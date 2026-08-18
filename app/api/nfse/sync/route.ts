// Sincronização de NFS-e recebidas com o gov.br (ADN) — SERVER-ONLY, runtime Node.
// Roda por empresa OU para todas. Para cada empresa devolve um diagnóstico
// completo: HTTP status, quantas notas foram encontradas/gravadas, o motivo em
// caso de falha e uma amostra da resposta — nada de falhar em silêncio.
import { getAdminClient, decrypt } from '../../../../lib/salao/server'
import { agenteMTLS, consultarADN, baseADN } from '../../../../lib/salao/adn'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type DiagEmpresa = {
  empresa_id: string
  empresaNome: string
  ok: boolean
  status: number
  encontradas: number
  gravadas: number
  ignoradas?: number
  canceladas?: number
  ultimoNsu?: number
  houveMais?: boolean
  erro?: string
  amostra?: string
}

export async function POST(req: Request) {
  let empresaFiltro: string | null = null
  let reset = false
  try {
    const body = await req.json().catch(() => null)
    empresaFiltro = body?.empresa_id ?? null
    reset = body?.reset === true
  } catch { /* sem corpo — todas */ }

  let admin
  try { admin = getAdminClient() } catch (e) {
    return Response.json({ ok: false, erro: e instanceof Error ? e.message : 'Configuração ausente (SUPABASE_SERVICE_ROLE_KEY / SALON_ENC_KEY).' }, { status: 503 })
  }

  // Nomes das empresas (para a UI)
  const { data: empresasRows } = await admin.from('empresas').select('id, razao_social, apelido')
  const nomeDe = new Map((empresasRows ?? []).map((e: { id: string; razao_social: string; apelido: string | null }) => [e.id, e.apelido || e.razao_social]))

  let certQ = admin.from('salon_certificados').select('empresa_id, cert_cnpj, cert_pfx_b64, cert_senha_enc, cert_validade')
  if (empresaFiltro) certQ = certQ.eq('empresa_id', empresaFiltro)
  const { data: certs, error: certErr } = await certQ
  if (certErr) return Response.json({ ok: false, erro: `Erro ao ler certificados: ${certErr.message}` }, { status: 500 })
  if (!certs || certs.length === 0) {
    return Response.json({ ok: false, erro: empresaFiltro ? 'Esta empresa não tem certificado cadastrado.' : 'Nenhuma empresa com certificado cadastrado.' }, { status: 400 })
  }

  const empresas: DiagEmpresa[] = []
  let notasEncontradas = 0, registrosAtualizados = 0

  for (const c of certs) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cert = c as any
    const nome = nomeDe.get(cert.empresa_id) ?? '—'
    const base: DiagEmpresa = { empresa_id: cert.empresa_id, empresaNome: nome, ok: false, status: 0, encontradas: 0, gravadas: 0 }
    try {
      if (cert.cert_validade && new Date(cert.cert_validade) < new Date()) {
        empresas.push({ ...base, erro: `Certificado VENCIDO em ${cert.cert_validade}.` }); continue
      }
      let senha: string
      try { senha = decrypt(cert.cert_senha_enc) }
      catch { empresas.push({ ...base, erro: 'Não foi possível ler a senha do certificado (SALON_ENC_KEY mudou?). Reenvie o .pfx.' }); continue }

      const { data: syncRow } = await admin.from('salon_nfse_sync').select('ultimo_nsu').eq('empresa_id', cert.empresa_id).maybeSingle()
      const ultimoNsu = reset ? 0 : (syncRow?.ultimo_nsu ?? 0)

      const agent = agenteMTLS(cert.cert_pfx_b64, senha)
      const { notas, ultimoNsu: novoNsu, status, amostra, houveMais, rateLimited, cancelamentos } = await consultarADN({ agent, cnpj: cert.cert_cnpj ?? '', ultimoNsu })

      if (rateLimited && notas.length === 0) {
        empresas.push({ ...base, status: 429, houveMais: true, erro: 'O gov.br limitou as requisições (429). Aguarde ~1 minuto e clique em Sincronizar de novo (a busca continua de onde parou).', amostra }); continue
      }

      // Expurgo de CANCELADAS: o cancelamento chega como evento separado
      // (referenciando a chave). Marca como excluída qualquer nota já gravada
      // cuja chave foi cancelada — e remove essas chaves da gravação deste lote.
      const canceladasChaves = new Set((cancelamentos ?? []).map((c) => c.replace(/\s/g, '')).filter(Boolean))
      let canceladasMarcadas = 0
      if (canceladasChaves.size > 0) {
        const { count } = await admin.from('salon_notas')
          .update({ excluida: true, excluida_motivo: 'Cancelada na origem (evento de cancelamento NFS-e)', excluida_em: new Date().toISOString() }, { count: 'exact' })
          .eq('empresa_id', cert.empresa_id).eq('excluida', false).in('chave', Array.from(canceladasChaves))
        canceladasMarcadas = count ?? 0
      }

      // Guarda só notas RECEBIDAS e VÁLIDAS:
      //  - descarta valor <= 0 (sem valor — "lixo");
      //  - descarta canceladas na origem (chave em canceladasChaves);
      //  - descarta emitidas pela própria empresa (mesma raiz de CNPJ);
      //  - mantém CPFs e outros CNPJs (os profissionais).
      const raiz = (cert.cert_cnpj ?? '').replace(/\D/g, '').slice(0, 8)
      const recebidas = notas.filter((n) => {
        if (!(Number(n.valor) > 0)) return false
        if (n.chave && canceladasChaves.has(n.chave.replace(/\s/g, ''))) return false
        const emit = (n.prestadorDoc ?? '').replace(/\D/g, '')
        return !(raiz && emit.length === 14 && emit.slice(0, 8) === raiz)
      })
      const ignoradas = notas.length - recebidas.length
      const canceladas = canceladasChaves.size   // eventos de cancelamento vistos neste lote

      let gravadas = 0
      if (recebidas.length > 0) {
        const payload = recebidas.map((n) => ({
          empresa_id: cert.empresa_id, nsu: n.nsu, chave: n.chave || null,
          documento: n.prestadorDoc || null, emitente_nome: n.prestadorNome || null,
          numero: n.numero || null, valor: n.valor, data_emissao: n.dataEmissao || null,
          competencia: n.competencia || null,
          xml_original: n.xmlOriginal || null,
          xml_nome: n.numero ? `NFS-e-${n.numero}.xml` : null,
        }))
        let gravacao = await admin.from('salon_notas').upsert(payload, { onConflict: 'empresa_id,nsu', count: 'exact' })
        // Compatibilidade durante a migração: a baixa não para se o cache do
        // Supabase ainda não conhecer as colunas do XML. Após a migração, o XML
        // passa a ser preservado automaticamente.
        if (gravacao.error && /xml_(original|nome)|schema cache/i.test(gravacao.error.message)) {
          const payloadCompat = payload.map(({ xml_original: _xml, xml_nome: _nome, ...nota }) => nota)
          gravacao = await admin.from('salon_notas').upsert(payloadCompat, { onConflict: 'empresa_id,nsu', count: 'exact' })
        }
        const { error, count } = gravacao
        if (error) {
          const dica = /salon_notas/.test(error.message) && /exist|relation|does not/.test(error.message)
            ? ' (rode supabase_salao_v2.sql no Supabase para criar a tabela salon_notas)' : ''
          empresas.push({ ...base, status, encontradas: notas.length, erro: `Erro ao gravar: ${error.message}${dica}`, amostra }); continue
        }
        gravadas = count ?? payload.length
      }

      await admin.from('salon_nfse_sync').upsert({ empresa_id: cert.empresa_id, ultimo_nsu: novoNsu, ultima_sync: new Date().toISOString() })
      notasEncontradas += notas.length
      registrosAtualizados += gravadas
      empresas.push({ ...base, ok: true, status, encontradas: notas.length, gravadas, ignoradas, canceladas: canceladas + canceladasMarcadas, ultimoNsu: novoNsu, houveMais: houveMais || rateLimited, amostra })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const amigavel =
        /mac verify|wrong (final block|tag)|bad decrypt|PKCS12|passphrase|unable to load/i.test(msg) ? 'Certificado ou senha inválidos — reenvie o .pfx com a senha correta.'
        : /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|timeout|ETIMEDOUT/i.test(msg) ? `Não foi possível alcançar o ADN (${baseADN()}). Verifique a rede/ambiente.`
        : /alert|handshake|SSL|TLS number|certificate/i.test(msg) ? 'Falha no handshake TLS — o gov.br não aceitou este certificado (validade/tipo e-CNPJ/ambiente).'
        : msg
      empresas.push({ ...base, erro: amigavel })
    }
  }

  const houveFalha = empresas.some(e => !e.ok)
  return Response.json({ ok: !houveFalha, ambiente: baseADN(), notasEncontradas, registrosAtualizados, empresas })
}

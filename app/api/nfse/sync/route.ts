// Sincronização de NFS-e recebidas com o gov.br (ADN) — SERVER-ONLY, runtime Node.
// Roda por empresa OU para todas. Para cada empresa devolve um diagnóstico
// completo: HTTP status, quantas notas foram encontradas/gravadas, o motivo em
// caso de falha e uma amostra da resposta — nada de falhar em silêncio.
import { getAdminClient, decrypt } from '../../../../lib/salao/server'
import { agenteMTLS, consultarADN, baseADN } from '../../../../lib/salao/adn'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type DiagEmpresa = {
  empresa_id: string
  empresaNome: string
  ok: boolean
  status: number
  encontradas: number
  gravadas: number
  ultimoNsu?: number
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
      const { notas, ultimoNsu: novoNsu, status, amostra } = await consultarADN({ agent, cnpj: cert.cert_cnpj ?? '', ultimoNsu })

      let gravadas = 0
      if (notas.length > 0) {
        const payload = notas.map((n) => ({
          empresa_id: cert.empresa_id, nsu: n.nsu, chave: n.chave || null,
          documento: n.prestadorDoc || null, emitente_nome: n.prestadorNome || null,
          numero: n.numero || null, valor: n.valor, data_emissao: n.dataEmissao || null,
          competencia: n.competencia || null,
        }))
        const { error, count } = await admin.from('salon_notas').upsert(payload, { onConflict: 'empresa_id,nsu', count: 'exact' })
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
      empresas.push({ ...base, ok: true, status, encontradas: notas.length, gravadas, ultimoNsu: novoNsu, amostra })
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

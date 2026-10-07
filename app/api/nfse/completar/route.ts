// Completar base — SERVER-ONLY, runtime Node.
// "Pente-fino" da baixa: verifica se as notas já armazenadas estão COMPLETAS
// (com o XML original) e, quando faltam, busca no ADN APENAS as faixas de NSU
// necessárias — sem rebaixar tudo do zero, sem duplicar e sem mexer no cursor
// da baixa contínua (salon_nfse_sync fica intacto). Pode ser limitado a um
// período (competência de/até) e é resumível (o cliente chama em laço por NSU).
import { getAdminClient, decrypt } from '../../../../lib/salao/server'
import { agenteMTLS, consultarADN, baseADN } from '../../../../lib/salao/adn'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const empresaId: string | undefined = body?.empresa_id
  const de: string | undefined = body?.de        // 'YYYY-MM' competência inicial
  const ate: string | undefined = body?.ate       // 'YYYY-MM' competência final
  const nsuInicial: number | undefined = body?.nsuInicial
  if (!empresaId) return Response.json({ ok: false, erro: 'Empresa não informada.' }, { status: 400 })

  let admin
  try { admin = getAdminClient() }
  catch (e) { return Response.json({ ok: false, erro: e instanceof Error ? e.message : 'Config ausente.' }, { status: 503 }) }

  const { data: cert } = await admin.from('salon_certificados')
    .select('cert_cnpj, cert_pfx_b64, cert_senha_enc, cert_validade')
    .eq('empresa_id', empresaId).maybeSingle()
  if (!cert) return Response.json({ ok: false, erro: 'Esta unidade não tem certificado cadastrado.' }, { status: 400 })
  const c = cert as Row
  if (c.cert_validade && new Date(c.cert_validade) < new Date()) {
    return Response.json({ ok: false, erro: `Certificado VENCIDO em ${c.cert_validade}.` }, { status: 400 })
  }

  // 1) Notas INCOMPLETAS (sem XML) desta unidade, no período (se informado).
  //    A competência considerada é a efetiva (competencia_conf || competencia);
  //    como não dá para filtrar coalesce no PostgREST com OR, trazemos as sem
  //    XML e aplicamos o recorte de período no servidor.
  const PAG = 1000
  const incompletas: Row[] = []
  for (let off = 0; ; off += PAG) {
    const { data, error } = await admin.from('salon_notas')
      .select('id, nsu, chave, competencia, competencia_conf, data_emissao')
      .eq('empresa_id', empresaId).eq('excluida', false).is('xml_original', null)
      .order('nsu', { ascending: true }).range(off, off + PAG - 1)
    if (error) return Response.json({ ok: false, erro: `Erro ao ler a base: ${error.message}` }, { status: 500 })
    if (!data || data.length === 0) break
    incompletas.push(...data)
    if (data.length < PAG) break
  }
  const noPeriodo = (n: Row) => {
    if (!de && !ate) return true
    const comp = (n.competencia_conf || n.competencia || (n.data_emissao ? String(n.data_emissao).slice(0, 7) : '')) as string
    if (!comp) return true
    if (de && comp < de) return false
    if (ate && comp > ate) return false
    return true
  }
  const alvo = incompletas.filter((n) => noPeriodo(n) && Number(n.nsu) > 0)
  const faltavam = alvo.length
  if (faltavam === 0) {
    return Response.json({ ok: true, ambiente: baseADN(), empresaId, faltavam: 0, completadas: 0, aindaFaltam: 0, houveMais: false, proximoNsu: nsuInicial ?? 0 })
  }

  // 2) Busca APENAS as faixas de NSU necessárias. Começa no menor NSU faltante
  //    (ou no NSU informado pelo cliente, para retomar) e caminha 6 páginas.
  const porChave = new Map<string, string>()
  const porNsu = new Map<number, string>()
  for (const n of alvo) { if (n.chave) porChave.set(String(n.chave).replace(/\s/g, ''), n.id); porNsu.set(Number(n.nsu), n.id) }
  const menorNsu = Math.min(...alvo.map((n) => Number(n.nsu)))
  const start = Math.max(0, nsuInicial != null ? nsuInicial : menorNsu - 1)

  let senha: string
  try { senha = decrypt(c.cert_senha_enc) }
  catch { return Response.json({ ok: false, erro: 'Falha ao ler a senha do certificado (SALON_ENC_KEY mudou?). Reenvie o .pfx.' }, { status: 400 }) }

  try {
    const agent = agenteMTLS(c.cert_pfx_b64, senha)
    const { notas, ultimoNsu, houveMais, rateLimited, maxNsuDisponivel, status, amostra } =
      await consultarADN({ agent, cnpj: c.cert_cnpj ?? '', ultimoNsu: start, maxPaginas: 6 })

    if (rateLimited && notas.length === 0) {
      return Response.json({ ok: true, ambiente: baseADN(), empresaId, faltavam, completadas: 0, aindaFaltam: faltavam, rateLimited: true, houveMais: true, proximoNsu: start, maxNsu: maxNsuDisponivel || undefined })
    }

    // 3) Backfill do XML nas notas correspondentes (por chave; senão por NSU).
    let completadas = 0
    for (const n of notas) {
      if (!n.xmlOriginal) continue
      const id = (n.chave && porChave.get(String(n.chave).replace(/\s/g, ''))) || porNsu.get(Number(n.nsu))
      if (!id) continue
      const upd: Row = { xml_original: n.xmlOriginal, xml_nome: n.numero ? `NFS-e-${n.numero}.xml` : null }
      // Completa também dados que porventura tenham ficado vazios.
      if (n.chave) upd.chave = n.chave
      const { error } = await admin.from('salon_notas').update(upd).eq('id', id)
      if (!error) { completadas++; if (n.chave) porChave.delete(String(n.chave).replace(/\s/g, '')); porNsu.delete(Number(n.nsu)) }
    }

    const proximoNsu = ultimoNsu > start ? ultimoNsu : start + 1
    const aindaFaltam = faltavam - completadas
    // Continua enquanto o ADN tiver mais páginas E ainda houver faltantes além
    // do ponto atual (há notas incompletas com NSU > proximoNsu).
    const restamAdiante = alvo.some((n) => Number(n.nsu) >= proximoNsu && (porNsu.has(Number(n.nsu))))
    const seguir = (houveMais || (maxNsuDisponivel > proximoNsu)) && restamAdiante && aindaFaltam > 0
    return Response.json({ ok: true, ambiente: baseADN(), empresaId, faltavam, completadas, aindaFaltam, houveMais: seguir, proximoNsu, maxNsu: maxNsuDisponivel || undefined, status, amostra: completadas === 0 ? amostra : undefined })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const amigavel =
      /mac verify|wrong (final block|tag)|bad decrypt|PKCS12|passphrase|unable to load/i.test(msg) ? 'Certificado ou senha inválidos — reenvie o .pfx.'
      : /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|timeout|ETIMEDOUT/i.test(msg) ? `Não foi possível alcançar o ADN (${baseADN()}).`
      : msg
    return Response.json({ ok: false, erro: amigavel }, { status: 500 })
  }
}

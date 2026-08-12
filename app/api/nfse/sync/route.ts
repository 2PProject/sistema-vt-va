// Sincronização manual de NFS-e com o gov.br (ADN) — SERVER-ONLY, runtime Node.
// Para cada empresa com certificado: mTLS → consulta desde o último NSU → GRAVA
// as notas recebidas em salon_notas → guarda o novo NSU. A consulta de período
// é feita depois, sobre as notas já armazenadas.
// (Um cron futuro no Vercel Pro pode apontar para esta mesma rota, sem mudanças.)
import { getAdminClient, decrypt } from '../../../../lib/salao/server'
import { agenteMTLS, consultarADN, baseADN } from '../../../../lib/salao/adn'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let empresaFiltro: string | null = null
  let reset = false
  try {
    const body = await req.json().catch(() => null)
    empresaFiltro = body?.empresa_id ?? null
    reset = body?.reset === true
  } catch { /* sem corpo — sincroniza todas */ }

  let admin
  try { admin = getAdminClient() }
  catch (e) { return Response.json({ erro: e instanceof Error ? e.message : 'Config ausente.' }, { status: 503 }) }

  let certQ = admin.from('salon_certificados').select('empresa_id, cert_cnpj, cert_pfx_b64, cert_senha_enc')
  if (empresaFiltro) certQ = certQ.eq('empresa_id', empresaFiltro)
  const { data: certs } = await certQ
  if (!certs || certs.length === 0) {
    return Response.json({ erro: 'Nenhuma empresa com certificado configurado.' }, { status: 400 })
  }

  let notasEncontradas = 0, registrosAtualizados = 0
  const porEmpresa: { empresa_id: string; notas: number; atualizados: number; erro?: string }[] = []

  for (const c of certs) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cert = c as any
    try {
      const { data: syncRow } = await admin.from('salon_nfse_sync').select('ultimo_nsu').eq('empresa_id', cert.empresa_id).maybeSingle()
      const ultimoNsu = reset ? 0 : (syncRow?.ultimo_nsu ?? 0)
      const agent = agenteMTLS(cert.cert_pfx_b64, decrypt(cert.cert_senha_enc))
      const { notas, ultimoNsu: novoNsu } = await consultarADN({ agent, cnpj: cert.cert_cnpj ?? '', ultimoNsu })

      // Grava as notas recebidas (idempotente por empresa_id + nsu)
      let gravadas = 0
      if (notas.length > 0) {
        const payload = notas.map((n) => ({
          empresa_id: cert.empresa_id, nsu: n.nsu, chave: n.chave || null,
          documento: n.prestadorDoc, emitente_nome: n.prestadorNome || null,
          numero: n.numero || null, valor: n.valor, data_emissao: n.dataEmissao || null,
          competencia: n.competencia || null,
        }))
        const { error, count } = await admin.from('salon_notas').upsert(payload, { onConflict: 'empresa_id,nsu', count: 'exact' })
        if (error) throw new Error(error.message)
        gravadas = count ?? payload.length
      }

      await admin.from('salon_nfse_sync').upsert({
        empresa_id: cert.empresa_id, ultimo_nsu: novoNsu, ultima_sync: new Date().toISOString(),
      })
      notasEncontradas += notas.length
      registrosAtualizados += gravadas
      porEmpresa.push({ empresa_id: cert.empresa_id, notas: notas.length, atualizados: gravadas })
    } catch (e) {
      porEmpresa.push({ empresa_id: cert.empresa_id, notas: 0, atualizados: 0, erro: e instanceof Error ? e.message : 'falha' })
    }
  }

  return Response.json({ ok: true, ambiente: baseADN(), notasEncontradas, registrosAtualizados, empresas: porEmpresa })
}

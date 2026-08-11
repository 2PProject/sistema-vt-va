// Sincronização manual de NFS-e com o gov.br (ADN) — SERVER-ONLY, runtime Node.
// Para cada empresa com certificado: mTLS → consulta desde o último NSU → cruza
// pelas CPF/CNPJ dos prestadores → atualiza status e guarda o novo NSU.
// (Um cron futuro no Vercel Pro pode apontar para esta mesma rota, sem mudanças.)
import { getAdminClient, decrypt } from '../../../../lib/salao/server'
import { agenteMTLS, consultarADN } from '../../../../lib/salao/adn'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let empresaFiltro: string | null = null
  try {
    const body = await req.json().catch(() => null)
    empresaFiltro = body?.empresa_id ?? null
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
      const ultimoNsu = syncRow?.ultimo_nsu ?? 0
      const agent = agenteMTLS(cert.cert_pfx_b64, decrypt(cert.cert_senha_enc))
      const { notas, ultimoNsu: novoNsu } = await consultarADN({ agent, cnpj: cert.cert_cnpj ?? '', ultimoNsu })

      let atualizados = 0
      for (const nota of notas) {
        const { data: prof } = await admin.from('salon_professionals')
          .select('id').eq('empresa_id', cert.empresa_id).eq('documento', nota.prestadorDoc).maybeSingle()
        if (!prof) continue
        // Casa a comissão: por competência se houver; senão a pendente mais antiga.
        let alvo
        if (nota.competencia) {
          const { data } = await admin.from('salon_comissoes').select('id')
            .eq('empresa_id', cert.empresa_id).eq('profissional_id', prof.id).eq('mes_ref', nota.competencia).maybeSingle()
          alvo = data
        }
        if (!alvo) {
          const { data } = await admin.from('salon_comissoes').select('id')
            .eq('empresa_id', cert.empresa_id).eq('profissional_id', prof.id).is('nf_numero', null)
            .order('mes_ref', { ascending: true }).limit(1).maybeSingle()
          alvo = data
        }
        if (!alvo) continue
        await admin.from('salon_comissoes').update({
          nf_numero: nota.numero, nf_data: nota.dataEmissao || null, nf_valor: nota.valor,
          nf_origem: 'adn', status: 'recebida', confirmado_em: new Date().toISOString(),
        }).eq('id', alvo.id)
        await admin.from('salon_comissoes_log').insert({
          comissao_id: alvo.id, acao: 'sync_adn', detalhe: `NF ${nota.numero} (NSU ${nota.nsu})`, usuario: 'gov.br',
        })
        atualizados++
      }

      await admin.from('salon_nfse_sync').upsert({
        empresa_id: cert.empresa_id, ultimo_nsu: novoNsu, ultima_sync: new Date().toISOString(),
      })
      notasEncontradas += notas.length
      registrosAtualizados += atualizados
      porEmpresa.push({ empresa_id: cert.empresa_id, notas: notas.length, atualizados })
    } catch (e) {
      porEmpresa.push({ empresa_id: cert.empresa_id, notas: 0, atualizados: 0, erro: e instanceof Error ? e.message : 'falha' })
    }
  }

  return Response.json({ ok: true, notasEncontradas, registrosAtualizados, empresas: porEmpresa })
}

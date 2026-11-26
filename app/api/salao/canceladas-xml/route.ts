// Marca como CANCELADA/excluída toda nota cujo XML já armazenado indica
// cancelamento (cSitNFSe=2, tags de cancelamento ou evento tpEvento 1011/1051/
// 1055). Resolve o caso de nota cancelada que estava sendo trazida como válida.
// SERVER-ONLY, runtime Node. Reaproveita cancelamentoDoXml de lib/salao/adn.
import { getAdminClient } from '../../../../lib/salao/server'
import { cancelamentoDoXml } from '../../../../lib/salao/adn'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const empresaId: string | undefined = body?.empresa_id
  let admin
  try { admin = getAdminClient() }
  catch (e) { return Response.json({ ok: false, erro: e instanceof Error ? e.message : 'Config ausente.' }, { status: 503 }) }

  const PAG = 500
  let lastId = ''
  let verificadas = 0, marcadas = 0, desvinculadas = 0
  let houveMais = false

  // Cursor por id (estável): a marcação não muda o id, então o cursor avança
  // sem repetir/pular, mesmo com notas saindo/entrando de outros filtros.
  for (let page = 0; page < 400; page++) {
    let q = admin.from('salon_notas').select('id, xml_original')
      .eq('excluida', false).eq('cancelada', false).not('xml_original', 'is', null)
      .order('id', { ascending: true }).limit(PAG)
    if (empresaId) q = q.eq('empresa_id', empresaId)
    if (lastId) q = q.gt('id', lastId)
    const { data, error } = await q
    if (error) return Response.json({ ok: false, erro: `Erro ao ler notas: ${error.message}` }, { status: 500 })
    if (!data || data.length === 0) break
    verificadas += data.length
    lastId = (data[data.length - 1] as Row).id

    for (const n of data as Row[]) {
      if (!cancelamentoDoXml(n.xml_original)) continue
      // Desvincula (o trigger reabre a comissão e a nota) e MARCA como cancelada,
      // mas SEM excluir: a nota continua visível com o rótulo "Cancelada".
      await admin.from('salon_comissao_notas').delete().eq('nota_id', n.id)
      const { count } = await admin.from('salon_comissoes')
        .update({ nota_id: null, status: 'pendente', nf_numero: null, nf_data: null, nf_valor: null, nf_origem: null, confirmado_em: null }, { count: 'exact' })
        .eq('nota_id', n.id)
      desvinculadas += count ?? 0
      const { error: e2 } = await admin.from('salon_notas')
        .update({ cancelada: true, conferida: false, conferida_em: null, conferida_por: null, competencia_conf: null })
        .eq('id', n.id)
      if (!e2) marcadas++
    }

    if (data.length < PAG) break
    if (page === 399) houveMais = true
  }

  return Response.json({ ok: true, verificadas, marcadas, desvinculadas, houveMais })
}

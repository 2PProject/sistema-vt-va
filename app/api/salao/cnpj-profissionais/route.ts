// Atualização do CNPJ/CPF dos profissionais do Salão — SERVER-ONLY (service_role).
// Regra (pedido do cliente): o documento ATUAL de cada profissional (agrupado por
// NOME na unidade) é o da NOTA VINCULADA que você confirmou; se não houver nota
// vinculada, é o da ÚLTIMA IMPORTAÇÃO (competência mais recente).
// POST { empresaId?, aplicar? }:
//  - aplicar=false (padrão): só devolve a PRÉVIA (o que mudaria).
//  - aplicar=true: grava o documento atual em salon_comissoes e no cadastro
//    salon_professionals. Não é destrutivo além da correção do documento.
import { getAdminClient } from '../../../../lib/salao/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const soDig = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')
const valido = (d: string) => d.length === 11 || d.length === 14
const norm = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function paginado(build: (de: number, ate: number) => any): Promise<any[]> {
  const out: any[] = []; const tam = 1000
  for (let p = 0; p < 200; p++) {
    const { data, error } = await build(p * tam, (p + 1) * tam - 1)
    if (error) throw new Error(error.message)
    const arr = data ?? []; out.push(...arr)
    if (arr.length < tam) break
  }
  return out
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const empresaId: string | undefined = body?.empresaId || undefined
  const aplicar = body?.aplicar === true

  let admin
  try { admin = getAdminClient() } catch (e) {
    return Response.json({ ok: false, erro: e instanceof Error ? e.message : 'Configuração ausente.' }, { status: 503 })
  }

  // Comissões importadas (mais recentes primeiro).
  const coms = await paginado((de, ate) => {
    let q = admin.from('salon_comissoes').select('id, empresa_id, nome, documento, nota_id, mes_ref')
      .order('mes_ref', { ascending: false }).range(de, ate)
    if (empresaId) q = q.eq('empresa_id', empresaId)
    return q
  })

  // Documento das notas vinculadas (por nota_id).
  const notaIds = Array.from(new Set(coms.map((c) => c.nota_id).filter(Boolean))) as string[]
  const notaDoc = new Map<string, string>()
  for (let i = 0; i < notaIds.length; i += 300) {
    const { data } = await admin.from('salon_notas').select('id, documento').in('id', notaIds.slice(i, i + 300))
    ;(data ?? []).forEach((n: { id: string; documento: string | null }) => notaDoc.set(n.id, soDig(n.documento)))
  }

  // Agrupa por unidade + nome normalizado.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Grupo = { empresa_id: string; nome: string; coms: any[]; linked: { doc: string; mes: string }[]; imports: { doc: string; mes: string }[] }
  const grupos = new Map<string, Grupo>()
  for (const c of coms) {
    const k = `${c.empresa_id}|${norm(c.nome)}`
    const g: Grupo = grupos.get(k) || { empresa_id: c.empresa_id, nome: c.nome, coms: [], linked: [], imports: [] }
    g.coms.push(c)
    const mes = String(c.mes_ref ?? '')
    const dImp = soDig(c.documento); if (valido(dImp)) g.imports.push({ doc: dImp, mes })
    if (c.nota_id) { const dN = notaDoc.get(c.nota_id); if (dN && valido(dN)) g.linked.push({ doc: dN, mes }) }
    grupos.set(k, g)
  }

  type Item = { empresa_id: string; nome: string; cnpjAtual: string; fonte: string; divergentes: string[]; comissoes: number; aplicaveis: number; comIds: string[] }
  const itens: Item[] = []
  for (const g of grupos.values()) {
    g.linked.sort((a, b) => b.mes.localeCompare(a.mes))
    g.imports.sort((a, b) => b.mes.localeCompare(a.mes))
    const cnpjAtual = g.linked[0]?.doc || g.imports[0]?.doc || ''
    if (!cnpjAtual) continue
    const fonte = g.linked[0] ? 'nota vinculada' : 'última importação'
    const docsDistintos = Array.from(new Set(g.coms.map((c) => soDig(c.documento)).filter(valido)))
    const divergentes = docsDistintos.filter((d) => d !== cnpjAtual)
    const comAtualizar = g.coms.filter((c) => soDig(c.documento) !== cnpjAtual)
    itens.push({ empresa_id: g.empresa_id, nome: g.nome, cnpjAtual, fonte, divergentes, comissoes: g.coms.length, aplicaveis: comAtualizar.length, comIds: comAtualizar.map((c) => c.id) })
  }
  itens.sort((a, b) => (b.aplicaveis - a.aplicaveis) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'))

  let aplicadas = 0, conflitos = 0, profissionais = 0
  if (aplicar) {
    for (const it of itens) {
      // Cadastro-mestre de profissionais com o documento atual.
      const up = await admin.from('salon_professionals').upsert({ empresa_id: it.empresa_id, documento: it.cnpjAtual, nome: it.nome }, { onConflict: 'empresa_id,documento' })
      if (!up.error) profissionais++
      // Corrige o documento nas comissões (o casamento por CNPJ passa a valer).
      for (const id of it.comIds) {
        const { error } = await admin.from('salon_comissoes').update({ documento: it.cnpjAtual }).eq('id', id)
        if (error) conflitos++; else aplicadas++
      }
    }
  }

  return Response.json({
    ok: true,
    total: itens.length,
    comDivergencia: itens.filter((i) => i.aplicaveis > 0).length,
    itens: itens.map(({ comIds: _c, ...r }) => r),
    aplicadas, conflitos, profissionais,
  })
}

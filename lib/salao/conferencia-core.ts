// Núcleo da CONFERÊNCIA — SERVER-ONLY (roda com service_role, ignora RLS).
// Fonte única de verdade da reconciliação planilha (salon_comissoes) × notas
// recebidas (salon_notas). Toda gravação passa por aqui, no servidor — o cliente
// nunca escreve direto no banco (evita falha silenciosa por RLS).
//
// Regra de casamento (definitiva):
//   CNPJ do emitente (documento) + competência (dCompet da nota = mes_ref da
//   planilha). O VALOR é comparação, nunca filtro (o crédito da planilha pode
//   diferir do valor bruto da NFS-e). Notas de valor 0 (canceladas) são ignoradas.
//   "Nota usada" conta só dentro da MESMA competência (vínculo de outro mês não
//   bloqueia). Casa em 2 passadas: mesma unidade primeiro, depois qualquer unidade.
//
// EFICIÊNCIA: as consultas FILTRAM no banco (por competência e por CNPJ) — nunca
// carregam a tabela inteira. E paginam com .range(): o PostgREST devolve no
// máximo 1000 linhas por requisição (era esta a causa de "Notas no mês: 2" —
// só as 1000 notas mais antigas vinham, e as do mês ficavam de fora).
import type { SupabaseClient } from '@supabase/supabase-js'

export type Esperada = {
  id: string
  empresa_id: string
  mes_ref: string
  documento: string | null
  nome: string | null
  valor_comissao: number
  status: string
  nota_id: string | null
  pendencia: string | null
  observacao: string | null
  nf_numero: string | null
  nf_data: string | null
  nf_valor: number | null
  empresaNome?: string
  nota?: { numero: string | null; valor: number | null; data_emissao: string | null; competencia: string | null } | null
  // diagnóstico da pendência
  dicaNotaValor?: number | null
  dicaNotaComp?: string | null
  dicaNotaId?: string | null
  dicaNotaEmpresa?: string | null
  dicaOutraEmpresa?: boolean
  dicaMotivo?: string
}

export type NotaLivre = {
  id: string
  empresa_id: string
  documento: string | null
  emitente_nome: string | null
  numero: string | null
  valor: number | null
  data_emissao: string | null
  competencia: string | null
  competencia_conf: string | null
  conferida?: boolean
  empresaNome?: string
}

export type Diagnostico = {
  competencia: string
  notasNaCompetencia: number
  comissoesNaCompetencia: number
  conferidas: number
  pendentes: number
  pendentesComNotaNoMes: number
  pendentesComNotaDisponivel: number
  notasSemVinculo: number
  totalNotas: number
  distComp: { comp: string; n: number }[]  // meses das notas dos profissionais pendentes
}

export type ConferenciaResultado = {
  pendentes: Esperada[]
  conferidas: Esperada[]
  semVinculo: NotaLivre[]
  pendenciasImport: Esperada[]
  diagnostico: Diagnostico
}

export function dig(s: string | null | undefined): string { return (s ?? '').replace(/\D/g, '') }

// Competência efetiva da nota: dCompet real (competencia) → override manual
// (competencia_conf) → mês da emissão. O sync já grava competencia = dCompet ||
// mês da emissão, então a coluna `competencia` costuma bastar.
export function notaComp(n: { competencia_conf?: string | null; competencia?: string | null; data_emissao?: string | null }): string {
  return (n.competencia || n.competencia_conf || (n.data_emissao ? String(n.data_emissao).slice(0, 7) : '')) as string
}

const NOTA_COLS = 'id, empresa_id, documento, emitente_nome, numero, valor, data_emissao, competencia, competencia_conf, conferida, empresas(apelido, razao_social)'
const PAGINA = 1000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NotaRow = any
// Builder do supabase-js — tipado como any para evitar acoplar à API interna.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QB = any

/** SELECT paginado (contorna o teto de 1000 linhas do PostgREST). */
async function paginado(construir: (de: number, ate: number) => QB): Promise<NotaRow[]> {
  const todas: NotaRow[] = []
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await construir(de, de + PAGINA - 1)
    if (error || !data || data.length === 0) break
    todas.push(...(data as NotaRow[]))
    if ((data as NotaRow[]).length < PAGINA) break
  }
  return todas
}

function empresaNomeDe(row: NotaRow): string {
  const e = Array.isArray(row.empresas) ? row.empresas[0] : row.empresas
  return e?.apelido || e?.razao_social || ''
}

/** Notas de UMA competência (todas as unidades). Filtra no banco. */
async function notasDaCompetencia(admin: SupabaseClient, competencia: string, soComValor = false): Promise<NotaRow[]> {
  return paginado((de, ate) => {
    let q = admin.from('salon_notas').select(NOTA_COLS).eq('competencia', competencia).order('id', { ascending: true }).range(de, ate)
    if (soComValor) q = q.gt('valor', 0)
    return q as unknown as QB
  })
}

/** Notas de um conjunto de CNPJs (qualquer competência). Filtra no banco. */
async function notasDosDocumentos(admin: SupabaseClient, docs: string[]): Promise<NotaRow[]> {
  if (docs.length === 0) return []
  const out: NotaRow[] = []
  for (let i = 0; i < docs.length; i += 200) {           // .in() em blocos
    const lote = docs.slice(i, i + 200)
    const parte = await paginado((de, ate) =>
      admin.from('salon_notas').select(NOTA_COLS).in('documento', lote).order('id', { ascending: true }).range(de, ate) as unknown as QB)
    out.push(...parte)
  }
  return out
}

/** Vínculos (nota_id) em uso — por competência (default) ou globais. Paginado. */
async function notasUsadas(admin: SupabaseClient, competencia?: string): Promise<Set<string>> {
  const rows = await paginado((de, ate) => {
    let q = admin.from('salon_comissoes').select('nota_id').not('nota_id', 'is', null).order('id', { ascending: true }).range(de, ate)
    if (competencia) q = q.eq('mes_ref', competencia)
    return q as unknown as QB
  })
  const set = new Set<string>()
  for (const r of rows) if (r.nota_id) set.add(r.nota_id)
  return set
}

async function comissoesDaCompetencia(admin: SupabaseClient, competencia: string, empresaId?: string): Promise<NotaRow[]> {
  return paginado((de, ate) => {
    let q = admin.from('salon_comissoes').select('*, empresas(apelido, razao_social)').eq('mes_ref', competencia).order('id', { ascending: true }).range(de, ate)
    if (empresaId) q = q.eq('empresa_id', empresaId)
    return q as unknown as QB
  })
}

/**
 * Reconcilia a competência (CNPJ + competência, valor informativo).
 * Duas passadas: mesma unidade → qualquer unidade. Auto-cura vínculos de outro mês.
 */
export async function reconciliar(admin: SupabaseClient, competencia: string, empresaId?: string):
  Promise<{ conferidas: number; pendentes: number; divergencias: number; outraEmpresa: number }> {
  let cq = admin.from('salon_comissoes').select('id, empresa_id, documento, valor_comissao')
    .eq('mes_ref', competencia).is('nota_id', null)
  if (empresaId) cq = cq.eq('empresa_id', empresaId)
  const { data: pend } = await cq
  if (!pend || pend.length === 0) return { conferidas: 0, pendentes: 0, divergencias: 0, outraEmpresa: 0 }

  const usadas = await notasUsadas(admin, competencia)
  const notas = await notasDaCompetencia(admin, competencia, true) // só as notas do mês, com valor > 0

  type Cand = { id: string; empresa_id: string; valor: number; numero: string | null; data_emissao: string | null }
  const porDoc = new Map<string, Cand[]>()
  for (const n of notas) {
    if (usadas.has(n.id)) continue
    const k = dig(n.documento); if (!k) continue
    const arr = porDoc.get(k) ?? []
    arr.push({ id: n.id, empresa_id: n.empresa_id, valor: Number(n.valor) || 0, numero: n.numero, data_emissao: n.data_emissao })
    porDoc.set(k, arr)
  }

  let conferidas = 0, divergencias = 0, outraEmpresa = 0
  const feitos = new Set<string>()

  async function casar(p: { id: string; empresa_id: string; valor_comissao: number }, arr: Cand[], nota: Cand) {
    const alvo = Number(p.valor_comissao) || 0
    await admin.from('salon_comissoes').update({
      nota_id: null, status: 'pendente', nf_numero: null, nf_data: null, nf_valor: null, nf_origem: null, confirmado_em: null,
    }).eq('nota_id', nota.id).neq('id', p.id)
    await admin.from('salon_comissoes').update({
      nota_id: nota.id, status: 'conferida',
      nf_numero: nota.numero ?? null, nf_data: nota.data_emissao ?? null, nf_valor: nota.valor, nf_origem: 'adn',
      confirmado_em: new Date().toISOString(),
    }).eq('id', p.id)
    await admin.from('salon_notas').update({ conferida: true }).eq('id', nota.id)
    arr.splice(arr.indexOf(nota), 1)
    feitos.add(p.id)
    if (Math.abs(nota.valor - alvo) >= 0.01) divergencias++
    if (nota.empresa_id !== p.empresa_id) outraEmpresa++
    conferidas++
  }

  // 1ª passada: mesma unidade
  for (const p of pend) {
    const arr = porDoc.get(dig(p.documento)); if (!arr || arr.length === 0) continue
    const alvo = Number(p.valor_comissao) || 0
    const mine = arr.filter((n) => n.empresa_id === p.empresa_id)
    if (mine.length === 0) continue
    mine.sort((a, b) => Math.abs(a.valor - alvo) - Math.abs(b.valor - alvo))
    await casar(p, arr, mine[0])
  }
  // 2ª passada: qualquer unidade
  for (const p of pend) {
    if (feitos.has(p.id)) continue
    const arr = porDoc.get(dig(p.documento)); if (!arr || arr.length === 0) continue
    const alvo = Number(p.valor_comissao) || 0
    arr.sort((a, b) => Math.abs(a.valor - alvo) - Math.abs(b.valor - alvo))
    await casar(p, arr, arr[0])
  }

  return { conferidas, pendentes: pend.length - conferidas, divergencias, outraEmpresa }
}

/** Zera vínculos de conferência (competência/empresa opcionais) para refazer do zero. */
export async function limpar(admin: SupabaseClient, competencia?: string, empresaId?: string): Promise<{ limpos: number }> {
  const rows = await paginado((de, ate) => {
    let sel = admin.from('salon_comissoes').select('id, nota_id').not('nota_id', 'is', null).order('id', { ascending: true }).range(de, ate)
    if (competencia) sel = sel.eq('mes_ref', competencia)
    if (empresaId) sel = sel.eq('empresa_id', empresaId)
    return sel as unknown as QB
  })
  const notaIds = Array.from(new Set(rows.map((r) => r.nota_id).filter(Boolean))) as string[]

  let upd = admin.from('salon_comissoes').update({
    nota_id: null, status: 'pendente', nf_numero: null, nf_data: null, nf_valor: null, nf_origem: null, confirmado_em: null,
  }).not('nota_id', 'is', null)
  if (competencia) upd = upd.eq('mes_ref', competencia)
  if (empresaId) upd = upd.eq('empresa_id', empresaId)
  await upd

  for (let i = 0; i < notaIds.length; i += 200) {
    await admin.from('salon_notas').update({ conferida: false }).in('id', notaIds.slice(i, i + 200))
  }
  return { limpos: rows.length }
}

/** Estado completo da conferência + diagnóstico do banco (server-side). */
export async function carregar(admin: SupabaseClient, competencia: string, empresaId?: string): Promise<ConferenciaResultado> {
  const coms = await comissoesDaCompetencia(admin, competencia, empresaId)

  // notas vinculadas (para exibir na aba Conferidas)
  const linkIds = Array.from(new Set(coms.filter((c) => c.nota_id).map((c) => c.nota_id))) as string[]
  const notaById = new Map<string, { numero: string | null; valor: number | null; data_emissao: string | null; competencia: string | null }>()
  for (let i = 0; i < linkIds.length; i += 200) {
    const { data: nl } = await admin.from('salon_notas').select('id, numero, valor, data_emissao, competencia').in('id', linkIds.slice(i, i + 200))
    ;(nl ?? []).forEach((n: NotaRow) => notaById.set(n.id, { numero: n.numero, valor: n.valor, data_emissao: n.data_emissao, competencia: n.competencia }))
  }

  const mapEsp = (c: NotaRow): Esperada => {
    const e = Array.isArray(c.empresas) ? c.empresas[0] : c.empresas
    return { ...c, empresaNome: e?.apelido || e?.razao_social || '', nota: c.nota_id ? (notaById.get(c.nota_id) ?? null) : null }
  }
  const conferidas = coms.filter((c) => c.nota_id).map(mapEsp)
  const pendenciasImport = coms.filter((c) => !c.nota_id && c.pendencia).map(mapEsp)
  const pendentes = coms.filter((c) => !c.nota_id && !c.pendencia).map(mapEsp)

  // Notas do mês (filtradas no banco) + vínculos do mês
  const notasMes = await notasDaCompetencia(admin, competencia)
  const usadasNoMes = await notasUsadas(admin, competencia)

  const semVinculo: NotaLivre[] = notasMes
    .filter((n) => !usadasNoMes.has(n.id))
    .map((n) => ({ ...n, empresaNome: empresaNomeDe(n) }))

  // Notas dos CNPJs pendentes (qualquer mês) — para a dica e a distribuição.
  const pendDocs = Array.from(new Set(pendentes.map((p) => dig(p.documento)).filter(Boolean)))
  const notasPend = await notasDosDocumentos(admin, pendDocs)

  // Índices
  const porDocPend = new Map<string, NotaRow[]>()
  for (const n of notasPend) { const k = dig(n.documento); if (!k) continue; (porDocPend.get(k) ?? porDocPend.set(k, []).get(k)!).push(n) }
  const porDocMes = new Map<string, NotaRow[]>()
  const porDocMesLivre = new Map<string, NotaRow[]>()
  for (const n of notasMes) {
    if (!(Number(n.valor) > 0)) continue
    const k = dig(n.documento); if (!k) continue
    ;(porDocMes.get(k) ?? porDocMes.set(k, []).get(k)!).push(n)
    if (!usadasNoMes.has(n.id)) (porDocMesLivre.get(k) ?? porDocMesLivre.set(k, []).get(k)!).push(n)
  }

  let pendentesComNotaNoMes = 0, pendentesComNotaDisponivel = 0
  for (const p of pendentes) {
    const k = dig(p.documento)
    if (porDocMes.has(k)) pendentesComNotaNoMes++
    if (porDocMesLivre.has(k)) pendentesComNotaDisponivel++

    const cands = porDocPend.get(k)
    if (!cands || cands.length === 0) { p.dicaMotivo = 'nenhuma nota deste CNPJ baixada'; continue }
    const ord = [...cands].sort((a, b) => (notaComp(b) || '').localeCompare(notaComp(a) || ''))
    const best =
      ord.find((c) => c.empresa_id === p.empresa_id && notaComp(c) === competencia && Number(c.valor) > 0) ??
      ord.find((c) => notaComp(c) === competencia && Number(c.valor) > 0) ??
      ord.find((c) => c.empresa_id === p.empresa_id) ??
      ord[0]
    p.dicaNotaValor = Number(best.valor) || 0
    p.dicaNotaComp = notaComp(best) || null
    p.dicaNotaId = best.id
    p.dicaNotaEmpresa = empresaNomeDe(best)
    p.dicaOutraEmpresa = best.empresa_id !== p.empresa_id
    if (porDocMesLivre.has(k)) p.dicaMotivo = 'tem nota livre no mês — clique em Refazer conferência'
    else if (porDocMes.has(k)) p.dicaMotivo = 'nota do mês já vinculada a outro registro'
    else p.dicaMotivo = 'sem nota nesta competência (só de outro mês)'
  }

  // Distribuição por competência das notas dos profissionais pendentes.
  const distMap = new Map<string, number>()
  for (const n of notasPend) {
    if (!(Number(n.valor) > 0)) continue
    const c = notaComp(n) || '(sem competência)'
    distMap.set(c, (distMap.get(c) ?? 0) + 1)
  }
  const distComp = Array.from(distMap.entries()).map(([comp, n]) => ({ comp, n })).sort((a, b) => b.n - a.n).slice(0, 12)

  // Total de notas no banco (só a contagem, sem transferir linhas).
  const { count: totalNotas } = await admin.from('salon_notas').select('id', { count: 'exact', head: true })

  const diagnostico: Diagnostico = {
    competencia,
    notasNaCompetencia: notasMes.filter((n) => Number(n.valor) > 0).length,
    comissoesNaCompetencia: coms.length,
    conferidas: conferidas.length,
    pendentes: pendentes.length,
    pendentesComNotaNoMes,
    pendentesComNotaDisponivel,
    notasSemVinculo: semVinculo.length,
    totalNotas: totalNotas ?? 0,
    distComp,
  }

  return { pendentes, conferidas, semVinculo, pendenciasImport, diagnostico }
}

/** Notas do mesmo CNPJ (qualquer unidade/competência) ainda livres — p/ vínculo manual. */
export async function notasDoCnpj(admin: SupabaseClient, documento: string | null): Promise<NotaLivre[]> {
  const doc = dig(documento)
  if (!doc) return []
  const usadas = await notasUsadas(admin) // global: p/ manual, não mostrar já usadas
  const notas = await notasDosDocumentos(admin, [doc])
  return notas
    .filter((n) => !usadas.has(n.id))
    .map((n) => ({ ...n, empresaNome: empresaNomeDe(n) }))
    .sort((a, b) => (notaComp(b) || '').localeCompare(notaComp(a) || ''))
}

export async function vincular(admin: SupabaseClient, comissaoId: string, notaId: string): Promise<{ ok: boolean; erro?: string }> {
  const { data: n } = await admin.from('salon_notas').select('id, numero, valor, data_emissao').eq('id', notaId).maybeSingle()
  if (!n) return { ok: false, erro: 'Nota não encontrada.' }
  await admin.from('salon_comissoes').update({
    nota_id: null, status: 'pendente', nf_numero: null, nf_data: null, nf_valor: null, nf_origem: null, confirmado_em: null,
  }).eq('nota_id', notaId).neq('id', comissaoId)
  const { error } = await admin.from('salon_comissoes').update({
    nota_id: n.id, status: 'conferida', nf_numero: n.numero, nf_data: n.data_emissao, nf_valor: n.valor, nf_origem: 'manual',
    confirmado_em: new Date().toISOString(),
  }).eq('id', comissaoId)
  if (error) return { ok: false, erro: error.message }
  await admin.from('salon_notas').update({ conferida: true }).eq('id', n.id)
  return { ok: true }
}

export async function desvincular(admin: SupabaseClient, comissaoId: string): Promise<{ ok: boolean; erro?: string }> {
  const { data: c } = await admin.from('salon_comissoes').select('nota_id').eq('id', comissaoId).maybeSingle()
  const { error } = await admin.from('salon_comissoes').update({
    nota_id: null, status: 'pendente', nf_numero: null, nf_data: null, nf_valor: null, nf_origem: null, confirmado_em: null,
  }).eq('id', comissaoId)
  if (error) return { ok: false, erro: error.message }
  if (c?.nota_id) await admin.from('salon_notas').update({ conferida: false }).eq('id', c.nota_id)
  return { ok: true }
}

export async function corrigirCnpj(admin: SupabaseClient, comissaoId: string, documento: string): Promise<{ ok: boolean; erro?: string }> {
  const doc = dig(documento)
  if (doc.length !== 11 && doc.length !== 14) return { ok: false, erro: 'CNPJ/CPF inválido.' }
  const { error } = await admin.from('salon_comissoes').update({ documento: doc, pendencia: null }).eq('id', comissaoId)
  if (error) return { ok: false, erro: error.message }
  return { ok: true }
}

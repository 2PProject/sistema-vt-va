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

// ── Classificação e consulta (painel + filtros + tabela) ───────────────────
export type Situacao =
  | 'conferido' | 'conferido_com_divergencia' | 'divergencia_valor' | 'sem_nota' | 'nota_sem_vinculo'
  | 'falta_cnpj' | 'cnpj_invalido' | 'nota_outra_empresa'
  | 'possivel_duplicidade' | 'vinculo_sugerido' | 'aguardando_confirmacao' | 'corrigido_manual'

export const SITUACAO_LABEL: Record<Situacao, string> = {
  conferido: 'Conferido', conferido_com_divergencia: 'Conferido com divergência', divergencia_valor: 'Divergência de valor', sem_nota: 'Sem nota',
  nota_sem_vinculo: 'Nota sem vínculo', falta_cnpj: 'Falta CNPJ', cnpj_invalido: 'CNPJ inválido',
  nota_outra_empresa: 'Nota de outra empresa', possivel_duplicidade: 'Possível duplicidade',
  vinculo_sugerido: 'Vínculo sugerido', aguardando_confirmacao: 'Aguardando confirmação',
  corrigido_manual: 'Corrigido manualmente',
}

export type LinhaConsulta = {
  tipo: 'comissao' | 'nota'
  id: string
  empresa_id: string
  empresaNome: string
  mes_ref: string
  documento: string | null
  nome: string | null
  valor_comissao: number | null
  nota_id: string | null
  nf_numero: string | null
  nf_data: string | null
  nf_valor: number | null
  nota_competencia?: string | null
  nota_empresaNome?: string | null
  diferenca: number | null
  situacao: Situacao
  outraEmpresa: boolean
  corrigidoManual: boolean
  duplicada: boolean
  conferida?: boolean
  analise_manual?: boolean
  observacao?: string | null
  pendencia?: string | null
  confianca?: number
  confiancaLabel?: 'alta' | 'media' | 'baixa'
  sugestaoNotaId?: string | null
  sugestaoJustificativa?: string | null
}

export type Indicadores = {
  esperados: number; conferidos: number; semNota: number; notasSemVinculo: number
  divergencias: number; semCnpj: number; outraEmpresa: number; duplicidades: number
  aguardando: number; corrigidos: number
  valorEsperado: number; valorVinculado: number; diferenca: number
}

export type Filtros = {
  competencia: string
  empresaId?: string
  nome?: string
  documento?: string
  situacao?: Situacao | 'todas'
  vinculo?: 'vinculado' | 'nao_vinculado' | 'todas'
  valorMin?: number | null
  valorMax?: number | null
  soDivergencia?: boolean
  emissaoDe?: string | null
  emissaoAte?: string | null
  numeroNota?: string
  busca?: string
}
export type Ordenacao = { campo: 'nome' | 'empresa' | 'documento' | 'valor' | 'competencia' | 'situacao' | 'diferenca'; dir: 'asc' | 'desc' }
export type ConsultaResultado = { linhas: LinhaConsulta[]; total: number; pagina: number; tamanho: number; indicadores: Indicadores; distComp: { comp: string; n: number }[] }

function mesesDiff(a: string, b: string): number {
  const pa = (a || '').split('-').map(Number), pb = (b || '').split('-').map(Number)
  if (pa.length < 2 || pb.length < 2 || !pa[0] || !pb[0]) return 99
  return Math.abs((pa[0] * 12 + pa[1]) - (pb[0] * 12 + pb[1]))
}
function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '')
}
// Similaridade simples de nomes (Jaccard por tokens) — apenas apoio.
function similaridadeNome(a: string | null, b: string | null): number {
  const ta = new Set(norm(a).split(/\s+/).filter((x) => x.length > 2))
  const tb = new Set(norm(b).split(/\s+/).filter((x) => x.length > 2))
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0; ta.forEach((t) => { if (tb.has(t)) inter++ })
  return inter / new Set([...ta, ...tb]).size
}

/**
 * Pontuação de confiança de um vínculo candidato (0–100) + justificativa.
 * Bloqueia notas inválidas (usada/excluída/valor<=0). Considera CNPJ (base),
 * competência (peso alto, com janela de 1 mês), empresa destinatária, proximidade
 * de valor e semelhança de nome (apoio).
 */
export function pontuarVinculo(
  com: { empresa_id: string; mes_ref: string; valor_comissao: number; nome: string | null },
  nota: { empresa_id: string; valor: number | null; competencia?: string | null; competencia_conf?: string | null; data_emissao?: string | null; emitente_nome?: string | null },
): { score: number; label: 'alta' | 'media' | 'baixa'; justificativa: string } {
  const partes: string[] = ['mesmo CNPJ']
  let score = 40
  const compN = notaComp(nota)
  const dm = mesesDiff(compN, com.mes_ref)
  if (dm === 0) { score += 35; partes.push('mesma competência') }
  else if (dm === 1) { score += 12; partes.push('competência ±1 mês') }
  if (nota.empresa_id === com.empresa_id) { score += 15; partes.push('mesma empresa') }
  else partes.push('empresa diferente')
  const alvo = Number(com.valor_comissao) || 0
  const d = Math.abs((Number(nota.valor) || 0) - alvo)
  const rel = alvo > 0 ? d / alvo : 1
  if (d < 0.01) { score += 10; partes.push('valor exato') }
  else if (rel <= 0.05) { score += 6; partes.push('valor próximo') }
  else if (rel <= 0.15) { score += 3; partes.push('valor aproximado') }
  else partes.push('valor divergente')
  const sim = similaridadeNome(com.nome, nota.emitente_nome ?? null)
  if (sim >= 0.5) { score += 5; partes.push('nome compatível') }
  score = Math.min(100, score)
  const label = score >= 85 ? 'alta' : score >= 60 ? 'media' : 'baixa'
  return { score, label, justificativa: `${score}% de compatibilidade: ${partes.join(', ')}.` }
}

// Competência efetiva da nota: dCompet real (competencia) → override manual
// (competencia_conf) → mês da emissão. O sync já grava competencia = dCompet ||
// mês da emissão, então a coluna `competencia` costuma bastar.
export function notaComp(n: { competencia_conf?: string | null; competencia?: string | null; data_emissao?: string | null }): string {
  return (n.competencia || n.competencia_conf || (n.data_emissao ? String(n.data_emissao).slice(0, 7) : '')) as string
}

const NOTA_COLS = 'id, empresa_id, documento, emitente_nome, numero, valor, data_emissao, competencia, competencia_conf, conferida, excluida, duplicada, observacao, empresas(apelido, razao_social)'
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
async function notasDaCompetencia(admin: SupabaseClient, competencia: string, soComValor = false, empresaId?: string): Promise<NotaRow[]> {
  return paginado((de, ate) => {
    let q = admin.from('salon_notas').select(NOTA_COLS).or(`competencia.eq.${competencia},competencia_conf.eq.${competencia}`).eq('excluida',false).eq('classificacao','profissional').order('id', { ascending: true }).range(de, ate)
    if (empresaId) q = q.eq('empresa_id', empresaId)
    if (soComValor) q = q.gt('valor', 0)
    return q as unknown as QB
  })
}

/** Notas de um conjunto de CNPJs (qualquer competência). Filtra no banco. */
async function notasDosDocumentos(admin: SupabaseClient, docs: string[], empresaId?: string): Promise<NotaRow[]> {
  if (docs.length === 0) return []
  const out: NotaRow[] = []
  for (let i = 0; i < docs.length; i += 200) {           // .in() em blocos
    const lote = docs.slice(i, i + 200)
    const parte = await paginado((de, ate) =>
      (() => { let q=admin.from('salon_notas').select(NOTA_COLS).in('documento', lote).eq('excluida',false).eq('classificacao','profissional').order('id',{ascending:true}).range(de,ate);if(empresaId)q=q.eq('empresa_id',empresaId);return q as unknown as QB })())
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
    if (usadas.has(n.id) || n.excluida) continue
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
    const divergente=Math.abs(nota.valor-alvo)>=0.01
    if(divergente){divergencias++;await admin.from('salon_comissoes').update({observacao:`Conferido com divergência: esperado R$ ${alvo.toFixed(2)} e nota R$ ${nota.valor.toFixed(2)}.`}).eq('id',p.id)}
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
  const notasMes = await notasDaCompetencia(admin, competencia, false, empresaId)
  const usadasNoMes = await notasUsadas(admin, competencia)

  const semVinculo: NotaLivre[] = notasMes
    .filter((n) => !usadasNoMes.has(n.id) && !n.excluida)
    .map((n) => ({ ...n, empresaNome: empresaNomeDe(n) }))

  // Notas dos CNPJs pendentes (qualquer mês) — para a dica e a distribuição.
  const pendDocs = Array.from(new Set(pendentes.map((p) => dig(p.documento)).filter(Boolean)))
  const notasPend = await notasDosDocumentos(admin, pendDocs, empresaId)

  // Índices
  const porDocPend = new Map<string, NotaRow[]>()
  for (const n of notasPend) { const k = dig(n.documento); if (!k) continue; (porDocPend.get(k) ?? porDocPend.set(k, []).get(k)!).push(n) }
  const porDocMes = new Map<string, NotaRow[]>()
  const porDocMesLivre = new Map<string, NotaRow[]>()
  for (const n of notasMes) {
    if (!(Number(n.valor) > 0) || n.excluida) continue
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

/**
 * CONSULTA principal: classifica cada registro, calcula indicadores, aplica
 * filtros, ordena e pagina — tudo no servidor. As notas ficam no backend
 * (o frontend só recebe a página pedida + os totais).
 */
export async function consultar(admin: SupabaseClient, f: Filtros, ord: Ordenacao, pagina: number, tamanho: number): Promise<ConsultaResultado> {
  const competencia = f.competencia
  const coms = await comissoesDaCompetencia(admin, competencia, f.empresaId)
  const notasMesTodas = await notasDaCompetencia(admin, competencia, false, f.empresaId)
  const notasMes = notasMesTodas.filter((n) => !n.excluida)

  // Notas vinculadas (detalhe, inclusive de outra competência)
  const linkIds = Array.from(new Set(coms.filter((c) => c.nota_id).map((c) => c.nota_id))) as string[]
  const notaById = new Map<string, NotaRow>()
  for (let i = 0; i < linkIds.length; i += 200) {
    const { data } = await admin.from('salon_notas').select(NOTA_COLS).in('id', linkIds.slice(i, i + 200))
    ;(data ?? []).forEach((n: NotaRow) => notaById.set(n.id, n))
  }

  // Notas dos CNPJs pendentes (qualquer mês) — sugestões e distribuição
  const pendDocs = Array.from(new Set(coms.filter((c) => !c.nota_id && c.documento).map((c) => dig(c.documento))))
  const notasPend = await notasDosDocumentos(admin, pendDocs, f.empresaId)
  const usadasGlobal = await notasUsadas(admin)
  const usadasNoMes = await notasUsadas(admin, competencia)

  const porDocPend = new Map<string, NotaRow[]>()
  for (const n of notasPend) { const k = dig(n.documento); if (!k) continue; (porDocPend.get(k) ?? porDocPend.set(k, []).get(k)!).push(n) }

  // Duplicidades: mesma empresa + competência + CNPJ aparecendo mais de uma vez
  const dupCount = new Map<string, number>()
  for (const c of coms) { if (!c.documento) continue; const k = c.empresa_id + '|' + dig(c.documento); dupCount.set(k, (dupCount.get(k) ?? 0) + 1) }

  const linhas: LinhaConsulta[] = []

  for (const c of coms) {
    const e = Array.isArray(c.empresas) ? c.empresas[0] : c.empresas
    const empresaNome = e?.apelido || e?.razao_social || ''
    const duplicada = !!c.documento && (dupCount.get(c.empresa_id + '|' + dig(c.documento)) ?? 0) > 1
    const base: LinhaConsulta = {
      tipo: 'comissao', id: c.id, empresa_id: c.empresa_id, empresaNome, mes_ref: c.mes_ref,
      documento: c.documento, nome: c.nome, valor_comissao: Number(c.valor_comissao) || 0,
      nota_id: c.nota_id ?? null, nf_numero: c.nf_numero ?? null, nf_data: c.nf_data ?? null, nf_valor: c.nf_valor ?? null,
      diferenca: null, situacao: 'sem_nota', outraEmpresa: false, corrigidoManual: !!c.corrigido_manual,
      duplicada, analise_manual: !!c.analise_manual, observacao: c.observacao ?? null, pendencia: c.pendencia ?? null,
    }

    if (c.nota_id) {
      const n = notaById.get(c.nota_id)
      const ne = n && (Array.isArray(n.empresas) ? n.empresas[0] : n.empresas)
      base.nota_competencia = n ? notaComp(n) : null
      base.nota_empresaNome = ne?.apelido || ne?.razao_social || ''
      const vNota = Number(c.nf_valor ?? n?.valor ?? 0)
      base.nf_valor = vNota
      base.diferenca = Math.round((vNota - (base.valor_comissao || 0)) * 100) / 100
      base.outraEmpresa = !!n && n.empresa_id !== c.empresa_id
      base.situacao = duplicada ? 'possivel_duplicidade'
        : base.outraEmpresa ? 'nota_outra_empresa'
        : Math.abs(base.diferenca) >= 0.01 ? 'conferido_com_divergencia' : 'conferido'
    } else if (c.pendencia || !c.documento) {
      const doc = dig(c.documento)
      base.situacao = (doc && doc.length !== 11 && doc.length !== 14) ? 'cnpj_invalido' : 'falta_cnpj'
    } else {
      // pendente com CNPJ: melhor sugestão dentro da janela de ±1 mês, nota livre
      const cands = (porDocPend.get(dig(c.documento)) ?? []).filter((n) =>
        Number(n.valor) > 0 && !usadasGlobal.has(n.id) && mesesDiff(notaComp(n), c.mes_ref) <= 1)
      let melhor: { nota: NotaRow; p: ReturnType<typeof pontuarVinculo> } | null = null
      for (const n of cands) {
        const p = pontuarVinculo({ empresa_id: c.empresa_id, mes_ref: c.mes_ref, valor_comissao: base.valor_comissao || 0, nome: c.nome }, n)
        if (!melhor || p.score > melhor.p.score) melhor = { nota: n, p }
      }
      if (melhor && melhor.p.label !== 'baixa') {
        base.confianca = melhor.p.score
        base.confiancaLabel = melhor.p.label
        base.sugestaoNotaId = melhor.nota.id
        base.sugestaoJustificativa = melhor.p.justificativa
        base.situacao = duplicada ? 'possivel_duplicidade'
          : melhor.p.label === 'alta' ? 'vinculo_sugerido' : 'aguardando_confirmacao'
      } else {
        base.situacao = duplicada ? 'possivel_duplicidade' : 'sem_nota'
      }
    }
    if (base.corrigidoManual && base.situacao === 'conferido') base.situacao = 'corrigido_manual'
    linhas.push(base)
  }

  // Notas sem vínculo (do mês) → linhas tipo 'nota'
  for (const n of notasMes) {
    if (usadasGlobal.has(n.id)) continue
    if (!(Number(n.valor) > 0)) continue
    const e = Array.isArray(n.empresas) ? n.empresas[0] : n.empresas
    linhas.push({
      tipo: 'nota', id: n.id, empresa_id: n.empresa_id, empresaNome: e?.apelido || e?.razao_social || '',
      mes_ref: notaComp(n), documento: n.documento, nome: n.emitente_nome, valor_comissao: null,
      nota_id: n.id, nf_numero: n.numero, nf_data: n.data_emissao, nf_valor: Number(n.valor) || 0,
      nota_competencia: notaComp(n), diferenca: null, situacao: n.conferida ? 'conferido' : 'nota_sem_vinculo',
      outraEmpresa: false, corrigidoManual: false, duplicada: false, conferida: !!n.conferida,
    })
  }

  // ── Filtros base (afetam indicadores + tabela) ──
  const txt = (s: string | null | undefined) => norm(s)
  const buscaN = txt(f.busca)
  const nomeN = txt(f.nome)
  const docN = dig(f.documento)
  const baseRows = linhas.filter((l) => {
    if (nomeN && !txt(l.nome).includes(nomeN)) return false
    if (docN && !dig(l.documento).includes(docN)) return false
    if (f.numeroNota && !(l.nf_numero ?? '').includes(f.numeroNota)) return false
    if (f.valorMin != null && (l.valor_comissao ?? l.nf_valor ?? 0) < f.valorMin) return false
    if (f.valorMax != null && (l.valor_comissao ?? l.nf_valor ?? 0) > f.valorMax) return false
    if (f.emissaoDe && (!l.nf_data || l.nf_data < f.emissaoDe)) return false
    if (f.emissaoAte && (!l.nf_data || l.nf_data > f.emissaoAte)) return false
    if (buscaN) {
      const hay = `${txt(l.nome)} ${dig(l.documento)} ${l.nf_numero ?? ''} ${txt(l.empresaNome)}`
      if (!hay.includes(buscaN)) return false
    }
    return true
  })

  const indicadores: Indicadores = {
    esperados: baseRows.filter((l) => l.tipo === 'comissao').length,
    conferidos: baseRows.filter((l) => l.situacao === 'conferido' || l.situacao === 'conferido_com_divergencia' || l.situacao === 'corrigido_manual').length,
    semNota: baseRows.filter((l) => l.situacao === 'sem_nota').length,
    notasSemVinculo: baseRows.filter((l) => l.situacao === 'nota_sem_vinculo').length,
    divergencias: baseRows.filter((l) => l.situacao === 'divergencia_valor' || l.situacao === 'conferido_com_divergencia').length,
    semCnpj: baseRows.filter((l) => l.situacao === 'falta_cnpj' || l.situacao === 'cnpj_invalido').length,
    outraEmpresa: baseRows.filter((l) => l.outraEmpresa).length,
    duplicidades: baseRows.filter((l) => l.duplicada).length,
    aguardando: baseRows.filter((l) => l.situacao === 'aguardando_confirmacao' || l.situacao === 'vinculo_sugerido').length,
    corrigidos: baseRows.filter((l) => l.corrigidoManual).length,
    valorEsperado: Math.round(baseRows.filter((l) => l.tipo === 'comissao').reduce((s, l) => s + (l.valor_comissao || 0), 0) * 100) / 100,
    valorVinculado: Math.round(baseRows.filter((l) => l.nota_id && l.tipo === 'comissao').reduce((s, l) => s + (l.nf_valor || 0), 0) * 100) / 100,
    diferenca: 0,
  }
  indicadores.diferenca = Math.round((indicadores.valorEsperado - indicadores.valorVinculado) * 100) / 100

  // ── Filtros de recorte (tabela) ──
  let tableRows = baseRows
  if (f.situacao && f.situacao !== 'todas') tableRows = tableRows.filter((l) => l.situacao === f.situacao)
  if (f.vinculo === 'vinculado') tableRows = tableRows.filter((l) => l.tipo === 'comissao' && l.nota_id)
  else if (f.vinculo === 'nao_vinculado') tableRows = tableRows.filter((l) => !l.nota_id || l.tipo === 'nota')
  if (f.soDivergencia) tableRows = tableRows.filter((l) => l.diferenca != null && Math.abs(l.diferenca) >= 0.01)

  // ── Ordenação ──
  const dir = ord.dir === 'desc' ? -1 : 1
  const val = (l: LinhaConsulta): string | number => {
    switch (ord.campo) {
      case 'empresa': return txt(l.empresaNome)
      case 'documento': return dig(l.documento)
      case 'valor': return l.valor_comissao ?? l.nf_valor ?? 0
      case 'competencia': return l.mes_ref || ''
      case 'situacao': return SITUACAO_LABEL[l.situacao]
      case 'diferenca': return l.diferenca ?? 0
      default: return txt(l.nome)
    }
  }
  tableRows = [...tableRows].sort((a, b) => {
    const va = val(a), vb = val(b)
    if (va < vb) return -1 * dir
    if (va > vb) return 1 * dir
    return txt(a.nome).localeCompare(txt(b.nome))
  })

  const total = tableRows.length
  const de = Math.max(0, (pagina - 1) * tamanho)
  const linhasPag = tableRows.slice(de, de + tamanho)

  const distMap = new Map<string, number>()
  for (const n of notasPend) { if (!(Number(n.valor) > 0)) continue; const cc = notaComp(n) || '(sem)'; distMap.set(cc, (distMap.get(cc) ?? 0) + 1) }
  const distComp = Array.from(distMap.entries()).map(([comp, n]) => ({ comp, n })).sort((a, b) => b.n - a.n).slice(0, 12)

  return { linhas: linhasPag, total, pagina, tamanho, indicadores, distComp }
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

export async function vincular(admin: SupabaseClient, comissaoId: string, notaId: string, usuario?: string): Promise<{ ok: boolean; erro?: string }> {
  const [{ data: n }, { data: comissao }] = await Promise.all([
    admin.from('salon_notas').select('id, numero, valor, data_emissao').eq('id', notaId).maybeSingle(),
    admin.from('salon_comissoes').select('valor_comissao, observacao').eq('id', comissaoId).maybeSingle(),
  ])
  if (!n) return { ok: false, erro: 'Nota não encontrada.' }
  if (!comissao) return { ok: false, erro: 'Profissional importado não encontrado.' }
  const esperado=Number(comissao.valor_comissao)||0,valorNota=Number(n.valor)||0,diferenca=Math.round((valorNota-esperado)*100)/100
  const notaDivergencia=Math.abs(diferenca)>=0.01?`Conferido com divergência: esperado R$ ${esperado.toFixed(2)}, nota R$ ${valorNota.toFixed(2)}, diferença R$ ${diferenca.toFixed(2)}.`:null
  await admin.from('salon_comissoes').update({
    nota_id: null, status: 'pendente', nf_numero: null, nf_data: null, nf_valor: null, nf_origem: null, confirmado_em: null,
  }).eq('nota_id', notaId).neq('id', comissaoId)
  const { error } = await admin.from('salon_comissoes').update({
    nota_id: n.id, status: 'conferida', nf_numero: n.numero, nf_data: n.data_emissao, nf_valor: n.valor, nf_origem: 'manual',
    confirmado_em: new Date().toISOString(), observacao: notaDivergencia || comissao.observacao || null,
  }).eq('id', comissaoId)
  if (error) return { ok: false, erro: error.message }
  const { error: erroNota } = await admin.from('salon_notas').update({ conferida: true, conferida_em: new Date().toISOString(), conferida_por: usuario ?? null, analise_manual: false, analise_motivo: null }).eq('id', n.id)
  if (erroNota) {
    // Não deixar vínculo pela metade quando a atualização da nota falhar.
    await admin.from('salon_comissoes').update({ nota_id: null, status: 'pendente', nf_numero: null, nf_data: null, nf_valor: null, nf_origem: null, confirmado_em: null }).eq('id', comissaoId)
    return { ok: false, erro: erroNota.message }
  }
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

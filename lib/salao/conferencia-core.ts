// Núcleo da CONFERÊNCIA — SERVER-ONLY (roda com service_role, ignora RLS).
// Fonte única de verdade da reconciliação planilha (salon_comissoes) × notas
// recebidas (salon_notas). Toda gravação passa por aqui, no servidor — o cliente
// nunca escreve direto no banco (evita falha silenciosa por RLS).
//
// Regra automática (conservadora):
//   mesma unidade + mesmo CNPJ/CPF + valor exato + uma única candidata disponível.
//   A competência oficial é a da planilha (mes_ref); a competência declarada na
//   NFS-e não bloqueia o vínculo porque pode vir preenchida incorretamente.
//   Qualquer ambiguidade ou divergência permanece pendente para decisão manual.
//
// EFICIÊNCIA: as consultas FILTRAM no banco (por competência e por CNPJ) — nunca
// carregam a tabela inteira. E paginam com .range(): o PostgREST devolve no
// máximo 1000 linhas por requisição (era esta a causa de "Notas no mês: 2" —
// só as 1000 notas mais antigas vinham, e as do mês ficavam de fora).
import type { SupabaseClient } from '@supabase/supabase-js'
import { SALAO_COMPETENCIA_INICIAL } from './config'

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
  notas_vinculadas?: { id: string; numero: string | null; valor: number | null; data_emissao: string | null; competencia: string | null }[]
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
    let q = admin.from('salon_notas').select(NOTA_COLS).or(`competencia.eq.${competencia},competencia_conf.eq.${competencia}`).eq('excluida',false).eq('classificacao','profissional').eq('analise_manual',false).order('id', { ascending: true }).range(de, ate)
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
      (() => { let q=admin.from('salon_notas').select(NOTA_COLS).in('documento', lote).eq('excluida',false).eq('classificacao','profissional').eq('analise_manual',false).order('id',{ascending:true}).range(de,ate);if(empresaId)q=q.eq('empresa_id',empresaId);return q as unknown as QB })())
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
  // Vínculos múltiplos. A consulta é tolerante enquanto a migração v8 ainda não foi aplicada.
  const { data: multiplas } = await admin.from('salon_comissao_notas').select('nota_id').limit(10000)
  for (const r of multiplas ?? []) if (r.nota_id) set.add(r.nota_id)
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
 * Reconcilia uma competência usando somente correspondências automáticas inequívocas.
 * Não classifica como processada uma nota que permaneceu sem vínculo.
 */
export async function reconciliar(admin: SupabaseClient, competencia: string, empresaId?: string):
  Promise<{ conferidas: number; pendentes: number; divergencias: number; outraEmpresa: number }> {
  if (competencia < SALAO_COMPETENCIA_INICIAL) return { conferidas: 0, pendentes: 0, divergencias: 0, outraEmpresa: 0 }
  let cq = admin.from('salon_comissoes').select('id, empresa_id, documento, nome, valor_comissao')
    .eq('mes_ref', competencia).is('nota_id', null)
  if (empresaId) cq = cq.eq('empresa_id', empresaId)
  const { data: pend } = await cq
  if (!pend || pend.length === 0) return { conferidas: 0, pendentes: 0, divergencias: 0, outraEmpresa: 0 }

  const usadas = await notasUsadas(admin)
  // A competência oficial vem da comissão importada. A competência/data da nota
  // não restringe o casamento: buscamos notas recebidas pelos documentos pendentes.
  const docsPendentes = Array.from(new Set(pend.map(p => dig(p.documento)).filter(Boolean)))
  const notas = (await notasDosDocumentos(admin, docsPendentes, empresaId)).filter(n => Number(n.valor) > 0)

  type Cand = { id: string; empresa_id: string; valor: number; numero: string | null; data_emissao: string | null }
  const porDoc = new Map<string, Cand[]>()
  for (const n of notas) {
    if (usadas.has(n.id) || n.excluida || n.conferida) continue
    const k = dig(n.documento)
    if (!k) continue
    const cand: Cand = { id: n.id, empresa_id: n.empresa_id, valor: Number(n.valor) || 0, numero: n.numero, data_emissao: n.data_emissao }
    const arr = porDoc.get(k) ?? []; arr.push(cand); porDoc.set(k, arr)
  }

  let conferidas = 0, divergencias = 0, outraEmpresa = 0
  const feitos = new Set<string>()

  async function casar(p: { id: string; empresa_id: string; valor_comissao: number }, arr: Cand[], nota: Cand) {
    const alvo = Number(p.valor_comissao) || 0
    const divergente = Math.abs(nota.valor - alvo) >= 0.01
    const observacao = divergente ? `Conferido com divergência: esperado R$ ${alvo.toFixed(2)} e nota R$ ${nota.valor.toFixed(2)}.` : null
    await admin.from('salon_comissao_notas').delete().eq('comissao_id', p.id)
    const resultados = await Promise.all([
      admin.from('salon_comissoes').update({
        nota_id: null, status: 'pendente', nf_numero: null, nf_data: null, nf_valor: null, nf_origem: null, confirmado_em: null,
      }).eq('nota_id', nota.id).neq('id', p.id),
      admin.from('salon_comissoes').update({
        nota_id: nota.id, status: 'conferida',
        nf_numero: nota.numero ?? null, nf_data: nota.data_emissao ?? null, nf_valor: nota.valor, nf_origem: 'adn',
        confirmado_em: new Date().toISOString(), observacao,
      }).eq('id', p.id),
      admin.from('salon_notas').update({ conferida: true }).eq('id', nota.id),
      admin.from('salon_comissao_notas').upsert({ comissao_id: p.id, nota_id: nota.id }, { onConflict: 'comissao_id,nota_id' }),
    ])
    const falha = resultados.find((r) => r.error)?.error
    if (falha) throw new Error(`Falha ao reconciliar: ${falha.message}`)
    arr.splice(arr.indexOf(nota), 1)
    feitos.add(p.id)
    if (divergente) divergencias++
    if (nota.empresa_id !== p.empresa_id) outraEmpresa++
    conferidas++
  }

  // Automático estrito: documento, competência, unidade e valor devem coincidir.
  // Casos sem documento ou com qualquer divergência permanecem pendentes para decisão manual.
  for (const p of pend) {
    const documento = dig(p.documento)
    if (!documento) continue
    const arr = porDoc.get(documento)
    if (!arr?.length) continue
    const alvo = Number(p.valor_comissao) || 0
    const exatas = arr.filter((n) => n.empresa_id === p.empresa_id && Math.abs(n.valor - alvo) < 0.01)
    if (exatas.length !== 1) continue
    await casar(p, arr, exatas[0])
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
  const comissaoIds = rows.map((r) => r.id)
  const { data: relacoes } = comissaoIds.length
    ? await admin.from('salon_comissao_notas').select('comissao_id, nota_id').in('comissao_id', comissaoIds)
    : { data: [] as { comissao_id: string; nota_id: string }[] }
  const notaIds = Array.from(new Set([
    ...rows.map((r) => r.nota_id),
    ...(relacoes ?? []).map((r) => r.nota_id),
  ].filter(Boolean))) as string[]

  let upd = admin.from('salon_comissoes').update({
    nota_id: null, status: 'pendente', nf_numero: null, nf_data: null, nf_valor: null, nf_origem: null, confirmado_em: null,
  }).not('nota_id', 'is', null)
  if (competencia) upd = upd.eq('mes_ref', competencia)
  if (empresaId) upd = upd.eq('empresa_id', empresaId)
  await upd

  if (comissaoIds.length) await admin.from('salon_comissao_notas').delete().in('comissao_id', comissaoIds)
  for (let i = 0; i < notaIds.length; i += 200) {
    await admin.from('salon_notas').update({ conferida: false, conferida_em: null, conferida_por: null }).in('id', notaIds.slice(i, i + 200))
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

  // Notas vinculadas (detalhe de todas as notas do conjunto, não só a principal).
  const comissaoIds = coms.filter(c => c.nota_id).map(c => c.id)
  const { data: relacoesVinculo } = comissaoIds.length
    ? await admin.from('salon_comissao_notas').select('comissao_id, nota_id').in('comissao_id', comissaoIds)
    : { data: [] as { comissao_id: string; nota_id: string }[] }
  const relPorComissao = new Map<string, string[]>()
  for (const r of relacoesVinculo ?? []) { const a = relPorComissao.get(r.comissao_id) ?? []; a.push(r.nota_id); relPorComissao.set(r.comissao_id, a) }
  const linkIds = Array.from(new Set([
    ...coms.filter((c) => c.nota_id).map((c) => c.nota_id),
    ...(relacoesVinculo ?? []).map(r => r.nota_id),
  ].filter(Boolean))) as string[]
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

  // Duplicidade real exige repetição integral do registro importado.
  // O mesmo profissional pode possuir mais de um lançamento legítimo no mês.
  const chaveComissao = (c: NotaRow) => [c.empresa_id, dig(c.documento), norm(c.nome), Number(c.valor_comissao || 0).toFixed(2)].join('|')
  const dupCount = new Map<string, number>()
  for (const c of coms) { if (!c.documento) continue; const k = chaveComissao(c); dupCount.set(k, (dupCount.get(k) ?? 0) + 1) }

  const linhas: LinhaConsulta[] = []

  for (const c of coms) {
    const e = Array.isArray(c.empresas) ? c.empresas[0] : c.empresas
    const empresaNome = e?.apelido || e?.razao_social || ''
    const duplicada = !!c.documento && (dupCount.get(chaveComissao(c)) ?? 0) > 1
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
      const idsVinculados = Array.from(new Set([...(relPorComissao.get(c.id) ?? []), c.nota_id].filter(Boolean))) as string[]
      const notasVinculadas = idsVinculados.map(id => notaById.get(id)).filter(Boolean) as NotaRow[]
      base.notas_vinculadas = notasVinculadas.map(x => ({ id: x.id, numero: x.numero, valor: x.valor, data_emissao: x.data_emissao, competencia: notaComp(x) || null }))
      base.nota_competencia = notasVinculadas.length === 1 ? notaComp(notasVinculadas[0]) : null
      base.nota_empresaNome = ne?.apelido || ne?.razao_social || ''
      const vNota = Number(c.nf_valor ?? n?.valor ?? 0)
      base.nf_valor = vNota
      base.diferenca = Math.round((vNota - (base.valor_comissao || 0)) * 100) / 100
      base.outraEmpresa = !!n && n.empresa_id !== c.empresa_id
      const motivosVinculo: string[] = []
      if (duplicada) motivosVinculo.push('registro importado possivelmente duplicado')
      if (base.outraEmpresa) motivosVinculo.push('nota vinculada pertence a outra unidade')
      if (n && dig(n.documento) !== dig(c.documento)) motivosVinculo.push('CNPJ/CPF da nota difere do profissional')
      if (Math.abs(base.diferenca) >= 0.01) motivosVinculo.push(`valor divergente em R$ ${Math.abs(base.diferenca).toFixed(2)}`)
      base.situacao = motivosVinculo.length ? 'conferido_com_divergencia' : 'conferido'
      if (motivosVinculo.length && !base.observacao) base.observacao = `Vínculo confirmado: ${motivosVinculo.join('; ')}.`
    } else if (c.pendencia || !c.documento) {
      const doc = dig(c.documento)
      base.situacao = (doc && doc.length !== 11 && doc.length !== 14) ? 'cnpj_invalido' : 'falta_cnpj'
    } else {
      // pendente com CNPJ: melhor sugestão dentro da janela de ±1 mês, nota livre
      const cands = (porDocPend.get(dig(c.documento)) ?? []).filter((n) =>
        Number(n.valor) > 0 && !n.conferida && !usadasGlobal.has(n.id) && mesesDiff(notaComp(n), c.mes_ref) <= 1)
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

  // Notas livres relevantes: notas do mês e notas de qualquer data dos
  // profissionais pendentes. A competência da nota é apenas informativa.
  const notasRelevantes = Array.from(new Map([...notasMes, ...notasPend].map(n => [n.id, n])).values())
  for (const n of notasRelevantes) {
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
    conferidos: baseRows.filter((l) => l.tipo === 'comissao' && (l.situacao === 'conferido' || l.situacao === 'conferido_com_divergencia' || l.situacao === 'corrigido_manual')).length,
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
    .filter((n) => !usadas.has(n.id) && !n.conferida)
    .map((n) => ({ ...n, empresaNome: empresaNomeDe(n) }))
    .sort((a, b) => (notaComp(b) || '').localeCompare(notaComp(a) || ''))
}

export async function vincular(admin: SupabaseClient, comissaoId: string, notaId: string, usuario?: string): Promise<{ ok: boolean; erro?: string }> {
  const [{ data: n }, { data: comissao }] = await Promise.all([
    admin.from('salon_notas').select('id, empresa_id, documento, numero, valor, data_emissao, excluida, classificacao, analise_manual').eq('id', notaId).maybeSingle(),
    admin.from('salon_comissoes').select('empresa_id, documento, valor_comissao, observacao, nota_id, mes_ref').eq('id', comissaoId).maybeSingle(),
  ])
  if (!n) return { ok: false, erro: 'Nota não encontrada.' }
  if (!comissao) return { ok: false, erro: 'Profissional importado não encontrado.' }
  if (comissao.mes_ref < SALAO_COMPETENCIA_INICIAL) return { ok: false, erro: 'Competências anteriores a janeiro/2026 ficam somente no histórico.' }
  if (n.excluida || n.classificacao !== 'profissional' || n.analise_manual) return { ok: false, erro: 'A nota não está disponível para conferência.' }
  if (n.empresa_id !== comissao.empresa_id) return { ok: false, erro: 'Nota e profissional pertencem a unidades diferentes.' }
  const documentoDivergente = dig(n.documento) !== dig(comissao.documento)
  const [{ data: relOcupada }, { data: legadoOcupado }, { data: relAntigas }] = await Promise.all([
    admin.from('salon_comissao_notas').select('comissao_id').eq('nota_id', notaId).neq('comissao_id', comissaoId),
    admin.from('salon_comissoes').select('id').eq('nota_id', notaId).neq('id', comissaoId),
    admin.from('salon_comissao_notas').select('nota_id').eq('comissao_id', comissaoId),
  ])
  if ((relOcupada?.length ?? 0) || (legadoOcupado?.length ?? 0)) return { ok: false, erro: 'Esta nota já está vinculada a outro profissional.' }
  const notasAnteriores = Array.from(new Set([comissao.nota_id, ...(relAntigas ?? []).map(r => r.nota_id)].filter(Boolean))) as string[]
  const esperado=Number(comissao.valor_comissao)||0,valorNota=Number(n.valor)||0,diferenca=Math.round((valorNota-esperado)*100)/100
  const divergenciasVinculo:string[]=[]
  if(documentoDivergente)divergenciasVinculo.push(`CNPJ/CPF da nota ${dig(n.documento)||'não informado'} diferente do profissional ${dig(comissao.documento)||'não informado'}`)
  if(Math.abs(diferenca)>=0.01)divergenciasVinculo.push(`esperado R$ ${esperado.toFixed(2)}, nota R$ ${valorNota.toFixed(2)}, diferença R$ ${diferenca.toFixed(2)}`)
  const notaDivergencia=divergenciasVinculo.length?`Conferido manualmente com divergência: ${divergenciasVinculo.join('; ')}.`:null
  await admin.from('salon_comissoes').update({
    nota_id: null, status: 'pendente', nf_numero: null, nf_data: null, nf_valor: null, nf_origem: null, confirmado_em: null,
  }).eq('nota_id', notaId).neq('id', comissaoId)
  await admin.from('salon_comissao_notas').delete().eq('comissao_id', comissaoId)
  const { error: erroRel } = await admin.from('salon_comissao_notas').upsert({ comissao_id: comissaoId, nota_id: notaId, criado_por: usuario ?? null }, { onConflict: 'comissao_id,nota_id' })
  if (erroRel) return { ok: false, erro: `Aplique a migração supabase_salao_v8_multiplas_notas.sql: ${erroRel.message}` }
  const { error } = await admin.from('salon_comissoes').update({
    nota_id: n.id, status: 'conferida', nf_numero: n.numero, nf_data: n.data_emissao, nf_valor: n.valor, nf_origem: 'manual',
    confirmado_em: new Date().toISOString(), observacao: notaDivergencia || comissao.observacao || null,
  }).eq('id', comissaoId)
  if (error) {
    await admin.from('salon_comissao_notas').delete().eq('comissao_id', comissaoId).eq('nota_id', notaId)
    return { ok: false, erro: error.message }
  }
  const { error: erroNota } = await admin.from('salon_notas').update({ conferida: true, conferida_em: new Date().toISOString(), conferida_por: usuario ?? null, analise_manual: false, analise_motivo: null }).eq('id', n.id)
  if (erroNota) {
    // Não deixar vínculo pela metade quando a atualização da nota falhar.
    await admin.from('salon_comissoes').update({ nota_id: null, status: 'pendente', nf_numero: null, nf_data: null, nf_valor: null, nf_origem: null, confirmado_em: null }).eq('id', comissaoId)
    return { ok: false, erro: erroNota.message }
  }
  const reabrir = notasAnteriores.filter(x => x !== n.id)
  if (reabrir.length) await admin.from('salon_notas').update({ conferida: false, conferida_em: null, conferida_por: null }).in('id', reabrir)
  return { ok: true }
}

export async function vincularMultiplas(admin: SupabaseClient, comissaoId: string, notaIds: string[], usuario?: string): Promise<{ ok: boolean; erro?: string }> {
  const ids = Array.from(new Set(notaIds.filter(Boolean)))
  if (ids.length < 2) return { ok: false, erro: 'Selecione pelo menos duas notas.' }
  const [{ data: comissao }, { data: notas, error: erroNotas }] = await Promise.all([
    admin.from('salon_comissoes').select('id, empresa_id, mes_ref, valor_comissao, nota_id, observacao, documento').eq('id', comissaoId).maybeSingle(),
    admin.from('salon_notas').select('id, empresa_id, numero, valor, data_emissao, documento, emitente_nome, excluida, classificacao, analise_manual').in('id', ids),
  ])
  if (!comissao) return { ok: false, erro: 'Profissional importado não encontrado.' }
  if (comissao.mes_ref < SALAO_COMPETENCIA_INICIAL) return { ok: false, erro: 'Competências anteriores a janeiro/2026 ficam somente no histórico.' }
  if (erroNotas) return { ok: false, erro: erroNotas.message }
  if (!notas || notas.length !== ids.length) return { ok: false, erro: 'Uma ou mais notas não foram encontradas.' }
  if (notas.some(n => n.excluida || n.classificacao !== 'profissional' || n.analise_manual)) return { ok: false, erro: 'Uma das notas não está disponível para conferência.' }
  if (notas.some(n => n.empresa_id !== comissao.empresa_id)) return { ok: false, erro: 'Todas as notas devem pertencer à mesma unidade do profissional.' }
  const documentosDivergentes = notas.filter(n => dig(n.documento) !== dig(comissao.documento))
  const total = Math.round(notas.reduce((s, n) => s + Number(n.valor || 0), 0) * 100) / 100
  const esperado = Math.round(Number(comissao.valor_comissao || 0) * 100) / 100
  if (Math.abs(total - esperado) >= 0.01) return { ok: false, erro: `A soma das notas (${total.toFixed(2)}) não corresponde ao valor importado (${esperado.toFixed(2)}).` }
  const [{ data: ocupadas }, { data: legadas }] = await Promise.all([
    admin.from('salon_comissao_notas').select('nota_id, comissao_id').in('nota_id', ids),
    admin.from('salon_comissoes').select('id, nota_id').in('nota_id', ids).neq('id', comissaoId),
  ])
  if ((ocupadas ?? []).some(x => x.comissao_id !== comissaoId) || (legadas?.length ?? 0) > 0) return { ok: false, erro: 'Uma das notas já está vinculada a outro profissional.' }
  const { data: relAntigas } = await admin.from('salon_comissao_notas').select('nota_id').eq('comissao_id', comissaoId)
  const notasAnteriores = Array.from(new Set([comissao.nota_id, ...(relAntigas ?? []).map(r => r.nota_id)].filter(Boolean))) as string[]
  await admin.from('salon_comissao_notas').delete().eq('comissao_id', comissaoId)
  const primeira = notas[0]
  const numeros = notas.map(n => n.numero || 's/n').join(', ')
  const { error: erroRel } = await admin.from('salon_comissao_notas').upsert(ids.map(nota_id => ({ comissao_id: comissaoId, nota_id, criado_por: usuario ?? null })), { onConflict: 'comissao_id,nota_id' })
  if (erroRel) return { ok: false, erro: `Aplique a migração supabase_salao_v8_multiplas_notas.sql: ${erroRel.message}` }
  const agora = new Date().toISOString()
  const [{ error: erroCom }, { error: erroNf }] = await Promise.all([
    admin.from('salon_comissoes').update({
      nota_id: primeira.id, status: 'conferida', nf_numero: numeros, nf_data: primeira.data_emissao,
      nf_valor: total, nf_origem: 'manual_multiplo', confirmado_em: agora,
      observacao: `${ids.length} notas vinculadas: ${numeros}. Soma R$ ${total.toFixed(2)}.${documentosDivergentes.length?` Conferido manualmente com divergência de CNPJ/CPF em ${documentosDivergentes.length} nota(s).`:''}`,
    }).eq('id', comissaoId),
    admin.from('salon_notas').update({ conferida: true, conferida_em: agora, conferida_por: usuario ?? null }).in('id', ids),
  ])
  if (erroCom || erroNf) {
    await admin.from('salon_comissao_notas').delete().eq('comissao_id', comissaoId).in('nota_id', ids)
    return { ok: false, erro: (erroCom || erroNf)?.message }
  }
  const reabrir = notasAnteriores.filter(id => !ids.includes(id))
  if (reabrir.length) await admin.from('salon_notas').update({ conferida: false, conferida_em: null, conferida_por: null }).in('id', reabrir)
  return { ok: true }
}

export async function desvincular(admin: SupabaseClient, comissaoId: string, notaId?: string | null): Promise<{ ok: boolean; erro?: string }> {
  const [{ data: registro, error: erroRegistro }, { data: relacoes, error: erroRelacoes }] = await Promise.all([
    admin.from('salon_comissoes').select('id, nota_id, status, nf_numero, nf_data, nf_valor, nf_origem, confirmado_em, observacao').eq('id', comissaoId).maybeSingle(),
    admin.from('salon_comissao_notas').select('nota_id, criado_por').eq('comissao_id', comissaoId),
  ])
  if (erroRegistro) return { ok: false, erro: erroRegistro.message }
  if (erroRelacoes) return { ok: false, erro: erroRelacoes.message }
  if (!registro) return { ok: false, erro: 'Profissional importado não encontrado.' }

  const notaIds = Array.from(new Set([registro.nota_id, ...(relacoes ?? []).map(r => r.nota_id)].filter(Boolean))) as string[]
  if (notaId && !notaIds.includes(notaId)) return { ok: false, erro: 'A nota informada não pertence a este vínculo.' }

  // No quadro de notas, remover UMA nota de um conjunto múltiplo preserva as demais.
  if (notaId && notaIds.length > 1) {
    const restantes = notaIds.filter(id => id !== notaId)
    const { data: notasRestantes, error: erroBuscaNotas } = await admin.from('salon_notas')
      .select('id, numero, valor, data_emissao').in('id', restantes)
    if (erroBuscaNotas) return { ok: false, erro: erroBuscaNotas.message }
    if (!notasRestantes || notasRestantes.length !== restantes.length) return { ok: false, erro: 'Não foi possível reconstruir o vínculo restante.' }
    const ordenadas = restantes.map(id => notasRestantes.find(n => n.id === id)).filter(Boolean) as { id: string; numero: string | null; valor: number | null; data_emissao: string | null }[]
    const primeira = ordenadas[0]
    const total = Math.round(ordenadas.reduce((s, n) => s + Number(n.valor || 0), 0) * 100) / 100
    const numeros = ordenadas.map(n => n.numero || 's/n').join(', ')
    const { error: erroDeleteUma } = await admin.from('salon_comissao_notas').delete().eq('comissao_id', comissaoId).eq('nota_id', notaId)
    if (erroDeleteUma) return { ok: false, erro: erroDeleteUma.message }
    const { error: erroAtualizaConjunto } = await admin.from('salon_comissoes').update({
      nota_id: primeira.id, status: 'conferida', nf_numero: numeros, nf_data: primeira.data_emissao,
      nf_valor: total, nf_origem: ordenadas.length > 1 ? 'manual_multiplo' : 'manual',
      confirmado_em: new Date().toISOString(),
      observacao: ordenadas.length > 1 ? `${ordenadas.length} notas vinculadas: ${numeros}. Soma R$ ${total.toFixed(2)}.` : registro.observacao,
    }).eq('id', comissaoId)
    if (erroAtualizaConjunto) {
      const antiga = (relacoes ?? []).find(r => r.nota_id === notaId)
      await admin.from('salon_comissao_notas').upsert({ comissao_id: comissaoId, nota_id: notaId, criado_por: antiga?.criado_por ?? null }, { onConflict: 'comissao_id,nota_id' })
      return { ok: false, erro: erroAtualizaConjunto.message }
    }
    const [{ data: relAinda, error: erroRelAinda }, { data: legadoAinda, error: erroLegadoAinda }] = await Promise.all([
      admin.from('salon_comissao_notas').select('nota_id').eq('nota_id', notaId),
      admin.from('salon_comissoes').select('nota_id').eq('nota_id', notaId),
    ])
    if (erroRelAinda || erroLegadoAinda) {
      await admin.from('salon_comissoes').update({
        nota_id: registro.nota_id, status: registro.status, nf_numero: registro.nf_numero, nf_data: registro.nf_data,
        nf_valor: registro.nf_valor, nf_origem: registro.nf_origem, confirmado_em: registro.confirmado_em, observacao: registro.observacao,
      }).eq('id', comissaoId)
      const antiga = (relacoes ?? []).find(r => r.nota_id === notaId)
      await admin.from('salon_comissao_notas').upsert({ comissao_id: comissaoId, nota_id: notaId, criado_por: antiga?.criado_por ?? null }, { onConflict: 'comissao_id,nota_id' })
      return { ok: false, erro: (erroRelAinda || erroLegadoAinda)?.message }
    }
    if (!(relAinda?.length || legadoAinda?.length)) {
      const { error: erroReabrirUma } = await admin.from('salon_notas').update({ conferida: false, conferida_em: null, conferida_por: null }).eq('id', notaId)
      if (erroReabrirUma) {
        await admin.from('salon_comissoes').update({
          nota_id: registro.nota_id, status: registro.status, nf_numero: registro.nf_numero, nf_data: registro.nf_data,
          nf_valor: registro.nf_valor, nf_origem: registro.nf_origem, confirmado_em: registro.confirmado_em, observacao: registro.observacao,
        }).eq('id', comissaoId)
        const antiga = (relacoes ?? []).find(r => r.nota_id === notaId)
        await admin.from('salon_comissao_notas').upsert({ comissao_id: comissaoId, nota_id: notaId, criado_por: antiga?.criado_por ?? null }, { onConflict: 'comissao_id,nota_id' })
        return { ok: false, erro: erroReabrirUma.message }
      }
    }
    return { ok: true }
  }
  // Primeiro remove as relações explícitas. Se qualquer etapa posterior falhar,
  // restaura-se exatamente o estado anterior para não deixar vínculo fantasma.
  const { error: erroDelete } = await admin.from('salon_comissao_notas').delete().eq('comissao_id', comissaoId)
  if (erroDelete) return { ok: false, erro: `Não foi possível remover as relações do vínculo: ${erroDelete.message}` }

  const { error: erroComissao } = await admin.from('salon_comissoes').update({
    nota_id: null, status: 'pendente', nf_numero: null, nf_data: null, nf_valor: null, nf_origem: null, confirmado_em: null,
  }).eq('id', comissaoId)
  if (erroComissao) {
    if (relacoes?.length) await admin.from('salon_comissao_notas').upsert(relacoes.map(r => ({ comissao_id: comissaoId, nota_id: r.nota_id, criado_por: r.criado_por ?? null })), { onConflict: 'comissao_id,nota_id' })
    return { ok: false, erro: erroComissao.message }
  }

  if (notaIds.length) {
    // Uma nota só volta para Pendente se nenhuma comissão ainda a utilizar,
    // seja pela relação nova ou pela coluna legada nota_id.
    const [{ data: relRestantes, error: erroRestantes }, { data: legados, error: erroLegados }] = await Promise.all([
      admin.from('salon_comissao_notas').select('nota_id').in('nota_id', notaIds),
      admin.from('salon_comissoes').select('nota_id').in('nota_id', notaIds).not('nota_id', 'is', null),
    ])
    if (erroRestantes || erroLegados) {
      await admin.from('salon_comissoes').update({
        nota_id: registro.nota_id, status: registro.status, nf_numero: registro.nf_numero, nf_data: registro.nf_data,
        nf_valor: registro.nf_valor, nf_origem: registro.nf_origem, confirmado_em: registro.confirmado_em,
        observacao: registro.observacao,
      }).eq('id', comissaoId)
      if (relacoes?.length) await admin.from('salon_comissao_notas').upsert(relacoes.map(r => ({ comissao_id: comissaoId, nota_id: r.nota_id, criado_por: r.criado_por ?? null })), { onConflict: 'comissao_id,nota_id' })
      return { ok: false, erro: (erroRestantes || erroLegados)?.message }
    }
    const aindaUsadas = new Set([...(relRestantes ?? []).map(r => r.nota_id), ...(legados ?? []).map(r => r.nota_id)].filter(Boolean))
    const livres = notaIds.filter(id => !aindaUsadas.has(id))
    if (livres.length) {
      const { error: erroNotas } = await admin.from('salon_notas').update({
        conferida: false, conferida_em: null, conferida_por: null,
      }).in('id', livres)
      if (erroNotas) {
        await admin.from('salon_comissoes').update({
          nota_id: registro.nota_id, status: registro.status, nf_numero: registro.nf_numero, nf_data: registro.nf_data,
          nf_valor: registro.nf_valor, nf_origem: registro.nf_origem, confirmado_em: registro.confirmado_em,
          observacao: registro.observacao,
        }).eq('id', comissaoId)
        if (relacoes?.length) await admin.from('salon_comissao_notas').upsert(relacoes.map(r => ({ comissao_id: comissaoId, nota_id: r.nota_id, criado_por: r.criado_por ?? null })), { onConflict: 'comissao_id,nota_id' })
        return { ok: false, erro: `Não foi possível reabrir as notas: ${erroNotas.message}` }
      }
    }
  }
  return { ok: true }
}

export async function corrigirCnpj(admin: SupabaseClient, comissaoId: string, documento: string): Promise<{ ok: boolean; erro?: string }> {
  const doc = dig(documento)
  if (doc.length !== 11 && doc.length !== 14) return { ok: false, erro: 'CNPJ/CPF inválido.' }
  const { error } = await admin.from('salon_comissoes').update({ documento: doc, pendencia: null }).eq('id', comissaoId)
  if (error) return { ok: false, erro: error.message }
  return { ok: true }
}

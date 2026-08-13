// Conferência (lado cliente) — apenas WRAPPERS HTTP para /api/salao/conferencia.
// Toda a lógica e a gravação ficam no servidor (service_role, ignora RLS). O
// cliente não escreve mais direto no banco — fim das falhas silenciosas por RLS.
import type { Esperada, NotaLivre, Diagnostico, LinhaConsulta, Indicadores, Filtros, Ordenacao, ConsultaResultado, Situacao } from './conferencia-core'

export type { Esperada, NotaLivre, Diagnostico, LinhaConsulta, Indicadores, Filtros, Ordenacao, ConsultaResultado, Situacao } from './conferencia-core'

export const SITUACAO_LABEL: Record<Situacao, string> = {
  conferido: 'Conferido', divergencia_valor: 'Divergência de valor', sem_nota: 'Sem nota',
  nota_sem_vinculo: 'Nota sem vínculo', falta_cnpj: 'Falta CNPJ', cnpj_invalido: 'CNPJ inválido',
  nota_outra_empresa: 'Nota de outra empresa', possivel_duplicidade: 'Possível duplicidade',
  vinculo_sugerido: 'Vínculo sugerido', aguardando_confirmacao: 'Aguardando confirmação',
  corrigido_manual: 'Corrigido manualmente',
}
export type Conferencia = {
  pendentes: Esperada[]; conferidas: Esperada[]; semVinculo: NotaLivre[]
  pendenciasImport: Esperada[]; diagnostico: Diagnostico
}

const API = '/api/salao/conferencia'

async function post(body: Record<string, unknown>) {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return r.json().catch(() => ({ ok: false, erro: 'Resposta inválida do servidor.' }))
}

/** Estado completo da conferência + diagnóstico (server-side). */
export async function listarConferencia(competencia: string, empresaId?: string): Promise<Conferencia> {
  const qs = new URLSearchParams({ competencia }); if (empresaId) qs.set('empresaId', empresaId)
  const r = await fetch(`${API}?${qs.toString()}`, { cache: 'no-store' })
  const j = await r.json().catch(() => null)
  const vazio: Conferencia = {
    pendentes: [], conferidas: [], semVinculo: [], pendenciasImport: [],
    diagnostico: { competencia, notasNaCompetencia: 0, comissoesNaCompetencia: 0, conferidas: 0, pendentes: 0, pendentesComNotaNoMes: 0, pendentesComNotaDisponivel: 0, notasSemVinculo: 0, totalNotas: 0, distComp: [] },
  }
  if (!j?.ok) return vazio
  return { pendentes: j.pendentes, conferidas: j.conferidas, semVinculo: j.semVinculo, pendenciasImport: j.pendenciasImport, diagnostico: j.diagnostico }
}

export async function reconciliarCompetencia(competencia: string, empresaId?: string):
  Promise<{ conferidas: number; pendentes: number; divergencias: number; outraEmpresa: number }> {
  const j = await post({ acao: 'reconciliar', competencia, empresaId })
  return { conferidas: j.conferidas ?? 0, pendentes: j.pendentes ?? 0, divergencias: j.divergencias ?? 0, outraEmpresa: j.outraEmpresa ?? 0 }
}

export async function refazerConferencia(competencia: string, empresaId?: string):
  Promise<{ limpos: number; conferidas: number; pendentes: number; divergencias: number; outraEmpresa: number }> {
  const j = await post({ acao: 'refazer', competencia, empresaId })
  return { limpos: j.limpos ?? 0, conferidas: j.conferidas ?? 0, pendentes: j.pendentes ?? 0, divergencias: j.divergencias ?? 0, outraEmpresa: j.outraEmpresa ?? 0 }
}

export async function limparVinculos(competencia?: string, empresaId?: string): Promise<{ limpos: number }> {
  const j = await post({ acao: 'limpar', competencia, empresaId })
  return { limpos: j.limpos ?? 0 }
}

export async function notasDoCnpj(_empresaId: string, documento: string | null): Promise<NotaLivre[]> {
  const qs = new URLSearchParams({ acao: 'notasDoCnpj', documento: documento ?? '' })
  const r = await fetch(`${API}?${qs.toString()}`, { cache: 'no-store' })
  const j = await r.json().catch(() => null)
  return j?.ok ? j.notas : []
}

export async function vincularNota(comissaoId: string, nota: { id: string; numero: string | null; valor: number | null; data_emissao: string | null }):
  Promise<{ ok: boolean; erro?: string }> {
  return post({ acao: 'vincular', comissaoId, notaId: nota.id })
}

export async function desvincular(comissaoId: string, _notaId?: string | null): Promise<{ ok: boolean; erro?: string }> {
  return post({ acao: 'desvincular', comissaoId })
}

export async function corrigirCnpj(comissaoId: string, documento: string): Promise<{ ok: boolean; erro?: string }> {
  return post({ acao: 'corrigirCnpj', comissaoId, documento })
}

// ── Consulta principal (painel + filtros + tabela) ──
export async function consultarConferencia(filtros: Filtros, ord: Ordenacao, pagina: number, tamanho: number): Promise<ConsultaResultado> {
  const qs = new URLSearchParams({ acao: 'consultar', ordCampo: ord.campo, ordDir: ord.dir, pagina: String(pagina), tamanho: String(tamanho) })
  const add = (k: string, v: unknown) => { if (v !== undefined && v !== null && v !== '' && v !== false) qs.set(k, v === true ? '1' : String(v)) }
  add('competencia', filtros.competencia); add('empresaId', filtros.empresaId)
  add('nome', filtros.nome); add('documento', filtros.documento)
  add('situacao', filtros.situacao && filtros.situacao !== 'todas' ? filtros.situacao : '');
  add('vinculo', filtros.vinculo && filtros.vinculo !== 'todas' ? filtros.vinculo : '')
  add('valorMin', filtros.valorMin); add('valorMax', filtros.valorMax)
  add('soDivergencia', filtros.soDivergencia); add('emissaoDe', filtros.emissaoDe); add('emissaoAte', filtros.emissaoAte)
  add('numeroNota', filtros.numeroNota); add('busca', filtros.busca)
  const r = await fetch(`${API}?${qs.toString()}`, { cache: 'no-store' })
  const j = await r.json().catch(() => null)
  if (!j?.ok) return { linhas: [], total: 0, pagina, tamanho, indicadores: { esperados: 0, conferidos: 0, semNota: 0, notasSemVinculo: 0, divergencias: 0, semCnpj: 0, outraEmpresa: 0, duplicidades: 0, aguardando: 0, corrigidos: 0, valorEsperado: 0, valorVinculado: 0, diferenca: 0 }, distComp: [] }
  return j as ConsultaResultado
}

export async function editarComissao(comissaoId: string, campos: Record<string, unknown>, usuario?: string) {
  return post({ acao: 'editarComissao', comissaoId, campos, usuario })
}
export async function editarNota(notaId: string, campos: Record<string, unknown>, usuario?: string) {
  return post({ acao: 'editarNota', notaId, campos, usuario })
}
export async function excluirNota(notaId: string, motivo: string, usuario?: string) {
  return post({ acao: 'excluirNota', notaId, motivo, usuario })
}
export async function restaurarNota(notaId: string, usuario?: string) {
  return post({ acao: 'restaurarNota', notaId, usuario })
}
export async function marcarDuplicada(notaId: string, dup: boolean, usuario?: string) {
  return post({ acao: 'marcarDuplicada', notaId, dup, usuario })
}
export async function observacaoNota(notaId: string, texto: string, usuario?: string) {
  return post({ acao: 'observacaoNota', notaId, texto, usuario })
}
export async function setStatusCompetencia(competencia: string, status: string, opts: { empresaId?: string; usuario?: string; justificativa?: string } = {}) {
  return post({ acao: 'setStatus', competencia, status, ...opts })
}
export async function getStatusCompetencia(competencia: string, empresaId?: string): Promise<Record<string, unknown> | null> {
  const qs = new URLSearchParams({ acao: 'statusCompetencia', competencia }); if (empresaId) qs.set('empresaId', empresaId)
  const r = await fetch(`${API}?${qs.toString()}`, { cache: 'no-store' })
  const j = await r.json().catch(() => null)
  return j?.ok ? j.status : null
}
export async function historicoConferencia(filtro: { tipo?: string; refId?: string; competencia?: string; limite?: number }): Promise<Record<string, unknown>[]> {
  const qs = new URLSearchParams({ acao: 'historico' })
  if (filtro.tipo) qs.set('tipo', filtro.tipo); if (filtro.refId) qs.set('refId', filtro.refId)
  if (filtro.competencia) qs.set('competencia', filtro.competencia); if (filtro.limite) qs.set('limite', String(filtro.limite))
  const r = await fetch(`${API}?${qs.toString()}`, { cache: 'no-store' })
  const j = await r.json().catch(() => null)
  return j?.ok ? j.historico : []
}

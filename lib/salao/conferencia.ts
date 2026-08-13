// Conferência (lado cliente) — apenas WRAPPERS HTTP para /api/salao/conferencia.
// Toda a lógica e a gravação ficam no servidor (service_role, ignora RLS). O
// cliente não escreve mais direto no banco — fim das falhas silenciosas por RLS.
import type { Esperada, NotaLivre, Diagnostico } from './conferencia-core'

export type { Esperada, NotaLivre, Diagnostico } from './conferencia-core'
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
    diagnostico: { competencia, notasNaCompetencia: 0, comissoesNaCompetencia: 0, conferidas: 0, pendentes: 0, pendentesComNotaNoMes: 0, pendentesComNotaDisponivel: 0, notasSemVinculo: 0 },
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

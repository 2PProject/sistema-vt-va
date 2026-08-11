import { supabase } from '../supabase'
import type { Profissional } from './tipos'

export function soDigitos(s: string): string { return (s ?? '').replace(/\D/g, '') }

/** Lista profissionais (opcionalmente de uma empresa), com o nome da empresa. */
export async function listarProfissionais(empresaId?: string): Promise<Profissional[]> {
  let q = supabase
    .from('salon_professionals')
    .select('*, empresas(razao_social, apelido)')
    .order('nome')
  if (empresaId) q = q.eq('empresa_id', empresaId)
  const { data } = await q
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((p: any) => {
    const e = Array.isArray(p.empresas) ? p.empresas[0] : p.empresas
    return { ...p, empresaNome: e?.apelido || e?.razao_social || '' }
  })
}

export async function criarProfissional(p: { empresa_id: string; nome: string; documento: string }):
  Promise<{ ok: boolean; erro?: string }> {
  const nome = p.nome.trim()
  const documento = soDigitos(p.documento)
  if (!nome) return { ok: false, erro: 'Informe o nome.' }
  if (documento.length !== 11 && documento.length !== 14) return { ok: false, erro: 'CPF/CNPJ inválido.' }
  const { error } = await supabase.from('salon_professionals').insert({ empresa_id: p.empresa_id, nome, documento })
  if (error) return { ok: false, erro: error.code === '23505' ? 'Já existe um profissional com esse documento nesta empresa.' : error.message }
  return { ok: true }
}

export async function atualizarProfissional(id: string, patch: { nome?: string; documento?: string; ativo?: boolean }):
  Promise<{ ok: boolean; erro?: string }> {
  const upd: Record<string, unknown> = {}
  if (patch.nome !== undefined) upd.nome = patch.nome.trim()
  if (patch.documento !== undefined) upd.documento = soDigitos(patch.documento)
  if (patch.ativo !== undefined) upd.ativo = patch.ativo
  const { error } = await supabase.from('salon_professionals').update(upd).eq('id', id)
  if (error) return { ok: false, erro: error.message }
  return { ok: true }
}

export async function excluirProfissional(id: string): Promise<void> {
  await supabase.from('salon_professionals').delete().eq('id', id)
}

/**
 * Interpreta um texto CSV/colado (nome;CPF por linha; aceita vírgula ou tab).
 * Retorna pares válidos; ignora linhas em branco e cabeçalho "nome".
 */
export function parseListaProfissionais(texto: string): { nome: string; documento: string }[] {
  const out: { nome: string; documento: string }[] = []
  for (const linha of (texto ?? '').split(/\r?\n/)) {
    const l = linha.trim()
    if (!l) continue
    const partes = l.split(/[;,\t]/).map(s => s.trim())
    if (partes.length < 2) continue
    const nome = partes[0]
    const documento = soDigitos(partes[1])
    if (!nome || nome.toLowerCase() === 'nome') continue
    if (documento.length !== 11 && documento.length !== 14) continue
    out.push({ nome, documento })
  }
  return out
}

/** Importa uma lista de profissionais para uma empresa (ignora duplicados). */
export async function importarProfissionais(empresaId: string, itens: { nome: string; documento: string }[]):
  Promise<{ inseridos: number; ignorados: number }> {
  if (itens.length === 0) return { inseridos: 0, ignorados: 0 }
  // Documentos já existentes na empresa
  const { data: existentes } = await supabase.from('salon_professionals').select('documento').eq('empresa_id', empresaId)
  const jaTem = new Set((existentes ?? []).map((r: { documento: string }) => r.documento))
  const novos = itens.filter(i => !jaTem.has(i.documento))
    .map(i => ({ empresa_id: empresaId, nome: i.nome, documento: i.documento }))
  let inseridos = 0
  if (novos.length > 0) {
    const { error, count } = await supabase.from('salon_professionals').insert(novos, { count: 'exact' })
    if (!error) inseridos = count ?? novos.length
  }
  return { inseridos, ignorados: itens.length - inseridos }
}

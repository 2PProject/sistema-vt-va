import { supabase } from '../supabase'

export type NotaRecebida = {
  id: string
  empresa_id: string
  nsu: number | null
  chave: string | null
  documento: string | null
  emitente_nome: string | null
  numero: string | null
  valor: number | null
  data_emissao: string | null
  competencia: string | null
  empresaNome?: string
}

/** Lista as notas recebidas já sincronizadas, por empresa e período (data de emissão). */
export async function listarNotas(params: { empresaId?: string; de?: string; ate?: string }): Promise<NotaRecebida[]> {
  let q = supabase
    .from('salon_notas')
    .select('*, empresas(razao_social, apelido)')
    .order('data_emissao', { ascending: false })
  if (params.empresaId) q = q.eq('empresa_id', params.empresaId)
  if (params.de) q = q.gte('data_emissao', params.de)
  if (params.ate) q = q.lte('data_emissao', params.ate)
  const { data } = await q
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((n: any) => {
    const e = Array.isArray(n.empresas) ? n.empresas[0] : n.empresas
    return { ...n, empresaNome: e?.apelido || e?.razao_social || '' }
  })
}

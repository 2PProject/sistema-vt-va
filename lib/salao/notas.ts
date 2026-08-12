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

/**
 * Lista as notas recebidas já sincronizadas, por empresa e MÊS. O filtro do mês
 * é feito no cliente por data de emissão OU competência — e notas SEM data não
 * são escondidas (aparecem sempre), para nada "sumir".
 */
export async function listarNotas(params: { empresaId?: string; mes?: string }): Promise<NotaRecebida[]> {
  let q = supabase
    .from('salon_notas')
    .select('*, empresas(razao_social, apelido)')
    .order('data_emissao', { ascending: false, nullsFirst: false })
    .limit(5000)
  if (params.empresaId) q = q.eq('empresa_id', params.empresaId)
  const { data } = await q
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let linhas: NotaRecebida[] = (data ?? []).map((n: any) => {
    const e = Array.isArray(n.empresas) ? n.empresas[0] : n.empresas
    return { ...n, empresaNome: e?.apelido || e?.razao_social || '' }
  })
  if (params.mes) {
    const mes = params.mes
    linhas = linhas.filter(l => {
      const semData = !l.data_emissao && !l.competencia
      return semData || (l.data_emissao ?? '').slice(0, 7) === mes || (l.competencia ?? '') === mes
    })
  }
  return linhas
}

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
  // conferência (v3)
  competencia_conf: string | null
  observacao: string | null
  conferida: boolean
  conferida_em: string | null
  conferida_por: string | null
  // derivados
  empresaNome?: string
  competenciaEfetiva?: string | null   // competencia_conf ?? competencia
}

export type FiltroNotas = {
  empresaId?: string
  mes?: string          // 'YYYY-MM' — filtra por emissão OU competência efetiva
  de?: string           // 'YYYY-MM-DD' — data de emissão inicial (períodos longos)
  ate?: string          // 'YYYY-MM-DD' — data de emissão final
  competencia?: string  // 'YYYY-MM' — competência efetiva exata
  profissional?: string // nome ou documento do emitente
  status?: 'pendente' | 'conferida'
  busca?: string
}

/**
 * Lista as notas recebidas com filtros amplos (empresa/unidade, período,
 * competência, profissional, status de conferência). O período por data de
 * emissão é aplicado no banco; os demais no cliente. Notas sem data não somem.
 */
export async function listarNotas(f: FiltroNotas): Promise<NotaRecebida[]> {
  let q = supabase
    .from('salon_notas')
    .select('*, empresas(razao_social, apelido)')
    .order('data_emissao', { ascending: false, nullsFirst: false })
    .limit(8000)
  if (f.empresaId) q = q.eq('empresa_id', f.empresaId)
  if (f.de) q = q.gte('data_emissao', f.de)
  if (f.ate) q = q.lte('data_emissao', f.ate)
  const { data } = await q

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let linhas: NotaRecebida[] = (data ?? []).map((n: any) => {
    const e = Array.isArray(n.empresas) ? n.empresas[0] : n.empresas
    return { ...n, empresaNome: e?.apelido || e?.razao_social || '', competenciaEfetiva: n.competencia_conf || n.competencia || null }
  })

  if (f.mes) {
    const mes = f.mes
    linhas = linhas.filter(l => {
      const semData = !l.data_emissao && !l.competenciaEfetiva
      return semData || (l.data_emissao ?? '').slice(0, 7) === mes || (l.competenciaEfetiva ?? '') === mes
    })
  }
  if (f.competencia) linhas = linhas.filter(l => (l.competenciaEfetiva ?? '') === f.competencia)
  if (f.status) linhas = linhas.filter(l => f.status === 'conferida' ? l.conferida : !l.conferida)
  if (f.profissional) {
    const p = f.profissional.trim().toLowerCase(); const pd = p.replace(/\D/g, '')
    linhas = linhas.filter(l => (l.emitente_nome ?? '').toLowerCase().includes(p) || (pd && (l.documento ?? '').includes(pd)))
  }
  if (f.busca) {
    const q2 = f.busca.trim().toLowerCase()
    linhas = linhas.filter(l => (l.emitente_nome ?? '').toLowerCase().includes(q2) || (l.documento ?? '').includes(q2.replace(/\D/g, '')) || (l.numero ?? '').includes(q2))
  }
  return linhas
}

/** Salva a conferência de uma nota: competência ajustada, observação e status. */
export async function conferirNota(
  id: string,
  patch: { competencia_conf?: string | null; observacao?: string | null; conferida?: boolean },
  usuario?: string,
): Promise<{ ok: boolean; erro?: string }> {
  const upd: Record<string, unknown> = {}
  if ('competencia_conf' in patch) upd.competencia_conf = patch.competencia_conf || null
  if ('observacao' in patch) upd.observacao = patch.observacao ?? null
  if ('conferida' in patch) {
    upd.conferida = !!patch.conferida
    upd.conferida_em = patch.conferida ? new Date().toISOString() : null
    upd.conferida_por = patch.conferida ? (usuario ?? null) : null
  }
  const { error } = await supabase.from('salon_notas').update(upd).eq('id', id)
  return error ? { ok: false, erro: error.message } : { ok: true }
}

/** Resumo para os cartões da conferência. */
export function resumoNotas(linhas: NotaRecebida[]) {
  const conferidas = linhas.filter(l => l.conferida).length
  const divergentes = linhas.filter(l => l.competenciaEfetiva && l.data_emissao && (l.data_emissao.slice(0, 7) !== l.competenciaEfetiva)).length
  return {
    total: linhas.length,
    conferidas,
    pendentes: linhas.length - conferidas,
    divergentes,   // emissão em mês diferente da competência
    valor: Math.round(linhas.reduce((s, l) => s + (l.valor || 0), 0) * 100) / 100,
  }
}

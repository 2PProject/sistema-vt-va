import { supabase } from '../supabase'
import { competenciaNoEscopo } from './config'

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
  xml_original?: string | null
  xml_nome?: string | null
  // conferência (v3)
  competencia_conf: string | null
  observacao: string | null
  conferida: boolean
  conferida_em: string | null
  conferida_por: string | null
  // classificação operacional (v7)
  classificacao?: 'profissional' | 'outro_servico'
  categoria_outro_servico?: string | null
  analise_manual?: boolean
  analise_motivo?: string | null
  excluida?: boolean
  // derivados
  empresaNome?: string
  competenciaEfetiva?: string | null   // competencia_conf ?? competencia
}

function normalizarBusca(v: string | null | undefined): string {
  return (v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}
function termosBusca(v: string): string[] { return normalizarBusca(v).split(/\s+/).filter(Boolean) }

export type FiltroNotas = {
  empresaId?: string
  mes?: string          // 'YYYY-MM' — filtra por emissão OU competência efetiva
  de?: string           // 'YYYY-MM-DD' — data de emissão inicial (períodos longos)
  ate?: string          // 'YYYY-MM-DD' — data de emissão final
  competencia?: string  // 'YYYY-MM' — competência efetiva exata
  profissional?: string // nome ou documento do emitente
  status?: 'pendente' | 'conferida'
  busca?: string
  classificacao?: 'profissional' | 'outro_servico'
  incluirExcluidas?: boolean
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
  // Os filtros de excluída/classificação são aplicados APÓS a deduplicação:
  // uma nota pode ter linhas duplicadas (baixada + reimportada). Se qualquer
  // gêmea foi tratada (excluída, outro serviço, conferida ou em análise), a
  // NOTA inteira conta como tratada — senão a gêmea não tratada reaparece.
  if (f.de) q = q.gte('data_emissao', f.de)
  if (f.ate) q = q.lte('data_emissao', f.ate)
  const { data } = await q

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let linhas: NotaRecebida[] = (data ?? []).map((n: any) => {
    const e = Array.isArray(n.empresas) ? n.empresas[0] : n.empresas
    return { ...n, empresaNome: e?.apelido || e?.razao_social || '', competenciaEfetiva: n.competencia_conf || n.competencia || null }
  })

  // Deduplicação por IDENTIDADE da nota (mesma unidade, documento, nº, emissão e
  // valor). O grupo herda o tratamento de QUALQUER gêmea: se uma foi excluída,
  // classificada como outro serviço, conferida ou marcada para análise, a nota
  // toda passa a esse estado. Fecha o furo de "nota tratada que reaparece como
  // pendente pela linha duplicada".
  const ident = (n: NotaRecebida) => (n.numero && n.data_emissao)
    ? `${n.empresa_id}|${(n.documento || '').replace(/\D/g, '')}|${n.numero}|${n.data_emissao}|${Number(n.valor || 0).toFixed(2)}`
    : `id:${n.id}`
  const grupos = new Map<string, NotaRecebida[]>()
  for (const l of linhas) { const k = ident(l); (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(l) }
  linhas = Array.from(grupos.values()).map((g) => {
    const anyConf = g.some(x => x.conferida)
    const anyExcl = g.some(x => x.excluida)
    const anyAnal = g.some(x => !!x.analise_manual)
    const efClass: NotaRecebida['classificacao'] = g.some(x => x.classificacao === 'outro_servico') ? 'outro_servico' : 'profissional'
    // Representante acionável: prefere uma linha ATIVA (não tratada) da nota.
    const rep = g.find(x => !x.excluida && x.classificacao !== 'outro_servico' && !x.conferida && !x.analise_manual) ?? g.find(x => !x.excluida) ?? g[0]
    return { ...rep, conferida: anyConf, excluida: anyExcl, analise_manual: anyAnal, classificacao: efClass }
  })

  if (!f.incluirExcluidas) linhas = linhas.filter(l => !l.excluida)
  if (f.classificacao) linhas = linhas.filter(l => (l.classificacao || 'profissional') === f.classificacao)

  // O módulo começa em 01/2026. Competências anteriores permanecem no
  // histórico, mas não participam da operação nem geram pendências.
  linhas = linhas.filter(l => competenciaNoEscopo(l.competenciaEfetiva))

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
    const termos = termosBusca(f.profissional); const pd = f.profissional.replace(/\D/g, '')
    linhas = linhas.filter(l => {
      const nome = normalizarBusca(l.emitente_nome)
      return (termos.length > 0 && termos.every(t => nome.includes(t))) || (pd.length >= 3 && (l.documento ?? '').replace(/\D/g, '').includes(pd))
    })
  }
  if (f.busca) {
    const termos = termosBusca(f.busca); const digitos = f.busca.replace(/\D/g, '')
    linhas = linhas.filter(l => {
      const texto = normalizarBusca(`${l.emitente_nome ?? ''} ${l.empresaNome ?? ''} ${l.numero ?? ''}`)
      const doc = (l.documento ?? '').replace(/\D/g, '')
      return (termos.length > 0 && termos.every(t => texto.includes(t))) || (digitos.length >= 2 && (doc.includes(digitos) || String(l.numero ?? '').includes(digitos)))
    })
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
  // "Pendente" = ainda exige conferência: nem conferida nem em análise manual
  // (mesma regra da aba Pendentes, para o card não contar o que não aparece).
  const pendentes = linhas.filter(l => !l.conferida && !l.analise_manual).length
  const divergentes = linhas.filter(l => l.competenciaEfetiva && l.data_emissao && (l.data_emissao.slice(0, 7) !== l.competenciaEfetiva)).length
  return {
    total: linhas.length,
    conferidas,
    pendentes,
    divergentes,   // emissão em mês diferente da competência
    valor: Math.round(linhas.reduce((s, l) => s + (l.valor || 0), 0) * 100) / 100,
  }
}

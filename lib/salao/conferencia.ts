import { supabase } from '../supabase'

export type ClassificacaoConferencia =
  | 'conferido' | 'sem_nota' | 'nota_sem_vinculo' | 'divergencia_valor'
  | 'falta_cnpj' | 'cnpj_invalido' | 'nota_outra_empresa' | 'possivel_duplicidade'
  | 'vinculo_sugerido' | 'aguardando_confirmacao' | 'corrigido_manualmente'

export type FiltrosConferencia = {
  competencia: string
  empresaId?: string
  nome?: string
  documento?: string
  classificacao?: ClassificacaoConferencia
  valorMin?: number
  valorMax?: number
  divergencia?: boolean
  emissaoDe?: string
  emissaoAte?: string
  numeroNota?: string
  busca?: string
  pagina?: number
  porPagina?: number
  ordem?: 'profissional_nome' | 'empresa_id' | 'profissional_documento' | 'valor_comissao' | 'mes_ref' | 'classificacao'
  direcao?: 'asc' | 'desc'
}

export type CandidatoVinculo = {
  notaId: string
  documentoIgual: boolean
  competenciaNota: string | null
  competenciaComissao: string
  empresaIgual: boolean
  disponivel: boolean
  valorNota: number
  valorEsperado: number
  nomeSimilar?: boolean
}

function distanciaMes(a: string | null, b: string) {
  if (!a) return 99
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return Math.abs((ay * 12 + am) - (by * 12 + bm))
}

export function pontuarVinculo(c: CandidatoVinculo) {
  if (!c.disponivel || c.valorNota <= 0 || !c.documentoIgual) return { pontos: 0, nivel: 'baixa' as const, justificativa: 'Nota indisponível, sem valor ou com documento diferente.' }
  const distancia = distanciaMes(c.competenciaNota, c.competenciaComissao)
  if (distancia > 1) return { pontos: 0, nivel: 'baixa' as const, justificativa: 'Competência distante; disponível apenas no histórico completo.' }
  let pontos = 50
  const motivos = ['mesmo CPF/CNPJ']
  if (distancia === 0) { pontos += 20; motivos.push('mesma competência') }
  else { pontos += 5; motivos.push('competência adjacente') }
  if (c.empresaIgual) { pontos += 15; motivos.push('mesma empresa') }
  const base = Math.max(Math.abs(c.valorEsperado), 1)
  const delta = Math.abs(c.valorNota - c.valorEsperado) / base
  if (delta <= .02) { pontos += 12; motivos.push('valor compatível') }
  else if (delta <= .1) { pontos += 6; motivos.push('valor próximo') }
  if (c.nomeSimilar) { pontos += 3; motivos.push('nome semelhante') }
  pontos = Math.min(100, pontos)
  const nivel = pontos >= 90 && distancia === 0 && c.empresaIgual ? 'alta' : pontos >= 65 ? 'media' : 'baixa'
  return { pontos, nivel, justificativa: `${pontos}% de compatibilidade: ${motivos.join(', ')}.` }
}

export async function listarConferencia(f: FiltrosConferencia) {
  const pagina = Math.max(1, f.pagina || 1)
  const porPagina = Math.min(100, Math.max(10, f.porPagina || 25))
  const inicio = (pagina - 1) * porPagina
  let q = supabase.from('salon_comissoes')
    .select('*, empresas(razao_social, apelido), salon_notas(*)', { count: 'exact' })
    .eq('mes_ref', f.competencia)
  if (f.empresaId) q = q.eq('empresa_id', f.empresaId)
  if (f.nome) q = q.ilike('profissional_nome', `%${f.nome}%`)
  if (f.documento) q = q.ilike('profissional_documento', `%${f.documento.replace(/\D/g, '')}%`)
  if (f.classificacao) q = q.eq('classificacao', f.classificacao)
  if (f.valorMin != null) q = q.gte('valor_comissao', f.valorMin)
  if (f.valorMax != null) q = q.lte('valor_comissao', f.valorMax)
  if (f.numeroNota) q = q.ilike('nf_numero', `%${f.numeroNota}%`)
  if (f.busca) q = q.or(`profissional_nome.ilike.%${f.busca}%,profissional_documento.ilike.%${f.busca}%,nf_numero.ilike.%${f.busca}%`)
  if (f.divergencia) q = q.eq('classificacao', 'divergencia_valor')
  q = q.order(f.ordem || 'profissional_nome', { ascending: (f.direcao || 'asc') === 'asc' }).range(inicio, inicio + porPagina - 1)
  const { data, count, error } = await q
  if (error) throw new Error(error.message)
  return { linhas: data || [], total: count || 0, pagina, porPagina }
}

export async function registrarAuditoria(params: {
  entidade: string; registroId?: string; acao: string; anterior?: unknown; novo?: unknown; usuario?: string; justificativa?: string
}) {
  const { error } = await supabase.from('salon_auditoria').insert({
    entidade: params.entidade, registro_id: params.registroId || null, acao: params.acao,
    valor_anterior: params.anterior ?? null, valor_novo: params.novo ?? null,
    usuario: params.usuario || null, justificativa: params.justificativa || null,
  })
  if (error) throw new Error(error.message)
}

import { supabase } from '../supabase'

// Linha "esperada" (planilha) por competência
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
  // nota vinculada (quando conferida)
  nota?: { numero: string | null; valor: number | null; data_emissao: string | null; competencia: string | null } | null
  // diagnóstico: existe nota do MESMO CNPJ disponível? (mesmo que valor/empresa difira)
  dicaNotaValor?: number | null
  dicaNotaComp?: string | null
  dicaNotaId?: string | null
  dicaNotaEmpresa?: string | null
  dicaOutraEmpresa?: boolean
}

// Nota recebida sem vínculo
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
  empresaNome?: string
}

function dig(s: string | null | undefined) { return (s ?? '').replace(/\D/g, '') }

// Competência efetiva de uma nota: usa a conferência manual, senão o dCompet
// da nota, senão o mês da data de emissão (fallback quando o XML não trouxe dCompet).
function notaComp(n: { competencia_conf?: string | null; competencia?: string | null; data_emissao?: string | null }): string {
  return (n.competencia_conf || n.competencia || (n.data_emissao ? String(n.data_emissao).slice(0, 7) : '')) as string
}

/**
 * Reconcilia uma competência por CNPJ + competência (NÃO por valor exato).
 *
 * Motivo: o "Crédito" da planilha é a comissão que o salão paga ao profissional,
 * que NÃO é igual ao valor bruto da NFS-e emitida — mesmo no mesmo mês os números
 * divergem. Casar por valor exato praticamente nunca fecha. A chave confiável é
 * CNPJ do emitente + competência (dCompet da nota = mês informado na planilha).
 *
 * Para cada linha esperada ainda pendente, procura a(s) nota(s) recebida(s) do
 * MESMO CNPJ na MESMA empresa cuja competência seja a da conferência. Havendo mais
 * de uma, escolhe a de valor mais próximo do crédito. Ao casar, marca como
 * conferida e vincula a nota. O valor vira apenas comparação (exibido na tela),
 * não requisito. Uma nota só é usada uma vez.
 */
export async function reconciliarCompetencia(competencia: string, empresaId?: string):
  Promise<{ conferidas: number; pendentes: number; divergencias: number }> {
  let cq = supabase.from('salon_comissoes')
    .select('id, empresa_id, documento, valor_comissao')
    .eq('mes_ref', competencia).is('nota_id', null)
  if (empresaId) cq = cq.eq('empresa_id', empresaId)
  const { data: pend } = await cq
  if (!pend || pend.length === 0) return { conferidas: 0, pendentes: 0, divergencias: 0 }

  const empresas = Array.from(new Set(pend.map((p) => p.empresa_id)))

  // Notas já usadas por qualquer comissão (não reutilizar)
  const { data: linkRows } = await supabase.from('salon_comissoes').select('nota_id').not('nota_id', 'is', null)
  const usadas = new Set((linkRows ?? []).map((r: { nota_id: string }) => r.nota_id))

  const { data: notas } = await supabase.from('salon_notas')
    .select('id, empresa_id, documento, valor, numero, data_emissao, competencia, competencia_conf')
    .in('empresa_id', empresas)

  // Agrupa notas livres por empresa|documento
  type NotaCand = { id: string; valor: number; numero: string | null; data_emissao: string | null; competencia: string | null; competencia_conf: string | null }
  const porChave = new Map<string, NotaCand[]>()
  for (const n of (notas ?? [])) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nn = n as any
    if (usadas.has(nn.id)) continue
    const k = nn.empresa_id + '|' + dig(nn.documento)
    const arr = porChave.get(k) ?? []
    arr.push({ id: nn.id, valor: Number(nn.valor) || 0, numero: nn.numero, data_emissao: nn.data_emissao, competencia: nn.competencia, competencia_conf: nn.competencia_conf })
    porChave.set(k, arr)
  }

  let conferidas = 0, divergencias = 0
  for (const p of pend) {
    const k = p.empresa_id + '|' + dig(p.documento)
    const arr = porChave.get(k)
    if (!arr || arr.length === 0) continue
    const alvo = Number(p.valor_comissao) || 0
    // Chave: mesma competência (dCompet da nota = mês da planilha). Valor NÃO é filtro,
    // mas ignora notas de valor 0 (canceladas/lixo) para não vincular a nota errada.
    const cands = arr.filter((n) => notaComp(n) === competencia && n.valor > 0)
    if (cands.length === 0) continue
    // Havendo várias notas do mesmo CNPJ no mês, prefere a de valor mais próximo do crédito.
    cands.sort((a, b) => Math.abs(a.valor - alvo) - Math.abs(b.valor - alvo))
    const nota = cands[0]
    await supabase.from('salon_comissoes').update({
      nota_id: nota.id, status: 'conferida',
      nf_numero: nota.numero ?? null, nf_data: nota.data_emissao ?? null, nf_valor: nota.valor, nf_origem: 'adn',
      confirmado_em: new Date().toISOString(),
    }).eq('id', p.id)
    await supabase.from('salon_notas').update({ conferida: true }).eq('id', nota.id)
    arr.splice(arr.indexOf(nota), 1) // não reutiliza
    if (Math.abs(nota.valor - alvo) >= 0.01) divergencias++
    conferidas++
  }
  return { conferidas, pendentes: pend.length - conferidas, divergencias }
}

export type Conferencia = { pendentes: Esperada[]; conferidas: Esperada[]; semVinculo: NotaLivre[]; pendenciasImport: Esperada[] }

/** Corrige o CNPJ de uma pendência de importação (deixa de ser pendência). */
export async function corrigirCnpj(comissaoId: string, documento: string): Promise<{ ok: boolean; erro?: string }> {
  const doc = (documento ?? '').replace(/\D/g, '')
  if (doc.length !== 11 && doc.length !== 14) return { ok: false, erro: 'CNPJ/CPF inválido.' }
  const { error } = await supabase.from('salon_comissoes').update({ documento: doc, pendencia: null }).eq('id', comissaoId)
  if (error) return { ok: false, erro: error.code === '23505' ? 'Já existe um registro com esse CNPJ nesta competência/empresa.' : error.message }
  return { ok: true }
}

/** Lista os grupos da competência: pendentes, conferidas, sem vínculo e pendências de importação. */
export async function listarConferencia(competencia: string, empresaId?: string): Promise<Conferencia> {
  let cq = supabase.from('salon_comissoes')
    .select('*, empresas(apelido, razao_social)')
    .eq('mes_ref', competencia)
  if (empresaId) cq = cq.eq('empresa_id', empresaId)
  const { data: coms } = await cq

  const linkIds = Array.from(new Set((coms ?? []).filter((c: { nota_id: string | null }) => c.nota_id).map((c: { nota_id: string }) => c.nota_id)))
  const notaById = new Map<string, { numero: string | null; valor: number | null; data_emissao: string | null; competencia: string | null }>()
  if (linkIds.length) {
    const { data: nl } = await supabase.from('salon_notas').select('id, numero, valor, data_emissao, competencia').in('id', linkIds)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(nl ?? []).forEach((n: any) => notaById.set(n.id, { numero: n.numero, valor: n.valor, data_emissao: n.data_emissao, competencia: n.competencia }))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapEsp = (c: any): Esperada => {
    const e = Array.isArray(c.empresas) ? c.empresas[0] : c.empresas
    return { ...c, empresaNome: e?.apelido || e?.razao_social || '', nota: c.nota_id ? (notaById.get(c.nota_id) ?? null) : null }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conferidas = (coms ?? []).filter((c: any) => c.nota_id).map(mapEsp)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendenciasImport = (coms ?? []).filter((c: any) => !c.nota_id && c.pendencia).map(mapEsp)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendentes = (coms ?? []).filter((c: any) => !c.nota_id && !c.pendencia).map(mapEsp)

  // Notas sem vínculo (da competência): não usadas por nenhuma comissão
  const { data: allLink } = await supabase.from('salon_comissoes').select('nota_id').not('nota_id', 'is', null)
  const usadas = new Set((allLink ?? []).map((r: { nota_id: string }) => r.nota_id))
  let nq = supabase.from('salon_notas').select('*, empresas(apelido, razao_social)').limit(8000)
  if (empresaId) nq = nq.eq('empresa_id', empresaId)
  const { data: notas } = await nq
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const semVinculo: NotaLivre[] = (notas ?? []).filter((n: any) => !usadas.has(n.id) && ((n.competencia_conf || n.competencia || '') === competencia))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((n: any) => { const e = Array.isArray(n.empresas) ? n.empresas[0] : n.empresas; return { ...n, empresaNome: e?.apelido || e?.razao_social || '' } })

  // Diagnóstico: procura a nota do mesmo CNPJ em TODAS as empresas (não usadas),
  // para revelar se a nota existe porém em outra empresa ou com outro valor.
  const { data: todasNotas } = await supabase.from('salon_notas')
    .select('id, empresa_id, documento, valor, competencia, competencia_conf, empresas(apelido, razao_social)').limit(20000)
  const porDocGlobal = new Map<string, { id: string; valor: number; comp: string; empresa_id: string; empresaNome: string }[]>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const n of (todasNotas ?? []) as any[]) {
    if (usadas.has(n.id)) continue
    const e = Array.isArray(n.empresas) ? n.empresas[0] : n.empresas
    const k = dig(n.documento)
    if (!k) continue
    const arr = porDocGlobal.get(k) ?? []
    arr.push({ id: n.id, valor: Number(n.valor) || 0, comp: n.competencia_conf || n.competencia || '', empresa_id: n.empresa_id, empresaNome: e?.apelido || e?.razao_social || '' })
    porDocGlobal.set(k, arr)
  }
  for (const p of pendentes) {
    const cands = porDocGlobal.get(dig(p.documento))
    if (!cands || cands.length === 0) continue
    // Nota mais recente primeiro (mostra a competência mais próxima disponível).
    const ordenadas = [...cands].sort((a, b) => (b.comp || '').localeCompare(a.comp || ''))
    // Prioridade: nota na competência conferida (na própria empresa) → competência
    // conferida em outra empresa → nota mais recente na própria empresa → mais recente geral.
    const best =
      ordenadas.find((c) => c.empresa_id === p.empresa_id && c.comp === competencia) ??
      ordenadas.find((c) => c.comp === competencia) ??
      ordenadas.find((c) => c.empresa_id === p.empresa_id) ??
      ordenadas[0]
    p.dicaNotaValor = best.valor; p.dicaNotaComp = best.comp || null; p.dicaNotaId = best.id
    p.dicaNotaEmpresa = best.empresaNome; p.dicaOutraEmpresa = best.empresa_id !== p.empresa_id
  }

  return { pendentes, conferidas, semVinculo, pendenciasImport }
}

/** Notas recebidas (não usadas) do mesmo CNPJ — de qualquer competência. */
export async function notasDoCnpj(empresaId: string, documento: string | null): Promise<NotaLivre[]> {
  const doc = dig(documento)
  const { data: allLink } = await supabase.from('salon_comissoes').select('nota_id').not('nota_id', 'is', null)
  const usadas = new Set((allLink ?? []).map((r: { nota_id: string }) => r.nota_id))
  const { data } = await supabase.from('salon_notas').select('*, empresas(apelido, razao_social)').eq('empresa_id', empresaId).limit(8000)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).filter((n: any) => !usadas.has(n.id) && (!doc || dig(n.documento) === doc))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((n: any) => { const e = Array.isArray(n.empresas) ? n.empresas[0] : n.empresas; return { ...n, empresaNome: e?.apelido || e?.razao_social || '' } })
}

/** Vincula manualmente uma nota a uma linha esperada (conferência manual). */
export async function vincularNota(comissaoId: string, nota: { id: string; numero: string | null; valor: number | null; data_emissao: string | null }):
  Promise<{ ok: boolean; erro?: string }> {
  const { error } = await supabase.from('salon_comissoes').update({
    nota_id: nota.id, status: 'conferida',
    nf_numero: nota.numero, nf_data: nota.data_emissao, nf_valor: nota.valor, nf_origem: 'manual',
    confirmado_em: new Date().toISOString(),
  }).eq('id', comissaoId)
  if (error) return { ok: false, erro: error.message }
  await supabase.from('salon_notas').update({ conferida: true }).eq('id', nota.id)
  return { ok: true }
}

/** Desfaz o vínculo (volta a pendente). */
export async function desvincular(comissaoId: string, notaId: string | null): Promise<{ ok: boolean; erro?: string }> {
  const { error } = await supabase.from('salon_comissoes').update({
    nota_id: null, status: 'pendente', nf_numero: null, nf_data: null, nf_valor: null, nf_origem: null, confirmado_em: null,
  }).eq('id', comissaoId)
  if (error) return { ok: false, erro: error.message }
  if (notaId) await supabase.from('salon_notas').update({ conferida: false }).eq('id', notaId)
  return { ok: true }
}

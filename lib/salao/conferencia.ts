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
  observacao: string | null
  nf_numero: string | null
  nf_data: string | null
  nf_valor: number | null
  empresaNome?: string
  // nota vinculada (quando conferida)
  nota?: { numero: string | null; valor: number | null; data_emissao: string | null; competencia: string | null } | null
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

/**
 * Reconcilia uma competência: para cada linha esperada (planilha) ainda pendente,
 * procura uma NOTA recebida do MESMO CNPJ e MESMO VALOR (tolerância de centavos),
 * dando preferência à nota da própria competência. Ao casar, marca como conferida
 * e vincula a nota. Uma nota só é usada uma vez.
 */
export async function reconciliarCompetencia(competencia: string, empresaId?: string):
  Promise<{ conferidas: number; pendentes: number }> {
  let cq = supabase.from('salon_comissoes')
    .select('id, empresa_id, documento, valor_comissao')
    .eq('mes_ref', competencia).is('nota_id', null)
  if (empresaId) cq = cq.eq('empresa_id', empresaId)
  const { data: pend } = await cq
  if (!pend || pend.length === 0) return { conferidas: 0, pendentes: 0 }

  const empresas = Array.from(new Set(pend.map((p) => p.empresa_id)))

  // Notas já usadas por qualquer comissão (não reutilizar)
  const { data: linkRows } = await supabase.from('salon_comissoes').select('nota_id').not('nota_id', 'is', null)
  const usadas = new Set((linkRows ?? []).map((r: { nota_id: string }) => r.nota_id))

  const { data: notas } = await supabase.from('salon_notas')
    .select('id, empresa_id, documento, valor, numero, data_emissao, competencia, competencia_conf')
    .in('empresa_id', empresas)

  // Agrupa notas livres por empresa|documento
  const porChave = new Map<string, NotaCand[]>()
  type NotaCand = { id: string; valor: number; numero: string | null; data_emissao: string | null; competencia: string | null; competencia_conf: string | null }
  for (const n of (notas ?? [])) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nn = n as any
    if (usadas.has(nn.id)) continue
    const k = nn.empresa_id + '|' + dig(nn.documento)
    const arr = porChave.get(k) ?? []
    arr.push({ id: nn.id, valor: Number(nn.valor) || 0, numero: nn.numero, data_emissao: nn.data_emissao, competencia: nn.competencia, competencia_conf: nn.competencia_conf })
    porChave.set(k, arr)
  }

  let conferidas = 0
  for (const p of pend) {
    const k = p.empresa_id + '|' + dig(p.documento)
    const arr = porChave.get(k)
    if (!arr || arr.length === 0) continue
    const alvo = Number(p.valor_comissao) || 0
    const cands = arr.filter((n) => Math.abs(n.valor - alvo) < 0.01)
    if (cands.length === 0) continue
    cands.sort((a, b) => {
      const ca = (a.competencia_conf || a.competencia || '') === competencia ? 0 : 1
      const cb = (b.competencia_conf || b.competencia || '') === competencia ? 0 : 1
      if (ca !== cb) return ca - cb
      return (a.data_emissao || '').localeCompare(b.data_emissao || '')
    })
    const nota = cands[0]
    await supabase.from('salon_comissoes').update({
      nota_id: nota.id, status: 'conferida',
      nf_numero: nota.numero ?? null, nf_data: nota.data_emissao ?? null, nf_valor: nota.valor, nf_origem: 'adn',
      confirmado_em: new Date().toISOString(),
    }).eq('id', p.id)
    await supabase.from('salon_notas').update({ conferida: true }).eq('id', nota.id)
    arr.splice(arr.indexOf(nota), 1) // não reutiliza
    conferidas++
  }
  return { conferidas, pendentes: pend.length - conferidas }
}

export type Conferencia = { pendentes: Esperada[]; conferidas: Esperada[]; semVinculo: NotaLivre[] }

/** Lista os 3 grupos da competência: pendentes, conferidas e notas sem vínculo. */
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
  const pendentes = (coms ?? []).filter((c: { nota_id: string | null }) => !c.nota_id).map(mapEsp)
  const conferidas = (coms ?? []).filter((c: { nota_id: string | null }) => c.nota_id).map(mapEsp)

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

  return { pendentes, conferidas, semVinculo }
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

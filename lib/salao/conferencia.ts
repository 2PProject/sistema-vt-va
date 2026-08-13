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
 * Reconcilia uma competência por CNPJ + competência (NÃO por valor exato, NÃO
 * exigindo a mesma empresa).
 *
 * Motivo 1 (valor): o "Crédito" da planilha é a comissão que o salão paga, que
 * pode diferir do valor bruto da NFS-e. O valor vira comparação, não requisito.
 * Motivo 2 (empresa): a nota é baixada pela unidade dona do certificado e a linha
 * da planilha é vinculada pela aba/apelido — os `empresa_id` internos nem sempre
 * são o mesmo registro. Exigir empresa igual descartava notas idênticas em CNPJ e
 * competência. A chave confiável é o CNPJ do emitente + a competência (dCompet).
 *
 * Estratégia em 2 passadas para não "roubar" a nota da unidade certa:
 *   1ª) casa quando CNPJ + competência + MESMA empresa;
 *   2ª) para o que sobrou, casa por CNPJ + competência em QUALQUER empresa.
 * Havendo mais de uma nota, escolhe a de valor mais próximo do crédito. Ignora
 * notas de valor 0 (canceladas). Uma nota só é usada uma vez.
 */
export async function reconciliarCompetencia(competencia: string, empresaId?: string):
  Promise<{ conferidas: number; pendentes: number; divergencias: number; outraEmpresa: number }> {
  let cq = supabase.from('salon_comissoes')
    .select('id, empresa_id, documento, valor_comissao')
    .eq('mes_ref', competencia).is('nota_id', null)
  if (empresaId) cq = cq.eq('empresa_id', empresaId)
  const { data: pend } = await cq
  if (!pend || pend.length === 0) return { conferidas: 0, pendentes: 0, divergencias: 0, outraEmpresa: 0 }

  // "Usada" conta APENAS vínculos da MESMA competência. Um vínculo herdado de
  // outro mês (poluição de importações antigas, quando o casamento não travava a
  // competência) não pode bloquear a nota do mês certo.
  const { data: linkRows } = await supabase.from('salon_comissoes').select('nota_id').eq('mes_ref', competencia).not('nota_id', 'is', null)
  const usadas = new Set((linkRows ?? []).map((r: { nota_id: string }) => r.nota_id))

  // Carrega TODAS as notas da competência (qualquer empresa) — não filtra por
  // empresa_id, senão notas de unidade diferente ficariam invisíveis.
  const { data: notas } = await supabase.from('salon_notas')
    .select('id, empresa_id, documento, valor, numero, data_emissao, competencia, competencia_conf')
    .limit(20000)

  // Agrupa notas candidatas por CNPJ (só da competência, valor > 0, não usadas).
  type NotaCand = { id: string; empresa_id: string; valor: number; numero: string | null; data_emissao: string | null }
  const porDoc = new Map<string, NotaCand[]>()
  for (const n of (notas ?? [])) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nn = n as any
    if (usadas.has(nn.id)) continue
    if (!(Number(nn.valor) > 0)) continue
    if (notaComp(nn) !== competencia) continue
    const k = dig(nn.documento)
    if (!k) continue
    const arr = porDoc.get(k) ?? []
    arr.push({ id: nn.id, empresa_id: nn.empresa_id, valor: Number(nn.valor) || 0, numero: nn.numero, data_emissao: nn.data_emissao })
    porDoc.set(k, arr)
  }

  let conferidas = 0, divergencias = 0, outraEmpresa = 0
  const feitos = new Set<string>()

  async function casar(p: { id: string; empresa_id: string; documento: string | null; valor_comissao: number }, arr: NotaCand[], nota: NotaCand) {
    const alvo = Number(p.valor_comissao) || 0
    // Auto-cura: libera qualquer vínculo INVÁLIDO dessa nota em OUTRA comissão
    // (ex.: importação antiga que amarrou a nota a outro mês). A nota pertence a
    // um único profissional/competência.
    await supabase.from('salon_comissoes').update({
      nota_id: null, status: 'pendente', nf_numero: null, nf_data: null, nf_valor: null, nf_origem: null, confirmado_em: null,
    }).eq('nota_id', nota.id).neq('id', p.id)
    await supabase.from('salon_comissoes').update({
      nota_id: nota.id, status: 'conferida',
      nf_numero: nota.numero ?? null, nf_data: nota.data_emissao ?? null, nf_valor: nota.valor, nf_origem: 'adn',
      confirmado_em: new Date().toISOString(),
    }).eq('id', p.id)
    await supabase.from('salon_notas').update({ conferida: true }).eq('id', nota.id)
    arr.splice(arr.indexOf(nota), 1) // não reutiliza
    feitos.add(p.id)
    if (Math.abs(nota.valor - alvo) >= 0.01) divergencias++
    if (nota.empresa_id !== p.empresa_id) outraEmpresa++
    conferidas++
  }

  // 1ª passada: CNPJ + competência + MESMA empresa (prioridade da unidade certa).
  for (const p of pend) {
    const arr = porDoc.get(dig(p.documento))
    if (!arr || arr.length === 0) continue
    const alvo = Number(p.valor_comissao) || 0
    const mesmaEmpresa = arr.filter((n) => n.empresa_id === p.empresa_id)
    if (mesmaEmpresa.length === 0) continue
    mesmaEmpresa.sort((a, b) => Math.abs(a.valor - alvo) - Math.abs(b.valor - alvo))
    await casar(p, arr, mesmaEmpresa[0])
  }

  // 2ª passada: o que sobrou casa por CNPJ + competência em QUALQUER empresa.
  for (const p of pend) {
    if (feitos.has(p.id)) continue
    const arr = porDoc.get(dig(p.documento))
    if (!arr || arr.length === 0) continue
    const alvo = Number(p.valor_comissao) || 0
    arr.sort((a, b) => Math.abs(a.valor - alvo) - Math.abs(b.valor - alvo))
    await casar(p, arr, arr[0])
  }

  return { conferidas, pendentes: pend.length - conferidas, divergencias, outraEmpresa }
}

export type Conferencia = { pendentes: Esperada[]; conferidas: Esperada[]; semVinculo: NotaLivre[]; pendenciasImport: Esperada[] }

/**
 * Zera os vínculos de conferência de uma competência (ou de tudo) para reconciliar
 * do zero. Volta as comissões a "pendente" e libera as notas (conferida=false).
 * Útil para limpar vínculos poluídos por importações antigas.
 */
export async function limparVinculos(competencia?: string, empresaId?: string): Promise<{ limpos: number }> {
  let sel = supabase.from('salon_comissoes').select('id, nota_id').not('nota_id', 'is', null)
  if (competencia) sel = sel.eq('mes_ref', competencia)
  if (empresaId) sel = sel.eq('empresa_id', empresaId)
  const { data } = await sel
  const notaIds = Array.from(new Set((data ?? []).map((r: { nota_id: string | null }) => r.nota_id).filter(Boolean))) as string[]

  let upd = supabase.from('salon_comissoes').update({
    nota_id: null, status: 'pendente', nf_numero: null, nf_data: null, nf_valor: null, nf_origem: null, confirmado_em: null,
  }).not('nota_id', 'is', null)
  if (competencia) upd = upd.eq('mes_ref', competencia)
  if (empresaId) upd = upd.eq('empresa_id', empresaId)
  await upd

  if (notaIds.length) {
    // libera as notas em blocos (evita URL longa demais)
    for (let i = 0; i < notaIds.length; i += 200) {
      await supabase.from('salon_notas').update({ conferida: false }).in('id', notaIds.slice(i, i + 200))
    }
  }
  return { limpos: (data ?? []).length }
}

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

  // Notas sem vínculo (da competência): não usadas por comissão DESTA competência.
  // (Vínculos de outro mês não contam — senão a nota some por poluição antiga.)
  const { data: allLink } = await supabase.from('salon_comissoes').select('nota_id').eq('mes_ref', competencia).not('nota_id', 'is', null)
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

/**
 * Notas recebidas (não usadas) do mesmo CNPJ — de QUALQUER competência e de
 * QUALQUER unidade. Cross-empresa de propósito: a nota é baixada pela unidade
 * dona do certificado, que pode não ser o mesmo registro da aba da planilha.
 * O 1º argumento é mantido por compatibilidade, mas não filtra mais por empresa.
 */
export async function notasDoCnpj(_empresaId: string, documento: string | null): Promise<NotaLivre[]> {
  const doc = dig(documento)
  const { data: allLink } = await supabase.from('salon_comissoes').select('nota_id').not('nota_id', 'is', null)
  const usadas = new Set((allLink ?? []).map((r: { nota_id: string }) => r.nota_id))
  const { data } = await supabase.from('salon_notas').select('*, empresas(apelido, razao_social)').limit(20000)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).filter((n: any) => !usadas.has(n.id) && (!doc || dig(n.documento) === doc))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((n: any) => { const e = Array.isArray(n.empresas) ? n.empresas[0] : n.empresas; return { ...n, empresaNome: e?.apelido || e?.razao_social || '' } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .sort((a: any, b: any) => (b.competencia_conf || b.competencia || '').localeCompare(a.competencia_conf || a.competencia || ''))
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

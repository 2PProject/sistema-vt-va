import { supabase } from '../supabase'
import { MESES } from '../../utils/calculoVT'
import { PRAZO_DIA_PADRAO, type StatusComissao } from './config'
import type { Comissao, ResumoMes } from './tipos'

function norm(s: string) {
  return (s ?? '').toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** Mapa empresa_id -> prazo_dia (dia do mês seguinte). */
export async function carregarPrazos(): Promise<Map<string, number>> {
  const { data } = await supabase.from('salon_empresa_config').select('empresa_id, prazo_dia')
  const m = new Map<string, number>()
  ;(data ?? []).forEach((r: { empresa_id: string; prazo_dia: number }) => m.set(r.empresa_id, r.prazo_dia))
  return m
}

/** Calcula o status atual da comissão com base na NF e no prazo da empresa. */
export function calcularStatus(c: { nf_numero: string | null; mes_ref: string }, prazoDia: number): StatusComissao {
  if (c.nf_numero) return 'recebida'
  const [y, m] = c.mes_ref.split('-').map(Number)
  if (!y || !m) return 'pendente'
  const prazo = new Date(y, m, prazoDia)   // dia `prazoDia` do mês seguinte ao ref
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  return hoje > prazo ? 'fora_prazo' : 'pendente'
}

/** Converte "Maio/2026", "05/2026" ou "2026-05" em 'YYYY-MM'. */
export function parseMesRef(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  let mm = s.match(/^(\d{4})-(\d{1,2})$/)
  if (mm) return `${mm[1]}-${mm[2].padStart(2, '0')}`
  mm = s.match(/^(\d{1,2})[/-](\d{4})$/)
  if (mm) return `${mm[2]}-${mm[1].padStart(2, '0')}`
  mm = s.match(/^([a-zA-ZçÇãÃéÉêÊ]+)[/\s-]+(\d{4})$/)
  if (mm) {
    const idx = MESES.findIndex(x => norm(x) === norm(mm![1]))
    if (idx >= 0) return `${mm[2]}-${String(idx + 1).padStart(2, '0')}`
  }
  return null
}

export function parseValorBR(raw: unknown): number {
  if (typeof raw === 'number') return raw
  let s = String(raw ?? '').replace(/R\$/i, '').replace(/\s/g, '').trim()
  if (!s) return NaN
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  return parseFloat(s)
}

/** Lista comissões com nomes e status calculado. */
export async function listarComissoes(params: { empresaId?: string; mes?: string; status?: StatusComissao }):
  Promise<Comissao[]> {
  let q = supabase
    .from('salon_comissoes')
    .select('*, salon_professionals(nome, documento), empresas(razao_social, apelido)')
  if (params.empresaId) q = q.eq('empresa_id', params.empresaId)
  if (params.mes) q = q.eq('mes_ref', params.mes)
  const { data } = await q
  const prazos = await carregarPrazos()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let linhas: Comissao[] = (data ?? []).map((c: any) => {
    const p = Array.isArray(c.salon_professionals) ? c.salon_professionals[0] : c.salon_professionals
    const e = Array.isArray(c.empresas) ? c.empresas[0] : c.empresas
    const status = calcularStatus(c, prazos.get(c.empresa_id) ?? PRAZO_DIA_PADRAO)
    return {
      ...c, status,
      profissionalNome: p?.nome ?? '—', profissionalDoc: p?.documento ?? '',
      empresaNome: e?.apelido || e?.razao_social || '',
    }
  })
  if (params.status) linhas = linhas.filter(l => l.status === params.status)
  linhas.sort((a, b) => (a.empresaNome ?? '').localeCompare(b.empresaNome ?? '') || (a.profissionalNome ?? '').localeCompare(b.profissionalNome ?? ''))
  return linhas
}

export function resumoDoMes(linhas: Comissao[]): ResumoMes {
  const recebidas = linhas.filter(l => l.status === 'recebida').length
  const pendentesArr = linhas.filter(l => l.status === 'pendente' || l.status === 'fora_prazo')
  const total = linhas.length
  return {
    totalProfissionais: total,
    recebidas,
    percentualRecebidas: total > 0 ? Math.round((recebidas / total) * 100) : 0,
    pendentes: pendentesArr.length,
    valorPendente: Math.round(pendentesArr.reduce((s, l) => s + (l.valor_comissao || 0), 0) * 100) / 100,
    foraPrazo: linhas.filter(l => l.status === 'fora_prazo').length,
  }
}

// ── Confirmação manual / substituição de NF ────────────────────────────────
async function registrarLog(comissaoId: string, acao: string, detalhe: string, usuario?: string) {
  await supabase.from('salon_comissoes_log').insert({ comissao_id: comissaoId, acao, detalhe, usuario: usuario ?? null })
}

export async function confirmarNFManual(
  comissaoId: string,
  nf: { numero: string; data: string; valor: number },
  usuario?: string,
): Promise<{ ok: boolean; erro?: string }> {
  if (!nf.numero.trim() || !nf.data) return { ok: false, erro: 'Informe número e data da NF.' }
  const { error } = await supabase.from('salon_comissoes').update({
    nf_numero: nf.numero.trim(), nf_data: nf.data, nf_valor: nf.valor,
    nf_origem: 'manual', status: 'recebida', confirmado_em: new Date().toISOString(),
  }).eq('id', comissaoId)
  if (error) return { ok: false, erro: error.message }
  await registrarLog(comissaoId, 'confirmacao_manual', `NF ${nf.numero} em ${nf.data} (R$ ${nf.valor})`, usuario)
  return { ok: true }
}

export async function substituirNF(
  comissaoId: string,
  nf: { numero: string; data: string; valor: number },
  motivo: string,
  usuario?: string,
): Promise<{ ok: boolean; erro?: string }> {
  if (!motivo.trim()) return { ok: false, erro: 'Informe o motivo da substituição.' }
  const { error } = await supabase.from('salon_comissoes').update({
    nf_numero: nf.numero.trim(), nf_data: nf.data, nf_valor: nf.valor,
    nf_origem: 'manual', status: 'recebida', confirmado_em: new Date().toISOString(),
  }).eq('id', comissaoId)
  if (error) return { ok: false, erro: error.message }
  await registrarLog(comissaoId, 'substituicao_nf', `NF ${nf.numero}. Motivo: ${motivo.trim()}`, usuario)
  return { ok: true }
}

export type LinhaImportComissao = {
  empresaId: string; empresaNome: string
  profissionalId: string; profissionalNome: string
  mes_ref: string; valor_comissao: number
}

/** Lê a planilha (uma aba = uma empresa) e casa profissionais pelo nome. */
export async function importarPlanilhaComissoes(arquivo: File):
  Promise<{ linhas: LinhaImportComissao[]; erros: string[] }> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' })
  const linhas: LinhaImportComissao[] = []
  const erros: string[] = []

  const { data: empresas } = await supabase.from('empresas').select('id, razao_social, apelido')
  const empByNome = new Map<string, { id: string; nome: string }>()
  ;(empresas ?? []).forEach((e: { id: string; razao_social: string; apelido: string | null }) => {
    empByNome.set(norm(e.razao_social), { id: e.id, nome: e.apelido || e.razao_social })
    if (e.apelido) empByNome.set(norm(e.apelido), { id: e.id, nome: e.apelido })
  })

  const { data: profs } = await supabase.from('salon_professionals').select('id, nome, empresa_id')
  const profsPorEmp = new Map<string, { id: string; nomeNorm: string }[]>()
  ;(profs ?? []).forEach((p: { id: string; nome: string; empresa_id: string }) => {
    const arr = profsPorEmp.get(p.empresa_id) ?? []
    arr.push({ id: p.id, nomeNorm: norm(p.nome) }); profsPorEmp.set(p.empresa_id, arr)
  })

  for (const aba of wb.SheetNames) {
    const empresa = empByNome.get(norm(aba))
    if (!empresa) { erros.push(`Aba "${aba}": empresa não encontrada no sistema.`); continue }
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(wb.Sheets[aba], { defval: '' })
    for (let i = 0; i < rows.length; i++) {
      const row = Object.fromEntries(Object.entries(rows[i]).map(([k, v]) => [norm(k), v]))
      const nome = String(row['nome do profissional'] ?? row['nome'] ?? row['profissional'] ?? '').trim()
      const mes = parseMesRef(row['mes de referencia'] ?? row['mes'] ?? row['competencia'] ?? '')
      const valor = parseValorBR(row['valor da comissao'] ?? row['valor comissao'] ?? row['comissao'] ?? row['valor'] ?? 0)
      if (!nome) continue
      if (!mes) { erros.push(`Aba "${aba}", linha ${i + 2}: mês de referência inválido para "${nome}".`); continue }
      if (isNaN(valor) || valor < 0) { erros.push(`Aba "${aba}", linha ${i + 2}: valor inválido para "${nome}".`); continue }
      const lista = profsPorEmp.get(empresa.id) ?? []
      const alvo = norm(nome)
      const exato = lista.filter(p => p.nomeNorm === alvo)
      const cand = exato.length ? exato : lista.filter(p => p.nomeNorm.startsWith(alvo) || alvo.startsWith(p.nomeNorm))
      if (cand.length === 0) { erros.push(`Aba "${aba}": profissional "${nome}" não cadastrado.`); continue }
      if (cand.length > 1) { erros.push(`Aba "${aba}": mais de um profissional casa com "${nome}".`); continue }
      linhas.push({ empresaId: empresa.id, empresaNome: empresa.nome, profissionalId: cand[0].id, profissionalNome: nome, mes_ref: mes, valor_comissao: valor })
    }
  }
  return { linhas, erros }
}

/** Grava as comissões importadas. `sobrescrever` atualiza o valor de existentes. */
export async function processarImportacaoComissoes(linhas: LinhaImportComissao[], sobrescrever: boolean):
  Promise<{ gravados: number; atualizados: number; ignorados: number }> {
  let gravados = 0, atualizados = 0, ignorados = 0
  for (const l of linhas) {
    const { data: exist } = await supabase.from('salon_comissoes')
      .select('id').eq('empresa_id', l.empresaId).eq('profissional_id', l.profissionalId).eq('mes_ref', l.mes_ref).maybeSingle()
    if (exist) {
      if (!sobrescrever) { ignorados++; continue }
      await supabase.from('salon_comissoes').update({ valor_comissao: l.valor_comissao }).eq('id', exist.id)
      atualizados++
    } else {
      const { error } = await supabase.from('salon_comissoes').insert({
        empresa_id: l.empresaId, profissional_id: l.profissionalId, mes_ref: l.mes_ref, valor_comissao: l.valor_comissao, status: 'pendente',
      })
      if (!error) gravados++
    }
  }
  return { gravados, atualizados, ignorados }
}

/** Log completo (histórico) com nome do profissional. */
export async function listarHistorico(limite = 200) {
  const { data } = await supabase.from('salon_comissoes_log')
    .select('*, salon_comissoes(mes_ref, salon_professionals(nome), empresas(apelido, razao_social))')
    .order('criado_em', { ascending: false }).limit(limite)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => {
    const c = Array.isArray(r.salon_comissoes) ? r.salon_comissoes[0] : r.salon_comissoes
    const p = c ? (Array.isArray(c.salon_professionals) ? c.salon_professionals[0] : c.salon_professionals) : null
    const e = c ? (Array.isArray(c.empresas) ? c.empresas[0] : c.empresas) : null
    return {
      id: r.id, acao: r.acao, detalhe: r.detalhe, usuario: r.usuario, criado_em: r.criado_em,
      profissional: p?.nome ?? '', empresa: e?.apelido || e?.razao_social || '', mes_ref: c?.mes_ref ?? '',
    }
  })
}

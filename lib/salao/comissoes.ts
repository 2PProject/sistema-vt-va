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
export async function listarComissoes(params: { empresaId?: string; mes?: string; mesInicio?: string; mesFim?: string; status?: StatusComissao }):
  Promise<Comissao[]> {
  let q = supabase
    .from('salon_comissoes')
    .select('*, salon_professionals(nome, documento), empresas(razao_social, apelido)')
  if (params.empresaId) q = q.eq('empresa_id', params.empresaId)
  if (params.mes) q = q.eq('mes_ref', params.mes)
  if (params.mesInicio) q = q.gte('mes_ref', params.mesInicio)
  if (params.mesFim) q = q.lte('mes_ref', params.mesFim)
  const { data } = await q
  const prazos = await carregarPrazos()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let linhas: Comissao[] = (data ?? []).map((c: any) => {
    const p = Array.isArray(c.salon_professionals) ? c.salon_professionals[0] : c.salon_professionals
    const e = Array.isArray(c.empresas) ? c.empresas[0] : c.empresas
    const status = calcularStatus(c, prazos.get(c.empresa_id) ?? PRAZO_DIA_PADRAO)
    return {
      ...c, status,
      profissionalNome: String(c.nome ?? '').trim() || p?.nome || c.documento || 'Profissional não identificado', profissionalDoc: c.documento || p?.documento || '',
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
  documento: string; nome: string; valor_comissao: number
  pendencia?: string          // preenchido quando falta algo (ex.: "Sem CNPJ")
}

/**
 * Lê a planilha da competência (uma ABA por empresa, nome da aba = apelido).
 * Colunas por linha: Nome do profissional · CNPJ/CPF · Valor. A competência é
 * informada no envio (não vem na planilha). Linhas do mesmo CNPJ são somadas.
 */
export async function importarPlanilhaComissoes(arquivo: File):
  Promise<{ linhas: LinhaImportComissao[]; erros: string[] }> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' })
  const brutas: LinhaImportComissao[] = []
  const erros: string[] = []

  const { data: empresas } = await supabase.from('empresas').select('id, razao_social, apelido')
  const empByNome = new Map<string, { id: string; nome: string }>()
  ;(empresas ?? []).forEach((e: { id: string; razao_social: string; apelido: string | null }) => {
    empByNome.set(norm(e.razao_social), { id: e.id, nome: e.apelido || e.razao_social })
    if (e.apelido) empByNome.set(norm(e.apelido), { id: e.id, nome: e.apelido })
  })

  for (const aba of wb.SheetNames) {
    const empresa = empByNome.get(norm(aba))
    if (!empresa) { erros.push(`Aba "${aba}": empresa não encontrada (o nome da aba deve ser o apelido da empresa).`); continue }
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(wb.Sheets[aba], { defval: '' })
    for (let i = 0; i < rows.length; i++) {
      const row = Object.fromEntries(Object.entries(rows[i]).map(([k, v]) => [norm(k), v]))
      const nome = String(row['nome completo'] ?? row['nome do profissional'] ?? row['nome'] ?? row['profissional'] ?? '').trim()
      const documento = String(row['cnpj'] ?? row['cpf'] ?? row['cnpj/cpf'] ?? row['cpf/cnpj'] ?? row['documento'] ?? row['cnpj cpf'] ?? '').replace(/\D/g, '')
      const valor = parseValorBR(row['credito'] ?? row['valor da comissao'] ?? row['valor comissao'] ?? row['comissao'] ?? row['valor'] ?? 0)
      if (!nome && !documento && !(valor > 0)) continue          // linha vazia/total
      // Sem valor não dá para conferir — vira erro (não importa)
      if (isNaN(valor) || valor <= 0) { erros.push(`Aba "${aba}", linha ${i + 2}: valor (Crédito) inválido${nome ? ` (${nome})` : ''}.`); continue }
      // Sem CNPJ / CNPJ inválido → IMPORTA como PENDÊNCIA (não perde o registro)
      const docOk = documento.length === 11 || documento.length === 14
      const pendencia = !documento ? 'Sem CNPJ na planilha' : (!docOk ? 'CNPJ/CPF inválido' : undefined)
      brutas.push({
        empresaId: empresa.id, empresaNome: empresa.nome,
        documento: docOk ? documento : '', nome: nome || (docOk ? documento : 'Sem nome'),
        valor_comissao: valor, pendencia,
      })
    }
  }

  // Agrega por (empresa, documento) apenas as VÁLIDAS; pendências ficam individuais
  const map = new Map<string, LinhaImportComissao>()
  const pend: LinhaImportComissao[] = []
  for (const l of brutas) {
    if (!l.documento) { pend.push(l); continue }
    const k = l.empresaId + '|' + l.documento
    const ex = map.get(k)
    if (ex) ex.valor_comissao = Math.round((ex.valor_comissao + l.valor_comissao) * 100) / 100
    else map.set(k, { ...l })
  }
  return { linhas: [...Array.from(map.values()), ...pend], erros }
}

/**
 * Grava a lista esperada da competência. Válidas entram por CNPJ; incompletas
 * (sem CNPJ) entram como PENDÊNCIA (documento nulo + motivo), sem se perder.
 * `sobrescrever`: refaz a lista não-conferida da competência (mantém as já
 * conferidas). Sem sobrescrever: só adiciona o que ainda não existe.
 */
export async function processarImportacaoComissoes(linhas: LinhaImportComissao[], competencia: string, sobrescrever: boolean):
  Promise<{ gravados: number; atualizados: number; pendencias: number; ignorados: number }> {
  const empresasNoLote = Array.from(new Set(linhas.map(l => l.empresaId)))
  const { data: existentes, error: erroLeitura } = await supabase.from('salon_comissoes')
    .select('id, empresa_id, documento, nome, nota_id')
    .eq('mes_ref', competencia).in('empresa_id', empresasNoLote)
  if (erroLeitura) throw new Error(erroLeitura.message)

  const atuais = existentes ?? []
  const porDocumento = new Map(atuais.filter(x => x.documento).map(x => [x.empresa_id + '|' + x.documento, x]))
  const pendentesAtuais = new Set(atuais.filter(x => !x.documento).map(x => x.empresa_id + '|' + String(x.nome ?? '').trim().toLocaleLowerCase('pt-BR')))

  if (sobrescrever) {
    const { error } = await supabase.from('salon_comissoes').delete()
      .eq('mes_ref', competencia).in('empresa_id', empresasNoLote).is('nota_id', null)
    if (error) throw new Error(error.message)
  }

  const validas = linhas.filter(l => l.documento)
  const incompletas = linhas.filter(l => !l.documento)

  // A planilha alimenta também o cadastro-base exibido em Profissionais.
  // A competência continua em salon_comissoes; nome/documento mestre ficam em
  // salon_professionals e são ligados por profissional_id.
  if (validas.length > 0) {
    const cadastro = Array.from(new Map(validas.map(l => [
      l.empresaId + '|' + l.documento,
      { empresa_id: l.empresaId, documento: l.documento, nome: l.nome.trim() || l.documento, ativo: true },
    ])).values())
    const { error: erroCadastro } = await supabase.from('salon_professionals').upsert(cadastro, {
      onConflict: 'empresa_id,documento',
    })
    if (erroCadastro) throw new Error(`Erro ao atualizar profissionais: ${erroCadastro.message}`)
  }

  const { data: profissionais, error: erroProfissionais } = await supabase.from('salon_professionals')
    .select('id, empresa_id, documento').in('empresa_id', empresasNoLote)
  if (erroProfissionais) throw new Error(`Erro ao vincular profissionais: ${erroProfissionais.message}`)
  const profissionalPorDocumento = new Map((profissionais ?? []).map(p => [p.empresa_id + '|' + p.documento, p.id]))

  let gravados = validas.filter(l => !porDocumento.has(l.empresaId + '|' + l.documento)).length
  let atualizados = sobrescrever ? validas.length - gravados : 0
  let ignorados = sobrescrever ? 0 : validas.length - gravados

  const payloadValidas = validas.map(l => ({
    empresa_id: l.empresaId, mes_ref: competencia, documento: l.documento,
    profissional_id: profissionalPorDocumento.get(l.empresaId + '|' + l.documento) || null,
    nome: l.nome.trim() || l.documento, valor_comissao: l.valor_comissao,
    status: 'pendente', pendencia: null,
  }))
  const payloadPendencias = incompletas
    .filter(l => sobrescrever || !pendentesAtuais.has(l.empresaId + '|' + l.nome.trim().toLocaleLowerCase('pt-BR')))
    .map(l => ({
      empresa_id: l.empresaId, mes_ref: competencia, documento: null,
      nome: l.nome.trim() || 'Profissional não identificado', valor_comissao: l.valor_comissao,
      status: 'pendente', pendencia: l.pendencia ?? 'Sem CNPJ',
    }))
  if (!sobrescrever) ignorados += incompletas.length - payloadPendencias.length

  const lotes = <T,>(itens: T[], tamanho = 500) =>
    Array.from({ length: Math.ceil(itens.length / tamanho) }, (_, i) => itens.slice(i * tamanho, (i + 1) * tamanho))

  for (const lote of lotes(payloadValidas)) {
    const { error } = await supabase.from('salon_comissoes').upsert(lote, {
      onConflict: 'empresa_id,mes_ref,documento', ignoreDuplicates: !sobrescrever,
    })
    if (error) throw new Error(error.message)
  }
  for (const lote of lotes(payloadPendencias)) {
    const { error } = await supabase.from('salon_comissoes').insert(lote)
    if (error) throw new Error(error.message)
  }

  return { gravados, atualizados, pendencias: payloadPendencias.length, ignorados }
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

import { supabase, Empresa, Funcionario } from './supabase'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type PagamentoRegistro = {
  id: string
  funcionario_id: string
  empresa_id: string
  mes_referencia: string   // 'YYYY-MM'
  valor_liquido: number
  criado_em?: string
  atualizado_em?: string
}

export type PagamentoVale = {
  id: string
  funcionario_id: string
  empresa_id: string
  data: string             // 'YYYY-MM-DD'
  descricao: string
  valor_total: number
  parcelas: number
  mes_inicio: string       // 'YYYY-MM' — competência da 1ª parcela
  criado_em?: string
  funcionarios?: Funcionario
  empresas?: Empresa
}

/** Situação do parcelamento de um vale relativa a uma competência de referência. */
export type StatusVale = {
  parcelas: number
  valorParcela: number
  descontadas: number
  restantes: number
  valorDescontado: number
  valorRestante: number
}

/** Desconto de um vale aplicável a uma competência específica. */
export type DescontoAplicado = {
  vale: PagamentoVale
  valorParcela: number
  parcelaAtual: number
  totalParcelas: number
}

/** Linha consolidada de pagamento para exibição/recibo. */
export type LinhaPagamento = {
  funcionario_id: string
  empresa_id: string
  funcionarioNome: string
  funcao: string
  empresaNome: string
  empresaCnpj: string
  pix: string | null
  valorLiquido: number
  descontos: DescontoAplicado[]
  totalDescontos: number
  valorAPagar: number
}

// ── Helpers de competência ────────────────────────────────────────────────────

/** Competência padrão: sempre o mês anterior ao atual. Retorna 'YYYY-MM'. */
export function competenciaMesAnterior(): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Diferença em meses entre duas competências 'YYYY-MM' (b - a). */
function diffMeses(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return (by - ay) * 12 + (bm - am)
}

/**
 * Retorna o desconto aplicável de um vale para a competência informada,
 * ou null se a competência estiver fora da faixa de parcelas.
 */
export function descontoDoVale(vale: PagamentoVale, mesRef: string): DescontoAplicado | null {
  const parcelas = Math.max(1, vale.parcelas ?? 1)
  const idx = diffMeses(vale.mes_inicio, mesRef) // 0-based
  if (idx < 0 || idx >= parcelas) return null
  const valorParcela = Math.round((vale.valor_total / parcelas) * 100) / 100
  return {
    vale,
    valorParcela,
    parcelaAtual: idx + 1,
    totalParcelas: parcelas,
  }
}

/**
 * Situação do parcelamento até uma competência de referência:
 * quantas parcelas já foram descontadas e quantas ainda faltam.
 * Considera descontadas as parcelas cujo mês é <= referência.
 */
export function statusParcelasVale(vale: PagamentoVale, refCompetencia: string): StatusVale {
  const parcelas = Math.max(1, vale.parcelas ?? 1)
  const valorParcela = Math.round((vale.valor_total / parcelas) * 100) / 100
  let descontadas = diffMeses(vale.mes_inicio, refCompetencia) + 1
  descontadas = Math.max(0, Math.min(parcelas, descontadas))
  const restantes = parcelas - descontadas
  return {
    parcelas,
    valorParcela,
    descontadas,
    restantes,
    valorDescontado: Math.round(descontadas * valorParcela * 100) / 100,
    valorRestante: Math.round(restantes * valorParcela * 100) / 100,
  }
}

// ── Registros de pagamento (salário líquido) ──────────────────────────────────

export async function listarPagamentos(params: {
  mesReferencia: string
  empresaId?: string
}): Promise<PagamentoRegistro[]> {
  let q = supabase
    .from('pagamento_registros')
    .select('*')
    .eq('mes_referencia', params.mesReferencia)
  if (params.empresaId) q = q.eq('empresa_id', params.empresaId)
  const { data } = await q
  return (data as PagamentoRegistro[]) ?? []
}

export async function excluirPagamento(id: string): Promise<void> {
  await supabase.from('pagamento_registros').delete().eq('id', id)
}

// ── Vales ─────────────────────────────────────────────────────────────────────

export async function listarVales(params?: {
  empresaId?: string
  funcionarioId?: string
}): Promise<PagamentoVale[]> {
  let q = supabase
    .from('pagamento_vales')
    .select('*, funcionarios(id, nome, funcao), empresas(id, razao_social, cnpj)')
    .order('data', { ascending: false })
  if (params?.empresaId) q = q.eq('empresa_id', params.empresaId)
  if (params?.funcionarioId) q = q.eq('funcionario_id', params.funcionarioId)
  const { data } = await q
  return (data as PagamentoVale[]) ?? []
}

export async function criarVale(vale: Omit<PagamentoVale, 'id' | 'criado_em' | 'funcionarios' | 'empresas'>): Promise<{ ok: boolean; erro?: string }> {
  const { error } = await supabase.from('pagamento_vales').insert(vale)
  if (error) return { ok: false, erro: error.message }
  return { ok: true }
}

export async function atualizarVale(
  id: string,
  patch: Partial<Omit<PagamentoVale, 'id' | 'criado_em' | 'funcionarios' | 'empresas'>>
): Promise<{ ok: boolean; erro?: string }> {
  const { error } = await supabase.from('pagamento_vales').update(patch).eq('id', id)
  if (error) return { ok: false, erro: error.message }
  return { ok: true }
}

export async function excluirVale(id: string): Promise<void> {
  await supabase.from('pagamento_vales').delete().eq('id', id)
}

// ── Consolidação (cálculo do pagamento) ───────────────────────────────────────

/**
 * Monta as linhas de pagamento da competência: junta o salário líquido
 * importado com os vales/descontos ativos no mês e calcula o valor a pagar.
 * Valor a pagar = valor líquido - descontos da competência.
 */
export async function consolidarPagamentos(params: {
  mesReferencia: string
  empresaId?: string
}): Promise<LinhaPagamento[]> {
  const { mesReferencia, empresaId } = params

  const [registros, vales, funcsRes, empresasRes] = await Promise.all([
    listarPagamentos({ mesReferencia, empresaId }),
    listarVales({ empresaId }),
    supabase.from('funcionarios').select('id, nome, funcao, pix'),
    supabase.from('empresas').select('id, razao_social, cnpj'),
  ])

  const funcMap = new Map<string, { nome: string; funcao: string; pix: string | null }>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(funcsRes.data ?? []).forEach((f: any) =>
    funcMap.set(f.id, { nome: f.nome, funcao: f.funcao, pix: f.pix ?? null }))
  const empMap = new Map<string, { razao_social: string; cnpj: string }>()
  ;(empresasRes.data ?? []).forEach((e: Pick<Empresa, 'id' | 'razao_social' | 'cnpj'>) =>
    empMap.set(e.id, { razao_social: e.razao_social, cnpj: e.cnpj }))

  // Índice de vales por funcionário
  const valesPorFunc = new Map<string, PagamentoVale[]>()
  for (const v of vales) {
    const arr = valesPorFunc.get(v.funcionario_id) ?? []
    arr.push(v)
    valesPorFunc.set(v.funcionario_id, arr)
  }

  return registros.map((reg) => {
    const func = funcMap.get(reg.funcionario_id)
    const emp = empMap.get(reg.empresa_id)
    const descontos: DescontoAplicado[] = []
    for (const v of valesPorFunc.get(reg.funcionario_id) ?? []) {
      const d = descontoDoVale(v, mesReferencia)
      if (d) descontos.push(d)
    }
    const totalDescontos = descontos.reduce((s, d) => s + d.valorParcela, 0)
    return {
      funcionario_id: reg.funcionario_id,
      empresa_id: reg.empresa_id,
      funcionarioNome: func?.nome ?? '—',
      funcao: func?.funcao ?? '',
      empresaNome: emp?.razao_social ?? '—',
      empresaCnpj: emp?.cnpj ?? '',
      pix: func?.pix ?? null,
      valorLiquido: reg.valor_liquido,
      descontos,
      totalDescontos,
      valorAPagar: Math.round((reg.valor_liquido - totalDescontos) * 100) / 100,
    }
  }).sort((a, b) =>
    a.empresaNome.localeCompare(b.empresaNome) || a.funcionarioNome.localeCompare(b.funcionarioNome))
}

/**
 * Monta o conteúdo CSV para pagamento no banco (Nome; Chave Pix; Valor).
 * Valor = valor a pagar (líquido - descontos). Separador ";" e decimal ",".
 */
export function montarCSVBanco(linhas: LinhaPagamento[]): { csv: string; semPix: number } {
  const header = 'Nome;Chave PIX;Valor'
  const rows: string[] = []
  let semPix = 0
  for (const l of linhas) {
    if (!l.pix) semPix++
    const nome = (l.funcionarioNome ?? '').replace(/[;\r\n]/g, ' ').trim()
    const valor = l.valorAPagar.toFixed(2).replace('.', ',')
    rows.push(`${nome};${l.pix ?? ''};${valor}`)
  }
  return { csv: [header, ...rows].join('\r\n'), semPix }
}

// ── Importação da planilha de salário líquido ─────────────────────────────────

export type LinhaImportSalario = {
  funcionarioNome: string
  identificadorEmpresa: string  // CNPJ/apelido/unidade informado na planilha
  empresaId: string
  empresaNome: string
  funcionarioId: string
  valorLiquido: number
  pix?: string                  // opcional — atualiza a chave Pix do cadastro
}

function soDigitos(s: string) { return (s ?? '').replace(/\D/g, '') }
function norm(s: string) { return (s ?? '').toLowerCase().trim() }

function parseValorBR(raw: unknown): number {
  if (typeof raw === 'number') return raw
  return parseFloat(
    String(raw ?? '')
      .replace(/R\$\s*/i, '')
      .replace(/\./g, '')
      .replace(',', '.')
      .trim()
  )
}

/**
 * Lê a planilha de salário líquido. Cada linha deve conter:
 *   - Nome do profissional (funcionário já cadastrado)
 *   - CNPJ ou Apelido da empresa
 *   - Valor líquido a receber
 * Casa a empresa por CNPJ ou apelido e o funcionário pelo nome dentro da empresa.
 */
export async function importarPlanilhaSalarios(
  arquivo: File
): Promise<{ linhas: LinhaImportSalario[]; erros: string[] }> {
  const XLSX = await import('xlsx')
  const buffer = await arquivo.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array' })
  const linhas: LinhaImportSalario[] = []
  const erros: string[] = []

  // Empresas indexadas por CNPJ e por apelido
  const { data: empresas } = await supabase.from('empresas').select('id, razao_social, cnpj, apelido')
  const empByCnpj = new Map<string, { id: string; razao_social: string }>()
  const empByApelido = new Map<string, { id: string; razao_social: string }>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(empresas ?? []).forEach((e: any) => {
    if (e.cnpj) empByCnpj.set(soDigitos(e.cnpj), { id: e.id, razao_social: e.razao_social })
    if (e.apelido) empByApelido.set(norm(e.apelido), { id: e.id, razao_social: e.razao_social })
  })

  // Funcionários agrupados por empresa (para casamento tolerante de nome)
  const { data: funcs } = await supabase
    .from('funcionarios')
    .select('id, nome, unidades(empresa_id)')
  const funcsPorEmp = new Map<string, { id: string; nomeNorm: string }[]>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(funcs ?? []).forEach((f: any) => {
    const uni = Array.isArray(f.unidades) ? f.unidades[0] : f.unidades
    const empId = uni?.empresa_id
    if (!empId) return
    const arr = funcsPorEmp.get(empId) ?? []
    arr.push({ id: f.id, nomeNorm: norm(f.nome) })
    funcsPorEmp.set(empId, arr)
  })

  // Resolve o funcionário pelo nome dentro da empresa, ignorando maiúsculas
  // e acentos: tenta match exato; senão, prefixo (um nome começa com o outro).
  function resolverFuncionario(empId: string, nome: string): { id?: string; ambiguo?: boolean } {
    const alvo = norm(nome)
    const lista = funcsPorEmp.get(empId) ?? []
    if (!alvo) return {}
    const exato = lista.filter(f => f.nomeNorm === alvo)
    if (exato.length === 1) return { id: exato[0].id }
    if (exato.length > 1) return { ambiguo: true }
    const prefixo = lista.filter(f => f.nomeNorm.startsWith(alvo) || alvo.startsWith(f.nomeNorm))
    if (prefixo.length === 1) return { id: prefixo[0].id }
    if (prefixo.length > 1) return { ambiguo: true }
    return {}
  }

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    const rowsRaw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
    const rows = rowsRaw.map((row) =>
      Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim(), v])))

    // Se o nome da aba casar com uma empresa (apelido/CNPJ), usa como padrão
    const empresaDaAba = empByApelido.get(norm(sheetName)) ?? empByCnpj.get(soDigitos(sheetName))

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const nome = String(row['Nome'] ?? row['nome'] ?? row['Nome completo'] ?? row['Profissional'] ?? row['NOME'] ?? '').trim()
      const ident = String(
        row['Unidade'] ?? row['unidade'] ?? row['UNIDADE'] ??
        row['CNPJ'] ?? row['cnpj'] ?? row['Apelido'] ?? row['apelido'] ?? row['Empresa'] ?? row['empresa'] ?? ''
      ).trim()
      const valorRaw = row['Valor líquido'] ?? row['Valor liquido'] ?? row['Líquido'] ?? row['Liquido'] ??
        row['Valor'] ?? row['valor'] ?? row['VALOR'] ?? 0
      const valor = parseValorBR(valorRaw)
      const pix = String(row['PIX'] ?? row['Pix'] ?? row['pix'] ?? row['Chave Pix'] ?? row['Chave PIX'] ?? '').trim()

      if (!nome) continue // linha em branco

      // Resolve empresa: identificador da linha, senão a aba
      let empresa = empresaDaAba
      if (ident) {
        empresa = empByCnpj.get(soDigitos(ident)) ?? empByApelido.get(norm(ident)) ?? empresa
      }
      if (!empresa) {
        erros.push(`Linha ${i + 2} (${sheetName}): empresa não identificada para "${nome}" (informe CNPJ/apelido válido).`)
        continue
      }
      if (isNaN(valor) || valor <= 0) {
        erros.push(`Linha ${i + 2} (${sheetName}): valor líquido inválido para "${nome}".`)
        continue
      }

      const resolvido = resolverFuncionario(empresa.id, nome)
      if (resolvido.ambiguo) {
        erros.push(`Linha ${i + 2} (${sheetName}): mais de um funcionário corresponde a "${nome}" na empresa ${empresa.razao_social}. Use o nome completo.`)
        continue
      }
      if (!resolvido.id) {
        erros.push(`Linha ${i + 2} (${sheetName}): funcionário "${nome}" não encontrado na empresa ${empresa.razao_social}.`)
        continue
      }

      linhas.push({
        funcionarioNome: nome,
        identificadorEmpresa: ident || sheetName,
        empresaId: empresa.id,
        empresaNome: empresa.razao_social,
        funcionarioId: resolvido.id,
        valorLiquido: valor,
        pix: pix || undefined,
      })
    }
  }

  return { linhas, erros }
}

/** Gera e baixa um modelo (.xlsx) da planilha de salário líquido. */
export async function baixarModeloPlanilhaSalarios(): Promise<void> {
  const XLSX = await import('xlsx')
  const linhas = [
    ['Apelido', 'Nome', 'Valor'],
    ['apelido-da-empresa', 'Nome do Profissional', 1500.00],
    ['apelido-da-empresa', 'Outro Profissional', 2300.50],
  ]
  const ws = XLSX.utils.aoa_to_sheet(linhas)
  ws['!cols'] = [{ wch: 22 }, { wch: 32 }, { wch: 14 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Salarios')
  XLSX.writeFile(wb, 'modelo_pagamentos.xlsx')
}

export async function processarImportacaoSalarios(
  linhas: LinhaImportSalario[],
  mesReferencia: string
): Promise<{ gravados: number; erros: string[] }> {
  const erros: string[] = []
  if (linhas.length === 0) return { gravados: 0, erros }

  // Deduplica por funcionário (mantém a última linha) para não inserir 2x
  const byFunc = new Map<string, LinhaImportSalario>()
  for (const l of linhas) byFunc.set(l.funcionarioId, l)
  const unicas = Array.from(byFunc.values())
  const funcIds = unicas.map((l) => l.funcionarioId)

  // Reimportação limpa: remove os registros do mês desses funcionários e reinsere.
  // Não depende de constraint UNIQUE (funcionario_id, mes_referencia) no banco.
  const del = await supabase
    .from('pagamento_registros')
    .delete()
    .eq('mes_referencia', mesReferencia)
    .in('funcionario_id', funcIds)
  if (del.error) {
    erros.push(`Erro ao gravar: ${del.error.message}`)
    return { gravados: 0, erros }
  }

  const payload = unicas.map((l) => ({
    funcionario_id: l.funcionarioId,
    empresa_id: l.empresaId,
    mes_referencia: mesReferencia,
    valor_liquido: l.valorLiquido,
    atualizado_em: new Date().toISOString(),
  }))

  const { error } = await supabase.from('pagamento_registros').insert(payload)
  if (error) {
    erros.push(`Erro ao gravar: ${error.message}`)
    return { gravados: 0, erros }
  }

  // Atualiza a chave Pix do cadastro quando informada na planilha (não bloqueia)
  const comPix = unicas.filter((l) => l.pix)
  await Promise.all(comPix.map((l) =>
    supabase.from('funcionarios').update({ pix: l.pix }).eq('id', l.funcionarioId)
  )).catch(() => { /* coluna pix pode não existir ainda — ignora */ })

  return { gravados: unicas.length, erros }
}

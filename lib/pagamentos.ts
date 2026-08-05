import { supabase, Empresa, Funcionario } from './supabase'
import { listarFechamentos } from './fechamentoStatus'

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
  registroId: string
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

export async function atualizarPagamentoLiquido(id: string, valorLiquido: number): Promise<{ ok: boolean; erro?: string }> {
  const { error } = await supabase
    .from('pagamento_registros')
    .update({ valor_liquido: valorLiquido, atualizado_em: new Date().toISOString() })
    .eq('id', id)
  if (error) return { ok: false, erro: error.message }
  return { ok: true }
}

// ── Vales ─────────────────────────────────────────────────────────────────────

export async function listarVales(params?: {
  empresaId?: string
  funcionarioId?: string
}): Promise<PagamentoVale[]> {
  let q = supabase
    .from('pagamento_vales')
    .select('*, funcionarios(id, nome, funcao), empresas(id, apelido, razao_social, cnpj)')
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
    supabase.from('funcionarios').select('id, nome, funcao, pix, ativo'),
    supabase.from('empresas').select('id, razao_social, cnpj'),
  ])

  const funcMap = new Map<string, { nome: string; funcao: string; pix: string | null; ativo: boolean }>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(funcsRes.data ?? []).forEach((f: any) =>
    funcMap.set(f.id, { nome: f.nome, funcao: f.funcao, pix: f.pix ?? null, ativo: f.ativo !== false }))
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

  return registros
    // Não traz demitidos (funcionário inativo) para o pagamento
    .filter((reg) => funcMap.get(reg.funcionario_id)?.ativo !== false)
    .map((reg) => {
    const func = funcMap.get(reg.funcionario_id)
    const emp = empMap.get(reg.empresa_id)
    const descontos: DescontoAplicado[] = []
    for (const v of valesPorFunc.get(reg.funcionario_id) ?? []) {
      const d = descontoDoVale(v, mesReferencia)
      if (d) descontos.push(d)
    }
    const totalDescontos = descontos.reduce((s, d) => s + d.valorParcela, 0)
    return {
      registroId: reg.id,
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
  let s = String(raw ?? '').replace(/R\$/i, '').replace(/\s/g, '').trim()
  if (!s) return NaN
  if (s.includes(',')) {
    // vírgula = decimal, pontos = separador de milhar
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (s.includes('.')) {
    // sem vírgula: ponto só é decimal quando há 1 ponto com até 2 casas
    const partes = s.split('.')
    if (!(partes.length === 2 && partes[1].length <= 2)) {
      s = s.replace(/\./g, '') // caso contrário, pontos são milhar
    }
  }
  return parseFloat(s)
}

/** Linha "crua" de importação, antes de casar empresa/funcionário. */
export type LinhaBrutaImport = {
  nome: string
  ident: string          // CNPJ/apelido/unidade informado (pode vir vazio)
  valor: number
  pix?: string
  ref?: string           // rótulo de origem (aba, página, etc.) usado nas mensagens de erro
}

/**
 * Casa linhas cruas contra o cadastro: resolve a empresa (por CNPJ ou apelido,
 * ou o `defaultEmpresaId` quando a linha não traz identificador) e o funcionário
 * pelo nome dentro da empresa. É o núcleo compartilhado pelas importações de
 * planilha (.xlsx) e de folha em PDF, garantindo o MESMO critério de casamento.
 */
export async function casarLinhasImport(
  brutas: LinhaBrutaImport[],
  defaultEmpresaId?: string
): Promise<{ linhas: LinhaImportSalario[]; erros: string[] }> {
  const linhas: LinhaImportSalario[] = []
  const erros: string[] = []

  // Empresas indexadas por CNPJ, por apelido e por id
  const { data: empresas } = await supabase.from('empresas').select('id, razao_social, cnpj, apelido')
  const empByCnpj = new Map<string, { id: string; razao_social: string }>()
  const empByApelido = new Map<string, { id: string; razao_social: string }>()
  const empById = new Map<string, { id: string; razao_social: string }>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(empresas ?? []).forEach((e: any) => {
    const ref = { id: e.id, razao_social: e.razao_social }
    empById.set(e.id, ref)
    if (e.cnpj) empByCnpj.set(soDigitos(e.cnpj), ref)
    if (e.apelido) empByApelido.set(norm(e.apelido), ref)
  })
  const empresaPadrao = defaultEmpresaId ? empById.get(defaultEmpresaId) : undefined

  // Funcionários ATIVOS agrupados por empresa (não importa salário de demitidos)
  const { data: funcs } = await supabase
    .from('funcionarios')
    .select('id, nome, ativo, unidades(empresa_id)')
  const funcsPorEmp = new Map<string, { id: string; nomeNorm: string }[]>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(funcs ?? []).forEach((f: any) => {
    if (f.ativo === false) return
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

  for (const b of brutas) {
    const nome = (b.nome ?? '').trim()
    const ident = (b.ident ?? '').trim()
    const onde = b.ref ? ` (${b.ref})` : ''
    if (!nome) continue // linha em branco

    // Resolve empresa: identificador da linha, senão a empresa padrão
    let empresa = empresaPadrao
    if (ident) {
      empresa = empByCnpj.get(soDigitos(ident)) ?? empByApelido.get(norm(ident)) ?? empresa
    }
    if (!empresa) {
      erros.push(`${nome}${onde}: empresa não identificada (informe CNPJ/apelido válido ou selecione a empresa).`)
      continue
    }
    if (isNaN(b.valor) || b.valor <= 0) {
      erros.push(`${nome}${onde}: valor líquido inválido.`)
      continue
    }

    const resolvido = resolverFuncionario(empresa.id, nome)
    if (resolvido.ambiguo) {
      erros.push(`${nome}${onde}: mais de um funcionário corresponde na empresa ${empresa.razao_social}. Use o nome completo.`)
      continue
    }
    if (!resolvido.id) {
      erros.push(`${nome}${onde}: funcionário não encontrado na empresa ${empresa.razao_social}.`)
      continue
    }

    linhas.push({
      funcionarioNome: nome,
      identificadorEmpresa: ident || empresa.razao_social,
      empresaId: empresa.id,
      empresaNome: empresa.razao_social,
      funcionarioId: resolvido.id,
      valorLiquido: b.valor,
      pix: b.pix || undefined,
    })
  }

  return { linhas, erros }
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
  const brutas: LinhaBrutaImport[] = []

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    const rowsRaw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
    const rows = rowsRaw.map((row) =>
      Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim(), v])))

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const nome = String(row['Nome'] ?? row['nome'] ?? row['Nome completo'] ?? row['Profissional'] ?? row['NOME'] ?? '').trim()
      const ident = String(
        row['Unidade'] ?? row['unidade'] ?? row['UNIDADE'] ??
        row['CNPJ'] ?? row['cnpj'] ?? row['Apelido'] ?? row['apelido'] ?? row['Empresa'] ?? row['empresa'] ?? ''
      ).trim()
      const valorRaw = row['Valor líquido'] ?? row['Valor liquido'] ?? row['Líquido'] ?? row['Liquido'] ??
        row['Valor'] ?? row['valor'] ?? row['VALOR'] ?? 0
      const pix = String(row['PIX'] ?? row['Pix'] ?? row['pix'] ?? row['Chave Pix'] ?? row['Chave PIX'] ?? '').trim()

      if (!nome) continue // linha em branco
      // A aba serve de identificador padrão quando a linha não traz empresa
      brutas.push({ nome, ident: ident || sheetName, valor: parseValorBR(valorRaw), pix, ref: `linha ${i + 2}, ${sheetName}` })
    }
  }

  return casarLinhasImport(brutas)
}

/**
 * Envia uma folha de pagamento em PDF para a rota /api/importar-folha-pdf,
 * onde uma IA extrai (nome + valor líquido) de cada profissional. Em seguida
 * casa com o cadastro pelo MESMO critério da planilha. `defaultEmpresaId` é
 * usado quando o PDF não deixa clara a empresa de cada linha.
 */
export async function importarFolhaPdf(
  arquivo: File,
  defaultEmpresaId?: string
): Promise<{ linhas: LinhaImportSalario[]; erros: string[] }> {
  const form = new FormData()
  form.append('arquivo', arquivo)

  let resp: Response
  try {
    resp = await fetch('/api/importar-folha-pdf', { method: 'POST', body: form })
  } catch {
    return { linhas: [], erros: ['Falha de rede ao contatar o serviço de leitura de PDF.'] }
  }

  const data = await resp.json().catch(() => null) as
    | { funcionarios?: { nome: string; valorLiquido: number; unidade?: string }[]; erro?: string }
    | null

  if (!resp.ok || !data) {
    return { linhas: [], erros: [data?.erro ?? `Não foi possível ler o PDF (HTTP ${resp.status}).`] }
  }
  const extraidos = data.funcionarios ?? []
  if (extraidos.length === 0) {
    return { linhas: [], erros: ['A IA não encontrou nenhum profissional com valor líquido no PDF.'] }
  }

  const brutas: LinhaBrutaImport[] = extraidos.map((f) => ({
    nome: f.nome,
    ident: (f.unidade ?? '').trim(),
    valor: Number(f.valorLiquido) || 0,
    ref: 'PDF',
  }))

  return casarLinhasImport(brutas, defaultEmpresaId)
}

/**
 * Gera e baixa o modelo (.xlsx) de salário líquido JÁ PREENCHIDO com os
 * funcionários ativos (Apelido da empresa + Nome), deixando só a coluna Valor
 * em branco para o usuário digitar. Se `empresaId` for informado, traz apenas
 * os funcionários daquela empresa.
 */
export async function baixarModeloPlanilhaSalarios(empresaId?: string): Promise<void> {
  const XLSX = await import('xlsx')

  const { data: funcs } = await supabase
    .from('funcionarios')
    .select('nome, ativo, unidades(empresa_id, empresas(apelido, razao_social, cnpj))')
    .order('nome')

  const corpo: (string | number)[][] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(funcs ?? []).forEach((f: any) => {
    if (f.ativo === false) return
    const uni = Array.isArray(f.unidades) ? f.unidades[0] : f.unidades
    const empId = uni?.empresa_id
    if (!empId) return
    if (empresaId && empId !== empresaId) return
    const emp = uni?.empresas ? (Array.isArray(uni.empresas) ? uni.empresas[0] : uni.empresas) : null
    // A importação casa a empresa por apelido ou CNPJ — preferimos o apelido.
    const ident = (emp?.apelido || emp?.cnpj || emp?.razao_social || '').toString()
    corpo.push([ident, f.nome, ''])
  })

  // Ordena por empresa e depois por nome, para facilitar a conferência
  corpo.sort((a, b) =>
    String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])))

  // Sem funcionários: cai no modelo de exemplo (apenas ilustrativo)
  const linhas = corpo.length > 0
    ? [['Apelido', 'Nome', 'Valor'], ...corpo]
    : [
        ['Apelido', 'Nome', 'Valor'],
        ['apelido-da-empresa', 'Nome do Profissional', 1500.00],
        ['apelido-da-empresa', 'Outro Profissional', 2300.50],
      ]

  const ws = XLSX.utils.aoa_to_sheet(linhas)
  ws['!cols'] = [{ wch: 22 }, { wch: 32 }, { wch: 14 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Salarios')

  // Nome do arquivo leva o apelido quando é uma empresa só (1ª coluna = apelido)
  const slug = (s: string) => s.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)
  const nomeArq = empresaId && corpo.length > 0
    ? `modelo_pagamentos_${slug(String(corpo[0][0]))}.xlsx`
    : 'modelo_pagamentos.xlsx'
  XLSX.writeFile(wb, nomeArq)
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
  let unicas = Array.from(byFunc.values())

  // Não importa para empresas com a competência FECHADA
  const [anoRef, mesRef] = mesReferencia.split('-').map(Number)
  const fechados = await listarFechamentos(mesRef, anoRef)
  const bloqueadas = unicas.filter((l) => fechados.get(l.empresaId) === true)
  if (bloqueadas.length > 0) {
    const nomes = Array.from(new Set(bloqueadas.map((l) => l.empresaNome)))
    erros.push(`${bloqueadas.length} salário(s) não importado(s): competência FECHADA em ${nomes.join(', ')}. Reabra o mês para importar.`)
    unicas = unicas.filter((l) => fechados.get(l.empresaId) !== true)
  }
  if (unicas.length === 0) return { gravados: 0, erros }

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

import { supabase, SalaoProfissional, SalaoProfissionalEmpresa, SalaoNFRegistro, SalaoNFConfirmacao, SalaoNFHistorico, SalaoConfigEmpresa, Empresa } from './supabase'

// ── Profissionais ────────────────────────────────────────────────────────────

export async function listarProfissionais(): Promise<SalaoProfissional[]> {
  const { data } = await supabase.from('salao_profissionais').select('*').order('nome')
  return data ?? []
}

export async function criarProfissional(p: Omit<SalaoProfissional, 'id' | 'criado_em'>): Promise<SalaoProfissional | null> {
  const { data } = await supabase.from('salao_profissionais').insert(p).select().single()
  return data
}

export async function atualizarProfissional(id: string, p: Partial<SalaoProfissional>): Promise<void> {
  await supabase.from('salao_profissionais').update(p).eq('id', id)
}

export async function listarProfissionalEmpresas(profissionalId: string): Promise<(SalaoProfissionalEmpresa & { empresas?: Empresa })[]> {
  const { data } = await supabase
    .from('salao_profissional_empresa')
    .select('*, empresas(id, razao_social, cnpj)')
    .eq('profissional_id', profissionalId)
  return data ?? []
}

export async function vincularProfissionalEmpresa(profissionalId: string, empresaId: string): Promise<void> {
  await supabase.from('salao_profissional_empresa').upsert(
    { profissional_id: profissionalId, empresa_id: empresaId, ativo: true },
    { onConflict: 'profissional_id,empresa_id' }
  )
}

// ── NF Registros ────────────────────────────────────────────────────────────

export type RegistroComDetalhes = SalaoNFRegistro & {
  profissionais?: SalaoProfissional
  empresas?: Empresa
  confirmacao?: SalaoNFConfirmacao | null
}

export async function listarRegistros(params: {
  empresaId?: string
  mesReferencia?: string
  status?: string
}): Promise<RegistroComDetalhes[]> {
  let q = supabase
    .from('salao_nf_registros')
    .select('*, profissionais:salao_profissionais(id, nome, cpf), empresas(id, razao_social)')
    .order('mes_referencia', { ascending: false })
    .order('criado_em', { ascending: false })

  if (params.empresaId) q = q.eq('empresa_id', params.empresaId)
  if (params.mesReferencia) q = q.eq('mes_referencia', params.mesReferencia)
  if (params.status) q = q.eq('status', params.status)

  const { data: registros } = await q
  if (!registros || registros.length === 0) return []

  // Load confirmations
  const ids = registros.map((r: SalaoNFRegistro) => r.id)
  const { data: confs } = await supabase
    .from('salao_nf_confirmacoes')
    .select('*')
    .in('registro_id', ids)

  const confMap = new Map<string, SalaoNFConfirmacao>()
  ;(confs ?? []).forEach((c: SalaoNFConfirmacao) => confMap.set(c.registro_id, c))

  return registros.map((r: SalaoNFRegistro) => ({
    ...r,
    confirmacao: confMap.get(r.id) ?? null,
  }))
}

export async function criarRegistro(r: Omit<SalaoNFRegistro, 'id' | 'criado_em' | 'atualizado_em'>): Promise<SalaoNFRegistro | null> {
  const { data } = await supabase.from('salao_nf_registros').insert(r).select().single()
  return data
}

export async function confirmarNF(params: {
  registroId: string
  numeroNF: string
  dataNF: string
  valorNF: number
  tolerancia: number
  valorComissao: number
  usuario?: string
}): Promise<{ ok: boolean; erro?: string }> {
  const { registroId, numeroNF, dataNF, valorNF, tolerancia, valorComissao, usuario } = params

  if (Math.abs(valorNF - valorComissao) > tolerancia) {
    return { ok: false, erro: `Valor da NF (${valorNF.toFixed(2)}) difere da comissão (${valorComissao.toFixed(2)}) além da tolerância (±${tolerancia.toFixed(2)}).` }
  }

  // Buscar registro atual para histórico
  const { data: reg } = await supabase.from('salao_nf_registros').select('*').eq('id', registroId).single()
  if (!reg) return { ok: false, erro: 'Registro não encontrado.' }

  // Upsert confirmação
  await supabase.from('salao_nf_confirmacoes').upsert({
    registro_id: registroId,
    numero_nf: numeroNF,
    data_nf: dataNF,
    valor_nf: valorNF,
    confirmado_por: usuario ?? null,
    confirmado_em: new Date().toISOString(),
  }, { onConflict: 'registro_id' })

  // Update status
  await supabase.from('salao_nf_registros').update({ status: 'nf_recebida', atualizado_em: new Date().toISOString() }).eq('id', registroId)

  // Log history
  await registrarHistorico({
    registroId,
    acao: 'NF Confirmada',
    descricao: `NF ${numeroNF} em ${dataNF}, valor R$ ${valorNF.toFixed(2)}`,
    dadosAnteriores: { status: reg.status },
    dadosNovos: { status: 'nf_recebida', numero_nf: numeroNF, valor_nf: valorNF },
    usuario,
  })

  return { ok: true }
}

export async function substituirNF(params: {
  registroId: string
  numeroNF: string
  dataNF: string
  valorNF: number
  motivo: string
  tolerancia: number
  valorComissao: number
  usuario?: string
}): Promise<{ ok: boolean; erro?: string }> {
  const { registroId, numeroNF, dataNF, valorNF, motivo, tolerancia, valorComissao, usuario } = params

  if (Math.abs(valorNF - valorComissao) > tolerancia) {
    return { ok: false, erro: `Valor da NF (${valorNF.toFixed(2)}) difere da comissão (${valorComissao.toFixed(2)}) além da tolerância (±${tolerancia.toFixed(2)}).` }
  }

  // Buscar confirmação atual para histórico
  const { data: confAtual } = await supabase.from('salao_nf_confirmacoes').select('*').eq('registro_id', registroId).single()

  // Update confirmação
  await supabase.from('salao_nf_confirmacoes').upsert({
    registro_id: registroId,
    numero_nf: numeroNF,
    data_nf: dataNF,
    valor_nf: valorNF,
    confirmado_por: usuario ?? null,
    confirmado_em: new Date().toISOString(),
  }, { onConflict: 'registro_id' })

  // Log history
  await registrarHistorico({
    registroId,
    acao: 'NF Substituída',
    descricao: motivo,
    dadosAnteriores: confAtual ? { numero_nf: confAtual.numero_nf, valor_nf: confAtual.valor_nf } : null,
    dadosNovos: { numero_nf: numeroNF, valor_nf: valorNF },
    usuario,
  })

  return { ok: true }
}

export async function marcarForaPrazo(registroId: string, usuario?: string): Promise<void> {
  const { data: reg } = await supabase.from('salao_nf_registros').select('*').eq('id', registroId).single()

  await supabase.from('salao_nf_registros').update({ status: 'fora_do_prazo', atualizado_em: new Date().toISOString() }).eq('id', registroId)

  await registrarHistorico({
    registroId,
    acao: 'Fora do Prazo',
    descricao: 'Status alterado automaticamente para Fora do Prazo',
    dadosAnteriores: { status: reg?.status },
    dadosNovos: { status: 'fora_do_prazo' },
    usuario,
  })
}

// Checks and transitions overdue records for a given month
export async function verificarPrazos(mesReferencia: string, usuario?: string): Promise<number> {
  const hoje = new Date()

  // Get configs and find overdue
  const { data: configs } = await supabase
    .from('salao_config_empresa')
    .select('*, empresas(id)')

  const { data: pendentes } = await supabase
    .from('salao_nf_registros')
    .select('id, empresa_id, mes_referencia, status')
    .eq('mes_referencia', mesReferencia)
    .eq('status', 'pendente')

  if (!pendentes || pendentes.length === 0) return 0

  const configMap = new Map<string, SalaoConfigEmpresa>()
  ;(configs ?? []).forEach((c: SalaoConfigEmpresa) => configMap.set(c.empresa_id, c))

  const [ano, mes] = mesReferencia.split('-').map(Number)
  let count = 0

  for (const reg of pendentes) {
    const config = configMap.get(reg.empresa_id)
    const diaPrazo = config?.dia_prazo ?? 10
    // Deadline = dia_prazo of NEXT month
    const prazo = new Date(mes === 12 ? ano + 1 : ano, mes === 12 ? 0 : mes, diaPrazo)
    if (hoje > prazo) {
      await marcarForaPrazo(reg.id, usuario)
      count++
    }
  }

  return count
}

// ── Histórico ────────────────────────────────────────────────────────────────

export async function buscarHistorico(registroId: string): Promise<SalaoNFHistorico[]> {
  const { data } = await supabase
    .from('salao_nf_historico')
    .select('*')
    .eq('registro_id', registroId)
    .order('criado_em', { ascending: false })
  return data ?? []
}

async function registrarHistorico(params: {
  registroId: string
  acao: string
  descricao?: string
  dadosAnteriores?: Record<string, unknown> | null
  dadosNovos?: Record<string, unknown> | null
  usuario?: string
}): Promise<void> {
  await supabase.from('salao_nf_historico').insert({
    registro_id: params.registroId,
    acao: params.acao,
    descricao: params.descricao ?? null,
    dados_anteriores: params.dadosAnteriores ?? null,
    dados_novos: params.dadosNovos ?? null,
    usuario: params.usuario ?? null,
    criado_em: new Date().toISOString(),
  })
}

// ── Config ────────────────────────────────────────────────────────────────────

export async function listarConfigs(): Promise<(SalaoConfigEmpresa & { empresas?: Empresa })[]> {
  const { data } = await supabase
    .from('salao_config_empresa')
    .select('*, empresas(id, razao_social)')
    .order('empresa_id')
  return data ?? []
}

export async function salvarConfig(config: Omit<SalaoConfigEmpresa, 'id'>): Promise<void> {
  await supabase.from('salao_config_empresa').upsert(config, { onConflict: 'empresa_id' })
}

// ── Excel Import ────────────────────────────────────────────────────────────

export type LinhaImportacao = {
  profissionalNome: string
  mesReferencia: string   // 'YYYY-MM' — vem do seletor na UI
  valorComissao: number
  empresaApelido: string  // nome da aba na planilha
  empresaId: string       // id resolvido da empresa
  empresaNome: string     // razao_social resolvida (para preview)
}

export async function importarExcel(arquivo: File, mesReferencia: string): Promise<{ linhas: LinhaImportacao[]; erros: string[] }> {
  const XLSX = await import('xlsx')
  const buffer = await arquivo.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array' })
  const linhas: LinhaImportacao[] = []
  const erros: string[] = []

  // Carregar empresas e indexar por apelido (case-insensitive)
  const { data: empresas } = await supabase.from('empresas').select('*')
  const apelidoMap = new Map<string, { id: string; razao_social: string }>()
  ;(empresas ?? []).forEach((e: any) => {
    if (e.apelido) apelidoMap.set(String(e.apelido).toLowerCase().trim(), { id: e.id, razao_social: e.razao_social })
  })

  for (const sheetName of wb.SheetNames) {
    const empresa = apelidoMap.get(sheetName.toLowerCase().trim())
    if (!empresa) {
      erros.push(`Aba "${sheetName}": nenhuma empresa com apelido "${sheetName}" encontrada. Cadastre o apelido na empresa.`)
      continue
    }

    const ws = wb.Sheets[sheetName]
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' })

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const nome = String(row['Nome'] ?? row['nome'] ?? '').trim()
      const valorRaw = row['Valor'] ?? row['valor'] ?? row['Valor comissão'] ?? row['valor_comissao'] ?? row['Valor comissao'] ?? 0
      const valor = typeof valorRaw === 'number' ? valorRaw : parseFloat(String(valorRaw).replace(',', '.'))

      if (!nome) { erros.push(`Aba "${sheetName}" linha ${i + 2}: Nome vazio`); continue }
      if (isNaN(valor) || valor <= 0) { erros.push(`Aba "${sheetName}" linha ${i + 2}: Valor inválido`); continue }

      linhas.push({
        profissionalNome: nome,
        mesReferencia,
        valorComissao: valor,
        empresaApelido: sheetName,
        empresaId: empresa.id,
        empresaNome: empresa.razao_social,
      })
    }
  }

  return { linhas, erros }
}

// ── Importação de Profissionais via Planilha ────────────────────────────────

export type LinhaProfissionalImportacao = {
  nome: string
  cnpj: string
}

export async function importarProfissionaisExcel(arquivo: File): Promise<{ linhas: LinhaProfissionalImportacao[]; erros: string[] }> {
  const XLSX = await import('xlsx')
  const buffer = await arquivo.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array' })
  const linhas: LinhaProfissionalImportacao[] = []
  const erros: string[] = []

  const sheetName = wb.SheetNames[0]
  if (!sheetName) {
    erros.push('Planilha vazia ou sem abas.')
    return { linhas, erros }
  }

  const ws = wb.Sheets[sheetName]
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' })

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const nome = String(row['Nome'] ?? row['nome'] ?? '').trim()
    const cnpj = String(row['CNPJ'] ?? row['cnpj'] ?? '').trim()

    if (!nome) { erros.push(`Linha ${i + 2}: Nome vazio`); continue }

    linhas.push({ nome, cnpj })
  }

  return { linhas, erros }
}

export async function processarImportacaoProfissionais(
  linhas: LinhaProfissionalImportacao[],
  empresaId?: string
): Promise<{ criados: number; atualizados: number; vinculados: number; erros: string[] }> {
  const erros: string[] = []
  let criados = 0
  let atualizados = 0
  let vinculados = 0

  const { data: existentes } = await supabase.from('salao_profissionais').select('*')
  const nomesMap = new Map<string, string>()
  const cnpjMap = new Map<string, string>()
  ;(existentes ?? []).forEach((p: any) => {
    nomesMap.set(p.nome.toLowerCase(), p.id)
    if (p.cnpj) cnpjMap.set((p.cnpj as string).replace(/\D/g, ''), p.id)
  })

  for (const linha of linhas) {
    const cnpjLimpo = linha.cnpj.replace(/\D/g, '')
    const existenteId = cnpjLimpo ? cnpjMap.get(cnpjLimpo) : nomesMap.get(linha.nome.toLowerCase())

    let profId = existenteId

    if (existenteId) {
      await supabase.from('salao_profissionais').update({ nome: linha.nome, cnpj: linha.cnpj || null }).eq('id', existenteId)
      atualizados++
    } else {
      const { data: novo, error } = await supabase
        .from('salao_profissionais')
        .insert({ nome: linha.nome, cnpj: linha.cnpj || null, ativo: true })
        .select('id')
        .single()
      if (error || !novo) { erros.push(`Erro ao criar "${linha.nome}": ${error?.message}`); continue }
      profId = novo.id
      nomesMap.set(linha.nome.toLowerCase(), profId)
      if (cnpjLimpo) cnpjMap.set(cnpjLimpo, profId)
      criados++
    }

    if (empresaId && profId) {
      await vincularProfissionalEmpresa(profId, empresaId)
      vinculados++
    }
  }

  return { criados, atualizados, vinculados, erros }
}

export async function processarImportacao(linhas: LinhaImportacao[]): Promise<{ criados: number; erros: string[] }> {
  const erros: string[] = []
  let criados = 0

  // Cache professionals by name
  const { data: profs } = await supabase.from('salao_profissionais').select('id, nome')
  const profMap = new Map<string, string>()
  ;(profs ?? []).forEach((p: any) => profMap.set(p.nome.toLowerCase(), p.id))

  for (const linha of linhas) {
    // Find or create profissional
    let profId = profMap.get(linha.profissionalNome.toLowerCase())
    if (!profId) {
      const { data: novoPro } = await supabase.from('salao_profissionais')
        .insert({ nome: linha.profissionalNome, ativo: true })
        .select('id').single()
      if (!novoPro) { erros.push(`Erro ao criar profissional "${linha.profissionalNome}"`); continue }
      profId = novoPro.id
      profMap.set(linha.profissionalNome.toLowerCase(), profId!)
    }

    // Vincular profissional à empresa
    await vincularProfissionalEmpresa(profId!, linha.empresaId)

    // Check if record already exists
    const { data: existente } = await supabase
      .from('salao_nf_registros')
      .select('id')
      .eq('profissional_id', profId)
      .eq('empresa_id', linha.empresaId)
      .eq('mes_referencia', linha.mesReferencia)
      .maybeSingle()

    if (existente) {
      erros.push(`Registro já existe para "${linha.profissionalNome}" em ${linha.mesReferencia} (${linha.empresaNome})`)
      continue
    }

    await criarRegistro({
      profissional_id: profId!,
      empresa_id: linha.empresaId,
      mes_referencia: linha.mesReferencia,
      valor_comissao: linha.valorComissao,
      status: 'pendente',
    })
    criados++
  }

  return { criados, erros }
}

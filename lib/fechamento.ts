import {
  supabase, Empresa, Funcionario, Competencia, CompetenciaFuncionario,
  getOrCreateDefaultUnidade, garantirFeriadosAno,
} from './supabase'
import {
  calcularVTVA, calcularDiasUteisAuto, trabalhaNoMes, resolverValorVA, calcularSabadosTrabalhados,
} from '../utils/calculoVT'
import { listarVales, descontoDoVale, statusParcelasVale } from './pagamentos'
import type { DadosRecibo, DescontoRecibo } from '../services/gerarReciboPDF'
import type { DadosReciboConsolidado } from '../services/gerarReciboValePDF'

/**
 * Valores de fallback: quando o cadastro estiver zerado, usa os valores da
 * última competência apurada (VT/VT-sábado por funcionário, VA por unidade).
 * Assim os meses futuros calculam mesmo sem os valores estarem no cadastro.
 */
type FallbackVTVA = {
  vt: Map<string, { valor_vt: number; valor_vt_sabado: number }>
  vaUnidade: Map<string, number>
}
async function carregarFallbackVTVA(): Promise<FallbackVTVA> {
  const [{ data: cfRows }, { data: compRows }] = await Promise.all([
    supabase.from('competencia_funcionario').select('funcionario_id, valor_vt, valor_vt_sabado, competencias(mes, ano)'),
    supabase.from('competencias').select('unidade_id, valor_va, mes, ano'),
  ])
  const vt = new Map<string, { valor_vt: number; valor_vt_sabado: number }>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfSorted = (cfRows ?? []).map((r: any) => {
    const c = Array.isArray(r.competencias) ? r.competencias[0] : r.competencias
    return { fid: r.funcionario_id, vtv: r.valor_vt ?? 0, vts: r.valor_vt_sabado ?? 0, key: c ? c.ano * 100 + c.mes : 0 }
  }).sort((a, b) => b.key - a.key)
  for (const r of cfSorted) {
    if (r.fid && !vt.has(r.fid) && (r.vtv > 0 || r.vts > 0)) vt.set(r.fid, { valor_vt: r.vtv, valor_vt_sabado: r.vts })
  }
  const vaUnidade = new Map<string, number>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const compSorted = (compRows ?? []).map((c: any) => ({ uid: c.unidade_id, va: c.valor_va ?? 0, key: c.ano * 100 + c.mes })).sort((a, b) => b.key - a.key)
  for (const c of compSorted) { if (c.uid && !vaUnidade.has(c.uid) && c.va > 0) vaUnidade.set(c.uid, c.va) }
  return { vt, vaUnidade }
}

export type LinhaFechamento = {
  registroId: string | null    // id do pagamento_registros (salário) — para editar/excluir
  funcionario_id: string
  nome: string
  funcao: string
  empresa_id: string
  empresaNome: string
  empresaApelido: string
  empresaCnpj: string
  pix: string | null
  liquido: number
  vtvaTotal: number
  descontoVales: number
  totalPagar: number
  vtvaApurado: boolean          // VT/VA do mês seguinte já apurado (tem competência_funcionario)
  reciboVTVA: DadosRecibo | null
  reciboVales: DadosReciboConsolidado | null
}

/**
 * Consolida o fechamento de uma competência (mês/ano) por profissional:
 * salário líquido (importado) + benefícios VT/VA (competências) − vales do mês.
 * Retorna, pronto para gerar, o recibo de VT/VA e o recibo de descontos de vales.
 */
export async function consolidarFechamento(params: {
  mes: number
  ano: number
  empresaId?: string
}): Promise<LinhaFechamento[]> {
  const { mes, ano, empresaId } = params
  const mesRef = `${ano}-${String(mes).padStart(2, '0')}`

  // Lógica de pagamento: o pagamento da competência (ex.: Junho) usa o salário
  // e os vales de Junho, mas o VT/VA do MÊS SEGUINTE (Julho), pois o benefício
  // é adiantado para o mês que se inicia.
  const vtvaMes = mes === 12 ? 1 : mes + 1
  const vtvaAno = mes === 12 ? ano + 1 : ano

  await garantirFeriadosAno(vtvaAno)
  const vMesStr = String(vtvaMes).padStart(2, '0')
  const vUltimoDia = new Date(vtvaAno, vtvaMes, 0).getDate()
  const [{ data: feriadosRows }, { data: empresasData }, { data: funcsData }, fallback] = await Promise.all([
    // feriados do mês do VT/VA (mês seguinte)
    supabase.from('feriados').select('data')
      .gte('data', `${vtvaAno}-${vMesStr}-01`).lte('data', `${vtvaAno}-${vMesStr}-${String(vUltimoDia).padStart(2, '0')}`),
    supabase.from('empresas').select('*'),
    supabase.from('funcionarios').select('*, unidades(empresa_id)'),
    carregarFallbackVTVA(),
  ])
  const feriadosDatas: string[] = (feriadosRows ?? []).map(f => f.data as string)

  const empMap = new Map<string, Empresa>()
  ;(empresasData ?? []).forEach((e: Empresa) => empMap.set(e.id, e))

  // Funcionário -> dados + empresa
  type FuncFull = Funcionario & { empresa_id: string }
  const funcMap = new Map<string, FuncFull>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(funcsData ?? []).forEach((f: any) => {
    const uni = Array.isArray(f.unidades) ? f.unidades[0] : f.unidades
    const empId = uni?.empresa_id
    if (!empId) return
    if (empresaId && empId !== empresaId) return
    funcMap.set(f.id, { ...f, empresa_id: empId })
  })

  // Competências do mês (por unidade) — usadas só para descontos (férias) e o
  // VA do mês. O VT/VA é calculado do CADASTRO (não depende de "apuração").
  const empresasParaBuscar = empresaId ? [empresaId] : Array.from(empMap.keys())
  const cfMap = new Map<string, CompetenciaFuncionario>()        // funcionario_id -> cf (se houver descontos)
  const vaMap = new Map<string, number>()                        // empresa_id -> valor_va do mês
  const descMap = new Map<string, DescontoRecibo[]>()            // cf_id -> descontos
  const acrescMap = new Map<string, DescontoRecibo[]>()          // cf_id -> acréscimos
  const carryMap = new Map<string, number>()                     // funcionario_id -> dias que transbordaram do mês anterior

  await Promise.all(empresasParaBuscar.map(async (empId) => {
    const unidadeId = await getOrCreateDefaultUnidade(empId)
    // VA: empresa (cadastro) → senão última competência da unidade
    vaMap.set(empId, (empMap.get(empId)?.valor_va || 0) || (unidadeId ? (fallback.vaUnidade.get(unidadeId) ?? 0) : 0))
    if (!unidadeId) return
    const { data: comp } = await supabase.from('competencias').select('*')
      .eq('unidade_id', unidadeId).eq('mes', vtvaMes).eq('ano', vtvaAno).limit(1).maybeSingle()
    if (!comp) return
    vaMap.set(empId, ((comp as Competencia).valor_va || 0) || (empMap.get(empId)?.valor_va || 0) || (fallback.vaUnidade.get(unidadeId) ?? 0))
    const { data: cfs } = await supabase.from('competencia_funcionario').select('*')
      .eq('competencia_id', (comp as Competencia).id)
    const cfIds: string[] = []
    ;(cfs ?? []).forEach((cf: CompetenciaFuncionario) => { cfMap.set(cf.funcionario_id, cf); cfIds.push(cf.id) })
    if (cfIds.length > 0) {
      const { data: descontosRows } = await supabase
        .from('competencia_funcionario_desconto').select('*, tipos_desconto(id, nome)')
        .in('competencia_funcionario_id', cfIds)
      for (const d of descontosRows ?? []) {
        const isAcrescimo = (d.dias ?? 0) < 0
        const item: DescontoRecibo = {
          tipo_nome: isAcrescimo ? 'Feriado trabalhado' : ((d.tipos_desconto as { nome: string } | null)?.nome ?? ''),
          dias: Math.abs(d.dias ?? 0),
          data_inicio: d.data_inicio ?? null,
          data_fim: d.data_fim ?? null,
        }
        const bucket = isAcrescimo ? acrescMap : descMap
        const arr = bucket.get(d.competencia_funcionario_id) ?? []
        arr.push(item)
        bucket.set(d.competencia_funcionario_id, arr)
      }
    }
    // Carry-over para vtvaMes: descontos do MÊS ANTERIOR a vtvaMes com
    // dias_proximo_mes > 0 abatem o VT/VA de vtvaMes.
    const cMes = vtvaMes === 1 ? 12 : vtvaMes - 1
    const cAno = vtvaMes === 1 ? vtvaAno - 1 : vtvaAno
    const { data: cComp } = await supabase.from('competencias').select('id')
      .eq('unidade_id', unidadeId).eq('mes', cMes).eq('ano', cAno).limit(1).maybeSingle()
    if (cComp) {
      const { data: cCfs } = await supabase.from('competencia_funcionario').select('id, funcionario_id')
        .eq('competencia_id', (cComp as { id: string }).id)
      const cByCf = new Map<string, string>(); const cCfIds: string[] = []
      ;(cCfs ?? []).forEach((c: { id: string; funcionario_id: string }) => { cByCf.set(c.id, c.funcionario_id); cCfIds.push(c.id) })
      if (cCfIds.length) {
        const { data: cDesc } = await supabase.from('competencia_funcionario_desconto')
          .select('competencia_funcionario_id, dias_proximo_mes').in('competencia_funcionario_id', cCfIds).gt('dias_proximo_mes', 0)
        for (const d of cDesc ?? []) {
          const fid = cByCf.get(d.competencia_funcionario_id); if (!fid) continue
          carryMap.set(fid, (carryMap.get(fid) ?? 0) + Number(d.dias_proximo_mes || 0))
        }
      }
    }
  }))

  // Salário líquido do mês
  let regQ = supabase.from('pagamento_registros').select('*').eq('mes_referencia', mesRef)
  if (empresaId) regQ = regQ.eq('empresa_id', empresaId)
  const { data: registros } = await regQ
  const liquidoMap = new Map<string, { id: string; valor: number }>()
  ;(registros ?? []).forEach((r: { id: string; funcionario_id: string; valor_liquido: number }) =>
    liquidoMap.set(r.funcionario_id, { id: r.id, valor: r.valor_liquido }))

  // Vales do mês
  const vales = await listarVales({ empresaId })
  const valesPorFunc = new Map<string, typeof vales>()
  for (const v of vales) {
    const arr = valesPorFunc.get(v.funcionario_id) ?? []
    arr.push(v); valesPorFunc.set(v.funcionario_id, arr)
  }

  // Universo: quem tem salário, vales OU VT/VA no mês. Como o VT/VA agora vem do
  // CADASTRO (não depende de "competência/apuração" lançada), todo funcionário
  // ATIVO que trabalha no mês do VT/VA entra no fechamento — assim toda empresa
  // com gente ativa aparece, mesmo sem salário importado ou competência.
  const idsSet = new Set<string>()
  Array.from(liquidoMap.keys()).forEach(k => idsSet.add(k))
  Array.from(cfMap.keys()).forEach(k => idsSet.add(k))
  Array.from(valesPorFunc.keys()).forEach(k => idsSet.add(k))
  for (const [fid, func] of funcMap) {
    if (func.ativo === false) continue
    if (trabalhaNoMes(vtvaMes, vtvaAno, func.data_admissao, func.data_fim_aviso)) idsSet.add(fid)
  }
  const ids = Array.from(idsSet)

  const linhas: LinhaFechamento[] = []
  for (const fid of ids) {
    const func = funcMap.get(fid)
    if (!func) continue
    if (func.ativo === false) continue  // não traz demitidos para o fechamento
    if (empresaId && func.empresa_id !== empresaId) continue
    const emp = empMap.get(func.empresa_id)
    const cf = cfMap.get(fid)  // presente só se há férias/descontos lançados

    // ── VT/VA (calculado do cadastro; férias/descontos salvos são aplicados) ──
    let vtvaTotal = 0
    let reciboVTVA: DadosRecibo | null = null
    if (trabalhaNoMes(vtvaMes, vtvaAno, func.data_admissao, func.data_fim_aviso)) {
      const fbVT = fallback.vt.get(func.id)
      const valorVTSabadoBase = cf?.valor_vt_sabado ?? (func.valor_vt_sabado || fbVT?.valor_vt_sabado || 0)
      const ehExcecao = valorVTSabadoBase > 0
      const valorVT = cf?.valor_vt ?? (func.valor_vt || fbVT?.valor_vt || 0)
      const valorVTSabado = ehExcecao ? valorVTSabadoBase : 0
      const descontosProprios = cf ? (descMap.get(cf.id) ?? []) : []
      const acrescimos = cf ? (acrescMap.get(cf.id) ?? []) : []
      const carry = carryMap.get(func.id) ?? 0
      const descontos = carry > 0
        ? [...descontosProprios, { tipo_nome: 'Férias/afastamento (do mês anterior)', dias: carry, data_inicio: null, data_fim: null }]
        : descontosProprios
      const diasSabado = ehExcecao ? calcularSabadosTrabalhados(vtvaMes, vtvaAno, func.data_admissao, func.data_fim_aviso, feriadosDatas, descontosProprios) : 0
      const valorVA = resolverValorVA(func.valor_va, vaMap.get(func.empresa_id) ?? emp?.valor_va ?? 0)
      const diasUteisAuto = calcularDiasUteisAuto(vtvaMes, vtvaAno, func.folga_semanal, feriadosDatas, func.data_admissao, func.data_fim_aviso)
      const diasProprios = descontosProprios.reduce((s, d) => s + (d.dias || 0), 0) - acrescimos.reduce((s, d) => s + (d.dias || 0), 0)
      const resultado = calcularVTVA({
        diasUteis: diasUteisAuto, diasFeriado: 0, diasSabado,
        diasDesconto: Math.max(0, diasProprios) + carry, valorVT, valorVTSabado, valorVA,
      })
      vtvaTotal = resultado.valorTotal
      reciboVTVA = {
        apelido: emp?.apelido ?? '', razaoSocial: emp?.razao_social ?? '', cnpj: emp?.cnpj ?? '',
        nomeFuncionario: func.nome, funcao: func.funcao, ctps: func.ctps ?? '', serie: func.serie ?? '',
        mes: vtvaMes, ano: vtvaAno, diasUteis: diasUteisAuto, diasEfetivos: resultado.diasEfetivos, diasSabado,
        valorVT, valorVTSabado, valorVA, resultado,
        dataAdmissao: func.data_admissao ?? null, dataFimAviso: func.data_fim_aviso ?? null,
        descontos, acrescimos,
      }
    }

    // ── Vales do mês ──
    let descontoVales = 0
    const valesItens: DadosReciboConsolidado['vales'] = []
    for (const v of valesPorFunc.get(fid) ?? []) {
      const d = descontoDoVale(v, mesRef)
      if (!d) continue
      const parcelas = Math.max(1, v.parcelas ?? 1)
      const idx = d.parcelaAtual
      const valorRestante = Math.round((parcelas - idx) * d.valorParcela * 100) / 100
      descontoVales += d.valorParcela
      valesItens.push({
        descricao: v.descricao,
        data: v.data,
        valorTotal: v.valor_total,
        parcelaAtual: d.parcelaAtual,
        totalParcelas: d.totalParcelas,
        valorParcela: d.valorParcela,
        valorRestante,
      })
    }
    descontoVales = Math.round(descontoVales * 100) / 100

    let reciboVales: DadosReciboConsolidado | null = null
    if (valesItens.length > 0) {
      // saldo devedor total após a competência (vales já quitados contam 0)
      let saldo = 0
      for (const v of valesPorFunc.get(fid) ?? []) {
        saldo += statusParcelasVale(v, mesRef).valorRestante
      }
      saldo = Math.round(saldo * 100) / 100
      reciboVales = {
        empresaApelido: emp?.apelido ?? '', empresaNome: emp?.razao_social ?? '', empresaCnpj: emp?.cnpj ?? '',
        funcionarioNome: func.nome, funcao: func.funcao, refCompetencia: mesRef,
        vales: valesItens, totalDescontadoNoMes: descontoVales,
        saldoDevedor: Math.round(saldo * 100) / 100,
      }
    }

    const reg = liquidoMap.get(fid)
    const liquido = reg?.valor ?? 0
    linhas.push({
      registroId: reg?.id ?? null,
      funcionario_id: fid, nome: func.nome, funcao: func.funcao,
      empresa_id: func.empresa_id, empresaNome: emp?.razao_social ?? '—', empresaApelido: emp?.apelido ?? '', empresaCnpj: emp?.cnpj ?? '',
      pix: func.pix ?? null,
      liquido, vtvaTotal, descontoVales,
      totalPagar: Math.round((liquido + vtvaTotal - descontoVales) * 100) / 100,
      vtvaApurado: reciboVTVA !== null,
      reciboVTVA, reciboVales,
    })
  }

  return linhas.sort((a, b) =>
    a.empresaNome.localeCompare(b.empresaNome) || a.nome.localeCompare(b.nome))
}

/**
 * CSV do banco no layout do modelo:
 *   Nome completo (opcional);Documento (opcional);Chave pix;Valor
 * A coluna Documento é mantida (vazia) — obrigatória no arquivo do banco.
 */
export function montarCSVFechamento(linhas: LinhaFechamento[]): { csv: string; semPix: number } {
  const header = 'Nome completo (opcional);Documento (opcional);Chave pix;Valor'
  const rows: string[] = []
  let semPix = 0
  for (const l of linhas) {
    if (!l.pix) semPix++
    const nome = (l.nome ?? '').replace(/[;\r\n]/g, ' ').trim()
    const valor = l.totalPagar.toFixed(2).replace('.', ',')
    rows.push(`${nome};;${l.pix ?? ''};${valor}`)
  }
  return { csv: [header, ...rows].join('\r\n'), semPix }
}

/**
 * Gera os dados de um recibo de VT/VA "avulso" para um funcionário — usando os
 * valores do cadastro (proporcional à admissão/aviso), sem depender de apuração
 * salva nem do fechamento. Serve para gerar o recibo de um funcionário
 * contratado após o fechamento do mês.
 */
export async function montarReciboVTVAAvulso(
  funcionarioId: string, mes: number, ano: number
): Promise<DadosRecibo | null> {
  const { data: func } = await supabase
    .from('funcionarios')
    .select('*, unidades(empresa_id, empresas(apelido, razao_social, cnpj, valor_va))')
    .eq('id', funcionarioId).limit(1).maybeSingle()
  if (!func) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f = func as any
  // Não gera recibo para um mês em que o funcionário não trabalha (antes da
  // admissão ou depois do fim do aviso prévio).
  if (!trabalhaNoMes(mes, ano, f.data_admissao, f.data_fim_aviso)) return null
  const uni = Array.isArray(f.unidades) ? f.unidades[0] : f.unidades
  const emp = uni?.empresas ? (Array.isArray(uni.empresas) ? uni.empresas[0] : uni.empresas) : null
  const empId = uni?.empresa_id

  await garantirFeriadosAno(ano)
  const mesStr = String(mes).padStart(2, '0')
  const ultimoDia = new Date(ano, mes, 0).getDate()
  const { data: feriadosRows } = await supabase.from('feriados').select('data')
    .gte('data', `${ano}-${mesStr}-01`).lte('data', `${ano}-${mesStr}-${String(ultimoDia).padStart(2, '0')}`)
  const feriadosDatas: string[] = (feriadosRows ?? []).map((r: { data: string }) => r.data)

  const fallback = await carregarFallbackVTVA()
  const fbVT = fallback.vt.get(funcionarioId)

  // VA: empresa (cadastro) → competência do mês → última competência da unidade
  let compVA = emp?.valor_va || 0
  if (empId) {
    const unidadeId = await getOrCreateDefaultUnidade(empId)
    if (unidadeId) {
      if (!compVA) compVA = fallback.vaUnidade.get(unidadeId) ?? 0
      const { data: comp } = await supabase.from('competencias').select('valor_va')
        .eq('unidade_id', unidadeId).eq('mes', mes).eq('ano', ano).limit(1).maybeSingle()
      if (comp && ((comp as { valor_va: number }).valor_va || 0) > 0) compVA = (comp as { valor_va: number }).valor_va
    }
  }

  const valorVTSabadoBase = f.valor_vt_sabado || fbVT?.valor_vt_sabado || 0
  const ehExcecao = valorVTSabadoBase > 0
  const valorVT = f.valor_vt || fbVT?.valor_vt || 0
  const valorVTSabado = ehExcecao ? valorVTSabadoBase : 0
  const valorVA = resolverValorVA(f.valor_va, compVA)
  const diasUteis = calcularDiasUteisAuto(mes, ano, f.folga_semanal, feriadosDatas, f.data_admissao, f.data_fim_aviso)
  const diasSabado = ehExcecao ? calcularSabadosTrabalhados(mes, ano, f.data_admissao, f.data_fim_aviso, feriadosDatas, []) : 0
  const resultado = calcularVTVA({ diasUteis, diasFeriado: 0, diasSabado, diasDesconto: 0, valorVT, valorVTSabado, valorVA })

  return {
    apelido: emp?.apelido ?? '', razaoSocial: emp?.razao_social ?? '', cnpj: emp?.cnpj ?? '',
    nomeFuncionario: f.nome, funcao: f.funcao, ctps: f.ctps ?? '', serie: f.serie ?? '',
    mes, ano, diasUteis, diasEfetivos: resultado.diasEfetivos, diasSabado,
    valorVT, valorVTSabado, valorVA, resultado,
    dataAdmissao: f.data_admissao ?? null, dataFimAviso: f.data_fim_aviso ?? null,
    descontos: [], acrescimos: [],
  }
}

// ── Recibos de VT/VA de um mês (cálculo automático, sem depender de apuração) ──

export type LinhaReciboVTVA = {
  funcionario_id: string
  empresa_id: string
  empresaNome: string
  nome: string
  funcao: string
  valorVA: number         // valor por dia
  valorVT: number         // valor por dia
  valorVTSabado: number   // valor por sábado
  diasEfetivos: number
  totalVA: number
  totalVT: number
  totalVTSabado: number
  valorTotal: number
  dados: DadosRecibo
}

/**
 * Lista os recibos de VT/VA de um mês para TODOS os funcionários ativos que
 * trabalham no mês, calculando do cadastro e aplicando as férias/descontos
 * lançados quando existirem. Não depende de "apuração/inicializar".
 */
export async function listarRecibosVTVA(params: {
  mes: number; ano: number; empresaId?: string
}): Promise<LinhaReciboVTVA[]> {
  const { mes, ano, empresaId } = params
  await garantirFeriadosAno(ano)
  const mesStr = String(mes).padStart(2, '0')
  const ultimoDia = new Date(ano, mes, 0).getDate()
  const [{ data: feriadosRows }, { data: empresasData }, { data: funcsData }, fallback] = await Promise.all([
    supabase.from('feriados').select('data')
      .gte('data', `${ano}-${mesStr}-01`).lte('data', `${ano}-${mesStr}-${String(ultimoDia).padStart(2, '0')}`),
    supabase.from('empresas').select('*'),
    supabase.from('funcionarios').select('*, unidades(empresa_id)'),
    carregarFallbackVTVA(),
  ])
  const feriadosDatas: string[] = (feriadosRows ?? []).map((f: { data: string }) => f.data)
  const empMap = new Map<string, Empresa>()
  ;(empresasData ?? []).forEach((e: Empresa) => empMap.set(e.id, e))

  type FuncFull = Funcionario & { empresa_id: string }
  const funcs: FuncFull[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(funcsData ?? []).forEach((f: any) => {
    if (f.ativo === false) return
    const uni = Array.isArray(f.unidades) ? f.unidades[0] : f.unidades
    const empId = uni?.empresa_id
    if (!empId) return
    if (empresaId && empId !== empresaId) return
    funcs.push({ ...f, empresa_id: empId })
  })

  const empresasParaBuscar = empresaId ? [empresaId] : Array.from(empMap.keys())
  const cfMap = new Map<string, CompetenciaFuncionario>()
  const vaMap = new Map<string, number>()
  const descMap = new Map<string, DescontoRecibo[]>()
  const acrescMap = new Map<string, DescontoRecibo[]>()
  // Carry-over: dias que transbordaram do MÊS ANTERIOR para este mês
  // (férias/afastamento que caem neste mês). Devem abater o VT/VA daqui.
  const carryMap = new Map<string, number>()
  await Promise.all(empresasParaBuscar.map(async (empId) => {
    const unidadeId = await getOrCreateDefaultUnidade(empId)
    vaMap.set(empId, (empMap.get(empId)?.valor_va || 0) || (unidadeId ? (fallback.vaUnidade.get(unidadeId) ?? 0) : 0))
    if (!unidadeId) return
    const { data: comp } = await supabase.from('competencias').select('*')
      .eq('unidade_id', unidadeId).eq('mes', mes).eq('ano', ano).limit(1).maybeSingle()
    if (!comp) return
    vaMap.set(empId, ((comp as Competencia).valor_va || 0) || (empMap.get(empId)?.valor_va || 0) || (fallback.vaUnidade.get(unidadeId) ?? 0))
    const { data: cfs } = await supabase.from('competencia_funcionario').select('*')
      .eq('competencia_id', (comp as Competencia).id)
    const cfIds: string[] = []
    ;(cfs ?? []).forEach((cf: CompetenciaFuncionario) => { cfMap.set(cf.funcionario_id, cf); cfIds.push(cf.id) })
    if (cfIds.length > 0) {
      const { data: descontosRows } = await supabase
        .from('competencia_funcionario_desconto').select('*, tipos_desconto(id, nome)')
        .in('competencia_funcionario_id', cfIds)
      for (const d of descontosRows ?? []) {
        const isAcrescimo = (d.dias ?? 0) < 0
        const item: DescontoRecibo = {
          tipo_nome: isAcrescimo ? 'Feriado trabalhado' : ((d.tipos_desconto as { nome: string } | null)?.nome ?? ''),
          dias: Math.abs(d.dias ?? 0), data_inicio: d.data_inicio ?? null, data_fim: d.data_fim ?? null,
        }
        const bucket = isAcrescimo ? acrescMap : descMap
        const arr = bucket.get(d.competencia_funcionario_id) ?? []; arr.push(item); bucket.set(d.competencia_funcionario_id, arr)
      }
    }
    // Carry-over do MÊS ANTERIOR: descontos com dias_proximo_mes > 0 abatem ESTE mês.
    const pMes = mes === 1 ? 12 : mes - 1
    const pAno = mes === 1 ? ano - 1 : ano
    const { data: pComp } = await supabase.from('competencias').select('id')
      .eq('unidade_id', unidadeId).eq('mes', pMes).eq('ano', pAno).limit(1).maybeSingle()
    if (pComp) {
      const { data: pCfs } = await supabase.from('competencia_funcionario').select('id, funcionario_id')
        .eq('competencia_id', (pComp as { id: string }).id)
      const pByCf = new Map<string, string>()
      const pCfIds: string[] = []
      ;(pCfs ?? []).forEach((c: { id: string; funcionario_id: string }) => { pByCf.set(c.id, c.funcionario_id); pCfIds.push(c.id) })
      if (pCfIds.length) {
        const { data: pDesc } = await supabase.from('competencia_funcionario_desconto')
          .select('competencia_funcionario_id, dias_proximo_mes, tipos_desconto(nome)')
          .in('competencia_funcionario_id', pCfIds).gt('dias_proximo_mes', 0)
        for (const d of pDesc ?? []) {
          const fid = pByCf.get(d.competencia_funcionario_id); if (!fid) continue
          const dp = Number(d.dias_proximo_mes || 0)
          carryMap.set(fid, (carryMap.get(fid) ?? 0) + dp)
        }
      }
    }
  }))

  const linhas: LinhaReciboVTVA[] = []
  for (const func of funcs) {
    if (!trabalhaNoMes(mes, ano, func.data_admissao, func.data_fim_aviso)) continue
    const emp = empMap.get(func.empresa_id)
    const cf = cfMap.get(func.id)
    const fbVT = fallback.vt.get(func.id)
    const valorVTSabadoBase = cf?.valor_vt_sabado ?? (func.valor_vt_sabado || fbVT?.valor_vt_sabado || 0)
    const ehExcecao = valorVTSabadoBase > 0
    const valorVT = cf?.valor_vt ?? (func.valor_vt || fbVT?.valor_vt || 0)
    const valorVTSabado = ehExcecao ? valorVTSabadoBase : 0
    const descontosProprios = cf ? (descMap.get(cf.id) ?? []) : []
    const acrescimos = cf ? (acrescMap.get(cf.id) ?? []) : []
    const carry = carryMap.get(func.id) ?? 0
    // Exibição do recibo: inclui a linha do carry-over (mês anterior).
    const descontos = carry > 0
      ? [...descontosProprios, { tipo_nome: 'Férias/afastamento (do mês anterior)', dias: carry, data_inicio: null, data_fim: null }]
      : descontosProprios
    const diasSabado = ehExcecao ? calcularSabadosTrabalhados(mes, ano, func.data_admissao, func.data_fim_aviso, feriadosDatas, descontosProprios) : 0
    const valorVA = resolverValorVA(func.valor_va, vaMap.get(func.empresa_id) ?? emp?.valor_va ?? 0)
    const diasUteis = calcularDiasUteisAuto(mes, ano, func.folga_semanal, feriadosDatas, func.data_admissao, func.data_fim_aviso)
    // Dias de desconto calculados a partir das LINHAS (robusto, sem depender do
    // agregado cf.dias_desconto que pode estar defasado/duplicar o carry):
    //   próprios do mês (descontos − acréscimos) + carry-over do mês anterior.
    const diasProprios = descontosProprios.reduce((s, d) => s + (d.dias || 0), 0) - acrescimos.reduce((s, d) => s + (d.dias || 0), 0)
    const resultado = calcularVTVA({ diasUteis, diasFeriado: 0, diasSabado, diasDesconto: Math.max(0, diasProprios) + carry, valorVT, valorVTSabado, valorVA })
    const dados: DadosRecibo = {
      apelido: emp?.apelido ?? '', razaoSocial: emp?.razao_social ?? '', cnpj: emp?.cnpj ?? '',
      nomeFuncionario: func.nome, funcao: func.funcao, ctps: func.ctps ?? '', serie: func.serie ?? '',
      mes, ano, diasUteis, diasEfetivos: resultado.diasEfetivos, diasSabado,
      valorVT, valorVTSabado, valorVA, resultado,
      dataAdmissao: func.data_admissao ?? null, dataFimAviso: func.data_fim_aviso ?? null,
      descontos, acrescimos,
    }
    linhas.push({
      funcionario_id: func.id, empresa_id: func.empresa_id, empresaNome: emp?.razao_social ?? '—',
      nome: func.nome, funcao: func.funcao,
      valorVA, valorVT, valorVTSabado,
      diasEfetivos: resultado.diasEfetivos, totalVA: resultado.totalVA, totalVT: resultado.totalVT,
      totalVTSabado: resultado.totalVTSabado, valorTotal: resultado.valorTotal, dados,
    })
  }
  return linhas.sort((a, b) => a.empresaNome.localeCompare(b.empresaNome) || a.nome.localeCompare(b.nome))
}

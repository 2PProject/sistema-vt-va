import {
  supabase, Empresa, Funcionario, Competencia, CompetenciaFuncionario,
  getOrCreateDefaultUnidade, garantirFeriadosAno,
} from './supabase'
import {
  calcularVTVA, calcularDiasUteisAuto, trabalhaNoMes, resolverValorVA, contarSabadosEmDescontos,
} from '../utils/calculoVT'
import { listarVales, descontoDoVale } from './pagamentos'
import type { DadosRecibo, DescontoRecibo } from '../services/gerarReciboPDF'
import type { DadosReciboConsolidado } from '../services/gerarReciboValePDF'

export type LinhaFechamento = {
  funcionario_id: string
  nome: string
  funcao: string
  empresa_id: string
  empresaNome: string
  empresaCnpj: string
  pix: string | null
  liquido: number
  vtvaTotal: number
  descontoVales: number
  totalPagar: number
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

  await garantirFeriadosAno(ano)
  const mesStr = String(mes).padStart(2, '0')
  const ultimoDia = new Date(ano, mes, 0).getDate()
  const [{ data: feriadosRows }, { data: empresasData }, { data: funcsData }] = await Promise.all([
    supabase.from('feriados').select('data')
      .gte('data', `${ano}-${mesStr}-01`).lte('data', `${ano}-${mesStr}-${String(ultimoDia).padStart(2, '0')}`),
    supabase.from('empresas').select('*'),
    supabase.from('funcionarios').select('*, unidades(empresa_id)'),
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

  // Competências do mês (por unidade) + CF + descontos
  const empresasParaBuscar = empresaId ? [empresaId] : Array.from(empMap.keys())
  const cfMap = new Map<string, CompetenciaFuncionario>()        // funcionario_id -> cf
  const compMap = new Map<string, Competencia>()                 // competencia_id -> competencia
  const descMap = new Map<string, DescontoRecibo[]>()            // cf_id -> descontos
  const acrescMap = new Map<string, DescontoRecibo[]>()          // cf_id -> acréscimos

  await Promise.all(empresasParaBuscar.map(async (empId) => {
    const unidadeId = await getOrCreateDefaultUnidade(empId)
    if (!unidadeId) return
    const { data: comp } = await supabase.from('competencias').select('*')
      .eq('unidade_id', unidadeId).eq('mes', mes).eq('ano', ano).maybeSingle()
    if (!comp) return
    compMap.set((comp as Competencia).id, comp as Competencia)
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
  }))

  // Salário líquido do mês
  let regQ = supabase.from('pagamento_registros').select('*').eq('mes_referencia', mesRef)
  if (empresaId) regQ = regQ.eq('empresa_id', empresaId)
  const { data: registros } = await regQ
  const liquidoMap = new Map<string, number>()
  ;(registros ?? []).forEach((r: { funcionario_id: string; valor_liquido: number }) =>
    liquidoMap.set(r.funcionario_id, r.valor_liquido))

  // Vales do mês
  const vales = await listarVales({ empresaId })
  const valesPorFunc = new Map<string, typeof vales>()
  for (const v of vales) {
    const arr = valesPorFunc.get(v.funcionario_id) ?? []
    arr.push(v); valesPorFunc.set(v.funcionario_id, arr)
  }

  // Universo: quem tem líquido OU competência (VT/VA) no mês
  const idsSet = new Set<string>()
  Array.from(liquidoMap.keys()).forEach(k => idsSet.add(k))
  Array.from(cfMap.keys()).forEach(k => idsSet.add(k))
  const ids = Array.from(idsSet)

  const linhas: LinhaFechamento[] = []
  for (const fid of ids) {
    const func = funcMap.get(fid)
    if (!func) continue
    if (empresaId && func.empresa_id !== empresaId) continue
    const emp = empMap.get(func.empresa_id)
    const cf = cfMap.get(fid)
    const comp = cf ? compMap.get(cf.competencia_id) : undefined

    // ── VT/VA ──
    let vtvaTotal = 0
    let reciboVTVA: DadosRecibo | null = null
    if (cf && comp && trabalhaNoMes(mes, ano, func.data_admissao, func.data_fim_aviso)) {
      const valorVTSabadoBase = cf.valor_vt_sabado ?? func.valor_vt_sabado ?? 0
      const ehExcecao = valorVTSabadoBase > 0
      const valorVT = cf.valor_vt ?? func.valor_vt ?? 0
      const valorVTSabado = ehExcecao ? valorVTSabadoBase : 0
      const descontos = descMap.get(cf.id) ?? []
      const acrescimos = acrescMap.get(cf.id) ?? []
      const diasSabadoBase = ehExcecao ? (cf.dias_sabado ?? 0) : 0
      const diasSabado = Math.max(0, diasSabadoBase - contarSabadosEmDescontos(descontos, mes, ano))
      const valorVA = resolverValorVA(func.valor_va, comp.valor_va)
      const diasUteisAuto = calcularDiasUteisAuto(mes, ano, func.folga_semanal, feriadosDatas, func.data_admissao, func.data_fim_aviso)
      const resultado = calcularVTVA({
        diasUteis: diasUteisAuto, diasFeriado: 0, diasSabado,
        diasDesconto: cf.dias_desconto ?? 0, valorVT, valorVTSabado, valorVA,
      })
      vtvaTotal = resultado.valorTotal
      reciboVTVA = {
        razaoSocial: emp?.razao_social ?? '', cnpj: emp?.cnpj ?? '',
        nomeFuncionario: func.nome, funcao: func.funcao, ctps: func.ctps ?? '', serie: func.serie ?? '',
        mes, ano, diasUteis: diasUteisAuto, diasEfetivos: resultado.diasEfetivos, diasSabado,
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
        parcelaAtual: d.parcelaAtual,
        totalParcelas: d.totalParcelas,
        valorParcela: d.valorParcela,
        valorRestante,
      })
    }
    descontoVales = Math.round(descontoVales * 100) / 100

    let reciboVales: DadosReciboConsolidado | null = null
    if (valesItens.length > 0) {
      // saldo devedor total (todos os vales) para exibir no recibo
      let saldo = 0
      for (const v of valesPorFunc.get(fid) ?? []) {
        const parcelas = Math.max(1, v.parcelas ?? 1)
        const dd = descontoDoVale(v, mesRef)
        const jaIdx = dd ? dd.parcelaAtual : 0
        // usa status simples: parcelas restantes após a competência
        const restantes = Math.max(0, parcelas - jaIdx)
        saldo += Math.round(restantes * (v.valor_total / parcelas) * 100) / 100
      }
      reciboVales = {
        empresaNome: emp?.razao_social ?? '', empresaCnpj: emp?.cnpj ?? '',
        funcionarioNome: func.nome, funcao: func.funcao, refCompetencia: mesRef,
        vales: valesItens, totalDescontadoNoMes: descontoVales,
        saldoDevedor: Math.round(saldo * 100) / 100,
      }
    }

    const liquido = liquidoMap.get(fid) ?? 0
    linhas.push({
      funcionario_id: fid, nome: func.nome, funcao: func.funcao,
      empresa_id: func.empresa_id, empresaNome: emp?.razao_social ?? '—', empresaCnpj: emp?.cnpj ?? '',
      pix: func.pix ?? null,
      liquido, vtvaTotal, descontoVales,
      totalPagar: Math.round((liquido + vtvaTotal - descontoVales) * 100) / 100,
      reciboVTVA, reciboVales,
    })
  }

  return linhas.sort((a, b) =>
    a.empresaNome.localeCompare(b.empresaNome) || a.nome.localeCompare(b.nome))
}

/** CSV do banco a partir do fechamento (Nome; Chave PIX; Total a pagar). */
export function montarCSVFechamento(linhas: LinhaFechamento[]): { csv: string; semPix: number } {
  const header = 'Nome;Chave PIX;Valor'
  const rows: string[] = []
  let semPix = 0
  for (const l of linhas) {
    if (!l.pix) semPix++
    const nome = (l.nome ?? '').replace(/[;\r\n]/g, ' ').trim()
    rows.push(`${nome};${l.pix ?? ''};${l.totalPagar.toFixed(2).replace('.', ',')}`)
  }
  return { csv: [header, ...rows].join('\r\n'), semPix }
}

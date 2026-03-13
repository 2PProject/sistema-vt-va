'use client'

import { useEffect, useState, useCallback } from 'react'
import LayoutAdmin from '../../components/LayoutAdmin'
import {
  supabase,
  Competencia,
  CompetenciaFuncionario,
  CFDesconto,
  Funcionario,
  Empresa,
  TipoDesconto,
  getOrCreateDefaultUnidade,
} from '../../lib/supabase'
import {
  calcularVTVA,
  calcularDiasUteisAuto,
  calcularSabadosDoMes,
  formatarMoeda,
  MESES,
} from '../../utils/calculoVT'

// ─── Types ────────────────────────────────────────────────────────────────────

type DescontoLocal = {
  id: string
  tipo_id: string
  tipo_nome: string
  dias: number
  data_inicio: string   // 'YYYY-MM-DD'
  data_fim: string      // 'YYYY-MM-DD'
  dias_proximo_mes: number
  isCarryOver: boolean  // read-only carry-over from previous month
}

type CFLocal = {
  id: string
  competencia_id: string
  funcionario_id: string
  dias_sabado: number
  descontos: DescontoLocal[]
  valor_vt: number
  valor_vt_sabado: number
  funcionario: Funcionario
  empresaNome: string    // used in modoTodas
  valorVAItem: number    // VA per-item (from competência)
}

const TODAS = '__todas__'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function contarDiasNoPeriodo(start: Date, end: Date): number {
  let count = 0
  const cur = new Date(start)
  while (cur <= end) {
    if (cur.getDay() !== 0) count++ // não conta domingo
    cur.setDate(cur.getDate() + 1)
  }
  return Math.max(0, count)
}

/** Retorna o último dia do mês como Date (com hora 12:00) */
function ultimoDiaDoMes(m: number, y: number): Date {
  const d = new Date(y, m, 0) // day 0 of month m+1 = last day of month m
  d.setHours(12, 0, 0, 0)
  return d
}

/**
 * Calcula dias (Mon–Sat) do intervalo inicio→fim que caem no mês corrente
 * e dias que transbordam para o próximo mês.
 */
function calcularDiasComCarryOver(
  inicio: string,
  fim: string,
  mes: number,
  ano: number
): { diasCorrente: number; diasProximo: number } {
  if (!inicio) return { diasCorrente: 1, diasProximo: 0 }
  const start = new Date(inicio + 'T12:00:00')
  const end = new Date((fim || inicio) + 'T12:00:00')
  const lastDay = ultimoDiaDoMes(mes, ano)

  const endCorrente = end <= lastDay ? end : lastDay
  const diasCorrente = contarDiasNoPeriodo(start, endCorrente)

  let diasProximo = 0
  if (end > lastDay) {
    const nextStart = new Date(lastDay)
    nextStart.setDate(nextStart.getDate() + 1)
    diasProximo = contarDiasNoPeriodo(nextStart, end)
  }
  return { diasCorrente, diasProximo }
}

// ─── Componente ──────────────────────────────────────────────────────────────

export default function CompetenciasPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [tiposDesconto, setTiposDesconto] = useState<TipoDesconto[]>([])
  const [competencia, setCompetencia] = useState<Competencia | null>(null)
  const [itens, setItens] = useState<CFLocal[]>([])
  const [feriadosDoMes, setFeriadosDoMes] = useState(0)
  const [loading, setLoading] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [sucesso, setSucesso] = useState(false)

  const [valorVA, setValorVA] = useState(0)
  const [empresaId, setEmpresaId] = useState<string>(TODAS)
  const [mes, setMes] = useState(new Date().getMonth() + 1)
  const [ano, setAno] = useState(new Date().getFullYear())
  const [criando, setCriando] = useState(false)

  const modoTodas = empresaId === TODAS

  // Modal de descontos
  const [modalIdx, setModalIdx] = useState<number | null>(null)
  const [novoTipoId, setNovoTipoId] = useState<string>('')
  const [novoDias, setNovoDias] = useState(1)
  const [novaDataInicio, setNovaDataInicio] = useState('')
  const [novaDataFim, setNovaDataFim] = useState('')
  const [novoDiasProximo, setNovoDiasProximo] = useState(0)

  useEffect(() => {
    supabase.from('empresas').select('*').order('razao_social').then(({ data }) => setEmpresas(data ?? []))
    supabase.from('tipos_desconto').select('*').order('nome').then(({ data }) => setTiposDesconto(data ?? []))
  }, [])

  // ─── Carregar ───────────────────────────────────────────────────────────────

  const carregarCompetencia = useCallback(async () => {
    if (!empresaId) return
    setLoading(true)
    setSucesso(false)

    const mesStr = String(mes).padStart(2, '0')
    const { data: feriadosRows } = await supabase
      .from('feriados').select('data')
      .gte('data', `${ano}-${mesStr}-01`)
      .lte('data', `${ano}-${mesStr}-31`)
    const feriados = feriadosRows?.length ?? 0
    setFeriadosDoMes(feriados)

    // ── MODO TODAS: batch loading ─────────────────────────────────────────────
    if (modoTodas) {
      const sabadosDoMes = calcularSabadosDoMes(mes, ano)

      // 1. Todas as unidades das empresas
      const { data: allUnidades } = await supabase
        .from('unidades').select('id, empresa_id')
        .in('empresa_id', empresas.map(e => e.id))
      const unidadeIds = (allUnidades ?? []).map(u => u.id)
      const empresaByUnidade = new Map((allUnidades ?? []).map(u => [u.id, u.empresa_id]))

      if (unidadeIds.length === 0) { setItens([]); setLoading(false); return }

      // 2. Todas as competências do mês
      const { data: allComps } = await supabase
        .from('competencias').select('*')
        .in('unidade_id', unidadeIds).eq('mes', mes).eq('ano', ano)
      const compIds = (allComps ?? []).map(c => c.id)
      const vaByComp = new Map((allComps ?? []).map(c => [c.id, (c as Competencia).valor_va ?? 0]))

      if (compIds.length === 0) { setItens([]); setLoading(false); return }

      // 3. Todos os CFs com funcionários
      const { data: allCFs } = await supabase
        .from('competencia_funcionario').select('*, funcionarios(*)')
        .in('competencia_id', compIds)
      const cfList = (allCFs ?? []) as Array<CompetenciaFuncionario & { funcionarios: Funcionario }>
      const cfIds = cfList.map(cf => cf.id)

      // 4. Todos os descontos
      const descontosMap = new Map<string, DescontoLocal[]>()
      if (cfIds.length > 0) {
        const { data: descontosRows } = await supabase
          .from('competencia_funcionario_desconto').select('*, tipos_desconto(id, nome)')
          .in('competencia_funcionario_id', cfIds)
        for (const d of descontosRows ?? []) {
          const arr = descontosMap.get(d.competencia_funcionario_id) ?? []
          arr.push({
            id: d.id, tipo_id: d.tipo_desconto_id,
            tipo_nome: (d.tipos_desconto as TipoDesconto)?.nome ?? '',
            dias: d.dias, data_inicio: d.data_inicio ?? '', data_fim: d.data_fim ?? '',
            dias_proximo_mes: d.dias_proximo_mes ?? 0, isCarryOver: false,
          })
          descontosMap.set(d.competencia_funcionario_id, arr)
        }
      }

      // 5. Carry-over: descontos do mês anterior com dias_proximo_mes > 0
      const prevMes = mes === 1 ? 12 : mes - 1
      const prevAno = mes === 1 ? ano - 1 : ano
      const prevMesStr = String(prevMes).padStart(2, '0')
      const { data: prevComps } = await supabase
        .from('competencias').select('id, unidade_id')
        .in('unidade_id', unidadeIds).eq('mes', prevMes).eq('ano', prevAno)
      if (prevComps && prevComps.length > 0) {
        const prevCompIds = prevComps.map(c => c.id)
        const { data: prevCFs } = await supabase
          .from('competencia_funcionario').select('id, funcionario_id')
          .in('competencia_id', prevCompIds)
        if (prevCFs && prevCFs.length > 0) {
          const prevCFMap = new Map(prevCFs.map(cf => [cf.id, cf.funcionario_id]))
          const { data: carryRows } = await supabase
            .from('competencia_funcionario_desconto').select('*, tipos_desconto(id, nome)')
            .in('competencia_funcionario_id', prevCFs.map(cf => cf.id))
            .gt('dias_proximo_mes', 0)
          const carryByFunc = new Map<string, DescontoLocal[]>()
          for (const d of carryRows ?? []) {
            const funcId = prevCFMap.get(d.competencia_funcionario_id)
            if (!funcId) continue
            const arr = carryByFunc.get(funcId) ?? []
            arr.push({
              id: d.id + '_carry', tipo_id: d.tipo_desconto_id,
              tipo_nome: `↩ ${MESES[prevMes - 1]}: ${(d.tipos_desconto as TipoDesconto)?.nome ?? ''}`,
              dias: d.dias_proximo_mes, data_inicio: '', data_fim: '',
              dias_proximo_mes: 0, isCarryOver: true,
            })
            carryByFunc.set(funcId, arr)
          }
          // Merge carry-over into descontosMap by CF
          for (const cf of cfList) {
            const carries = carryByFunc.get(cf.funcionario_id)
            if (carries && carries.length > 0) {
              const existing = descontosMap.get(cf.id) ?? []
              descontosMap.set(cf.id, [...existing, ...carries])
            }
          }
        }
      }
      void prevMesStr // suppress unused var warning

      // Build itens
      const items: CFLocal[] = cfList.map(cf => {
        const f = cf.funcionarios
        const loadedVtSabado = cf.valor_vt_sabado ?? f.valor_vt_sabado ?? 0
        const ehExcecao = loadedVtSabado > 0
        const comp = (allComps ?? []).find(c => c.id === cf.competencia_id)
        const unidadeId = comp?.unidade_id
        const empId = unidadeId ? empresaByUnidade.get(unidadeId) : undefined
        const emp = empId ? empresas.find(e => e.id === empId) : undefined
        return {
          id: cf.id, competencia_id: cf.competencia_id, funcionario_id: cf.funcionario_id,
          dias_sabado: ehExcecao ? (cf.dias_sabado ?? sabadosDoMes) : 0,
          descontos: descontosMap.get(cf.id) ?? [],
          valor_vt: cf.valor_vt ?? f.valor_vt ?? 0,
          valor_vt_sabado: loadedVtSabado,
          funcionario: f,
          empresaNome: emp?.razao_social ?? '',
          valorVAItem: vaByComp.get(cf.competencia_id) ?? 0,
        }
      })

      setItens(items)
      setLoading(false)
      return
    }

    // ── MODO EMPRESA ÚNICA ────────────────────────────────────────────────────

    const unidadeId = await getOrCreateDefaultUnidade(empresaId)
    if (!unidadeId) { setLoading(false); return }

    const emp = empresas.find(e => e.id === empresaId)
    if (emp) setValorVA(emp.valor_va ?? 0)

    const { data: compExistente } = await supabase
      .from('competencias').select('*')
      .eq('unidade_id', unidadeId).eq('mes', mes).eq('ano', ano).maybeSingle()

    const comp = compExistente as Competencia | null
    const sabadosDoMes = calcularSabadosDoMes(mes, ano)

    if (comp) {
      setCompetencia(comp)
      setValorVA(comp.valor_va ?? emp?.valor_va ?? 0)
    } else {
      setCompetencia(null)
    }

    const { data: funcs } = await supabase
      .from('funcionarios').select('*')
      .eq('unidade_id', unidadeId).eq('ativo', true).order('nome')

    // Carry-over do mês anterior
    const prevMes = mes === 1 ? 12 : mes - 1
    const prevAno = mes === 1 ? ano - 1 : ano
    const carryByFunc = new Map<string, DescontoLocal[]>()
    const { data: prevComp } = await supabase
      .from('competencias').select('id')
      .eq('unidade_id', unidadeId).eq('mes', prevMes).eq('ano', prevAno).maybeSingle()
    if (prevComp) {
      const { data: prevCFs } = await supabase
        .from('competencia_funcionario').select('id, funcionario_id')
        .eq('competencia_id', prevComp.id)
      if (prevCFs && prevCFs.length > 0) {
        const prevCFMap = new Map(prevCFs.map(cf => [cf.id, cf.funcionario_id]))
        const { data: carryRows } = await supabase
          .from('competencia_funcionario_desconto').select('*, tipos_desconto(id, nome)')
          .in('competencia_funcionario_id', prevCFs.map(cf => cf.id))
          .gt('dias_proximo_mes', 0)
        for (const d of carryRows ?? []) {
          const funcId = prevCFMap.get(d.competencia_funcionario_id)
          if (!funcId) continue
          const arr = carryByFunc.get(funcId) ?? []
          arr.push({
            id: d.id + '_carry', tipo_id: d.tipo_desconto_id,
            tipo_nome: `↩ ${MESES[prevMes - 1]}: ${(d.tipos_desconto as TipoDesconto)?.nome ?? ''}`,
            dias: d.dias_proximo_mes, data_inicio: '', data_fim: '',
            dias_proximo_mes: 0, isCarryOver: true,
          })
          carryByFunc.set(funcId, arr)
        }
      }
    }

    if (funcs && comp) {
      const { data: cfExistente } = await supabase
        .from('competencia_funcionario').select('*').eq('competencia_id', comp.id)
      const cfMap = new Map(
        (cfExistente ?? []).map((cf: CompetenciaFuncionario) => [cf.funcionario_id, cf])
      )
      const cfIds = (cfExistente ?? []).map((cf: CompetenciaFuncionario) => cf.id)
      const descontosMap = new Map<string, DescontoLocal[]>()
      if (cfIds.length > 0) {
        const { data: descontosRows } = await supabase
          .from('competencia_funcionario_desconto').select('*, tipos_desconto(id, nome)')
          .in('competencia_funcionario_id', cfIds)
        for (const d of descontosRows ?? []) {
          const arr = descontosMap.get(d.competencia_funcionario_id) ?? []
          arr.push({
            id: d.id, tipo_id: d.tipo_desconto_id,
            tipo_nome: (d.tipos_desconto as TipoDesconto)?.nome ?? '',
            dias: d.dias, data_inicio: d.data_inicio ?? '', data_fim: d.data_fim ?? '',
            dias_proximo_mes: d.dias_proximo_mes ?? 0, isCarryOver: false,
          })
          descontosMap.set(d.competencia_funcionario_id, arr)
        }
      }

      setItens(
        funcs.map((f: Funcionario) => {
          const cf = cfMap.get(f.id)
          const loadedVtSabado = cf?.valor_vt_sabado ?? f.valor_vt_sabado ?? 0
          const ehExcecao = loadedVtSabado > 0
          const cfDescontos = cf ? (descontosMap.get(cf.id) ?? []) : []
          const carries = carryByFunc.get(f.id) ?? []
          return {
            id: cf?.id ?? '', competencia_id: comp.id, funcionario_id: f.id,
            dias_sabado: ehExcecao ? (cf?.dias_sabado ?? sabadosDoMes) : 0,
            descontos: [...cfDescontos, ...carries],
            valor_vt: cf?.valor_vt ?? f.valor_vt ?? 0,
            valor_vt_sabado: loadedVtSabado,
            funcionario: f,
            empresaNome: emp?.razao_social ?? '',
            valorVAItem: comp.valor_va ?? emp?.valor_va ?? 0,
          }
        })
      )
    } else if (funcs) {
      setItens(
        funcs.map((f: Funcionario) => {
          const carries = carryByFunc.get(f.id) ?? []
          return {
            id: '', competencia_id: '', funcionario_id: f.id,
            dias_sabado: (f.valor_vt_sabado ?? 0) > 0 ? sabadosDoMes : 0,
            descontos: carries,
            valor_vt: f.valor_vt ?? 0,
            valor_vt_sabado: f.valor_vt_sabado ?? 0,
            funcionario: f,
            empresaNome: emp?.razao_social ?? '',
            valorVAItem: emp?.valor_va ?? 0,
          }
        })
      )
    } else {
      setItens([])
    }

    setLoading(false)
  }, [empresaId, mes, ano, empresas])

  useEffect(() => {
    if (empresaId) carregarCompetencia()
  }, [empresaId, mes, ano, carregarCompetencia])

  function atualizarItem(idx: number, campo: 'dias_sabado' | 'valor_vt' | 'valor_vt_sabado', valor: number) {
    setItens(prev => { const n = [...prev]; n[idx] = { ...n[idx], [campo]: valor }; return n })
  }

  // ─── Modal de descontos ──────────────────────────────────────────────────────

  function abrirModal(idx: number) {
    setModalIdx(idx)
    setNovoTipoId(tiposDesconto[0]?.id ?? '')
    setNovoDias(1)
    setNovaDataInicio('')
    setNovaDataFim('')
    setNovoDiasProximo(0)
  }

  function handleDataInicioChange(val: string) {
    setNovaDataInicio(val)
    if (val) {
      const fim = novaDataFim || val
      const { diasCorrente, diasProximo } = calcularDiasComCarryOver(val, fim, mes, ano)
      setNovoDias(diasCorrente || 1)
      setNovoDiasProximo(diasProximo)
    }
  }

  function handleDataFimChange(val: string) {
    setNovaDataFim(val)
    if (novaDataInicio) {
      const fim = val || novaDataInicio
      const { diasCorrente, diasProximo } = calcularDiasComCarryOver(novaDataInicio, fim, mes, ano)
      setNovoDias(diasCorrente || 1)
      setNovoDiasProximo(diasProximo)
    }
  }

  function adicionarDesconto() {
    if (!novoTipoId || novoDias < 1 || modalIdx === null) return
    const tipo = tiposDesconto.find(t => t.id === novoTipoId)
    if (!tipo) return
    setItens(prev => {
      const n = [...prev]
      n[modalIdx] = {
        ...n[modalIdx],
        descontos: [...n[modalIdx].descontos, {
          id: '', tipo_id: novoTipoId, tipo_nome: tipo.nome,
          dias: novoDias,
          data_inicio: novaDataInicio,
          data_fim: novaDataFim || novaDataInicio,
          dias_proximo_mes: novoDiasProximo,
          isCarryOver: false,
        }],
      }
      return n
    })
    setNovoDias(1)
    setNovaDataInicio('')
    setNovaDataFim('')
    setNovoDiasProximo(0)
    if (tiposDesconto.length > 0) setNovoTipoId(tiposDesconto[0].id)
  }

  function removerDesconto(itemIdx: number, desIdx: number) {
    setItens(prev => {
      const n = [...prev]
      n[itemIdx] = { ...n[itemIdx], descontos: n[itemIdx].descontos.filter((_, i) => i !== desIdx) }
      return n
    })
  }

  // ─── Salvar (helper por item) ────────────────────────────────────────────────

  async function salvarItemCF(item: CFLocal, vaEfetivo: number) {
    const ehExcecao = (item.valor_vt_sabado ?? 0) > 0
    const diasSabadoSalvar = ehExcecao ? item.dias_sabado : 0
    const valorVtSabadoSalvar = ehExcecao ? item.valor_vt_sabado : 0
    const descontosReais = item.descontos.filter(d => !d.isCarryOver)
    const totalDescontos = descontosReais.reduce((s, d) => s + d.dias, 0)
    const diasUteisAuto = calcularDiasUteisAuto(mes, ano, item.funcionario.folga_semanal, feriadosDoMes)
    const resultado = calcularVTVA({
      diasUteis: diasUteisAuto, diasFeriado: 0, diasSabado: diasSabadoSalvar,
      diasDesconto: totalDescontos, valorVT: item.valor_vt,
      valorVTSabado: valorVtSabadoSalvar, valorVA: vaEfetivo,
    })

    const payload = {
      competencia_id: item.competencia_id,
      funcionario_id: item.funcionario_id,
      dias_feriado: feriadosDoMes,
      dias_sabado: diasSabadoSalvar,
      dias_desconto: totalDescontos,
      valor_vt: item.valor_vt,
      valor_vt_sabado: valorVtSabadoSalvar,
      valor_total: resultado.valorTotal,
    }

    let cfId = item.id
    if (cfId) {
      await supabase.from('competencia_funcionario').update(payload).eq('id', cfId)
    } else {
      const { data: novoCF } = await supabase.from('competencia_funcionario').insert(payload).select().single()
      cfId = (novoCF as CFDesconto)?.id ?? ''
    }

    if (cfId) {
      await supabase.from('competencia_funcionario_desconto').delete().eq('competencia_funcionario_id', cfId)
      for (const d of descontosReais) {
        await supabase.from('competencia_funcionario_desconto').insert({
          competencia_funcionario_id: cfId,
          tipo_desconto_id: d.tipo_id,
          dias: d.dias,
          data_inicio: d.data_inicio || null,
          data_fim: d.data_fim || null,
          dias_proximo_mes: d.dias_proximo_mes ?? 0,
        })
      }
    }
  }

  // ─── Salvar ──────────────────────────────────────────────────────────────────

  async function salvar() {
    if (!empresaId) return
    setSalvando(true)
    setSucesso(false)

    if (modoTodas) {
      // Em modoTodas: itens já têm competencia_id, salva em paralelo
      await Promise.all(itens.map(item => {
        if (!item.competencia_id) return Promise.resolve()
        return salvarItemCF(item, item.valorVAItem)
      }))
    } else {
      const unidadeId = await getOrCreateDefaultUnidade(empresaId)
      if (!unidadeId) { setSalvando(false); return }

      let compId = competencia?.id ?? ''
      if (!competencia) {
        const { data: novaComp } = await supabase
          .from('competencias')
          .insert({ unidade_id: unidadeId, mes, ano, dias_uteis: 0, feriados_mes: feriadosDoMes, valor_va: valorVA })
          .select().single()
        compId = (novaComp as Competencia)?.id ?? ''
        setCompetencia(novaComp as Competencia)
      } else {
        await supabase.from('competencias').update({ feriados_mes: feriadosDoMes, valor_va: valorVA }).eq('id', competencia.id)
      }

      for (const item of itens) {
        await salvarItemCF({ ...item, competencia_id: compId }, valorVA)
      }
    }

    setSalvando(false)
    setSucesso(true)
    setTimeout(() => setSucesso(false), 3000)
    carregarCompetencia()
  }

  // ─── Inicializar / Salvar para Todas ────────────────────────────────────────

  async function inicializarTodasCompetencias() {
    setCriando(true)
    setSucesso(false)

    const mesStr = String(mes).padStart(2, '0')
    const { data: feriadosRows } = await supabase
      .from('feriados').select('data')
      .gte('data', `${ano}-${mesStr}-01`)
      .lte('data', `${ano}-${mesStr}-31`)
    const feriados = feriadosRows?.length ?? 0
    const sabadosDoMes = calcularSabadosDoMes(mes, ano)

    await Promise.all(empresas.map(async (emp) => {
      const unidadeId = await getOrCreateDefaultUnidade(emp.id)
      if (!unidadeId) return

      const { data: existingComp } = await supabase
        .from('competencias').select('id, valor_va')
        .eq('unidade_id', unidadeId).eq('mes', mes).eq('ano', ano).maybeSingle()

      let compId: string
      let compValorVA: number
      if (existingComp) {
        compId = (existingComp as Competencia).id
        compValorVA = (existingComp as Competencia).valor_va ?? emp.valor_va ?? 0
      } else {
        const { data: nova } = await supabase
          .from('competencias')
          .insert({ unidade_id: unidadeId, mes, ano, dias_uteis: 0, feriados_mes: feriados, valor_va: emp.valor_va ?? 0 })
          .select().single()
        if (!nova) return
        compId = (nova as Competencia).id
        compValorVA = emp.valor_va ?? 0
      }

      const { data: funcs } = await supabase
        .from('funcionarios').select('*')
        .eq('unidade_id', unidadeId).eq('ativo', true)

      await Promise.all(((funcs ?? []) as Funcionario[]).map(async (f) => {
        const { data: existingCF } = await supabase
          .from('competencia_funcionario').select('id')
          .eq('competencia_id', compId).eq('funcionario_id', f.id).maybeSingle()
        if (existingCF) return

        const ehExcecao = (f.valor_vt_sabado ?? 0) > 0
        const diasAuto = calcularDiasUteisAuto(mes, ano, f.folga_semanal, feriados)
        const diasSabado = ehExcecao ? sabadosDoMes : 0
        const valorVtSabado = ehExcecao ? (f.valor_vt_sabado ?? 0) : 0
        const resultado = calcularVTVA({
          diasUteis: diasAuto, diasFeriado: 0, diasSabado,
          diasDesconto: 0, valorVT: f.valor_vt ?? 0, valorVTSabado: valorVtSabado, valorVA: compValorVA,
        })

        await supabase.from('competencia_funcionario').insert({
          competencia_id: compId, funcionario_id: f.id,
          dias_feriado: feriados, dias_sabado: diasSabado, dias_desconto: 0,
          valor_vt: f.valor_vt ?? 0, valor_vt_sabado: valorVtSabado,
          valor_total: resultado.valorTotal,
        })
      }))
    }))

    setCriando(false)
    setSucesso(true)
    setTimeout(() => setSucesso(false), 3000)
    carregarCompetencia()
  }

  async function salvarTodasCompetencias() {
    setSalvando(true)
    setSucesso(false)

    const mesStr = String(mes).padStart(2, '0')
    const { data: feriadosRows } = await supabase
      .from('feriados').select('data')
      .gte('data', `${ano}-${mesStr}-01`)
      .lte('data', `${ano}-${mesStr}-31`)
    const feriados = feriadosRows?.length ?? 0
    const sabadosDoMes = calcularSabadosDoMes(mes, ano)

    await Promise.all(empresas.map(async (emp) => {
      const unidadeId = await getOrCreateDefaultUnidade(emp.id)
      if (!unidadeId) return

      const { data: existingComp } = await supabase
        .from('competencias').select('id, valor_va')
        .eq('unidade_id', unidadeId).eq('mes', mes).eq('ano', ano).maybeSingle()

      let compId: string
      let compValorVA: number
      if (existingComp) {
        compId = (existingComp as Competencia).id
        compValorVA = (existingComp as Competencia).valor_va ?? emp.valor_va ?? 0
        await supabase.from('competencias').update({ feriados_mes: feriados }).eq('id', compId)
      } else {
        const { data: nova } = await supabase
          .from('competencias')
          .insert({ unidade_id: unidadeId, mes, ano, dias_uteis: 0, feriados_mes: feriados, valor_va: emp.valor_va ?? 0 })
          .select().single()
        if (!nova) return
        compId = (nova as Competencia).id
        compValorVA = emp.valor_va ?? 0
      }

      const { data: funcs } = await supabase
        .from('funcionarios').select('*')
        .eq('unidade_id', unidadeId).eq('ativo', true)

      await Promise.all(((funcs ?? []) as Funcionario[]).map(async (f) => {
        const { data: existingCF } = await supabase
          .from('competencia_funcionario').select('id, dias_desconto, dias_sabado, valor_vt, valor_vt_sabado')
          .eq('competencia_id', compId).eq('funcionario_id', f.id).maybeSingle()

        const ehExcecao = existingCF ? (existingCF.valor_vt_sabado ?? 0) > 0 : (f.valor_vt_sabado ?? 0) > 0
        const diasSabado = ehExcecao ? (existingCF?.dias_sabado ?? sabadosDoMes) : 0
        const valorVtSabado = ehExcecao ? (existingCF?.valor_vt_sabado ?? f.valor_vt_sabado ?? 0) : 0
        const valorVt = existingCF?.valor_vt ?? f.valor_vt ?? 0
        const diasDesconto = existingCF?.dias_desconto ?? 0
        const diasAuto = calcularDiasUteisAuto(mes, ano, f.folga_semanal, feriados)
        const resultado = calcularVTVA({
          diasUteis: diasAuto, diasFeriado: 0, diasSabado,
          diasDesconto, valorVT: valorVt, valorVTSabado: valorVtSabado, valorVA: compValorVA,
        })
        const payload = {
          competencia_id: compId, funcionario_id: f.id,
          dias_feriado: feriados, dias_sabado: diasSabado, dias_desconto: diasDesconto,
          valor_vt: valorVt, valor_vt_sabado: valorVtSabado, valor_total: resultado.valorTotal,
        }
        if (existingCF) {
          await supabase.from('competencia_funcionario').update(payload).eq('id', existingCF.id)
        } else {
          await supabase.from('competencia_funcionario').insert(payload)
        }
      }))
    }))

    setSalvando(false)
    setSucesso(true)
    setTimeout(() => setSucesso(false), 3000)
    carregarCompetencia()
  }

  // ─── Totais ──────────────────────────────────────────────────────────────────

  const totalGeral = itens.reduce((sum, item) => {
    const ehExcecao = (item.valor_vt_sabado ?? 0) > 0
    const vaEfetivo = modoTodas ? (item.valorVAItem ?? 0) : valorVA
    const totalDesc = item.descontos.filter(d => !d.isCarryOver).reduce((s, d) => s + d.dias, 0)
    const diasAuto = calcularDiasUteisAuto(mes, ano, item.funcionario.folga_semanal, feriadosDoMes)
    const r = calcularVTVA({
      diasUteis: diasAuto, diasFeriado: 0,
      diasSabado: ehExcecao ? item.dias_sabado : 0,
      diasDesconto: totalDesc,
      valorVT: item.valor_vt,
      valorVTSabado: ehExcecao ? item.valor_vt_sabado : 0,
      valorVA: vaEfetivo,
    })
    return sum + r.valorTotal
  }, 0)

  const modalItem = modalIdx !== null ? itens[modalIdx] : null

  // ─── JSX ─────────────────────────────────────────────────────────────────────

  return (
    <LayoutAdmin title="Competências Mensais">
      <div className="space-y-6">

        {/* ── Modal de descontos ── */}
        {modalIdx !== null && modalItem && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-bold text-gray-800">Descontos</h2>
                  <p className="text-xs text-gray-500">{modalItem.funcionario.nome}</p>
                </div>
                <button onClick={() => setModalIdx(null)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Lista existente */}
              {modalItem.descontos.length > 0 ? (
                <div className="space-y-2 mb-4">
                  {modalItem.descontos.map((d, di) => (
                    <div key={di} className={`flex items-center justify-between rounded-lg px-3 py-2 ${d.isCarryOver ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50'}`}>
                      <div>
                        <span className={`text-sm font-medium ${d.isCarryOver ? 'text-amber-800' : 'text-gray-800'}`}>{d.tipo_nome}</span>
                        <span className="ml-2 text-xs text-gray-500">{d.dias} dia(s)</span>
                        {d.data_inicio && (
                          <span className="ml-2 text-xs text-blue-500">
                            {d.data_inicio === d.data_fim || !d.data_fim
                              ? new Date(d.data_inicio + 'T12:00:00').toLocaleDateString('pt-BR')
                              : `${new Date(d.data_inicio + 'T12:00:00').toLocaleDateString('pt-BR')} – ${new Date((d.data_fim ?? d.data_inicio) + 'T12:00:00').toLocaleDateString('pt-BR')}`
                            }
                          </span>
                        )}
                        {d.dias_proximo_mes > 0 && (
                          <span className="ml-2 text-xs text-orange-500">+{d.dias_proximo_mes}d no próx. mês</span>
                        )}
                        {d.isCarryOver && <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-1 rounded">carry-over</span>}
                      </div>
                      {!d.isCarryOver && (
                        <button onClick={() => removerDesconto(modalIdx, di)} className="text-red-500 hover:text-red-700">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="text-right text-sm font-semibold text-gray-700 pt-1">
                    Total: {modalItem.descontos.filter(d => !d.isCarryOver).reduce((s, d) => s + d.dias, 0)} dia(s) descontados
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-400 mb-4">Nenhum desconto lançado.</p>
              )}

              {/* Adicionar novo desconto */}
              {tiposDesconto.length > 0 ? (
                <div className="border-t border-gray-100 pt-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Adicionar desconto</p>
                  <p className="text-xs text-gray-400 mb-2">
                    Datas podem ser do mês anterior (para descontos retroativos de VT pago antecipadamente).
                    Se o período ultrapassar o fim deste mês, os dias excedentes serão aplicados automaticamente no próximo.
                  </p>
                  <div className="flex gap-2 mb-2">
                    <select
                      value={novoTipoId}
                      onChange={(e) => setNovoTipoId(e.target.value)}
                      className="input-field flex-1 text-sm"
                    >
                      {tiposDesconto.map(t => (
                        <option key={t.id} value={t.id}>{t.nome}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2 mb-2">
                    <div className="flex-1">
                      <label className="text-xs text-gray-500 mb-1 block">Data início</label>
                      <input
                        type="date"
                        value={novaDataInicio}
                        onChange={(e) => handleDataInicioChange(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-gray-500 mb-1 block">Data fim</label>
                      <input
                        type="date"
                        value={novaDataFim}
                        onChange={(e) => handleDataFimChange(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div className="w-20">
                      <label className="text-xs text-gray-500 mb-1 block">Dias</label>
                      <input
                        type="number"
                        value={novoDias}
                        onChange={(e) => setNovoDias(Number(e.target.value))}
                        min={1} max={31}
                        className="w-full border border-gray-300 rounded-lg px-2 py-2 text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  {novoDiasProximo > 0 && (
                    <div className="flex items-center gap-1 text-xs text-orange-600 bg-orange-50 rounded px-2 py-1 mb-2">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <strong>{novoDiasProximo} dia(s)</strong>&nbsp;serão aplicados automaticamente no próximo mês.
                    </div>
                  )}
                  <button onClick={adicionarDesconto} className="btn-primary w-full py-2 text-sm">
                    + Adicionar desconto
                  </button>
                </div>
              ) : (
                <p className="text-xs text-amber-600 mt-2">
                  Cadastre tipos de desconto primeiro em <strong>Tipos de Desconto</strong>.
                </p>
              )}

              <button onClick={() => setModalIdx(null)} className="btn-secondary w-full mt-4">
                Fechar
              </button>
            </div>
          </div>
        )}

        {/* ── Seleção ── */}
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Selecionar Competência</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <label className="label-field">Empresa</label>
              <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="input-field">
                <option value={TODAS}>— Todas as empresas —</option>
                {empresas.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.razao_social}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-field">Mês</label>
              <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="input-field">
                {MESES.map((m, i) => (<option key={i + 1} value={i + 1}>{m}</option>))}
              </select>
            </div>
            <div>
              <label className="label-field">Ano</label>
              <input type="number" value={ano} onChange={(e) => setAno(Number(e.target.value))} className="input-field" min={2020} max={2099} />
            </div>
          </div>

          {empresaId && !modoTodas && (
            <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-end gap-6">
              <div>
                <label className="label-field">VA / dia útil (R$)</label>
                <input
                  type="number" value={valorVA}
                  onChange={(e) => setValorVA(Number(e.target.value))}
                  min={0} step={0.01} className="input-field w-36" placeholder="0,00"
                />
              </div>
              <div className="pb-1">
                <p className="text-xs text-gray-400">Feriados no mês (automático)</p>
                <p className="text-lg font-bold text-blue-700">{feriadosDoMes}</p>
                <p className="text-xs text-gray-400">cadastrados na agenda de Feriados</p>
              </div>
              <p className="text-xs text-blue-600 pb-1">
                Dias úteis calculados automaticamente por funcionário.<br />
                VT pré-carregado do perfil de cada funcionário.
              </p>
              {!competencia && (
                <p className="text-xs text-amber-600">⚠ Competência nova — será criada ao salvar.</p>
              )}
            </div>
          )}
        </div>

        {sucesso && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Salvo com sucesso!
          </div>
        )}

        {/* ── Tabela de funcionários (funciona para empresa única e todas) ── */}
        {empresaId && (
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-700">
                {modoTodas
                  ? `Todas as empresas — ${MESES[mes - 1]}/${ano}`
                  : `Funcionários — ${MESES[mes - 1]}/${ano}`
                }
              </h2>
              <div className="flex items-center gap-3">
                {itens.length > 0 && (
                  <div className="text-sm font-semibold text-gray-700">
                    Total: <span className="text-blue-600">{formatarMoeda(totalGeral)}</span>
                  </div>
                )}
                {modoTodas && (
                  <>
                    <button
                      onClick={salvarTodasCompetencias}
                      disabled={salvando || criando || loading}
                      className="btn-secondary flex items-center gap-2 text-sm"
                    >
                      {salvando ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      )}
                      Recalcular para todas
                    </button>
                    <button
                      onClick={inicializarTodasCompetencias}
                      disabled={criando || salvando || loading}
                      className="btn-primary flex items-center gap-2 text-sm"
                    >
                      {criando ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      )}
                      {criando ? 'Inicializando...' : 'Inicializar mês para todas'}
                    </button>
                  </>
                )}
              </div>
            </div>

            {modoTodas && (
              <p className="text-xs text-amber-600 mb-3">
                &quot;Inicializar&quot; cria registros novos (não sobrescreve existentes).
                &quot;Recalcular&quot; atualiza todos os registros com valores atuais.
              </p>
            )}

            {loading ? (
              <div className="text-center py-12 text-gray-400 text-sm">Carregando...</div>
            ) : itens.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                {modoTodas
                  ? 'Nenhum registro encontrado. Clique em "Inicializar mês para todas" para criar.'
                  : 'Nenhum funcionário ativo nesta empresa.'
                }
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        {modoTodas && <th className="table-header text-left min-w-[120px]">Empresa</th>}
                        <th className="table-header text-left min-w-[160px]">Funcionário</th>
                        <th className="table-header text-left min-w-[80px]">Folga</th>
                        <th className="table-header text-center min-w-[90px]">VT/dia</th>
                        <th className="table-header text-center min-w-[90px]">VT Sáb</th>
                        <th className="table-header text-center">Sáb. trab.</th>
                        <th className="table-header text-center">Descontos</th>
                        <th className="table-header text-right bg-blue-50 text-blue-700">Dias Ef.</th>
                        <th className="table-header text-right">VA</th>
                        <th className="table-header text-right">VT</th>
                        <th className="table-header text-right">VT Sáb.</th>
                        <th className="table-header text-right font-bold">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {itens.map((item, idx) => {
                        const ehExcecao = (item.valor_vt_sabado ?? 0) > 0
                        const diasSabadoEfetivo = ehExcecao ? item.dias_sabado : 0
                        const valorVtSabadoEfetivo = ehExcecao ? item.valor_vt_sabado : 0
                        const vaEfetivo = modoTodas ? (item.valorVAItem ?? 0) : valorVA
                        const totalDesc = item.descontos.filter(d => !d.isCarryOver).reduce((s, d) => s + d.dias, 0)
                        const totalDescComCarry = item.descontos.reduce((s, d) => s + d.dias, 0)
                        const diasAuto = calcularDiasUteisAuto(mes, ano, item.funcionario.folga_semanal, feriadosDoMes)
                        const r = calcularVTVA({
                          diasUteis: diasAuto, diasFeriado: 0,
                          diasSabado: diasSabadoEfetivo, diasDesconto: totalDescComCarry,
                          valorVT: item.valor_vt, valorVTSabado: valorVtSabadoEfetivo, valorVA: vaEfetivo,
                        })
                        return (
                          <tr key={`${item.competencia_id}-${item.funcionario_id}`} className="hover:bg-gray-50">
                            {modoTodas && (
                              <td className="table-cell text-xs text-gray-500">{item.empresaNome}</td>
                            )}
                            <td className="table-cell">
                              <div className="font-medium text-gray-900">{item.funcionario.nome}</div>
                              <div className="text-xs text-gray-400">{item.funcionario.funcao}</div>
                            </td>
                            <td className="table-cell">
                              <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                                {item.funcionario.folga_semanal ?? '—'}
                              </span>
                            </td>
                            <td className="table-cell text-center">
                              <input type="number" value={item.valor_vt}
                                onChange={(e) => atualizarItem(idx, 'valor_vt', Number(e.target.value))}
                                className="w-20 border border-gray-300 rounded px-2 py-1 text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                min={0} step={0.01} />
                            </td>
                            <td className="table-cell text-center">
                              {ehExcecao
                                ? <input type="number" value={item.valor_vt_sabado}
                                    onChange={(e) => atualizarItem(idx, 'valor_vt_sabado', Number(e.target.value))}
                                    className="w-20 border border-blue-300 rounded px-2 py-1 text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    min={0} step={0.01} />
                                : <span className="text-gray-300 text-xs">—</span>
                              }
                            </td>
                            <td className="table-cell text-center">
                              {ehExcecao
                                ? <input type="number" value={item.dias_sabado}
                                    onChange={(e) => atualizarItem(idx, 'dias_sabado', Number(e.target.value))}
                                    className="w-16 border border-blue-300 rounded px-2 py-1 text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    min={0} max={5} />
                                : <span className="text-gray-300 text-xs">—</span>
                              }
                            </td>
                            <td className="table-cell text-center">
                              <button
                                onClick={() => abrirModal(idx)}
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
                                  totalDesc > 0 || item.descontos.some(d => d.isCarryOver)
                                    ? 'bg-red-50 text-red-700 hover:bg-red-100'
                                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                }`}
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                {totalDescComCarry > 0 ? `${totalDescComCarry}d` : 'Adicionar'}
                              </button>
                            </td>
                            <td className="table-cell text-right bg-blue-50">
                              <span className="font-bold text-blue-700 text-sm">{r.diasEfetivos}d</span>
                            </td>
                            <td className="table-cell text-right text-xs text-gray-500">{formatarMoeda(r.totalVA)}</td>
                            <td className="table-cell text-right text-xs text-gray-500">{formatarMoeda(r.totalVT)}</td>
                            <td className="table-cell text-right text-xs text-gray-500">{formatarMoeda(r.totalVTSabado)}</td>
                            <td className="table-cell text-right font-semibold text-blue-700">{formatarMoeda(r.valorTotal)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end mt-6">
                  <button onClick={salvar} disabled={salvando} className="btn-primary px-8 flex items-center gap-2">
                    {salvando ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                        </svg>
                        Salvando...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        {modoTodas ? 'Salvar Todas' : 'Salvar Competência'}
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {!empresaId && (
          <div className="card text-center py-16 text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-sm">Selecione uma empresa, mês e ano para gerenciar a competência.</p>
          </div>
        )}
      </div>
    </LayoutAdmin>
  )
}

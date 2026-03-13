'use client'

import { useEffect, useState } from 'react'
import LayoutAdmin from '../../components/LayoutAdmin'
import {
  supabase,
  Competencia,
  CompetenciaFuncionario,
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

type FuncionarioComEmpresa = {
  func: Funcionario
  empresa: Empresa
  unidadeId: string
}

type DescontoItem = {
  id: string
  tipo_id: string
  tipo_nome: string
  dias: number
  data_inicio: string
  data_fim: string
  dias_proximo_mes: number
  isCarryOver: boolean
}

type CFCarregado = {
  cfId: string
  competenciaId: string
  feriados: string[]
  valorVA: number
  valorVT: number
  valorVTSabado: number
  diasSabado: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ultimoDiaDoMes(m: number, y: number): Date {
  const d = new Date(y, m, 0)
  d.setHours(12, 0, 0, 0)
  return d
}

function contarDiasNoPeriodo(start: Date, end: Date): number {
  let count = 0
  const cur = new Date(start)
  while (cur <= end) {
    if (cur.getDay() !== 0) count++
    cur.setDate(cur.getDate() + 1)
  }
  return Math.max(0, count)
}

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

function fmtData(iso: string) {
  if (!iso) return ''
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function DescontosPage() {
  // Período global
  const [mes, setMes] = useState(new Date().getMonth() + 1)
  const [ano, setAno] = useState(new Date().getFullYear())

  // Dados base
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [tiposDesconto, setTiposDesconto] = useState<TipoDesconto[]>([])
  const [todosFuncionarios, setTodosFuncionarios] = useState<FuncionarioComEmpresa[]>([])
  const [filtroEmpresaId, setFiltroEmpresaId] = useState('')
  const [loadingLista, setLoadingLista] = useState(true)

  // Contadores de descontos já lançados
  const [contadoresDesconto, setContadoresDesconto] = useState<Record<string, number>>({})

  // View: 'list' | 'form'
  const [view, setView] = useState<'list' | 'form'>('list')
  const [selecionado, setSelecionado] = useState<FuncionarioComEmpresa | null>(null)

  // Estado do formulário
  const [loadingForm, setLoadingForm] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [sucesso, setSucesso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [cfCarregado, setCfCarregado] = useState<CFCarregado | null>(null)
  const [descontos, setDescontos] = useState<DescontoItem[]>([])

  // Formulário novo desconto
  const [novoTipoId, setNovoTipoId] = useState('')
  const [novaDataInicio, setNovaDataInicio] = useState('')
  const [novaDataFim, setNovaDataFim] = useState('')
  const [novoDias, setNovoDias] = useState(1)
  const [novoDiasProximo, setNovoDiasProximo] = useState(0)

  // ─── Carga inicial ──────────────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      supabase.from('empresas').select('*').order('razao_social'),
      supabase.from('tipos_desconto').select('*').order('nome'),
    ]).then(([{ data: emps }, { data: tipos }]) => {
      setEmpresas(emps ?? [])
      const tiposList = tipos ?? []
      setTiposDesconto(tiposList)
      if (tiposList.length > 0) setNovoTipoId(tiposList[0].id)
    })
  }, [])

  // Carrega todos os funcionários de todas as empresas
  useEffect(() => {
    async function carregarFuncionarios() {
      setLoadingLista(true)
      const { data: emps } = await supabase.from('empresas').select('*').order('razao_social')
      if (!emps || emps.length === 0) { setLoadingLista(false); return }

      const { data: unidades } = await supabase
        .from('unidades').select('id, empresa_id').in('empresa_id', emps.map(e => e.id))

      const unidadeMap: Record<string, string> = {}
      const empresaDeUnidade: Record<string, string> = {}
      for (const u of unidades ?? []) {
        unidadeMap[u.empresa_id] = u.id
        empresaDeUnidade[u.id] = u.empresa_id
      }

      const unidadeIds = Object.values(unidadeMap)
      if (unidadeIds.length === 0) { setLoadingLista(false); return }

      const { data: funcs } = await supabase
        .from('funcionarios').select('*')
        .in('unidade_id', unidadeIds)
        .eq('ativo', true)
        .order('nome')

      const empMap: Record<string, Empresa> = {}
      for (const e of emps) empMap[e.id] = e

      const lista: FuncionarioComEmpresa[] = (funcs ?? []).map(f => ({
        func: f as Funcionario,
        empresa: empMap[empresaDeUnidade[f.unidade_id]] ?? emps[0],
        unidadeId: f.unidade_id,
      }))

      setTodosFuncionarios(lista)
      setEmpresas(emps)
      setLoadingLista(false)
    }
    carregarFuncionarios()
  }, [])

  // Carrega contadores ao trocar período
  useEffect(() => {
    if (todosFuncionarios.length === 0) return
    carregarContadores()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes, ano, todosFuncionarios])

  async function carregarContadores() {
    const unidadeIds = Array.from(new Set(todosFuncionarios.map(f => f.unidadeId)))
    const { data: comps } = await supabase
      .from('competencias').select('id, unidade_id')
      .in('unidade_id', unidadeIds).eq('mes', mes).eq('ano', ano)
    if (!comps || comps.length === 0) { setContadoresDesconto({}); return }

    const compIds = comps.map(c => c.id)
    const { data: cfs } = await supabase
      .from('competencia_funcionario').select('id, funcionario_id')
      .in('competencia_id', compIds)
    if (!cfs || cfs.length === 0) { setContadoresDesconto({}); return }

    const cfIds = cfs.map(c => c.id)
    const cfPorFuncionario: Record<string, string> = {}
    for (const cf of cfs) cfPorFuncionario[cf.id] = cf.funcionario_id

    const { data: descs } = await supabase
      .from('competencia_funcionario_desconto').select('competencia_funcionario_id')
      .in('competencia_funcionario_id', cfIds)

    const contadores: Record<string, number> = {}
    for (const d of descs ?? []) {
      const funcId = cfPorFuncionario[d.competencia_funcionario_id]
      if (funcId) contadores[funcId] = (contadores[funcId] ?? 0) + 1
    }
    setContadoresDesconto(contadores)
  }

  // ─── Abrir formulário ───────────────────────────────────────────────────────

  async function abrirFormulario(item: FuncionarioComEmpresa) {
    setSelecionado(item)
    setView('form')
    setLoadingForm(true)
    setCfCarregado(null)
    setDescontos([])
    setErro(null)
    setSucesso(null)
    setNovaDataInicio('')
    setNovaDataFim('')
    setNovoDias(1)
    setNovoDiasProximo(0)
    if (tiposDesconto.length > 0) setNovoTipoId(tiposDesconto[0].id)

    await buscarDados(item)
    setLoadingForm(false)
  }

  async function buscarDados(item: FuncionarioComEmpresa) {
    const { func, empresa, unidadeId } = item

    const mesStr = String(mes).padStart(2, '0')
    const ultimoDia = new Date(ano, mes, 0).getDate()
    const { data: feriadosRows } = await supabase
      .from('feriados').select('data')
      .gte('data', `${ano}-${mesStr}-01`)
      .lte('data', `${ano}-${mesStr}-${String(ultimoDia).padStart(2, '0')}`)
    const feriados: string[] = (feriadosRows ?? []).map(f => f.data as string)

    const { data: comp } = await supabase
      .from('competencias').select('*')
      .eq('unidade_id', unidadeId).eq('mes', mes).eq('ano', ano).maybeSingle()

    let cfId = ''
    let competenciaId = ''
    let valorVA = empresa.valor_va ?? 0
    let valorVT = func.valor_vt ?? 0
    let valorVTSabado = func.valor_vt_sabado ?? 0
    let diasSabado = (valorVTSabado > 0) ? calcularSabadosDoMes(mes, ano) : 0

    if (comp) {
      competenciaId = (comp as Competencia).id
      valorVA = (comp as Competencia).valor_va ?? empresa.valor_va ?? 0
      const { data: cf } = await supabase
        .from('competencia_funcionario').select('*')
        .eq('competencia_id', competenciaId).eq('funcionario_id', func.id).maybeSingle()
      if (cf) {
        const cfObj = cf as CompetenciaFuncionario
        cfId = cfObj.id
        valorVT = cfObj.valor_vt ?? func.valor_vt ?? 0
        valorVTSabado = cfObj.valor_vt_sabado ?? func.valor_vt_sabado ?? 0
        diasSabado = cfObj.dias_sabado ?? 0
      }
    }

    const descontosCarregados: DescontoItem[] = []
    if (cfId) {
      const { data: descontosRows } = await supabase
        .from('competencia_funcionario_desconto').select('*, tipos_desconto(id, nome)')
        .eq('competencia_funcionario_id', cfId)
      for (const d of descontosRows ?? []) {
        descontosCarregados.push({
          id: d.id,
          tipo_id: d.tipo_desconto_id,
          tipo_nome: (d.tipos_desconto as TipoDesconto | null)?.nome ?? '',
          dias: d.dias,
          data_inicio: d.data_inicio ?? '',
          data_fim: d.data_fim ?? '',
          dias_proximo_mes: d.dias_proximo_mes ?? 0,
          isCarryOver: false,
        })
      }
    }

    // Carry-over do mês anterior
    const prevMes = mes === 1 ? 12 : mes - 1
    const prevAno = mes === 1 ? ano - 1 : ano
    const { data: prevComp } = await supabase
      .from('competencias').select('id')
      .eq('unidade_id', unidadeId).eq('mes', prevMes).eq('ano', prevAno).maybeSingle()
    if (prevComp) {
      const { data: prevCF } = await supabase
        .from('competencia_funcionario').select('id')
        .eq('competencia_id', prevComp.id).eq('funcionario_id', func.id).maybeSingle()
      if (prevCF) {
        const { data: carryRows } = await supabase
          .from('competencia_funcionario_desconto').select('*, tipos_desconto(id, nome)')
          .eq('competencia_funcionario_id', prevCF.id).gt('dias_proximo_mes', 0)
        for (const d of carryRows ?? []) {
          descontosCarregados.push({
            id: d.id + '_carry',
            tipo_id: d.tipo_desconto_id,
            tipo_nome: `↩ ${MESES[prevMes - 1]}: ${(d.tipos_desconto as TipoDesconto | null)?.nome ?? ''}`,
            dias: d.dias_proximo_mes,
            data_inicio: '',
            data_fim: '',
            dias_proximo_mes: 0,
            isCarryOver: true,
          })
        }
      }
    }

    setCfCarregado({ cfId, competenciaId, feriados, valorVA, valorVT, valorVTSabado, diasSabado })
    setDescontos(descontosCarregados)
  }

  // ─── Voltar para lista ───────────────────────────────────────────────────────

  function voltar() {
    setView('list')
    setSelecionado(null)
    setCfCarregado(null)
    setDescontos([])
    setSucesso(null)
    setErro(null)
    carregarContadores()
  }

  // ─── Desconto helpers ───────────────────────────────────────────────────────

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
    if (!novoTipoId || novoDias < 1) return
    const tipo = tiposDesconto.find(t => t.id === novoTipoId)
    if (!tipo) return
    setDescontos(prev => [...prev, {
      id: '',
      tipo_id: novoTipoId,
      tipo_nome: tipo.nome,
      dias: novoDias,
      data_inicio: novaDataInicio,
      data_fim: novaDataFim || novaDataInicio,
      dias_proximo_mes: novoDiasProximo,
      isCarryOver: false,
    }])
    setNovoDias(1)
    setNovaDataInicio('')
    setNovaDataFim('')
    setNovoDiasProximo(0)
    if (tiposDesconto.length > 0) setNovoTipoId(tiposDesconto[0].id)
  }

  function removerDesconto(idx: number) {
    setDescontos(prev => prev.filter((_, i) => i !== idx))
  }

  // ─── Salvar ─────────────────────────────────────────────────────────────────

  async function salvar() {
    if (!cfCarregado || !selecionado) return
    setSalvando(true)
    setErro(null)
    setSucesso(null)

    const { func, empresa, unidadeId } = selecionado
    const unidadeIdFinal = unidadeId || await getOrCreateDefaultUnidade(empresa.id)
    if (!unidadeIdFinal) { setErro('Erro ao obter unidade.'); setSalvando(false); return }

    let compId = cfCarregado.competenciaId
    if (!compId) {
      const { data: novaComp } = await supabase
        .from('competencias')
        .insert({ unidade_id: unidadeIdFinal, mes, ano, dias_uteis: 0, feriados_mes: cfCarregado.feriados.length, valor_va: cfCarregado.valorVA })
        .select().single()
      if (!novaComp) { setErro('Erro ao criar competência.'); setSalvando(false); return }
      compId = (novaComp as Competencia).id
    }

    const descontosReais = descontos.filter(d => !d.isCarryOver)
    const totalDescontos = descontosReais.reduce((s, d) => s + d.dias, 0)
    const { valorVT, valorVTSabado, diasSabado, feriados, valorVA } = cfCarregado
    const ehExcecao = valorVTSabado > 0
    const diasAuto = calcularDiasUteisAuto(mes, ano, func.folga_semanal, feriados)
    const resultado = calcularVTVA({
      diasUteis: diasAuto, diasFeriado: 0,
      diasSabado: ehExcecao ? diasSabado : 0,
      diasDesconto: totalDescontos,
      valorVT, valorVTSabado: ehExcecao ? valorVTSabado : 0, valorVA,
    })

    const payload = {
      competencia_id: compId,
      funcionario_id: func.id,
      dias_feriado: feriados.length,
      dias_sabado: ehExcecao ? diasSabado : 0,
      dias_desconto: totalDescontos,
      valor_vt: valorVT,
      valor_vt_sabado: ehExcecao ? valorVTSabado : 0,
      valor_total: resultado.valorTotal,
    }

    let cfId = cfCarregado.cfId
    if (cfId) {
      await supabase.from('competencia_funcionario').update(payload).eq('id', cfId)
    } else {
      const { data: novoCF } = await supabase.from('competencia_funcionario').insert(payload).select().single()
      cfId = (novoCF as CompetenciaFuncionario)?.id ?? ''
    }

    if (!cfId) { setErro('Erro ao criar registro do funcionário.'); setSalvando(false); return }

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

    setCfCarregado(prev => prev ? { ...prev, cfId, competenciaId: compId } : prev)
    setSalvando(false)
    setSucesso(`Salvo! ${totalDescontos} dia(s) de desconto — ${formatarMoeda(resultado.valorTotal)}`)
    setTimeout(() => setSucesso(null), 4000)
  }

  // ─── Preview ─────────────────────────────────────────────────────────────────

  const previewResultado = cfCarregado && selecionado ? (() => {
    const { func } = selecionado
    const { valorVT, valorVTSabado, diasSabado, feriados, valorVA } = cfCarregado
    const ehExcecao = valorVTSabado > 0
    const totalDesc = descontos.filter(d => !d.isCarryOver).reduce((s, d) => s + d.dias, 0)
    const diasAuto = calcularDiasUteisAuto(mes, ano, func.folga_semanal, feriados)
    return calcularVTVA({
      diasUteis: diasAuto, diasFeriado: 0,
      diasSabado: ehExcecao ? diasSabado : 0,
      diasDesconto: totalDesc,
      valorVT, valorVTSabado: ehExcecao ? valorVTSabado : 0, valorVA,
    })
  })() : null

  // ─── Navegação de período ────────────────────────────────────────────────────

  function mesAnterior() {
    if (mes === 1) { setMes(12); setAno(a => a - 1) }
    else setMes(m => m - 1)
  }

  function mesSeguinte() {
    if (mes === 12) { setMes(1); setAno(a => a + 1) }
    else setMes(m => m + 1)
  }

  // ─── Lista filtrada ──────────────────────────────────────────────────────────

  const listaFiltrada = filtroEmpresaId
    ? todosFuncionarios.filter(f => f.empresa.id === filtroEmpresaId)
    : todosFuncionarios

  // ─── JSX — View Lista ────────────────────────────────────────────────────────

  if (view === 'list') {
    return (
      <LayoutAdmin
        title="Lançamento de Descontos"
        actions={
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={mesAnterior}
              className="p-1.5 rounded-md hover:bg-white hover:shadow-sm transition-all text-gray-600"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="px-3 py-1 text-sm font-semibold text-gray-700 min-w-[130px] text-center">
              {MESES[mes - 1]} {ano}
            </span>
            <button
              onClick={mesSeguinte}
              className="p-1.5 rounded-md hover:bg-white hover:shadow-sm transition-all text-gray-600"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Filtro empresa */}
          <div className="card py-3">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-600 shrink-0">Empresa:</label>
              <select
                value={filtroEmpresaId}
                onChange={e => setFiltroEmpresaId(e.target.value)}
                className="input-field max-w-xs"
              >
                <option value="">Todas as empresas</option>
                {empresas.map(e => (
                  <option key={e.id} value={e.id}>{e.razao_social}</option>
                ))}
              </select>
              <span className="text-xs text-gray-400">{listaFiltrada.length} funcionário(s)</span>
            </div>
          </div>

          {/* Tabela de funcionários */}
          <div className="card p-0 overflow-hidden">
            {loadingLista ? (
              <div className="text-center py-16 text-gray-400 text-sm">Carregando funcionários...</div>
            ) : listaFiltrada.length === 0 ? (
              <div className="text-center py-16 text-gray-400 text-sm">Nenhum funcionário ativo encontrado.</div>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="table-header text-left">Funcionário</th>
                    <th className="table-header text-left">Função</th>
                    <th className="table-header text-left">Empresa</th>
                    <th className="table-header text-center">Descontos ({MESES[mes - 1]}/{ano})</th>
                    <th className="table-header text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {listaFiltrada.map(item => {
                    const count = contadoresDesconto[item.func.id] ?? 0
                    return (
                      <tr key={item.func.id} className="hover:bg-blue-50/40 transition-colors">
                        <td className="table-cell font-medium text-gray-900">{item.func.nome}</td>
                        <td className="table-cell text-gray-500">{item.func.funcao}</td>
                        <td className="table-cell text-gray-500">{item.empresa.razao_social}</td>
                        <td className="table-cell text-center">
                          {count > 0 ? (
                            <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-xs font-medium px-2 py-0.5 rounded-full">
                              {count} desconto{count > 1 ? 's' : ''}
                            </span>
                          ) : (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="table-cell text-right">
                          <button
                            onClick={() => abrirFormulario(item)}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Lançar
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </LayoutAdmin>
    )
  }

  // ─── JSX — View Formulário ───────────────────────────────────────────────────

  return (
    <LayoutAdmin
      title={selecionado ? selecionado.func.nome : 'Lançar Desconto'}
      actions={
        <button onClick={voltar} className="btn-secondary flex items-center gap-2 text-sm">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Voltar à lista
        </button>
      }
    >
      <div className="space-y-5">

        {/* Cabeçalho do funcionário */}
        {selecionado && (
          <div className="card py-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="font-semibold text-gray-900 text-lg">{selecionado.func.nome}</p>
                <p className="text-sm text-gray-500">{selecionado.func.funcao} — {selecionado.empresa.razao_social}</p>
              </div>
              <div className="flex items-center gap-2 bg-blue-50 px-4 py-2 rounded-lg">
                <span className="text-sm font-medium text-blue-700">{MESES[mes - 1]} / {ano}</span>
              </div>
            </div>
          </div>
        )}

        {/* Feedback */}
        {sucesso && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {sucesso}
          </div>
        )}
        {erro && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{erro}</div>
        )}

        {loadingForm ? (
          <div className="card text-center py-16 text-gray-400 text-sm">
            <svg className="w-8 h-8 animate-spin mx-auto mb-3 text-blue-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            Carregando dados...
          </div>
        ) : cfCarregado && (
          <div className="grid md:grid-cols-5 gap-5">

            {/* Coluna esquerda: desconto atual + preview */}
            <div className="md:col-span-2 space-y-4">

              {/* Descontos lançados */}
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-700">Descontos lançados</h3>
                  {descontos.filter(d => !d.isCarryOver).length > 0 && (
                    <span className="text-xs text-gray-500 font-mono">
                      {descontos.filter(d => !d.isCarryOver).reduce((s, d) => s + d.dias, 0)} dia(s)
                    </span>
                  )}
                </div>
                {descontos.length === 0 ? (
                  <p className="text-xs text-gray-400 py-3 text-center">Nenhum desconto neste mês.</p>
                ) : (
                  <div className="space-y-2">
                    {descontos.map((d, i) => (
                      <div
                        key={i}
                        className={`flex items-start justify-between rounded-lg px-3 py-2 gap-2 ${
                          d.isCarryOver ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-medium leading-tight ${d.isCarryOver ? 'text-amber-800' : 'text-gray-800'}`}>
                            {d.tipo_nome}
                            {d.isCarryOver && <span className="ml-1 text-amber-600">(carry-over)</span>}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {d.dias} dia(s)
                            {d.data_inicio && ` · ${d.data_inicio === d.data_fim || !d.data_fim ? fmtData(d.data_inicio) : `${fmtData(d.data_inicio)} → ${fmtData(d.data_fim)}`}`}
                            {d.dias_proximo_mes > 0 && ` · +${d.dias_proximo_mes}d próx.`}
                          </p>
                        </div>
                        {!d.isCarryOver && (
                          <button onClick={() => removerDesconto(i)} className="text-red-400 hover:text-red-600 shrink-0 mt-0.5">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Preview */}
              {previewResultado && (
                <div className="card">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Preview do cálculo</h3>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Dias efetivos</span>
                      <span className="font-mono font-semibold text-blue-700">{previewResultado.diasEfetivos}d</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">VA</span>
                      <span className="text-gray-700">{formatarMoeda(previewResultado.totalVA)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">VT</span>
                      <span className="text-gray-700">{formatarMoeda(previewResultado.totalVT)}</span>
                    </div>
                    {previewResultado.totalVTSabado > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">VT Sáb.</span>
                        <span className="text-gray-700">{formatarMoeda(previewResultado.totalVTSabado)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-gray-100 pt-2 font-semibold">
                      <span className="text-gray-700">Total</span>
                      <span className="text-blue-700">{formatarMoeda(previewResultado.valorTotal)}</span>
                    </div>
                  </div>
                </div>
              )}

              {!cfCarregado.cfId && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  ⚠ Sem registro neste mês — será criado ao salvar.
                </p>
              )}
            </div>

            {/* Coluna direita: formulário */}
            <div className="md:col-span-3 space-y-4">
              <div className="card">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Adicionar Desconto</h3>

                {tiposDesconto.length === 0 ? (
                  <p className="text-xs text-amber-600">Cadastre tipos de desconto em <strong>Tipos de Desconto</strong> primeiro.</p>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="label-field">Tipo de desconto</label>
                      <select value={novoTipoId} onChange={e => setNovoTipoId(e.target.value)} className="input-field">
                        {tiposDesconto.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label-field">Data início</label>
                        <input
                          type="date" value={novaDataInicio}
                          onChange={e => handleDataInicioChange(e.target.value)}
                          className="input-field"
                        />
                      </div>
                      <div>
                        <label className="label-field">Data fim</label>
                        <input
                          type="date" value={novaDataFim}
                          onChange={e => handleDataFimChange(e.target.value)}
                          className="input-field"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="label-field">Dias úteis (seg–sáb) calculados</label>
                      <input
                        type="number" value={novoDias}
                        onChange={e => setNovoDias(Number(e.target.value))}
                        min={1} max={31}
                        className="input-field w-28 text-center"
                      />
                      <p className="text-xs text-gray-400 mt-1">Calculado automaticamente ao preencher as datas. Pode ajustar manualmente.</p>
                    </div>

                    {novoDiasProximo > 0 && (
                      <div className="flex items-start gap-2 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2.5">
                        <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span><strong>{novoDiasProximo} dia(s)</strong> do período caem em {MESES[mes === 12 ? 0 : mes]} e serão aplicados automaticamente no próximo mês.</span>
                      </div>
                    )}

                    <button
                      onClick={adicionarDesconto}
                      disabled={!novoTipoId || novoDias < 1}
                      className="btn-secondary w-full flex items-center justify-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Adicionar à lista
                    </button>
                  </div>
                )}
              </div>

              {/* Botões de ação */}
              <div className="flex gap-3">
                <button
                  onClick={salvar}
                  disabled={salvando}
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                >
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
                      Salvar Descontos
                    </>
                  )}
                </button>
                <button onClick={voltar} className="btn-secondary flex items-center gap-2 px-5">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  Voltar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </LayoutAdmin>
  )
}

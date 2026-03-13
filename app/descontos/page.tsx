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

type DescontoItem = {
  id: string           // DB id (empty = não salvo)
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
  feriados: number
  valorVA: number
  valorVT: number
  valorVTSabado: number
  diasSabado: number
  funcionario: Funcionario
  empresa: Empresa
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  // Listas
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([])
  const [tiposDesconto, setTiposDesconto] = useState<TipoDesconto[]>([])

  // Seleção
  const [empresaId, setEmpresaId] = useState('')
  const [funcionarioId, setFuncionarioId] = useState('')
  const [mes, setMes] = useState(new Date().getMonth() + 1)
  const [ano, setAno] = useState(new Date().getFullYear())

  // Estado
  const [loading, setLoading] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [sucesso, setSucesso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  // Dados carregados
  const [cfCarregado, setCfCarregado] = useState<CFCarregado | null>(null)
  const [descontos, setDescontos] = useState<DescontoItem[]>([])

  // Formulário novo desconto
  const [novoTipoId, setNovoTipoId] = useState('')
  const [novaDataInicio, setNovaDataInicio] = useState('')
  const [novaDataFim, setNovaDataFim] = useState('')
  const [novoDias, setNovoDias] = useState(1)
  const [novoDiasProximo, setNovoDiasProximo] = useState(0)

  // Carga inicial
  useEffect(() => {
    supabase.from('empresas').select('*').order('razao_social').then(({ data }) => setEmpresas(data ?? []))
    supabase.from('tipos_desconto').select('*').order('nome').then(({ data }) => {
      setTiposDesconto(data ?? [])
      if (data && data.length > 0) setNovoTipoId(data[0].id)
    })
  }, [])

  // Carrega funcionários ao trocar empresa
  useEffect(() => {
    if (!empresaId) { setFuncionarios([]); setFuncionarioId(''); setCfCarregado(null); setDescontos([]); return }
    supabase.from('unidades').select('id').eq('empresa_id', empresaId).limit(1).maybeSingle().then(async ({ data: unidade }) => {
      if (!unidade) { setFuncionarios([]); return }
      const { data: funcs } = await supabase
        .from('funcionarios').select('*').eq('unidade_id', unidade.id).eq('ativo', true).order('nome')
      setFuncionarios(funcs ?? [])
      setFuncionarioId('')
      setCfCarregado(null)
      setDescontos([])
    })
  }, [empresaId])

  // ─── Buscar dados do funcionário/mês ────────────────────────────────────────

  async function buscar() {
    if (!empresaId || !funcionarioId) return
    setLoading(true)
    setCfCarregado(null)
    setDescontos([])
    setErro(null)

    const func = funcionarios.find(f => f.id === funcionarioId)
    const emp = empresas.find(e => e.id === empresaId)
    if (!func || !emp) { setLoading(false); return }

    const unidadeId = await getOrCreateDefaultUnidade(empresaId)
    if (!unidadeId) { setErro('Não foi possível encontrar a unidade da empresa.'); setLoading(false); return }

    // Feriados do mês
    const mesStr = String(mes).padStart(2, '0')
    const { data: feriadosRows } = await supabase
      .from('feriados').select('data')
      .gte('data', `${ano}-${mesStr}-01`)
      .lte('data', `${ano}-${mesStr}-31`)
    const feriados = feriadosRows?.length ?? 0

    // Competência
    const { data: comp } = await supabase
      .from('competencias').select('*')
      .eq('unidade_id', unidadeId).eq('mes', mes).eq('ano', ano).maybeSingle()

    // CF
    let cfId = ''
    let competenciaId = ''
    let valorVA = 0
    let valorVT = 0
    let valorVTSabado = 0
    let diasSabado = 0

    if (comp) {
      competenciaId = (comp as Competencia).id
      valorVA = (comp as Competencia).valor_va ?? emp.valor_va ?? 0
      const { data: cf } = await supabase
        .from('competencia_funcionario').select('*')
        .eq('competencia_id', competenciaId).eq('funcionario_id', funcionarioId).maybeSingle()
      if (cf) {
        const cfObj = cf as CompetenciaFuncionario
        cfId = cfObj.id
        valorVT = cfObj.valor_vt ?? func.valor_vt ?? 0
        valorVTSabado = cfObj.valor_vt_sabado ?? func.valor_vt_sabado ?? 0
        diasSabado = cfObj.dias_sabado ?? 0
      } else {
        valorVT = func.valor_vt ?? 0
        valorVTSabado = func.valor_vt_sabado ?? 0
        diasSabado = (valorVTSabado > 0) ? calcularSabadosDoMes(mes, ano) : 0
      }
    } else {
      valorVA = emp.valor_va ?? 0
      valorVT = func.valor_vt ?? 0
      valorVTSabado = func.valor_vt_sabado ?? 0
      diasSabado = (valorVTSabado > 0) ? calcularSabadosDoMes(mes, ano) : 0
    }

    // Descontos existentes
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
        .eq('competencia_id', prevComp.id).eq('funcionario_id', funcionarioId).maybeSingle()
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

    setCfCarregado({ cfId, competenciaId, feriados, valorVA, valorVT, valorVTSabado, diasSabado, funcionario: func, empresa: emp })
    setDescontos(descontosCarregados)
    setLoading(false)
  }

  // ─── Adicionar desconto local ─────────────────────────────────────────────

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
    if (!cfCarregado) return
    setSalvando(true)
    setErro(null)
    setSucesso(null)

    const unidadeId = await getOrCreateDefaultUnidade(empresaId)
    if (!unidadeId) { setErro('Erro ao obter unidade.'); setSalvando(false); return }

    // Garante competência
    let compId = cfCarregado.competenciaId
    if (!compId) {
      const { data: novaComp } = await supabase
        .from('competencias')
        .insert({ unidade_id: unidadeId, mes, ano, dias_uteis: 0, feriados_mes: cfCarregado.feriados, valor_va: cfCarregado.valorVA })
        .select().single()
      if (!novaComp) { setErro('Erro ao criar competência.'); setSalvando(false); return }
      compId = (novaComp as Competencia).id
    }

    // Garante CF
    const descontosReais = descontos.filter(d => !d.isCarryOver)
    const totalDescontos = descontosReais.reduce((s, d) => s + d.dias, 0)
    const { funcionario: func, valorVT, valorVTSabado, diasSabado, feriados, valorVA } = cfCarregado
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
      funcionario_id: funcionarioId,
      dias_feriado: feriados,
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

    // Recria descontos
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

    // Atualiza estado
    setCfCarregado(prev => prev ? { ...prev, cfId, competenciaId: compId } : prev)
    setSalvando(false)
    setSucesso(`Descontos salvos! Total: ${totalDescontos} dia(s) — Valor recalculado: ${formatarMoeda(resultado.valorTotal)}`)
    setTimeout(() => setSucesso(null), 5000)
  }

  // ─── Cálculo de preview ──────────────────────────────────────────────────────

  const previewResultado = cfCarregado ? (() => {
    const { funcionario: func, valorVT, valorVTSabado, diasSabado, feriados, valorVA } = cfCarregado
    const ehExcecao = valorVTSabado > 0
    const descontosReais = descontos.filter(d => !d.isCarryOver)
    const totalDesc = descontosReais.reduce((s, d) => s + d.dias, 0)
    const diasAuto = calcularDiasUteisAuto(mes, ano, func.folga_semanal, feriados)
    return calcularVTVA({
      diasUteis: diasAuto, diasFeriado: 0,
      diasSabado: ehExcecao ? diasSabado : 0,
      diasDesconto: totalDesc,
      valorVT, valorVTSabado: ehExcecao ? valorVTSabado : 0, valorVA,
    })
  })() : null

  // ─── JSX ─────────────────────────────────────────────────────────────────────

  return (
    <LayoutAdmin title="Lançamento de Descontos">
      <div className="space-y-6">

        {/* ── Seleção ── */}
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Selecionar Funcionário e Período</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <label className="label-field">Empresa</label>
              <select value={empresaId} onChange={e => setEmpresaId(e.target.value)} className="input-field">
                <option value="">Selecione uma empresa</option>
                {empresas.map(e => <option key={e.id} value={e.id}>{e.razao_social}</option>)}
              </select>
            </div>
            <div>
              <label className="label-field">Mês</label>
              <select value={mes} onChange={e => setMes(Number(e.target.value))} className="input-field">
                {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="label-field">Ano</label>
              <input type="number" value={ano} onChange={e => setAno(Number(e.target.value))} className="input-field" min={2020} max={2099} />
            </div>
          </div>

          {empresaId && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <label className="label-field">Funcionário</label>
              <div className="flex gap-3">
                <select value={funcionarioId} onChange={e => setFuncionarioId(e.target.value)} className="input-field flex-1">
                  <option value="">Selecione um funcionário</option>
                  {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome} — {f.funcao}</option>)}
                </select>
                <button
                  onClick={buscar}
                  disabled={!funcionarioId || loading}
                  className="btn-primary flex items-center gap-2 px-6"
                >
                  {loading ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  )}
                  Buscar
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Feedback ── */}
        {sucesso && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">{sucesso}</div>
        )}
        {erro && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{erro}</div>
        )}

        {/* ── Painel principal ── */}
        {cfCarregado && (
          <div className="grid md:grid-cols-3 gap-6">

            {/* Coluna esquerda: info + preview */}
            <div className="space-y-4">

              {/* Card do funcionário */}
              <div className="card">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Funcionário</h3>
                <p className="font-semibold text-gray-900">{cfCarregado.funcionario.nome}</p>
                <p className="text-sm text-gray-500">{cfCarregado.funcionario.funcao}</p>
                <p className="text-xs text-gray-400 mt-1">{cfCarregado.empresa.razao_social}</p>
                <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-2 text-xs text-gray-500">
                  <div>
                    <span className="text-gray-400">Folga:</span>{' '}
                    {cfCarregado.funcionario.folga_semanal ?? '—'}
                  </div>
                  <div>
                    <span className="text-gray-400">Feriados:</span>{' '}
                    {cfCarregado.feriados}
                  </div>
                  <div>
                    <span className="text-gray-400">VT/dia:</span>{' '}
                    {formatarMoeda(cfCarregado.valorVT)}
                  </div>
                  {cfCarregado.valorVTSabado > 0 && (
                    <div>
                      <span className="text-gray-400">VT Sáb:</span>{' '}
                      {formatarMoeda(cfCarregado.valorVTSabado)}
                    </div>
                  )}
                  <div>
                    <span className="text-gray-400">VA/dia:</span>{' '}
                    {formatarMoeda(cfCarregado.valorVA)}
                  </div>
                </div>
                {!cfCarregado.cfId && (
                  <p className="text-xs text-amber-600 mt-2">⚠ Sem registro neste mês — será criado ao salvar.</p>
                )}
              </div>

              {/* Preview de cálculo */}
              {previewResultado && (
                <div className="card">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Preview — {MESES[mes - 1]}/{ano}</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Dias efetivos</span>
                      <span className="font-mono font-bold text-blue-700">{previewResultado.diasEfetivos}d</span>
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
            </div>

            {/* Coluna direita: gerenciar descontos */}
            <div className="md:col-span-2 space-y-4">

              {/* Descontos existentes */}
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-700">
                    Descontos — {MESES[mes - 1]}/{ano}
                  </h3>
                  {descontos.filter(d => !d.isCarryOver).length > 0 && (
                    <span className="text-xs text-gray-500">
                      Total: <strong>{descontos.filter(d => !d.isCarryOver).reduce((s, d) => s + d.dias, 0)} dia(s)</strong>
                    </span>
                  )}
                </div>

                {descontos.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center">Nenhum desconto neste mês.</p>
                ) : (
                  <div className="space-y-2">
                    {descontos.map((d, i) => (
                      <div
                        key={i}
                        className={`flex items-center justify-between rounded-lg px-3 py-2.5 ${
                          d.isCarryOver ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-sm font-medium ${d.isCarryOver ? 'text-amber-800' : 'text-gray-800'}`}>
                              {d.tipo_nome}
                            </span>
                            {d.isCarryOver && (
                              <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">carry-over</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="text-xs text-gray-500 font-mono">{d.dias} dia(s)</span>
                            {d.data_inicio && (
                              <span className="text-xs text-blue-500">
                                {d.data_inicio === d.data_fim || !d.data_fim
                                  ? fmtData(d.data_inicio)
                                  : `${fmtData(d.data_inicio)} → ${fmtData(d.data_fim)}`
                                }
                              </span>
                            )}
                            {d.dias_proximo_mes > 0 && (
                              <span className="text-xs text-orange-500">+{d.dias_proximo_mes}d no próx. mês</span>
                            )}
                          </div>
                        </div>
                        {!d.isCarryOver && (
                          <button
                            onClick={() => removerDesconto(i)}
                            className="ml-2 text-red-400 hover:text-red-600 shrink-0"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Formulário: adicionar desconto */}
              <div className="card">
                <h3 className="text-sm font-semibold text-gray-700 mb-1">Adicionar Desconto</h3>
                <p className="text-xs text-gray-400 mb-4">
                  As datas podem ser do mês anterior (para cobrar retroativamente vales pagos antecipadamente).
                  Se o período ultrapassar o fim deste mês, os dias excedentes são registrados automaticamente no próximo.
                </p>

                {tiposDesconto.length === 0 ? (
                  <p className="text-xs text-amber-600">Cadastre tipos de desconto em <strong>Tipos de Desconto</strong> primeiro.</p>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="label-field">Tipo</label>
                      <select value={novoTipoId} onChange={e => setNovoTipoId(e.target.value)} className="input-field">
                        {tiposDesconto.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
                      </select>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
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
                      <div>
                        <label className="label-field">Dias (seg–sáb)</label>
                        <input
                          type="number" value={novoDias}
                          onChange={e => setNovoDias(Number(e.target.value))}
                          min={1} max={31}
                          className="input-field text-center"
                        />
                      </div>
                    </div>

                    {novoDiasProximo > 0 && (
                      <div className="flex items-center gap-2 text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

              {/* Botão salvar */}
              <div className="flex justify-end">
                <button
                  onClick={salvar}
                  disabled={salvando}
                  className="btn-primary px-8 flex items-center gap-2"
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
              </div>
            </div>
          </div>
        )}

        {/* Estado inicial */}
        {!cfCarregado && !loading && (
          <div className="card text-center py-16 text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
            </svg>
            <p className="text-sm">Selecione empresa, funcionário e período, depois clique em <strong>Buscar</strong>.</p>
          </div>
        )}
      </div>
    </LayoutAdmin>
  )
}

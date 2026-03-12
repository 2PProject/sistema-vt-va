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

type DescontoLocal = { id: string; tipo_id: string; tipo_nome: string; dias: number }

type CFLocal = {
  id: string
  competencia_id: string
  funcionario_id: string
  dias_sabado: number
  descontos: DescontoLocal[]
  valor_vt: number
  valor_vt_sabado: number
  funcionario: Funcionario
}

const TODAS = '__todas__'

type ItemResumo = {
  empresaNome: string
  funcionarioNome: string
  funcionarioFuncao: string
  diasEfetivos: number
  totalVA: number
  totalVT: number
  totalVTSabado: number
  valorTotal: number
}

export default function CompetenciasPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [tiposDesconto, setTiposDesconto] = useState<TipoDesconto[]>([])
  const [competencia, setCompetencia] = useState<Competencia | null>(null)
  const [itens, setItens] = useState<CFLocal[]>([])
  const [itensResumo, setItensResumo] = useState<ItemResumo[]>([])
  const [feriadosDoMes, setFeriadosDoMes] = useState(0)
  const [loading, setLoading] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [sucesso, setSucesso] = useState(false)

  const [valorVA, setValorVA] = useState(0)
  const [empresaId, setEmpresaId] = useState<string>('')
  const [mes, setMes] = useState(new Date().getMonth() + 1)
  const [ano, setAno] = useState(new Date().getFullYear())

  const modoTodas = empresaId === TODAS

  // Modal de descontos
  const [modalIdx, setModalIdx] = useState<number | null>(null)
  const [novoTipoId, setNovoTipoId] = useState<string>('')
  const [novoDias, setNovoDias] = useState(1)

  useEffect(() => {
    supabase.from('empresas').select('*').order('razao_social').then(({ data }) => setEmpresas(data ?? []))
    supabase.from('tipos_desconto').select('*').order('nome').then(({ data }) => setTiposDesconto(data ?? []))
  }, [])

  const carregarCompetencia = useCallback(async () => {
    if (!empresaId) return
    setLoading(true)
    setSucesso(false)

    // Modo "Todas" — carrega resumo de todas as empresas
    if (modoTodas) {
      const mesStr = String(mes).padStart(2, '0')
      const { data: feriadosRows } = await supabase
        .from('feriados').select('data')
        .gte('data', `${ano}-${mesStr}-01`)
        .lte('data', `${ano}-${mesStr}-31`)
      const feriados = feriadosRows?.length ?? 0

      const unidadesPorEmpresa = await Promise.all(
        empresas.map(async (emp) => ({
          emp,
          unidadeId: await getOrCreateDefaultUnidade(emp.id),
        }))
      )

      const empresaPorUnidade = new Map<string, Empresa>()
      for (const item of unidadesPorEmpresa) {
        if (item.unidadeId) empresaPorUnidade.set(item.unidadeId, item.emp)
      }

      const unidadeIds = [...empresaPorUnidade.keys()]
      if (unidadeIds.length === 0) {
        setItensResumo([])
        setLoading(false)
        return
      }

      const { data: comps } = await supabase
        .from('competencias')
        .select('*')
        .in('unidade_id', unidadeIds)
        .eq('mes', mes)
        .eq('ano', ano)

      const compsValidas = (comps ?? []) as Competencia[]
      const compPorId = new Map(compsValidas.map(comp => [comp.id, comp]))
      const compIds = compsValidas.map(comp => comp.id)

      if (compIds.length === 0) {
        setItensResumo([])
        setLoading(false)
        return
      }

      const { data: cfs } = await supabase
        .from('competencia_funcionario')
        .select('*, funcionarios(*)')
        .in('competencia_id', compIds)

      const resumo: ItemResumo[] = []
      for (const cf of (cfs ?? []) as Array<CompetenciaFuncionario & { funcionarios: Funcionario }>) {
        const comp = compPorId.get(cf.competencia_id)
        if (!comp) continue
        const emp = empresaPorUnidade.get(comp.unidade_id)
        if (!emp) continue
        const f = cf.funcionarios
        const ehExcecao = (f.valor_vt_sabado ?? 0) > 0
        const diasAuto = calcularDiasUteisAuto(mes, ano, f.folga_semanal, feriados)
        const r = calcularVTVA({
          diasUteis: diasAuto, diasFeriado: 0,
          diasSabado: ehExcecao ? (cf.dias_sabado ?? 0) : 0,
          diasDesconto: cf.dias_desconto,
          valorVT: cf.valor_vt ?? f.valor_vt ?? 0,
          valorVTSabado: ehExcecao ? (cf.valor_vt_sabado ?? f.valor_vt_sabado ?? 0) : 0,
          valorVA: comp.valor_va ?? 0,
        })
        resumo.push({
          empresaNome: emp.razao_social,
          funcionarioNome: f.nome,
          funcionarioFuncao: f.funcao,
          diasEfetivos: r.diasEfetivos,
          totalVA: r.totalVA,
          totalVT: r.totalVT,
          totalVTSabado: r.totalVTSabado,
          valorTotal: r.valorTotal,
        })
      }
      setItensResumo(resumo)
      setLoading(false)
      return
    }

    // Conta feriados do mês via tabela de feriados
    const mesStr = String(mes).padStart(2, '0')
    const { data: feriadosRows } = await supabase
      .from('feriados')
      .select('data')
      .gte('data', `${ano}-${mesStr}-01`)
      .lte('data', `${ano}-${mesStr}-31`)

    setFeriadosDoMes(feriadosRows?.length ?? 0)

    const unidadeId = await getOrCreateDefaultUnidade(empresaId)
    if (!unidadeId) { setLoading(false); return }

    // VA pré-carregado da empresa
    const emp = empresas.find(e => e.id === empresaId)
    if (emp) setValorVA(emp.valor_va ?? 0)

    const { data: compExistente } = await supabase
      .from('competencias')
      .select('*')
      .eq('unidade_id', unidadeId)
      .eq('mes', mes)
      .eq('ano', ano)
      .maybeSingle()

    const comp = compExistente as Competencia | null
    const sabadosDoMes = calcularSabadosDoMes(mes, ano)

    if (comp) {
      setCompetencia(comp)
      setValorVA(comp.valor_va ?? emp?.valor_va ?? 0)
    } else {
      setCompetencia(null)
    }

    const { data: funcs } = await supabase
      .from('funcionarios')
      .select('*')
      .eq('unidade_id', unidadeId)
      .eq('ativo', true)
      .order('nome')

    if (funcs && comp) {
      const { data: cfExistente } = await supabase
        .from('competencia_funcionario')
        .select('*')
        .eq('competencia_id', comp.id)

      const cfMap = new Map(
        (cfExistente ?? []).map((cf: CompetenciaFuncionario) => [cf.funcionario_id, cf])
      )

      // Carrega descontos de todos os CF
      const cfIds = (cfExistente ?? []).map((cf: CompetenciaFuncionario) => cf.id)
      let descontosMap = new Map<string, DescontoLocal[]>()
      if (cfIds.length > 0) {
        const { data: descontosRows } = await supabase
          .from('competencia_funcionario_desconto')
          .select('*, tipos_desconto(id, nome)')
          .in('competencia_funcionario_id', cfIds)

        for (const d of descontosRows ?? []) {
          const arr = descontosMap.get(d.competencia_funcionario_id) ?? []
          arr.push({
            id: d.id,
            tipo_id: d.tipo_desconto_id,
            tipo_nome: (d.tipos_desconto as TipoDesconto)?.nome ?? '',
            dias: d.dias,
          })
          descontosMap.set(d.competencia_funcionario_id, arr)
        }
      }

      setItens(
        funcs.map((f: Funcionario) => {
          const cf = cfMap.get(f.id)
          // Perfil do funcionário é a fonte da verdade para sábado
          const ehExcecaoPerfil = (f.valor_vt_sabado ?? 0) > 0
          return {
            id: cf?.id ?? '',
            competencia_id: comp.id,
            funcionario_id: f.id,
            dias_sabado: ehExcecaoPerfil ? (cf?.dias_sabado ?? sabadosDoMes) : 0,
            descontos: cf ? (descontosMap.get(cf.id) ?? []) : [],
            valor_vt: cf?.valor_vt ?? f.valor_vt ?? 0,
            valor_vt_sabado: f.valor_vt_sabado ?? 0,
            funcionario: f,
          }
        })
      )
    } else if (funcs) {
      setItens(
        funcs.map((f: Funcionario) => ({
          id: '',
          competencia_id: '',
          funcionario_id: f.id,
          dias_sabado: (f.valor_vt_sabado ?? 0) > 0 ? sabadosDoMes : 0,
          descontos: [],
          valor_vt: f.valor_vt ?? 0,
          valor_vt_sabado: f.valor_vt_sabado ?? 0,
          funcionario: f,
        }))
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

  // ─── Modal de descontos ────────────────────────────────────────────────────

  function abrirModal(idx: number) {
    setModalIdx(idx)
    setNovoTipoId(tiposDesconto[0]?.id ?? '')
    setNovoDias(1)
  }

  function adicionarDesconto() {
    if (!novoTipoId || novoDias < 1 || modalIdx === null) return
    const tipo = tiposDesconto.find(t => t.id === novoTipoId)
    if (!tipo) return
    setItens(prev => {
      const n = [...prev]
      n[modalIdx] = {
        ...n[modalIdx],
        descontos: [...n[modalIdx].descontos, { id: '', tipo_id: novoTipoId, tipo_nome: tipo.nome, dias: novoDias }],
      }
      return n
    })
    setNovoDias(1)
    if (tiposDesconto.length > 0) setNovoTipoId(tiposDesconto[0].id)
  }

  function removerDesconto(itemIdx: number, desIdx: number) {
    setItens(prev => {
      const n = [...prev]
      n[itemIdx] = { ...n[itemIdx], descontos: n[itemIdx].descontos.filter((_, i) => i !== desIdx) }
      return n
    })
  }

  // ─── Salvar ────────────────────────────────────────────────────────────────

  async function salvar() {
    if (!empresaId) return
    setSalvando(true)
    setSucesso(false)

    const unidadeId = await getOrCreateDefaultUnidade(empresaId)
    if (!unidadeId) { setSalvando(false); return }

    let compId = competencia?.id ?? ''
    if (!competencia) {
      const { data: novaComp } = await supabase
        .from('competencias')
        .insert({ unidade_id: unidadeId, mes, ano, dias_uteis: 0, feriados_mes: feriadosDoMes, valor_va: valorVA })
        .select()
        .single()
      compId = (novaComp as Competencia)?.id ?? ''
      setCompetencia(novaComp as Competencia)
    } else {
      await supabase.from('competencias').update({ feriados_mes: feriadosDoMes, valor_va: valorVA }).eq('id', competencia.id)
    }

    for (const item of itens) {
      const ehExcecao = (item.funcionario.valor_vt_sabado ?? 0) > 0
      const diasSabadoSalvar = ehExcecao ? item.dias_sabado : 0
      const valorVtSabadoSalvar = ehExcecao ? item.valor_vt_sabado : 0
      const totalDescontos = item.descontos.reduce((s, d) => s + d.dias, 0)
      const diasUteisAuto = calcularDiasUteisAuto(mes, ano, item.funcionario.folga_semanal, feriadosDoMes)
      const resultado = calcularVTVA({
        diasUteis: diasUteisAuto,
        diasFeriado: 0,
        diasSabado: diasSabadoSalvar,
        diasDesconto: totalDescontos,
        valorVT: item.valor_vt,
        valorVTSabado: valorVtSabadoSalvar,
        valorVA,
      })

      const payload = {
        competencia_id: compId,
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
        // Recria descontos: deleta antigos, insere novos
        await supabase.from('competencia_funcionario_desconto').delete().eq('competencia_funcionario_id', cfId)
        for (const d of item.descontos) {
          await supabase.from('competencia_funcionario_desconto').insert({
            competencia_funcionario_id: cfId,
            tipo_desconto_id: d.tipo_id,
            dias: d.dias,
          })
        }
      }
    }

    setSalvando(false)
    setSucesso(true)
    setTimeout(() => setSucesso(false), 3000)
    carregarCompetencia()
  }

  const totalGeral = itens.reduce((sum, item) => {
    const ehExcecao = (item.funcionario.valor_vt_sabado ?? 0) > 0
    const totalDesc = item.descontos.reduce((s, d) => s + d.dias, 0)
    const diasAuto = calcularDiasUteisAuto(mes, ano, item.funcionario.folga_semanal, feriadosDoMes)
    const r = calcularVTVA({ diasUteis: diasAuto, diasFeriado: 0, diasSabado: ehExcecao ? item.dias_sabado : 0, diasDesconto: totalDesc, valorVT: item.valor_vt, valorVTSabado: ehExcecao ? item.valor_vt_sabado : 0, valorVA })
    return sum + r.valorTotal
  }, 0)

  const modalItem = modalIdx !== null ? itens[modalIdx] : null

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
                    <div key={di} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                      <div>
                        <span className="text-sm font-medium text-gray-800">{d.tipo_nome}</span>
                        <span className="ml-2 text-xs text-gray-500">{d.dias} dia(s)</span>
                      </div>
                      <button onClick={() => removerDesconto(modalIdx, di)} className="text-red-500 hover:text-red-700">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  <div className="text-right text-sm font-semibold text-gray-700 pt-1">
                    Total: {modalItem.descontos.reduce((s, d) => s + d.dias, 0)} dia(s) descontados
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-400 mb-4">Nenhum desconto lançado.</p>
              )}

              {/* Adicionar novo desconto */}
              {tiposDesconto.length > 0 ? (
                <div className="border-t border-gray-100 pt-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Adicionar desconto</p>
                  <div className="flex gap-2">
                    <select
                      value={novoTipoId}
                      onChange={(e) => setNovoTipoId(e.target.value)}
                      className="input-field flex-1 text-sm"
                    >
                      {tiposDesconto.map(t => (
                        <option key={t.id} value={t.id}>{t.nome}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      value={novoDias}
                      onChange={(e) => setNovoDias(Number(e.target.value))}
                      min={1} max={31}
                      className="w-20 border border-gray-300 rounded-lg px-2 py-2 text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button onClick={adicionarDesconto} className="btn-primary px-3 py-2 text-sm">
                      + Adicionar
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">dias</p>
                </div>
              ) : (
                <p className="text-xs text-amber-600 mt-2">
                  Cadastre tipos de desconto primeiro em <strong>Tipos de Desconto</strong>.
                </p>
              )}

              <button onClick={() => setModalIdx(null)} className="btn-primary w-full mt-4">
                Confirmar
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
                <option value="">Selecione uma empresa</option>
                <option value={TODAS}>— Todas as empresas (resumo) —</option>
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
                  type="number"
                  value={valorVA}
                  onChange={(e) => setValorVA(Number(e.target.value))}
                  min={0} step={0.01}
                  className="input-field w-36"
                  placeholder="0,00"
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
            Competência salva com sucesso!
          </div>
        )}

        {/* ── Tabela resumo (Todas as empresas) ── */}
        {modoTodas && empresaId && (
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-700">Resumo — {MESES[mes - 1]}/{ano} — Todas as empresas</h2>
              {itensResumo.length > 0 && (
                <div className="text-sm font-semibold text-gray-700">
                  Total: <span className="text-blue-600">{formatarMoeda(itensResumo.reduce((s, i) => s + i.valorTotal, 0))}</span>
                </div>
              )}
            </div>
            {loading ? (
              <div className="text-center py-12 text-gray-400 text-sm">Carregando...</div>
            ) : itensResumo.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">Nenhuma competência encontrada para este período.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="table-header text-left">Empresa</th>
                      <th className="table-header text-left">Funcionário</th>
                      <th className="table-header text-right bg-blue-50 text-blue-700">Dias Ef.</th>
                      <th className="table-header text-right">VA</th>
                      <th className="table-header text-right">VT</th>
                      <th className="table-header text-right">VT Sáb.</th>
                      <th className="table-header text-right font-bold">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {itensResumo.map((item, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="table-cell text-xs text-gray-500">{item.empresaNome}</td>
                        <td className="table-cell">
                          <div className="font-medium text-gray-900">{item.funcionarioNome}</div>
                          <div className="text-xs text-gray-400">{item.funcionarioFuncao}</div>
                        </td>
                        <td className="table-cell text-right bg-blue-50 font-bold text-blue-700 text-sm">{item.diasEfetivos}d</td>
                        <td className="table-cell text-right text-xs text-gray-500">{formatarMoeda(item.totalVA)}</td>
                        <td className="table-cell text-right text-xs text-gray-500">{formatarMoeda(item.totalVT)}</td>
                        <td className="table-cell text-right text-xs text-gray-500">{item.totalVTSabado > 0 ? formatarMoeda(item.totalVTSabado) : <span className="text-gray-300">—</span>}</td>
                        <td className="table-cell text-right font-semibold text-blue-700">{formatarMoeda(item.valorTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 bg-gray-50">
                      <td colSpan={6} className="table-cell text-right text-sm font-semibold text-gray-600">Total geral:</td>
                      <td className="table-cell text-right font-bold text-blue-700">{formatarMoeda(itensResumo.reduce((s, i) => s + i.valorTotal, 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <p className="text-xs text-gray-400 mt-3">Para editar uma competência, selecione a empresa específica.</p>
          </div>
        )}

        {/* ── Tabela edição (empresa específica) ── */}
        {!modoTodas && empresaId && (
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-700">
                Funcionários — {MESES[mes - 1]}/{ano}
              </h2>
              {itens.length > 0 && (
                <div className="text-sm font-semibold text-gray-700">
                  Total: <span className="text-blue-600">{formatarMoeda(totalGeral)}</span>
                </div>
              )}
            </div>

            {loading ? (
              <div className="text-center py-12 text-gray-400 text-sm">Carregando...</div>
            ) : itens.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">Nenhum funcionário ativo nesta empresa.</div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="table-header text-left min-w-[160px]">Funcionário</th>
                        <th className="table-header text-left min-w-[100px]">Folga</th>
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
                        const ehExcecao = (item.funcionario.valor_vt_sabado ?? 0) > 0
                        const diasSabadoEfetivo = ehExcecao ? item.dias_sabado : 0
                        const valorVtSabadoEfetivo = ehExcecao ? item.valor_vt_sabado : 0
                        const totalDesc = item.descontos.reduce((s, d) => s + d.dias, 0)
                        const diasAuto = calcularDiasUteisAuto(mes, ano, item.funcionario.folga_semanal, feriadosDoMes)
                        const r = calcularVTVA({
                          diasUteis: diasAuto,
                          diasFeriado: 0,
                          diasSabado: diasSabadoEfetivo,
                          diasDesconto: totalDesc,
                          valorVT: item.valor_vt,
                          valorVTSabado: valorVtSabadoEfetivo,
                          valorVA,
                        })
                        return (
                          <tr key={item.funcionario_id} className="hover:bg-gray-50">
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
                              <input type="number" value={item.valor_vt} onChange={(e) => atualizarItem(idx, 'valor_vt', Number(e.target.value))} className="w-20 border border-gray-300 rounded px-2 py-1 text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" min={0} step={0.01} />
                            </td>
                            <td className="table-cell text-center">
                              {ehExcecao
                                ? <input type="number" value={item.valor_vt_sabado} onChange={(e) => atualizarItem(idx, 'valor_vt_sabado', Number(e.target.value))} className="w-20 border border-blue-300 rounded px-2 py-1 text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" min={0} step={0.01} />
                                : <span className="text-gray-300 text-xs">—</span>
                              }
                            </td>
                            <td className="table-cell text-center">
                              {ehExcecao
                                ? <input type="number" value={item.dias_sabado} onChange={(e) => atualizarItem(idx, 'dias_sabado', Number(e.target.value))} className="w-16 border border-blue-300 rounded px-2 py-1 text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" min={0} max={5} />
                                : <span className="text-gray-300 text-xs">—</span>
                              }
                            </td>
                            <td className="table-cell text-center">
                              <button
                                onClick={() => abrirModal(idx)}
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
                                  totalDesc > 0
                                    ? 'bg-red-50 text-red-700 hover:bg-red-100'
                                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                }`}
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                {totalDesc > 0 ? `${totalDesc}d` : 'Adicionar'}
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
                        Salvar Competência
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

'use client'

import { useEffect, useState, useCallback } from 'react'
import LayoutAdmin from '../../components/LayoutAdmin'
import {
  supabase,
  Competencia,
  CompetenciaFuncionario,
  Funcionario,
  Empresa,
  getOrCreateDefaultUnidade,
} from '../../lib/supabase'
import { calcularVTVA, calcularDiasUteisAuto, formatarMoeda, MESES } from '../../utils/calculoVT'

type CFComFunc = CompetenciaFuncionario & { funcionarios: Funcionario }

type RegistroCompleto = CFComFunc & {
  competenciaObj: Competencia
  empresaObj: Empresa
  feriadosDatas: string[]
  descontosRecibo: Array<{ tipo_nome: string; dias: number; data_inicio: string | null; data_fim: string | null }>
}

const TODAS = '__todas__'

export default function RecibosPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [registros, setRegistros] = useState<RegistroCompleto[]>([])
  const [loading, setLoading] = useState(false)
  const [gerando, setGerando] = useState<string | null>(null)

  const [empresaId, setEmpresaId] = useState<string>(TODAS)
  const [mes, setMes] = useState(new Date().getMonth() + 1)
  const [ano, setAno] = useState(new Date().getFullYear())

  useEffect(() => {
    supabase.from('empresas').select('*').order('razao_social').then(({ data }) => {
      setEmpresas(data ?? [])
    })
  }, [])

  const buscarDados = useCallback(async () => {
    if (!empresaId) return
    setLoading(true)
    setRegistros([])

    // Consulta feriados diretamente da tabela para garantir valor atualizado
    const mesStr = String(mes).padStart(2, '0')
    const ultimoDia = new Date(ano, mes, 0).getDate()
    const { data: feriadosRows } = await supabase
      .from('feriados').select('data')
      .gte('data', `${ano}-${mesStr}-01`)
      .lte('data', `${ano}-${mesStr}-${String(ultimoDia).padStart(2, '0')}`)
    const feriadosDatas: string[] = (feriadosRows ?? []).map(f => f.data as string)
    const empresasParaBuscar: Empresa[] = empresaId === TODAS
      ? empresas
      : empresas.filter(e => e.id === empresaId)

    const results = await Promise.all(empresasParaBuscar.map(async (emp) => {
      const unidadeId = await getOrCreateDefaultUnidade(emp.id)
      if (!unidadeId) return []

      const { data: comp } = await supabase
        .from('competencias')
        .select('*')
        .eq('unidade_id', unidadeId)
        .eq('mes', mes)
        .eq('ano', ano)
        .maybeSingle()

      if (!comp) return []

      const { data: cfs } = await supabase
        .from('competencia_funcionario')
        .select('*, funcionarios(*)')
        .eq('competencia_id', comp.id)

      const cfList = (cfs as CFComFunc[]) ?? []

      // Carrega descontos de todos os CFs de uma vez
      const cfIds = cfList.map(cf => cf.id)
      let descontosMap = new Map<string, Array<{ tipo_nome: string; dias: number; data_inicio: string | null; data_fim: string | null }>>()
      if (cfIds.length > 0) {
        const { data: descontosRows } = await supabase
          .from('competencia_funcionario_desconto')
          .select('*, tipos_desconto(id, nome)')
          .in('competencia_funcionario_id', cfIds)
        for (const d of descontosRows ?? []) {
          const arr = descontosMap.get(d.competencia_funcionario_id) ?? []
          arr.push({
            tipo_nome: (d.tipos_desconto as { nome: string } | null)?.nome ?? '',
            dias: d.dias,
            data_inicio: d.data_inicio ?? null,
            data_fim: d.data_fim ?? null,
          })
          descontosMap.set(d.competencia_funcionario_id, arr)
        }
      }

      return cfList.map(cf => ({ ...cf, competenciaObj: comp as Competencia, empresaObj: emp, feriadosDatas, descontosRecibo: descontosMap.get(cf.id) ?? [] }))
    }))

    setRegistros(results.flat())
    setLoading(false)
  }, [empresaId, mes, ano, empresas])

  useEffect(() => {
    if (empresaId) buscarDados()
  }, [empresaId, mes, ano, buscarDados])

  async function gerarPDF(reg: RegistroCompleto) {
    setGerando(reg.funcionario_id)
    try {
      const { gerarReciboPDF } = await import('../../services/gerarReciboPDF')
      const valorVTSabadoBase = reg.valor_vt_sabado ?? reg.funcionarios?.valor_vt_sabado ?? 0
      const ehExcecao = valorVTSabadoBase > 0
      const valorVT = reg.valor_vt ?? reg.funcionarios?.valor_vt ?? 0
      const valorVTSabado = ehExcecao ? valorVTSabadoBase : 0
      const diasSabado = ehExcecao ? (reg.dias_sabado ?? 0) : 0
      const valorVA = reg.competenciaObj.valor_va ?? 0
      const diasUteisAuto = calcularDiasUteisAuto(mes, ano, reg.funcionarios?.folga_semanal, reg.feriadosDatas)

      const resultado = calcularVTVA({
        diasUteis: diasUteisAuto,
        diasFeriado: 0,
        diasSabado,
        diasDesconto: reg.dias_desconto,
        valorVT,
        valorVTSabado,
        valorVA,
      })

      await gerarReciboPDF({
        razaoSocial: reg.empresaObj.razao_social,
        cnpj: reg.empresaObj.cnpj ?? '',
        nomeFuncionario: reg.funcionarios.nome,
        funcao: reg.funcionarios.funcao,
        ctps: reg.funcionarios.ctps ?? '',
        serie: reg.funcionarios.serie ?? '',
        mes,
        ano,
        diasUteis: diasUteisAuto,
        diasEfetivos: resultado.diasEfetivos,
        diasSabado,
        valorVT,
        valorVTSabado,
        valorVA,
        resultado,
        descontos: reg.descontosRecibo,
      })
    } catch (err) {
      console.error('Erro ao gerar PDF:', err)
      alert('Erro ao gerar PDF. Tente novamente.')
    } finally {
      setGerando(null)
    }
  }

  async function gerarTodosPDFs() {
    if (registros.length === 0) return
    setGerando('__todos__')
    try {
      const { gerarMultiplosPDFs } = await import('../../services/gerarReciboPDF')
      const dadosList = registros.map(reg => {
        const vtSabadoBase = reg.valor_vt_sabado ?? reg.funcionarios?.valor_vt_sabado ?? 0
        const ehExcecao = vtSabadoBase > 0
        const valorVT = reg.valor_vt ?? reg.funcionarios?.valor_vt ?? 0
        const valorVTSabado = ehExcecao ? vtSabadoBase : 0
        const diasSabado = ehExcecao ? (reg.dias_sabado ?? 0) : 0
        const valorVA = reg.competenciaObj.valor_va ?? 0
        const diasUteisAuto = calcularDiasUteisAuto(mes, ano, reg.funcionarios?.folga_semanal, reg.feriadosDatas)
        const resultado = calcularVTVA({
          diasUteis: diasUteisAuto, diasFeriado: 0, diasSabado,
          diasDesconto: reg.dias_desconto,
          valorVT, valorVTSabado, valorVA,
        })
        return {
          razaoSocial: reg.empresaObj.razao_social,
          cnpj: reg.empresaObj.cnpj ?? '',
          nomeFuncionario: reg.funcionarios.nome,
          funcao: reg.funcionarios.funcao,
          ctps: reg.funcionarios.ctps ?? '',
          serie: reg.funcionarios.serie ?? '',
          mes, ano,
          diasUteis: diasUteisAuto,
          diasEfetivos: resultado.diasEfetivos,
          diasSabado, valorVT, valorVTSabado, valorVA,
          resultado,
          descontos: reg.descontosRecibo,
        }
      })
      await gerarMultiplosPDFs(dadosList)
    } catch (err) {
      console.error('Erro ao gerar PDFs:', err)
      alert('Erro ao gerar PDFs. Tente novamente.')
    } finally {
      setGerando(null)
    }
  }

  async function gerarXLSX() {
    if (registros.length === 0) return
    setGerando('__xlsx__')
    try {
      const { utils, writeFile } = await import('xlsx')
      const dados = registros.map(reg => {
        const vtSabadoBase = reg.valor_vt_sabado ?? reg.funcionarios?.valor_vt_sabado ?? 0
        const ehExcecao = vtSabadoBase > 0
        const diasUteisAuto = calcularDiasUteisAuto(mes, ano, reg.funcionarios?.folga_semanal, reg.feriadosDatas)
        const r = calcularVTVA({
          diasUteis: diasUteisAuto, diasFeriado: 0,
          diasSabado: ehExcecao ? (reg.dias_sabado ?? 0) : 0,
          diasDesconto: reg.dias_desconto,
          valorVT: reg.valor_vt ?? reg.funcionarios?.valor_vt ?? 0,
          valorVTSabado: ehExcecao ? vtSabadoBase : 0,
          valorVA: reg.competenciaObj.valor_va ?? 0,
        })
        return {
          'Empresa': reg.empresaObj.razao_social,
          'Funcionário': reg.funcionarios.nome,
          'Função': reg.funcionarios.funcao,
          'Dias Efetivos': r.diasEfetivos,
          'VA (R$)': r.totalVA,
          'VT (R$)': r.totalVT,
          'VT Sábado (R$)': r.totalVTSabado,
          'Total (R$)': r.valorTotal,
        }
      })
      const ws = utils.json_to_sheet(dados)
      const wb = utils.book_new()
      utils.book_append_sheet(wb, ws, `${MESES[mes - 1]} ${ano}`)
      writeFile(wb, `recibos_${mes}_${ano}.xlsx`)
    } catch (err) {
      console.error('Erro ao gerar XLSX:', err)
    } finally {
      setGerando(null)
    }
  }

  const totalGeral = registros.reduce((sum, reg) => {
    const vtSabadoBase = reg.valor_vt_sabado ?? reg.funcionarios?.valor_vt_sabado ?? 0
    const ehExcecao = vtSabadoBase > 0
    const diasUteisAuto = calcularDiasUteisAuto(mes, ano, reg.funcionarios?.folga_semanal, reg.feriadosDatas)
    const r = calcularVTVA({
      diasUteis: diasUteisAuto,
      diasFeriado: 0,
      diasSabado: ehExcecao ? (reg.dias_sabado ?? 0) : 0,
      diasDesconto: reg.dias_desconto,
      valorVT: reg.valor_vt ?? reg.funcionarios?.valor_vt ?? 0,
      valorVTSabado: ehExcecao ? vtSabadoBase : 0,
      valorVA: reg.competenciaObj.valor_va ?? 0,
    })
    return sum + r.valorTotal
  }, 0)

  const modoTodas = empresaId === TODAS

  return (
    <LayoutAdmin title="Recibos PDF">
      <div className="space-y-6">
        {/* Seletor */}
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
        </div>

        {/* Resultados */}
        {empresaId && (
          <div className="card">
            {loading ? (
              <div className="text-center py-12 text-gray-400 text-sm">Buscando registros...</div>
            ) : registros.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                <svg className="w-10 h-10 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Nenhuma competência encontrada para este período.
                <br />
                <span className="text-xs">Cadastre as competências primeiro na página de Competências.</span>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h2 className="text-base font-semibold text-gray-800">
                      {MESES[mes - 1]}/{ano} — {registros.length} funcionário(s)
                      {modoTodas && <span className="ml-2 text-xs text-gray-400 font-normal">todas as empresas</span>}
                    </h2>
                    <p className="text-sm text-gray-500 mt-0.5">
                      Total geral: <span className="font-semibold text-blue-600">{formatarMoeda(totalGeral)}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                  <button onClick={gerarXLSX} className="btn-secondary flex items-center gap-2 text-sm" disabled={gerando !== null}>
                    {gerando === '__xlsx__' ? (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M10 3v18M14 3v18M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
                      </svg>
                    )}
                    {gerando === '__xlsx__' ? 'Gerando...' : 'Exportar XLSX'}
                  </button>
                  <button onClick={gerarTodosPDFs} className="btn-primary flex items-center gap-2 text-sm" disabled={gerando !== null}>
                    {gerando === '__todos__' && (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                    )}
                    {gerando !== '__todos__' && (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    )}
                    {gerando === '__todos__' ? 'Gerando...' : 'Gerar Todos os PDFs'}
                  </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        {modoTodas && <th className="table-header text-left">Empresa</th>}
                        <th className="table-header">Funcionário</th>
                        <th className="table-header text-center">Dias Ef.</th>
                        <th className="table-header text-right">VA</th>
                        <th className="table-header text-right">VT</th>
                        <th className="table-header text-right">VT Sáb.</th>
                        <th className="table-header text-right">Total</th>
                        <th className="table-header text-right">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {registros.map((reg) => {
                        const vtSabadoBase = reg.valor_vt_sabado ?? reg.funcionarios?.valor_vt_sabado ?? 0
                        const ehExcecao = vtSabadoBase > 0
                        const diasUteisAuto = calcularDiasUteisAuto(mes, ano, reg.funcionarios?.folga_semanal, reg.feriadosDatas)
                        const r = calcularVTVA({
                          diasUteis: diasUteisAuto,
                          diasFeriado: 0,
                          diasSabado: ehExcecao ? (reg.dias_sabado ?? 0) : 0,
                          diasDesconto: reg.dias_desconto,
                          valorVT: reg.valor_vt ?? reg.funcionarios?.valor_vt ?? 0,
                          valorVTSabado: ehExcecao ? vtSabadoBase : 0,
                          valorVA: reg.competenciaObj.valor_va ?? 0,
                        })
                        return (
                          <tr key={`${reg.empresaObj.id}-${reg.funcionario_id}`} className="hover:bg-gray-50 transition-colors">
                            {modoTodas && (
                              <td className="table-cell text-xs text-gray-500">{reg.empresaObj.razao_social}</td>
                            )}
                            <td className="table-cell">
                              <div className="font-medium text-gray-900">{reg.funcionarios.nome}</div>
                              <div className="text-xs text-gray-400">{reg.funcionarios.funcao}</div>
                            </td>
                            <td className="table-cell text-center font-mono text-sm">{r.diasEfetivos}</td>
                            <td className="table-cell text-right text-sm">{formatarMoeda(r.totalVA)}</td>
                            <td className="table-cell text-right text-sm">{formatarMoeda(r.totalVT)}</td>
                            <td className="table-cell text-right text-sm">{r.totalVTSabado > 0 ? formatarMoeda(r.totalVTSabado) : <span className="text-gray-300">—</span>}</td>
                            <td className="table-cell text-right font-semibold text-blue-700">{formatarMoeda(r.valorTotal)}</td>
                            <td className="table-cell text-right">
                              <button
                                onClick={() => gerarPDF(reg)}
                                disabled={gerando === reg.funcionario_id}
                                className="inline-flex items-center gap-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                              >
                                {gerando === reg.funcionario_id ? (
                                  <>
                                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                                    </svg>
                                    Gerando...
                                  </>
                                ) : (
                                  <>
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    PDF
                                  </>
                                )}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-200 bg-gray-50">
                        <td colSpan={modoTodas ? 6 : 5} className="table-cell text-right text-sm font-semibold text-gray-600">
                          Total geral:
                        </td>
                        <td className="table-cell text-right font-bold text-blue-700">{formatarMoeda(totalGeral)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {!empresaId && (
          <div className="card text-center py-16 text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm">Selecione uma empresa (ou todas) e o período para visualizar e gerar recibos.</p>
          </div>
        )}
      </div>
    </LayoutAdmin>
  )
}

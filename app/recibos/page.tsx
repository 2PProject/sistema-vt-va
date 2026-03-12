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
}

type ResumoRecibo = {
  diasUteis: number
  diasEfetivos: number
  diasVTUteis: number
  diasSabado: number
  totalVA: number
  totalVT: number
  totalVTSabado: number
  valorTotal: number
  valorVT: number
  valorVTSabado: number
  valorVA: number
}

const TODAS = '__todas__'

export default function RecibosPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [registros, setRegistros] = useState<RegistroCompleto[]>([])
  const [loading, setLoading] = useState(false)
  const [gerando, setGerando] = useState<string | null>(null)

  const [empresaId, setEmpresaId] = useState<string>('')
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

    const empresasParaBuscar: Empresa[] = empresaId === TODAS ? empresas : empresas.filter(e => e.id === empresaId)

    const porEmpresa = await Promise.all(
      empresasParaBuscar.map(async (emp): Promise<RegistroCompleto[]> => {
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

        return ((cfs as CFComFunc[]) ?? []).map((cf) => ({ ...cf, competenciaObj: comp as Competencia, empresaObj: emp }))
      })
    )

    const todos = porEmpresa.flat()

    setRegistros(todos)
    setLoading(false)
  }, [empresaId, mes, ano, empresas])

  useEffect(() => {
    if (empresaId) buscarDados()
  }, [empresaId, mes, ano, buscarDados])

  const resumirRecibo = useCallback((reg: RegistroCompleto): ResumoRecibo => {
    const ehExcecao = (reg.funcionarios?.valor_vt_sabado ?? 0) > 0
    const valorVT = reg.valor_vt ?? reg.funcionarios?.valor_vt ?? 0
    const valorVTSabado = ehExcecao ? (reg.valor_vt_sabado ?? reg.funcionarios?.valor_vt_sabado ?? 0) : 0
    const diasSabado = ehExcecao ? (reg.dias_sabado ?? 0) : 0
    const valorVA = reg.competenciaObj.valor_va ?? 0
    const diasUteis = calcularDiasUteisAuto(mes, ano, reg.funcionarios?.folga_semanal, reg.competenciaObj.feriados_mes ?? 0)

    const base = calcularVTVA({
      diasUteis,
      diasFeriado: 0,
      diasSabado,
      diasDesconto: reg.dias_desconto,
      valorVT,
      valorVTSabado,
      valorVA,
    })

    const diasVTUteis = ehExcecao ? Math.max(0, base.diasEfetivos - diasSabado) : base.diasEfetivos
    const totalVT = diasVTUteis * valorVT
    const valorTotal = base.totalVA + totalVT + base.totalVTSabado

    return {
      diasUteis,
      diasEfetivos: base.diasEfetivos,
      diasVTUteis,
      diasSabado,
      totalVA: base.totalVA,
      totalVT,
      totalVTSabado: base.totalVTSabado,
      valorTotal,
      valorVT,
      valorVTSabado,
      valorVA,
    }
  }, [mes, ano])

  async function gerarPDF(reg: RegistroCompleto) {
    setGerando(reg.funcionario_id)
    try {
      const { gerarReciboPDF } = await import('../../services/gerarReciboPDF')
      const resumo = resumirRecibo(reg)

      await gerarReciboPDF({
        razaoSocial: reg.empresaObj.razao_social,
        cnpj: reg.empresaObj.cnpj ?? '',
        nomeFuncionario: reg.funcionarios.nome,
        funcao: reg.funcionarios.funcao,
        ctps: reg.funcionarios.ctps ?? '',
        serie: reg.funcionarios.serie ?? '',
        mes,
        ano,
        diasUteis: resumo.diasUteis,
        diasEfetivos: resumo.diasEfetivos,
        diasVTUteis: resumo.diasVTUteis,
        diasSabado: resumo.diasSabado,
        valorVT: resumo.valorVT,
        valorVTSabado: resumo.valorVTSabado,
        valorVA: resumo.valorVA,
        resultado: {
          diasEfetivos: resumo.diasEfetivos,
          totalVA: resumo.totalVA,
          totalVT: resumo.totalVT,
          totalVTSabado: resumo.totalVTSabado,
          valorTotal: resumo.valorTotal,
        },
      })
    } catch (err) {
      console.error('Erro ao gerar PDF:', err)
      alert('Erro ao gerar PDF. Tente novamente.')
    } finally {
      setGerando(null)
    }
  }

  async function gerarTodosPDFs() {
    for (const reg of registros) {
      await gerarPDF(reg)
    }
  }

  const totalGeral = registros.reduce((sum, reg) => sum + resumirRecibo(reg).valorTotal, 0)

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
                <option value="">Selecione uma empresa</option>
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
                  <button onClick={gerarTodosPDFs} className="btn-primary flex items-center gap-2 text-sm" disabled={gerando !== null}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Gerar Todos os PDFs
                  </button>
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
                        const r = resumirRecibo(reg)
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

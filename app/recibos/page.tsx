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
import { calcularVTVA, formatarMoeda, MESES } from '../../utils/calculoVT'

type CFComFunc = CompetenciaFuncionario & { funcionarios: Funcionario }

export default function RecibosPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [competencia, setCompetencia] = useState<Competencia | null>(null)
  const [registros, setRegistros] = useState<CFComFunc[]>([])
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
    setCompetencia(null)

    const unidadeId = await getOrCreateDefaultUnidade(empresaId)
    if (!unidadeId) { setLoading(false); return }

    const { data: comp } = await supabase
      .from('competencias')
      .select('*')
      .eq('unidade_id', unidadeId)
      .eq('mes', mes)
      .eq('ano', ano)
      .maybeSingle()

    if (!comp) { setLoading(false); return }
    setCompetencia(comp as Competencia)

    const { data: cfs } = await supabase
      .from('competencia_funcionario')
      .select('*, funcionarios(*)')
      .eq('competencia_id', comp.id)

    setRegistros((cfs as CFComFunc[]) ?? [])
    setLoading(false)
  }, [empresaId, mes, ano])

  useEffect(() => {
    if (empresaId) buscarDados()
  }, [empresaId, mes, ano, buscarDados])

  async function gerarPDF(cf: CFComFunc) {
    if (!competencia) return
    setGerando(cf.funcionario_id)
    try {
      const { gerarReciboPDF } = await import('../../services/gerarReciboPDF')
      const empresa = empresas.find((e) => e.id === empresaId)

      const valorVT = competencia.valor_vt ?? 0
      const valorVTSabado = competencia.valor_vt_sabado ?? 0
      const valorVA = competencia.valor_va ?? 0

      const resultado = calcularVTVA({
        diasUteis: competencia.dias_uteis,
        diasFeriado: cf.dias_feriado,
        diasSabado: cf.dias_sabado,
        diasDesconto: cf.dias_desconto,
        valorVT,
        valorVTSabado,
        valorVA,
      })

      await gerarReciboPDF({
        razaoSocial: empresa?.razao_social ?? '',
        cnpj: empresa?.cnpj ?? '',
        nomeFuncionario: cf.funcionarios.nome,
        funcao: cf.funcionarios.funcao,
        mes,
        ano,
        diasUteis: competencia.dias_uteis,
        diasEfetivos: resultado.diasEfetivos,
        diasSabado: cf.dias_sabado,
        valorVT,
        valorVTSabado,
        valorVA,
        resultado,
      })
    } catch (err) {
      console.error('Erro ao gerar PDF:', err)
      alert('Erro ao gerar PDF. Tente novamente.')
    } finally {
      setGerando(null)
    }
  }

  async function gerarTodosPDFs() {
    for (const cf of registros) {
      await gerarPDF(cf)
    }
  }

  const valorVT = competencia?.valor_vt ?? 0
  const valorVTSabado = competencia?.valor_vt_sabado ?? 0
  const valorVA = competencia?.valor_va ?? 0

  const totalGeral = registros.reduce((sum, cf) => {
    const r = calcularVTVA({
      diasUteis: competencia?.dias_uteis ?? 22,
      diasFeriado: cf.dias_feriado,
      diasSabado: cf.dias_sabado,
      diasDesconto: cf.dias_desconto,
      valorVT,
      valorVTSabado,
      valorVA,
    })
    return sum + r.valorTotal
  }, 0)

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
            ) : !competencia ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                <svg className="w-10 h-10 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Nenhuma competência encontrada para este período.
                <br />
                <span className="text-xs">Cadastre a competência primeiro na página de Competências.</span>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h2 className="text-base font-semibold text-gray-800">
                      {MESES[mes - 1]}/{ano} — {registros.length} funcionário(s)
                    </h2>
                    <p className="text-sm text-gray-500 mt-0.5">
                      Dias úteis: {competencia.dias_uteis} | VT: {formatarMoeda(valorVT)}/dia | VA: {formatarMoeda(valorVA)}/dia | Total:{' '}
                      <span className="font-semibold text-blue-600">{formatarMoeda(totalGeral)}</span>
                    </p>
                  </div>
                  {registros.length > 0 && (
                    <button onClick={gerarTodosPDFs} className="btn-primary flex items-center gap-2 text-sm" disabled={gerando !== null}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Gerar Todos os PDFs
                    </button>
                  )}
                </div>

                {registros.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-sm">Nenhum registro encontrado.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
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
                        {registros.map((cf) => {
                          const r = calcularVTVA({
                            diasUteis: competencia.dias_uteis,
                            diasFeriado: cf.dias_feriado,
                            diasSabado: cf.dias_sabado,
                            diasDesconto: cf.dias_desconto,
                            valorVT,
                            valorVTSabado,
                            valorVA,
                          })
                          return (
                            <tr key={cf.funcionario_id} className="hover:bg-gray-50 transition-colors">
                              <td className="table-cell">
                                <div className="font-medium text-gray-900">{cf.funcionarios.nome}</div>
                                <div className="text-xs text-gray-400">{cf.funcionarios.funcao}</div>
                              </td>
                              <td className="table-cell text-center font-mono text-sm">{r.diasEfetivos}</td>
                              <td className="table-cell text-right text-sm">{formatarMoeda(r.totalVA)}</td>
                              <td className="table-cell text-right text-sm">{formatarMoeda(r.totalVT)}</td>
                              <td className="table-cell text-right text-sm">{formatarMoeda(r.totalVTSabado)}</td>
                              <td className="table-cell text-right font-semibold text-blue-700">{formatarMoeda(r.valorTotal)}</td>
                              <td className="table-cell text-right">
                                <button
                                  onClick={() => gerarPDF(cf)}
                                  disabled={gerando === cf.funcionario_id}
                                  className="inline-flex items-center gap-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                                >
                                  {gerando === cf.funcionario_id ? (
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
                                      PDF (2 vias)
                                    </>
                                  )}
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {!empresaId && (
          <div className="card text-center py-16 text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm">Selecione uma empresa e período para visualizar e gerar recibos.</p>
          </div>
        )}
      </div>
    </LayoutAdmin>
  )
}

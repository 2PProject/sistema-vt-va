'use client'

import { useEffect, useState, useCallback } from 'react'
import LayoutAdmin from '../../components/LayoutAdmin'
import { supabase, Empresa, Funcionario, getOrCreateDefaultUnidade } from '../../lib/supabase'
import { formatarMoeda } from '../../utils/calculoVT'

type FuncRow = {
  id: string
  empresaId: string
  empresaNome: string
  valorVAEmpresa: number
  nome: string
  funcao: string
  valor_vt: number
  valor_vt_sabado: number
  tem_sabado: boolean
  alterado: boolean
}

const TODAS = '__todas__'

export default function ValoresBeneficiosPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresaId, setEmpresaId] = useState<string>('')
  const [empresa, setEmpresa] = useState<Empresa | null>(null)
  const [valorVA, setValorVA] = useState(0)
  const [funcionarios, setFuncionarios] = useState<FuncRow[]>([])
  const [loading, setLoading] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [sucesso, setSucesso] = useState(false)

  const modoTodas = empresaId === TODAS

  useEffect(() => {
    supabase.from('empresas').select('*').order('razao_social').then(({ data }) => {
      setEmpresas(data ?? [])
    })
  }, [])

  const carregar = useCallback(async () => {
    if (!empresaId) return
    setLoading(true)

    if (modoTodas) {
      setEmpresa(null)
      setValorVA(0)
      const porEmpresa = await Promise.all(
        empresas.map(async (emp): Promise<FuncRow[]> => {
          const unidadeId = await getOrCreateDefaultUnidade(emp.id)
          if (!unidadeId) return []

          const { data: funcs } = await supabase
            .from('funcionarios')
            .select('id, nome, funcao, valor_vt, valor_vt_sabado')
            .eq('unidade_id', unidadeId)
            .eq('ativo', true)
            .order('nome')

          return ((funcs ?? []) as Array<{ id: string; nome: string; funcao: string; valor_vt: number | null; valor_vt_sabado: number | null }>).map((f) => ({
            id: f.id,
            empresaId: emp.id,
            empresaNome: emp.razao_social,
            valorVAEmpresa: emp.valor_va ?? 0,
            nome: f.nome,
            funcao: f.funcao,
            valor_vt: f.valor_vt ?? 0,
            valor_vt_sabado: f.valor_vt_sabado ?? 0,
            tem_sabado: (f.valor_vt_sabado ?? 0) > 0,
            alterado: false,
          }))
        })
      )

      const todos = porEmpresa.flat()
      setFuncionarios(todos)
      setLoading(false)
      return
    }

    const emp = empresas.find(e => e.id === empresaId) ?? null
    setEmpresa(emp)
    setValorVA(emp?.valor_va ?? 0)

    const unidadeId = await getOrCreateDefaultUnidade(empresaId)
    if (!unidadeId) { setLoading(false); return }

    const { data: funcs } = await supabase
      .from('funcionarios')
      .select('id, nome, funcao, valor_vt, valor_vt_sabado')
      .eq('unidade_id', unidadeId)
      .eq('ativo', true)
      .order('nome')

    setFuncionarios(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (funcs ?? []).map((f: any) => ({
        id: f.id,
        empresaId: empresaId,
        empresaNome: emp?.razao_social ?? '',
        valorVAEmpresa: emp?.valor_va ?? 0,
        nome: f.nome,
        funcao: f.funcao,
        valor_vt: f.valor_vt ?? 0,
        valor_vt_sabado: f.valor_vt_sabado ?? 0,
        tem_sabado: (f.valor_vt_sabado ?? 0) > 0,
        alterado: false,
      }))
    )
    setLoading(false)
  }, [empresaId, empresas, modoTodas])

  useEffect(() => {
    if (empresaId) carregar()
  }, [empresaId, carregar])

  function atualizarFunc(idx: number, campo: 'valor_vt' | 'valor_vt_sabado', valor: number) {
    setFuncionarios(prev => {
      const novo = [...prev]
      novo[idx] = { ...novo[idx], [campo]: valor, alterado: true }
      return novo
    })
  }

  function toggleSabado(idx: number) {
    setFuncionarios(prev => {
      const novo = [...prev]
      const ativo = !novo[idx].tem_sabado
      novo[idx] = { ...novo[idx], tem_sabado: ativo, valor_vt_sabado: ativo ? novo[idx].valor_vt_sabado : 0, alterado: true }
      return novo
    })
  }

  async function salvar() {
    setSalvando(true)
    setSucesso(false)

    if (!modoTodas && empresa) {
      await supabase.from('empresas').update({ valor_va: valorVA }).eq('id', empresa.id)
      setEmpresas(prev => prev.map(e => e.id === empresa.id ? { ...e, valor_va: valorVA } : e))
    }

    const alterados = funcionarios.filter(f => f.alterado)
    for (const f of alterados) {
      await supabase
        .from('funcionarios')
        .update({ valor_vt: f.valor_vt, valor_vt_sabado: f.valor_vt_sabado })
        .eq('id', f.id)
    }

    setFuncionarios(prev => prev.map(f => ({ ...f, alterado: false })))
    setSalvando(false)
    setSucesso(true)
    setTimeout(() => setSucesso(false), 3000)
  }

  const totalMensalEstimado = funcionarios.reduce((sum, f) => {
    const va = modoTodas ? f.valorVAEmpresa : valorVA
    return sum + (22 * (f.valor_vt + va)) + (4 * (f.tem_sabado ? f.valor_vt_sabado : 0))
  }, 0)

  return (
    <LayoutAdmin title="Valores VT / VA">
      <div className="space-y-6">

        {/* Seletor de empresa */}
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Selecionar Empresa</h2>
          <select
            value={empresaId}
            onChange={(e) => setEmpresaId(e.target.value)}
            className="input-field max-w-md"
          >
            <option value="">Selecione uma empresa</option>
            <option value={TODAS}>— Todas as empresas —</option>
            {empresas.map((emp) => (
              <option key={emp.id} value={emp.id}>{emp.razao_social}</option>
            ))}
          </select>
        </div>

        {sucesso && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Valores salvos com sucesso!
          </div>
        )}

        {empresaId && (
          <>
            {/* VA da empresa — só exibe quando empresa específica */}
            {!modoTodas && (
              <div className="card">
                <h2 className="text-sm font-semibold text-gray-700 mb-1">Vale Alimentação (VA)</h2>
                <p className="text-xs text-gray-400 mb-4">
                  Mesmo valor para todos os funcionários. Será pré-preenchido automaticamente nas competências.
                </p>
                <div className="flex items-end gap-6">
                  <div>
                    <label className="label-field">Valor VA / dia útil (R$)</label>
                    <input
                      type="number"
                      value={valorVA}
                      onChange={(e) => setValorVA(Number(e.target.value))}
                      min={0}
                      step={0.01}
                      className="input-field w-40 text-lg font-semibold"
                      placeholder="0,00"
                    />
                  </div>
                  <div className="pb-1 text-sm text-gray-500">
                    Mensal estimado (22 dias): <span className="font-semibold text-blue-600">{formatarMoeda(22 * valorVA)}</span> por funcionário
                  </div>
                </div>
              </div>
            )}

            {/* VT por funcionário */}
            <div className="card">
              <div className="flex items-center justify-between mb-1">
                <div>
                  <h2 className="text-sm font-semibold text-gray-700">Vale Transporte (VT) por Funcionário</h2>
                  {modoTodas && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      Visualizando todos os funcionários de todas as empresas. VA é editado por empresa individualmente.
                    </p>
                  )}
                </div>
                {funcionarios.some(f => f.alterado) && (
                  <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">Alterações não salvas</span>
                )}
              </div>

              {loading ? (
                <div className="text-center py-10 text-gray-400 text-sm">Carregando...</div>
              ) : funcionarios.length === 0 ? (
                <div className="text-center py-10 text-gray-400 text-sm">Nenhum funcionário ativo.</div>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        {modoTodas && <th className="table-header text-left">Empresa</th>}
                        <th className="table-header text-left">Funcionário</th>
                        <th className="table-header text-left">Cargo</th>
                        {modoTodas && <th className="table-header text-center">VA/dia</th>}
                        <th className="table-header text-center min-w-[130px]">VT / dia útil (R$)</th>
                        <th className="table-header text-center">VT Sábado diferente?</th>
                        <th className="table-header text-right">Estimativa mensal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {funcionarios.map((f, idx) => {
                        const va = modoTodas ? f.valorVAEmpresa : valorVA
                        const estimativa = (22 * (f.valor_vt + va)) + (4 * (f.tem_sabado ? f.valor_vt_sabado : 0))
                        return (
                          <tr key={f.id} className={`hover:bg-gray-50 ${f.alterado ? 'bg-amber-50/30' : ''}`}>
                            {modoTodas && (
                              <td className="table-cell text-xs text-gray-500">{f.empresaNome}</td>
                            )}
                            <td className="table-cell font-medium text-gray-900">{f.nome}</td>
                            <td className="table-cell text-gray-500 text-xs">{f.funcao}</td>
                            {modoTodas && (
                              <td className="table-cell text-center text-xs text-gray-500">{formatarMoeda(f.valorVAEmpresa)}</td>
                            )}
                            <td className="table-cell text-center">
                              <input
                                type="number"
                                value={f.valor_vt}
                                onChange={(e) => atualizarFunc(idx, 'valor_vt', Number(e.target.value))}
                                min={0}
                                step={0.01}
                                className="w-28 border border-gray-300 rounded px-2 py-1.5 text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </td>
                            <td className="table-cell text-center">
                              <div className="flex items-center justify-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={f.tem_sabado}
                                  onChange={() => toggleSabado(idx)}
                                  className="w-4 h-4 accent-blue-600 cursor-pointer"
                                />
                                {f.tem_sabado && (
                                  <input
                                    type="number"
                                    value={f.valor_vt_sabado}
                                    onChange={(e) => atualizarFunc(idx, 'valor_vt_sabado', Number(e.target.value))}
                                    min={0}
                                    step={0.01}
                                    className="w-24 border border-blue-300 rounded px-2 py-1.5 text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    placeholder="0,00"
                                  />
                                )}
                              </div>
                            </td>
                            <td className="table-cell text-right text-xs font-semibold text-blue-700">
                              {formatarMoeda(estimativa)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-200 bg-gray-50">
                        <td colSpan={modoTodas ? 6 : 4} className="table-cell text-right text-sm font-semibold text-gray-600">
                          Total mensal estimado {modoTodas ? '(todas as empresas)' : '(empresa)'}:
                        </td>
                        <td className="table-cell text-right font-bold text-blue-700">
                          {formatarMoeda(totalMensalEstimado)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button onClick={salvar} disabled={salvando} className="btn-primary px-10 flex items-center gap-2">
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
                    {modoTodas ? 'Salvar todos os valores' : 'Salvar Valores'}
                  </>
                )}
              </button>
            </div>
          </>
        )}

        {!empresaId && (
          <div className="card text-center py-16 text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm">Selecione uma empresa (ou todas) para configurar os valores de VT e VA.</p>
          </div>
        )}
      </div>
    </LayoutAdmin>
  )
}

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

type CFLocal = {
  id: string
  competencia_id: string
  funcionario_id: string
  dias_feriado: number
  dias_sabado: number
  dias_desconto: number
  valor_vt: number
  valor_vt_sabado: number
  valor_total: number
  funcionario: Funcionario
}

export default function CompetenciasPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [competencia, setCompetencia] = useState<Competencia | null>(null)
  const [itens, setItens] = useState<CFLocal[]>([])
  const [loading, setLoading] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [sucesso, setSucesso] = useState(false)

  const [valorVA, setValorVA] = useState(0)

  const [empresaId, setEmpresaId] = useState<string>('')
  const [mes, setMes] = useState(new Date().getMonth() + 1)
  const [ano, setAno] = useState(new Date().getFullYear())
  const [diasUteis, setDiasUteis] = useState(22)

  useEffect(() => {
    supabase.from('empresas').select('*').order('razao_social').then(({ data }) => {
      setEmpresas(data ?? [])
    })
  }, [])

  const carregarCompetencia = useCallback(async () => {
    if (!empresaId) return
    setLoading(true)
    setSucesso(false)

    const unidadeId = await getOrCreateDefaultUnidade(empresaId)
    if (!unidadeId) { setLoading(false); return }

    const { data: compExistente } = await supabase
      .from('competencias')
      .select('*')
      .eq('unidade_id', unidadeId)
      .eq('mes', mes)
      .eq('ano', ano)
      .maybeSingle()

    const comp = compExistente as Competencia | null

    if (comp) {
      setCompetencia(comp)
      setDiasUteis(comp.dias_uteis)
      setValorVA(comp.valor_va ?? 0)
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

      setItens(
        funcs.map((f: Funcionario) => {
          const cf = cfMap.get(f.id)
          return {
            id: cf?.id ?? '',
            competencia_id: comp.id,
            funcionario_id: f.id,
            dias_feriado: cf?.dias_feriado ?? 0,
            dias_sabado: cf?.dias_sabado ?? 0,
            dias_desconto: cf?.dias_desconto ?? 0,
            valor_vt: cf?.valor_vt ?? f.valor_vt ?? 0,
            valor_vt_sabado: cf?.valor_vt_sabado ?? f.valor_vt_sabado ?? 0,
            valor_total: cf?.valor_total ?? 0,
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
          dias_feriado: 0,
          dias_sabado: 0,
          dias_desconto: 0,
          valor_vt: f.valor_vt ?? 0,
          valor_vt_sabado: f.valor_vt_sabado ?? 0,
          valor_total: 0,
          funcionario: f,
        }))
      )
    } else {
      setItens([])
    }

    setLoading(false)
  }, [empresaId, mes, ano])

  useEffect(() => {
    if (empresaId) carregarCompetencia()
  }, [empresaId, mes, ano, carregarCompetencia])

  function atualizarItem(idx: number, campo: keyof CFLocal, valor: number) {
    setItens((prev) => {
      const novo = [...prev]
      novo[idx] = { ...novo[idx], [campo]: valor }
      return novo
    })
  }

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
        .insert({
          unidade_id: unidadeId,
          mes,
          ano,
          dias_uteis: diasUteis,
          valor_va: valorVA,
        })
        .select()
        .single()
      compId = (novaComp as Competencia)?.id ?? ''
      setCompetencia(novaComp as Competencia)
    } else {
      await supabase
        .from('competencias')
        .update({ dias_uteis: diasUteis, valor_va: valorVA })
        .eq('id', competencia.id)
    }

    for (const item of itens) {
      const resultado = calcularVTVA({
        diasUteis,
        diasFeriado: item.dias_feriado,
        diasSabado: item.dias_sabado,
        diasDesconto: item.dias_desconto,
        valorVT: item.valor_vt,
        valorVTSabado: item.valor_vt_sabado,
        valorVA,
      })

      const payload = {
        competencia_id: compId,
        funcionario_id: item.funcionario_id,
        dias_feriado: item.dias_feriado,
        dias_sabado: item.dias_sabado,
        dias_desconto: item.dias_desconto,
        valor_vt: item.valor_vt,
        valor_vt_sabado: item.valor_vt_sabado,
        valor_total: resultado.valorTotal,
      }

      if (item.id) {
        await supabase.from('competencia_funcionario').update(payload).eq('id', item.id)
      } else {
        await supabase.from('competencia_funcionario').insert(payload)
      }
    }

    setSalvando(false)
    setSucesso(true)
    setTimeout(() => setSucesso(false), 3000)
    carregarCompetencia()
  }

  const totalGeral = itens.reduce((sum, item) => {
    const r = calcularVTVA({
      diasUteis,
      diasFeriado: item.dias_feriado,
      diasSabado: item.dias_sabado,
      diasDesconto: item.dias_desconto,
      valorVT: item.valor_vt,
      valorVTSabado: item.valor_vt_sabado,
      valorVA,
    })
    return sum + r.valorTotal
  }, 0)

  return (
    <LayoutAdmin title="Competências Mensais">
      <div className="space-y-6">
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

          {empresaId && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Parâmetros do Mês
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-lg">
                <div>
                  <label className="label-field">Dias Úteis</label>
                  <input type="number" value={diasUteis} onChange={(e) => setDiasUteis(Number(e.target.value))} className="input-field" min={0} max={31} />
                </div>
                <div>
                  <label className="label-field">Valor VA / dia útil (R$)</label>
                  <input type="number" value={valorVA} onChange={(e) => setValorVA(Number(e.target.value))} className="input-field" min={0} step={0.01} placeholder="0,00" />
                </div>
              </div>
              <p className="text-xs text-blue-600 mt-2">
                O valor do VT é individual por funcionário — configure no cadastro de cada funcionário.
              </p>
              {!competencia && (
                <p className="text-xs text-amber-600 mt-1">
                  ⚠ Competência ainda não cadastrada — será criada ao salvar.
                </p>
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

        {empresaId && (
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-700">Funcionários — {MESES[mes - 1]}/{ano}</h2>
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
                        <th className="table-header text-center min-w-[90px]">VT/dia (R$)</th>
                        <th className="table-header text-center min-w-[90px]">VT Sáb (R$)</th>
                        <th className="table-header text-center">Feriados</th>
                        <th className="table-header text-center">Sábados</th>
                        <th className="table-header text-center">Descontos</th>
                        <th className="table-header text-right">Dias Ef.</th>
                        <th className="table-header text-right">VA</th>
                        <th className="table-header text-right">VT</th>
                        <th className="table-header text-right">VT Sáb.</th>
                        <th className="table-header text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {itens.map((item, idx) => {
                        const r = calcularVTVA({
                          diasUteis,
                          diasFeriado: item.dias_feriado,
                          diasSabado: item.dias_sabado,
                          diasDesconto: item.dias_desconto,
                          valorVT: item.valor_vt,
                          valorVTSabado: item.valor_vt_sabado,
                          valorVA,
                        })
                        return (
                          <tr key={item.funcionario_id} className="hover:bg-gray-50">
                            <td className="table-cell">
                              <div className="font-medium text-gray-900">{item.funcionario.nome}</div>
                              <div className="text-xs text-gray-400">{item.funcionario.funcao}</div>
                            </td>
                            <td className="table-cell text-center">
                              <input type="number" value={item.valor_vt} onChange={(e) => atualizarItem(idx, 'valor_vt', Number(e.target.value))} className="w-20 border border-gray-300 rounded px-2 py-1 text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" min={0} step={0.01} />
                            </td>
                            <td className="table-cell text-center">
                              <input type="number" value={item.valor_vt_sabado} onChange={(e) => atualizarItem(idx, 'valor_vt_sabado', Number(e.target.value))} className="w-20 border border-gray-300 rounded px-2 py-1 text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" min={0} step={0.01} />
                            </td>
                            <td className="table-cell text-center">
                              <input type="number" value={item.dias_feriado} onChange={(e) => atualizarItem(idx, 'dias_feriado', Number(e.target.value))} className="w-16 border border-gray-300 rounded px-2 py-1 text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" min={0} max={31} />
                            </td>
                            <td className="table-cell text-center">
                              <input type="number" value={item.dias_sabado} onChange={(e) => atualizarItem(idx, 'dias_sabado', Number(e.target.value))} className="w-16 border border-gray-300 rounded px-2 py-1 text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" min={0} max={5} />
                            </td>
                            <td className="table-cell text-center">
                              <input type="number" value={item.dias_desconto} onChange={(e) => atualizarItem(idx, 'dias_desconto', Number(e.target.value))} className="w-16 border border-gray-300 rounded px-2 py-1 text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" min={0} max={31} />
                            </td>
                            <td className="table-cell text-right text-xs font-semibold">{r.diasEfetivos}d</td>
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

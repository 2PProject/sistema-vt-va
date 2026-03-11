'use client'

import { useEffect, useState, useCallback } from 'react'
import LayoutAdmin from '../../components/LayoutAdmin'
import { supabase, Competencia, CompetenciaFuncionario, Funcionario, Unidade } from '../../lib/supabase'
import { calcularVTVA, formatarMoeda, MESES } from '../../utils/calculoVT'

type CFComFuncionario = CompetenciaFuncionario & { funcionarios: Funcionario }

export default function CompetenciasPage() {
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [competencia, setCompetencia] = useState<Competencia | null>(null)
  const [funcionariosComp, setFuncionariosComp] = useState<CFComFuncionario[]>([])
  const [loading, setLoading] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [sucesso, setSucesso] = useState(false)

  // Filtros de seleção
  const [unidadeId, setUnidadeId] = useState<number | ''>('')
  const [mes, setMes] = useState(new Date().getMonth() + 1)
  const [ano, setAno] = useState(new Date().getFullYear())
  const [diasUteis, setDiasUteis] = useState(22)

  useEffect(() => {
    carregarUnidades()
  }, [])

  async function carregarUnidades() {
    const { data } = await supabase.from('unidades').select('*').order('nome')
    setUnidades(data ?? [])
  }

  const carregarCompetencia = useCallback(async () => {
    if (!unidadeId) return
    setLoading(true)
    setSucesso(false)

    // Busca ou cria competência
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
    } else {
      setCompetencia(null)
    }

    // Carrega funcionários da unidade
    const { data: funcs } = await supabase
      .from('funcionarios')
      .select('*')
      .eq('unidade_id', unidadeId)
      .eq('ativo', true)
      .order('nome')

    if (funcs && comp) {
      // Busca competencia_funcionario existente
      const { data: cfExistente } = await supabase
        .from('competencia_funcionario')
        .select('*')
        .eq('competencia_id', comp.id)

      const cfMap = new Map((cfExistente ?? []).map((cf: CompetenciaFuncionario) => [cf.funcionario_id, cf]))

      const lista: CFComFuncionario[] = funcs.map((f: Funcionario) => {
        const cf = cfMap.get(f.id)
        return {
          id: cf?.id ?? 0,
          competencia_id: comp.id,
          funcionario_id: f.id,
          dias_feriado: cf?.dias_feriado ?? 0,
          dias_sabado: cf?.dias_sabado ?? 0,
          dias_desconto: cf?.dias_desconto ?? 0,
          valor_vt: cf?.valor_vt ?? 0,
          valor_vt_sabado: cf?.valor_vt_sabado ?? 0,
          valor_va: cf?.valor_va ?? 0,
          valor_total: cf?.valor_total ?? 0,
          funcionarios: f,
        }
      })
      setFuncionariosComp(lista)
    } else if (funcs) {
      const lista: CFComFuncionario[] = funcs.map((f: Funcionario) => ({
        id: 0,
        competencia_id: 0,
        funcionario_id: f.id,
        dias_feriado: 0,
        dias_sabado: 0,
        dias_desconto: 0,
        valor_vt: 0,
        valor_vt_sabado: 0,
        valor_va: 0,
        valor_total: 0,
        funcionarios: f,
      }))
      setFuncionariosComp(lista)
    }

    setLoading(false)
  }, [unidadeId, mes, ano])

  useEffect(() => {
    if (unidadeId) carregarCompetencia()
  }, [unidadeId, mes, ano, carregarCompetencia])

  function atualizarCF(idx: number, campo: keyof CFComFuncionario, valor: number) {
    setFuncionariosComp((prev) => {
      const novo = [...prev]
      const item = { ...novo[idx], [campo]: valor }

      // Recalcular valor_total
      const resultado = calcularVTVA({
        diasUteis,
        diasFeriado: Number(item.dias_feriado),
        diasSabado: Number(item.dias_sabado),
        diasDesconto: Number(item.dias_desconto),
        valorVT: Number(item.valor_vt),
        valorVTSabado: Number(item.valor_vt_sabado),
        valorVA: Number(item.valor_va),
      })
      item.valor_total = resultado.valorTotal
      novo[idx] = item
      return novo
    })
  }

  async function salvar() {
    if (!unidadeId) return
    setSalvando(true)
    setSucesso(false)

    // Upsert competência
    let compId = competencia?.id
    if (!competencia) {
      const { data: novaComp } = await supabase
        .from('competencias')
        .insert({ unidade_id: unidadeId, mes, ano, dias_uteis: diasUteis })
        .select()
        .single()
      compId = (novaComp as Competencia)?.id
      setCompetencia(novaComp as Competencia)
    } else {
      await supabase
        .from('competencias')
        .update({ dias_uteis: diasUteis })
        .eq('id', competencia.id)
    }

    // Upsert competencia_funcionario
    for (const cf of funcionariosComp) {
      const resultado = calcularVTVA({
        diasUteis,
        diasFeriado: cf.dias_feriado,
        diasSabado: cf.dias_sabado,
        diasDesconto: cf.dias_desconto,
        valorVT: cf.valor_vt,
        valorVTSabado: cf.valor_vt_sabado,
        valorVA: cf.valor_va,
      })

      const payload = {
        competencia_id: compId,
        funcionario_id: cf.funcionario_id,
        dias_feriado: cf.dias_feriado,
        dias_sabado: cf.dias_sabado,
        dias_desconto: cf.dias_desconto,
        valor_vt: cf.valor_vt,
        valor_vt_sabado: cf.valor_vt_sabado,
        valor_va: cf.valor_va,
        valor_total: resultado.valorTotal,
      }

      if (cf.id) {
        await supabase.from('competencia_funcionario').update(payload).eq('id', cf.id)
      } else {
        const { data: novo } = await supabase
          .from('competencia_funcionario')
          .insert(payload)
          .select()
          .single()
        cf.id = (novo as CompetenciaFuncionario)?.id ?? 0
      }
    }

    setSalvando(false)
    setSucesso(true)
    setTimeout(() => setSucesso(false), 3000)
  }

  const totalGeral = funcionariosComp.reduce((sum, cf) => {
    const r = calcularVTVA({
      diasUteis,
      diasFeriado: cf.dias_feriado,
      diasSabado: cf.dias_sabado,
      diasDesconto: cf.dias_desconto,
      valorVT: cf.valor_vt,
      valorVTSabado: cf.valor_vt_sabado,
      valorVA: cf.valor_va,
    })
    return sum + r.valorTotal
  }, 0)

  return (
    <LayoutAdmin title="Competências Mensais">
      <div className="space-y-6">
        {/* Seletor de competência */}
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Selecionar Competência</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <label className="label-field">Unidade</label>
              <select
                value={unidadeId}
                onChange={(e) => setUnidadeId(Number(e.target.value))}
                className="input-field"
              >
                <option value="">Selecione uma unidade</option>
                {unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    [{u.codigo}] {u.nome}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-field">Mês</label>
              <select
                value={mes}
                onChange={(e) => setMes(Number(e.target.value))}
                className="input-field"
              >
                {MESES.map((m, i) => (
                  <option key={i + 1} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-field">Ano</label>
              <input
                type="number"
                value={ano}
                onChange={(e) => setAno(Number(e.target.value))}
                className="input-field"
                min={2020}
                max={2099}
              />
            </div>
          </div>

          {unidadeId && (
            <div className="mt-4 flex items-end gap-4">
              <div>
                <label className="label-field">Dias Úteis no Mês</label>
                <input
                  type="number"
                  value={diasUteis}
                  onChange={(e) => setDiasUteis(Number(e.target.value))}
                  className="input-field w-32"
                  min={0}
                  max={31}
                />
              </div>
              <div className="text-sm text-gray-500 pb-2">
                {competencia
                  ? `Competência cadastrada (ID: ${competencia.id})`
                  : 'Nova competência — será criada ao salvar'}
              </div>
            </div>
          )}
        </div>

        {/* Avisos */}
        {sucesso && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Competência salva com sucesso!
          </div>
        )}

        {/* Tabela de funcionários */}
        {unidadeId && (
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-700">
                Funcionários — {MESES[mes - 1]}/{ano}
              </h2>
              {funcionariosComp.length > 0 && (
                <div className="text-sm font-semibold text-gray-700">
                  Total Geral:{' '}
                  <span className="text-blue-600">{formatarMoeda(totalGeral)}</span>
                </div>
              )}
            </div>

            {loading ? (
              <div className="text-center py-12 text-gray-400 text-sm">Carregando...</div>
            ) : funcionariosComp.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                Nenhum funcionário ativo nesta unidade.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="table-header text-left min-w-[180px]">Funcionário</th>
                        <th className="table-header text-center">Feriados</th>
                        <th className="table-header text-center">Sábados</th>
                        <th className="table-header text-center">Descontos</th>
                        <th className="table-header text-right">Valor VT</th>
                        <th className="table-header text-right">VT Sáb.</th>
                        <th className="table-header text-right">Valor VA</th>
                        <th className="table-header text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {funcionariosComp.map((cf, idx) => {
                        const resultado = calcularVTVA({
                          diasUteis,
                          diasFeriado: cf.dias_feriado,
                          diasSabado: cf.dias_sabado,
                          diasDesconto: cf.dias_desconto,
                          valorVT: cf.valor_vt,
                          valorVTSabado: cf.valor_vt_sabado,
                          valorVA: cf.valor_va,
                        })

                        return (
                          <tr key={cf.funcionario_id} className="hover:bg-gray-50">
                            <td className="table-cell">
                              <div className="font-medium text-gray-900">{cf.funcionarios.nome}</div>
                              <div className="text-xs text-gray-400">{cf.funcionarios.funcao}</div>
                            </td>
                            <td className="table-cell text-center">
                              <input
                                type="number"
                                value={cf.dias_feriado}
                                onChange={(e) => atualizarCF(idx, 'dias_feriado', Number(e.target.value))}
                                className="w-16 border border-gray-300 rounded px-2 py-1 text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                min={0}
                                max={31}
                              />
                            </td>
                            <td className="table-cell text-center">
                              <input
                                type="number"
                                value={cf.dias_sabado}
                                onChange={(e) => atualizarCF(idx, 'dias_sabado', Number(e.target.value))}
                                className="w-16 border border-gray-300 rounded px-2 py-1 text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                min={0}
                                max={5}
                              />
                            </td>
                            <td className="table-cell text-center">
                              <input
                                type="number"
                                value={cf.dias_desconto}
                                onChange={(e) => atualizarCF(idx, 'dias_desconto', Number(e.target.value))}
                                className="w-16 border border-gray-300 rounded px-2 py-1 text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                min={0}
                                max={31}
                              />
                            </td>
                            <td className="table-cell text-right">
                              <input
                                type="number"
                                value={cf.valor_vt}
                                onChange={(e) => atualizarCF(idx, 'valor_vt', Number(e.target.value))}
                                className="w-24 border border-gray-300 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                min={0}
                                step={0.01}
                              />
                            </td>
                            <td className="table-cell text-right">
                              <input
                                type="number"
                                value={cf.valor_vt_sabado}
                                onChange={(e) => atualizarCF(idx, 'valor_vt_sabado', Number(e.target.value))}
                                className="w-24 border border-gray-300 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                min={0}
                                step={0.01}
                              />
                            </td>
                            <td className="table-cell text-right">
                              <input
                                type="number"
                                value={cf.valor_va}
                                onChange={(e) => atualizarCF(idx, 'valor_va', Number(e.target.value))}
                                className="w-24 border border-gray-300 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                min={0}
                                step={0.01}
                              />
                            </td>
                            <td className="table-cell text-right font-semibold text-blue-700">
                              {formatarMoeda(resultado.valorTotal)}
                              <div className="text-xs text-gray-400 font-normal">
                                {resultado.diasEfetivos}d ef.
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end mt-6">
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
                        Salvar Competência
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {!unidadeId && (
          <div className="card text-center py-16 text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-sm">Selecione uma unidade, mês e ano para gerenciar a competência.</p>
          </div>
        )}
      </div>
    </LayoutAdmin>
  )
}

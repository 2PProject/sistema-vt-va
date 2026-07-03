'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase, Empresa } from '../../../lib/supabase'
import { formatarMoeda, MESES } from '../../../utils/calculoVT'
import {
  competenciaMesAnterior,
  listarVales,
  statusParcelasVale,
  PagamentoVale,
  StatusVale,
} from '../../../lib/pagamentos'
import type { DadosReciboConsolidado } from '../../../services/gerarReciboValePDF'

function fmtMes(mes: string) {
  const [a, m] = mes.split('-').map(Number)
  return m ? `${MESES[m - 1]}/${a}` : mes
}
function competenciasParcelas(mesInicio: string, parcelas: number): string[] {
  const [ay, am] = mesInicio.split('-').map(Number)
  const out: string[] = []
  for (let i = 0; i < parcelas; i++) {
    const d = new Date(ay, am - 1 + i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

type ValeSt = { v: PagamentoVale; st: StatusVale }
type Grupo = {
  funcionario_id: string
  funcionarioNome: string
  funcao: string
  empresaNome: string
  empresaCnpj: string
  vales: ValeSt[]
  total: number
  descontado: number
  restante: number
}

export default function RecibosValesPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [vales, setVales] = useState<PagamentoVale[]>([])
  const [loading, setLoading] = useState(false)
  const [gerando, setGerando] = useState<string | null>(null)

  const [empresaFiltro, setEmpresaFiltro] = useState('')
  const [refComp, setRefComp] = useState(competenciaMesAnterior())
  const [soEmAberto, setSoEmAberto] = useState(true)
  const [busca, setBusca] = useState('')
  const [aberto, setAberto] = useState<Set<string>>(new Set())

  const [msg, setMsg] = useState('')
  const [msgTipo, setMsgTipo] = useState<'ok' | 'erro'>('ok')

  useEffect(() => {
    supabase.from('empresas').select('*').order('razao_social').then(({ data }) => setEmpresas(data ?? []))
  }, [])

  useEffect(() => { carregar() }, [empresaFiltro]) // eslint-disable-line react-hooks/exhaustive-deps

  async function carregar() {
    setLoading(true)
    setVales(await listarVales({ empresaId: empresaFiltro || undefined }))
    setLoading(false)
  }

  function notify(text: string, tipo: 'ok' | 'erro') {
    setMsg(text); setMsgTipo(tipo)
    setTimeout(() => setMsg(''), 6000)
  }

  // Agrupa por profissional, com status calculado na competência de referência
  const grupos = useMemo<Grupo[]>(() => {
    const q = busca.trim().toLowerCase()
    const map = new Map<string, Grupo>()
    for (const v of vales) {
      const st = statusParcelasVale(v, refComp)
      if (soEmAberto && st.restantes === 0) continue
      if (q) {
        const txt = `${v.funcionarios?.nome ?? ''} ${v.empresas?.razao_social ?? ''} ${v.descricao ?? ''}`.toLowerCase()
        if (!txt.includes(q)) continue
      }
      const key = v.funcionario_id
      let g = map.get(key)
      if (!g) {
        g = {
          funcionario_id: key,
          funcionarioNome: v.funcionarios?.nome ?? '—',
          funcao: v.funcionarios?.funcao ?? '',
          empresaNome: v.empresas?.razao_social ?? '',
          empresaCnpj: v.empresas?.cnpj ?? '',
          vales: [], total: 0, descontado: 0, restante: 0,
        }
        map.set(key, g)
      }
      g.vales.push({ v, st })
      g.total += v.valor_total
      g.descontado += st.valorDescontado
      g.restante += st.valorRestante
    }
    return Array.from(map.values()).sort((a, b) =>
      b.restante - a.restante || a.funcionarioNome.localeCompare(b.funcionarioNome))
  }, [vales, refComp, soEmAberto, busca])

  const totais = useMemo(() => ({
    total: grupos.reduce((s, g) => s + g.total, 0),
    descontado: grupos.reduce((s, g) => s + g.descontado, 0),
    restante: grupos.reduce((s, g) => s + g.restante, 0),
    profissionais: grupos.length,
  }), [grupos])

  function toggle(id: string) {
    setAberto(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function montarConsolidado(g: Grupo): DadosReciboConsolidado {
    return {
      empresaNome: g.empresaNome,
      empresaCnpj: g.empresaCnpj,
      funcionarioNome: g.funcionarioNome,
      funcao: g.funcao,
      refCompetencia: refComp,
      vales: g.vales.map(({ v, st }) => ({
        descricao: v.descricao,
        data: v.data,
        valorTotal: v.valor_total,
        parcelas: st.parcelas,
        valorParcela: st.valorParcela,
        descontadas: st.descontadas,
        restantes: st.restantes,
        valorRestante: st.valorRestante,
        mesInicio: v.mes_inicio,
      })),
      totalGeral: g.total,
      totalDescontado: g.descontado,
      totalRestante: g.restante,
    }
  }

  async function gerarRecibo(g: Grupo) {
    setGerando(g.funcionario_id)
    try {
      const { gerarReciboConsolidadoPDF } = await import('../../../services/gerarReciboValePDF')
      await gerarReciboConsolidadoPDF(montarConsolidado(g))
    } catch (err) { console.error(err); notify('Erro ao gerar recibo.', 'erro') }
    finally { setGerando(null) }
  }

  async function gerarTodos() {
    if (grupos.length === 0) return
    setGerando('__todos__')
    try {
      const { gerarMultiplosConsolidados } = await import('../../../services/gerarReciboValePDF')
      await gerarMultiplosConsolidados(grupos.map(montarConsolidado))
    } catch (err) { console.error(err); notify('Erro ao gerar recibos.', 'erro') }
    finally { setGerando(null) }
  }

  async function gerarXLSX() {
    if (grupos.length === 0) return
    setGerando('__xlsx__')
    try {
      const { utils, writeFile } = await import('xlsx')
      const resumo = grupos.map(g => ({
        'Profissional': g.funcionarioNome,
        'Empresa': g.empresaNome,
        'Vales': g.vales.length,
        'Valor Total': g.total,
        'Descontado': g.descontado,
        'Devendo': g.restante,
      }))
      const detalhe = grupos.flatMap(g => g.vales.map(({ v, st }) => {
        const prox = st.restantes > 0 ? competenciasParcelas(v.mes_inicio, st.parcelas)[st.descontadas] : null
        return {
          'Profissional': g.funcionarioNome,
          'Empresa': g.empresaNome,
          'Descrição': v.descricao,
          'Valor Total': v.valor_total,
          'Parcelas': st.parcelas,
          'Valor Parcela': st.valorParcela,
          'Descontadas': st.descontadas,
          'Faltam': st.restantes,
          'Descontado': st.valorDescontado,
          'Restante': st.valorRestante,
          'Próxima': prox ? fmtMes(prox) : 'Quitado',
        }
      }))
      const wb = utils.book_new()
      utils.book_append_sheet(wb, utils.json_to_sheet(resumo), 'Resumo')
      utils.book_append_sheet(wb, utils.json_to_sheet(detalhe), 'Detalhe')
      writeFile(wb, `relatorio_vales_${refComp}.xlsx`)
    } catch (err) { console.error(err); notify('Erro ao exportar.', 'erro') }
    finally { setGerando(null) }
  }

  return (
    <LayoutAdmin title="Recibos de Vales">
      <div className="space-y-6">
        {msg && (
          <div className={`px-4 py-3 rounded-lg text-sm flex justify-between items-center ${msgTipo === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            <span>{msg}</span>
            <button onClick={() => setMsg('')} className="font-bold text-lg leading-none ml-4 opacity-60 hover:opacity-100">×</button>
          </div>
        )}

        {/* Filtros */}
        <div className="card">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <label className="label-field">Empresa</label>
              <select className="input-field" value={empresaFiltro} onChange={e => setEmpresaFiltro(e.target.value)}>
                <option value="">Todas as empresas</option>
                {empresas.map(e => <option key={e.id} value={e.id}>{e.razao_social}</option>)}
              </select>
            </div>
            <div>
              <label className="label-field">Posição em</label>
              <input type="month" className="input-field" value={refComp} onChange={e => setRefComp(e.target.value)} />
              <p className="text-xs text-gray-400 mt-1">Descontadas até esta competência.</p>
            </div>
            <div>
              <label className="label-field">Buscar</label>
              <input className="input-field" placeholder="Profissional ou descrição..." value={busca} onChange={e => setBusca(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-4 mt-4">
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" className="w-4 h-4" checked={soEmAberto} onChange={e => setSoEmAberto(e.target.checked)} />
              Somente quem está devendo
            </label>
          </div>
        </div>

        {/* Resumo */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Profissionais</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{totais.profissionais}</p>
          </div>
          <div className="card">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Valor Total</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{formatarMoeda(totais.total)}</p>
          </div>
          <div className="card">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Já Descontado</p>
            <p className="text-2xl font-bold text-green-700 mt-1">{formatarMoeda(totais.descontado)}</p>
          </div>
          <div className="card">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Devendo</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{formatarMoeda(totais.restante)}</p>
          </div>
        </div>

        {/* Lista agrupada por profissional */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800">
              {grupos.length} profissional(is) · posição {fmtMes(refComp)}
            </h2>
            {grupos.length > 0 && (
              <div className="flex items-center gap-2">
                <button className="btn-secondary text-sm" onClick={gerarXLSX} disabled={gerando !== null}>
                  {gerando === '__xlsx__' ? 'Gerando...' : 'Exportar XLSX'}
                </button>
                <button className="btn-primary text-sm" onClick={gerarTodos} disabled={gerando !== null}>
                  {gerando === '__todos__' ? 'Gerando...' : 'Gerar Todos os Recibos'}
                </button>
              </div>
            )}
          </div>

          {loading ? (
            <div className="text-center py-12 text-gray-400 text-sm">Carregando...</div>
          ) : grupos.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              Nenhum vale encontrado.<br />
              <span className="text-xs">Lance vales em Pagamentos → Vales / Descontos.</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="table-header" style={{ width: 32 }}></th>
                    <th className="table-header">Profissional</th>
                    <th className="table-header text-center">Vales</th>
                    <th className="table-header text-right">Valor Total</th>
                    <th className="table-header text-right">Descontado</th>
                    <th className="table-header text-right">Devendo</th>
                    <th className="table-header text-right">Recibo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {grupos.map((g) => {
                    const isOpen = aberto.has(g.funcionario_id)
                    return (
                      <Fragment key={g.funcionario_id}>
                        <tr className="hover:bg-gray-50 transition-colors">
                          <td className="table-cell text-center">
                            <button onClick={() => toggle(g.funcionario_id)} className="text-gray-400 hover:text-gray-700" title="Ver vales">
                              <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </button>
                          </td>
                          <td className="table-cell">
                            <div className="font-medium text-gray-900">{g.funcionarioNome}</div>
                            <div className="text-xs text-gray-400">{g.empresaNome}</div>
                          </td>
                          <td className="table-cell text-center">{g.vales.length}</td>
                          <td className="table-cell text-right">{formatarMoeda(g.total)}</td>
                          <td className="table-cell text-right text-green-700">{formatarMoeda(g.descontado)}</td>
                          <td className="table-cell text-right font-bold text-amber-700">{formatarMoeda(g.restante)}</td>
                          <td className="table-cell text-right">
                            <button
                              onClick={() => gerarRecibo(g)}
                              disabled={gerando === g.funcionario_id}
                              className="inline-flex items-center gap-1 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                            >
                              {gerando === g.funcionario_id ? 'Gerando...' : 'Recibo'}
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td />
                            <td colSpan={6} className="px-4 pb-4">
                              <div className="rounded-lg border border-gray-100 overflow-hidden">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="bg-gray-50 text-gray-500">
                                      <th className="text-left py-2 px-3 font-semibold">Descrição</th>
                                      <th className="text-center py-2 px-3 font-semibold">Progresso</th>
                                      <th className="text-center py-2 px-3 font-semibold">Faltam</th>
                                      <th className="text-center py-2 px-3 font-semibold">Próxima</th>
                                      <th className="text-right py-2 px-3 font-semibold">Restante</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {g.vales.map(({ v, st }) => {
                                      const comps = competenciasParcelas(v.mes_inicio, st.parcelas)
                                      const quitado = st.restantes === 0
                                      const pct = Math.round((st.descontadas / st.parcelas) * 100)
                                      return (
                                        <tr key={v.id} className="border-t border-gray-100">
                                          <td className="py-2 px-3">
                                            <div className="font-medium text-gray-800">{v.descricao}</div>
                                            <div className="text-gray-400">{formatarMoeda(v.valor_total)} · {st.parcelas}x {formatarMoeda(st.valorParcela)}</div>
                                          </td>
                                          <td className="py-2 px-3" style={{ minWidth: 140 }}>
                                            <div className="text-center text-gray-500 mb-1">{st.descontadas}/{st.parcelas}</div>
                                            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                              <div className={`h-full ${quitado ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
                                            </div>
                                          </td>
                                          <td className="py-2 px-3 text-center">
                                            {quitado ? <span className="badge-green">Quitado</span> : <span className="text-amber-700 font-semibold">{st.restantes}</span>}
                                          </td>
                                          <td className="py-2 px-3 text-center text-blue-700">
                                            {quitado ? '—' : fmtMes(comps[st.descontadas])}
                                          </td>
                                          <td className="py-2 px-3 text-right font-medium text-amber-700">
                                            {st.valorRestante > 0 ? formatarMoeda(st.valorRestante) : '—'}
                                          </td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                              <p className="text-xs text-gray-400 mt-2">Para corrigir um vale, use Pagamentos → Vales / Descontos (botão Editar).</p>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td />
                    <td className="table-cell text-right text-sm font-semibold text-gray-600">Totais:</td>
                    <td className="table-cell text-center font-semibold">{grupos.reduce((s, g) => s + g.vales.length, 0)}</td>
                    <td className="table-cell text-right font-semibold">{formatarMoeda(totais.total)}</td>
                    <td className="table-cell text-right font-semibold text-green-700">{formatarMoeda(totais.descontado)}</td>
                    <td className="table-cell text-right font-bold text-amber-700">{formatarMoeda(totais.restante)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </LayoutAdmin>
  )
}

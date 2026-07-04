'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase, Empresa } from '../../../lib/supabase'
import { formatarMoeda, MESES } from '../../../utils/calculoVT'
import {
  competenciaMesAnterior,
  listarVales,
  statusParcelasVale,
  descontoDoVale,
  PagamentoVale,
  StatusVale,
  DescontoAplicado,
} from '../../../lib/pagamentos'
import type { DadosReciboConsolidado } from '../../../services/gerarReciboValePDF'

function fmtMes(mes: string) {
  const [a, m] = mes.split('-').map(Number)
  return m ? `${MESES[m - 1]}/${a}` : mes
}

type ValeSt = { v: PagamentoVale; st: StatusVale; d: DescontoAplicado | null }
type Grupo = {
  funcionario_id: string
  nome: string
  funcao: string
  empresaNome: string
  empresaCnpj: string
  vales: ValeSt[]        // todos (para expandir)
  valesDoMes: ValeSt[]   // com parcela nesta competência
  descontoMes: number
  saldoDevedor: number
}

export default function RecibosValesPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [vales, setVales] = useState<PagamentoVale[]>([])
  const [loading, setLoading] = useState(false)
  const [gerando, setGerando] = useState<string | null>(null)

  const [empresaFiltro, setEmpresaFiltro] = useState('')
  const [refComp, setRefComp] = useState(competenciaMesAnterior())
  const [soComDesconto, setSoComDesconto] = useState(true)
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

  const grupos = useMemo<Grupo[]>(() => {
    const q = busca.trim().toLowerCase()
    const map = new Map<string, Grupo>()
    for (const v of vales) {
      if (q) {
        const txt = `${v.funcionarios?.nome ?? ''} ${v.empresas?.razao_social ?? ''} ${v.descricao ?? ''}`.toLowerCase()
        if (!txt.includes(q)) continue
      }
      const key = v.funcionario_id
      let g = map.get(key)
      if (!g) {
        g = {
          funcionario_id: key,
          nome: v.funcionarios?.nome ?? '—',
          funcao: v.funcionarios?.funcao ?? '',
          empresaNome: v.empresas?.razao_social ?? '',
          empresaCnpj: v.empresas?.cnpj ?? '',
          vales: [], valesDoMes: [], descontoMes: 0, saldoDevedor: 0,
        }
        map.set(key, g)
      }
      const st = statusParcelasVale(v, refComp)
      const d = descontoDoVale(v, refComp)
      const item: ValeSt = { v, st, d }
      g.vales.push(item)
      g.saldoDevedor += st.valorRestante
      if (d) { g.valesDoMes.push(item); g.descontoMes += d.valorParcela }
    }
    let arr = Array.from(map.values())
    if (soComDesconto) arr = arr.filter(g => g.valesDoMes.length > 0)
    return arr.sort((a, b) => b.descontoMes - a.descontoMes || a.nome.localeCompare(b.nome))
  }, [vales, refComp, soComDesconto, busca])

  const totais = useMemo(() => ({
    profissionais: grupos.length,
    descontoMes: grupos.reduce((s, g) => s + g.descontoMes, 0),
    saldo: grupos.reduce((s, g) => s + g.saldoDevedor, 0),
  }), [grupos])

  function toggle(id: string) {
    setAberto(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function montarConsolidado(g: Grupo): DadosReciboConsolidado {
    return {
      empresaNome: g.empresaNome,
      empresaCnpj: g.empresaCnpj,
      funcionarioNome: g.nome,
      funcao: g.funcao,
      refCompetencia: refComp,
      vales: g.valesDoMes.map(({ v, st, d }) => ({
        descricao: v.descricao,
        data: v.data,
        valorTotal: v.valor_total,
        parcelaAtual: d!.parcelaAtual,
        totalParcelas: d!.totalParcelas,
        valorParcela: d!.valorParcela,
        valorRestante: st.valorRestante,
      })),
      totalDescontadoNoMes: g.descontoMes,
      saldoDevedor: g.saldoDevedor,
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
    const comDesconto = grupos.filter(g => g.valesDoMes.length > 0)
    if (comDesconto.length === 0) { notify('Nenhum desconto nesta competência.', 'erro'); return }
    setGerando('__todos__')
    try {
      const { gerarMultiplosConsolidados } = await import('../../../services/gerarReciboValePDF')
      await gerarMultiplosConsolidados(comDesconto.map(montarConsolidado))
    } catch (err) { console.error(err); notify('Erro ao gerar recibos.', 'erro') }
    finally { setGerando(null) }
  }

  async function gerarXLSX() {
    if (grupos.length === 0) return
    setGerando('__xlsx__')
    try {
      const { utils, writeFile } = await import('xlsx')
      const resumo = grupos.map(g => ({
        'Profissional': g.nome,
        'Empresa': g.empresaNome,
        [`Desconto ${fmtMes(refComp)}`]: g.descontoMes,
        'Saldo Devedor': g.saldoDevedor,
      }))
      const detalhe = grupos.flatMap(g => g.valesDoMes.map(({ v, d, st }) => ({
        'Profissional': g.nome,
        'Empresa': g.empresaNome,
        'Descrição': v.descricao,
        'Parcela': d ? `${d.parcelaAtual}/${d.totalParcelas}` : '',
        'Valor Descontado': d?.valorParcela ?? 0,
        'Saldo Após': st.valorRestante,
      })))
      const wb = utils.book_new()
      utils.book_append_sheet(wb, utils.json_to_sheet(resumo), 'Resumo')
      utils.book_append_sheet(wb, utils.json_to_sheet(detalhe.length ? detalhe : [{}]), 'Descontos do mês')
      writeFile(wb, `descontos_vales_${refComp}.xlsx`)
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
            <div>
              <label className="label-field">Competência do fechamento</label>
              <input type="month" className="input-field" value={refComp} onChange={e => setRefComp(e.target.value)} />
              <p className="text-xs text-gray-400 mt-1">Mês que você está fechando.</p>
            </div>
            <div className="md:col-span-2">
              <label className="label-field">Empresa</label>
              <select className="input-field" value={empresaFiltro} onChange={e => setEmpresaFiltro(e.target.value)}>
                <option value="">Todas as empresas</option>
                {empresas.map(e => <option key={e.id} value={e.id}>{e.razao_social}</option>)}
              </select>
            </div>
            <div>
              <label className="label-field">Buscar</label>
              <input className="input-field" placeholder="Profissional ou descrição..." value={busca} onChange={e => setBusca(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-4 mt-4">
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" className="w-4 h-4" checked={soComDesconto} onChange={e => setSoComDesconto(e.target.checked)} />
              Somente com desconto em {fmtMes(refComp)}
            </label>
          </div>
        </div>

        {/* Resumo */}
        <div className="grid grid-cols-3 gap-4">
          <div className="card">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Profissionais</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{totais.profissionais}</p>
          </div>
          <div className="card">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">A Descontar em {fmtMes(refComp)}</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{formatarMoeda(totais.descontoMes)}</p>
          </div>
          <div className="card">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Saldo Devedor Total</p>
            <p className="text-2xl font-bold text-gray-700 mt-1">{formatarMoeda(totais.saldo)}</p>
          </div>
        </div>

        {/* Lista agrupada por profissional */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800">
              Descontos de {fmtMes(refComp)} · {grupos.length} profissional(is)
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
              Nenhum desconto em {fmtMes(refComp)}.<br />
              <span className="text-xs">Verifique a competência ou desmarque &quot;Somente com desconto&quot;. Lance vales em Pagamentos → Vales / Descontos.</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="table-header" style={{ width: 32 }}></th>
                    <th className="table-header">Profissional</th>
                    <th className="table-header text-center">Vales no mês</th>
                    <th className="table-header text-right">Desconto em {fmtMes(refComp)}</th>
                    <th className="table-header text-right">Saldo Devedor</th>
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
                            <div className="font-medium text-gray-900">{g.nome}</div>
                            <div className="text-xs text-gray-400">{g.empresaNome}</div>
                          </td>
                          <td className="table-cell text-center">{g.valesDoMes.length}</td>
                          <td className="table-cell text-right font-bold text-amber-700">
                            {g.descontoMes > 0 ? formatarMoeda(g.descontoMes) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="table-cell text-right text-gray-700">
                            {g.saldoDevedor > 0 ? formatarMoeda(g.saldoDevedor) : <span className="badge-green">Quitado</span>}
                          </td>
                          <td className="table-cell text-right">
                            <button
                              onClick={() => gerarRecibo(g)}
                              disabled={gerando === g.funcionario_id || g.valesDoMes.length === 0}
                              className="inline-flex items-center gap-1 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                              title={g.valesDoMes.length === 0 ? 'Sem desconto nesta competência' : 'Emitir recibo do mês'}
                            >
                              {gerando === g.funcionario_id ? 'Gerando...' : 'Recibo'}
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td />
                            <td colSpan={5} className="px-4 pb-4">
                              <div className="rounded-lg border border-gray-100 overflow-hidden">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="bg-gray-50 text-gray-500">
                                      <th className="text-left py-2 px-3 font-semibold">Descrição</th>
                                      <th className="text-center py-2 px-3 font-semibold">Parcela</th>
                                      <th className="text-right py-2 px-3 font-semibold">Desconto no mês</th>
                                      <th className="text-right py-2 px-3 font-semibold">Saldo após</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {g.vales.map(({ v, st, d }) => (
                                      <tr key={v.id} className={`border-t border-gray-100 ${d ? '' : 'text-gray-400'}`}>
                                        <td className="py-2 px-3">
                                          <span className="font-medium">{v.descricao}</span>
                                          {!d && <span className="ml-1 text-gray-400">(sem parcela em {fmtMes(refComp)})</span>}
                                        </td>
                                        <td className="py-2 px-3 text-center">{st.parcelas > 1 ? `${st.descontadas}/${st.parcelas}` : 'única'}</td>
                                        <td className="py-2 px-3 text-right font-medium text-amber-700">{d ? formatarMoeda(d.valorParcela) : '—'}</td>
                                        <td className="py-2 px-3 text-right">{st.valorRestante > 0 ? formatarMoeda(st.valorRestante) : '—'}</td>
                                      </tr>
                                    ))}
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
                    <td className="table-cell text-center font-semibold">{grupos.reduce((s, g) => s + g.valesDoMes.length, 0)}</td>
                    <td className="table-cell text-right font-bold text-amber-700">{formatarMoeda(totais.descontoMes)}</td>
                    <td className="table-cell text-right font-semibold text-gray-700">{formatarMoeda(totais.saldo)}</td>
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

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase, Empresa } from '../../../lib/supabase'
import { formatarMoeda, MESES } from '../../../utils/calculoVT'
import { competenciaMesAnterior } from '../../../lib/pagamentos'
import { consolidarFechamento, montarCSVFechamento, LinhaFechamento } from '../../../lib/fechamento'

function fmtMes(mes: string) {
  const [a, m] = mes.split('-').map(Number)
  return m ? `${MESES[m - 1]}/${a}` : mes
}

export default function FechamentoPage() {
  const [mesRef, setMesRef] = useState(competenciaMesAnterior())
  const [empresaFiltro, setEmpresaFiltro] = useState('')
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [linhas, setLinhas] = useState<LinhaFechamento[]>([])
  const [loading, setLoading] = useState(false)
  const [busca, setBusca] = useState('')
  const [gerando, setGerando] = useState<string | null>(null)

  const [msg, setMsg] = useState('')
  const [msgTipo, setMsgTipo] = useState<'ok' | 'erro'>('ok')

  useEffect(() => {
    supabase.from('empresas').select('*').order('razao_social').then(({ data }) => setEmpresas(data ?? []))
  }, [])

  const carregar = useCallback(async () => {
    const [ano, mes] = mesRef.split('-').map(Number)
    if (!ano || !mes) return
    setLoading(true)
    setLinhas(await consolidarFechamento({ mes, ano, empresaId: empresaFiltro || undefined }))
    setLoading(false)
  }, [mesRef, empresaFiltro])

  useEffect(() => { carregar() }, [carregar])

  function notify(text: string, tipo: 'ok' | 'erro') {
    setMsg(text); setMsgTipo(tipo)
    setTimeout(() => setMsg(''), 6000)
  }

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return linhas
    return linhas.filter(l => l.nome.toLowerCase().includes(q) || l.empresaNome.toLowerCase().includes(q))
  }, [linhas, busca])

  const totais = useMemo(() => ({
    liquido: filtradas.reduce((s, l) => s + l.liquido, 0),
    vtva: filtradas.reduce((s, l) => s + l.vtvaTotal, 0),
    vales: filtradas.reduce((s, l) => s + l.descontoVales, 0),
    pagar: filtradas.reduce((s, l) => s + l.totalPagar, 0),
  }), [filtradas])

  async function gerarReciboVTVA(l: LinhaFechamento) {
    if (!l.reciboVTVA) return
    setGerando('vtva:' + l.funcionario_id)
    try {
      const { gerarReciboPDF } = await import('../../../services/gerarReciboPDF')
      await gerarReciboPDF(l.reciboVTVA)
    } catch (e) { console.error(e); notify('Erro ao gerar recibo VT/VA.', 'erro') }
    finally { setGerando(null) }
  }

  async function gerarReciboVale(l: LinhaFechamento) {
    if (!l.reciboVales) return
    setGerando('vale:' + l.funcionario_id)
    try {
      const { gerarReciboConsolidadoPDF } = await import('../../../services/gerarReciboValePDF')
      await gerarReciboConsolidadoPDF(l.reciboVales)
    } catch (e) { console.error(e); notify('Erro ao gerar recibo de vale.', 'erro') }
    finally { setGerando(null) }
  }

  async function gerarTodosVTVA() {
    const lista = filtradas.filter(l => l.reciboVTVA).map(l => l.reciboVTVA!)
    if (lista.length === 0) { notify('Nenhum recibo de VT/VA nesta competência.', 'erro'); return }
    setGerando('__vtva__')
    try {
      const { gerarMultiplosPDFs } = await import('../../../services/gerarReciboPDF')
      await gerarMultiplosPDFs(lista)
    } catch (e) { console.error(e); notify('Erro ao gerar recibos VT/VA.', 'erro') }
    finally { setGerando(null) }
  }

  async function gerarTodosVales() {
    const lista = filtradas.filter(l => l.reciboVales).map(l => l.reciboVales!)
    if (lista.length === 0) { notify('Nenhum desconto de vale nesta competência.', 'erro'); return }
    setGerando('__vales__')
    try {
      const { gerarMultiplosConsolidados } = await import('../../../services/gerarReciboValePDF')
      await gerarMultiplosConsolidados(lista)
    } catch (e) { console.error(e); notify('Erro ao gerar recibos de vales.', 'erro') }
    finally { setGerando(null) }
  }

  function exportarCSV() {
    if (filtradas.length === 0) return
    const { csv, semPix } = montarCSVFechamento(filtradas)
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `fechamento_banco_${mesRef}.csv`; a.click()
    URL.revokeObjectURL(url)
    if (semPix > 0) notify(`CSV gerado. Atenção: ${semPix} profissional(is) sem chave Pix.`, 'erro')
    else notify('CSV do banco gerado com sucesso.', 'ok')
  }

  return (
    <LayoutAdmin title="Fechamento do Mês">
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
              <input type="month" className="input-field" value={mesRef} onChange={e => setMesRef(e.target.value)} />
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
              <input className="input-field" placeholder="Profissional ou empresa..." value={busca} onChange={e => setBusca(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Resumo */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Salário Líquido</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{formatarMoeda(totais.liquido)}</p>
          </div>
          <div className="card">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">VT / VA</p>
            <p className="text-2xl font-bold text-blue-700 mt-1">{formatarMoeda(totais.vtva)}</p>
          </div>
          <div className="card">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Vales (desc.)</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">- {formatarMoeda(totais.vales)}</p>
          </div>
          <div className="card">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total a Pagar</p>
            <p className="text-2xl font-bold text-green-700 mt-1">{formatarMoeda(totais.pagar)}</p>
          </div>
        </div>

        {/* Ações do fechamento */}
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-gray-800">
              {fmtMes(mesRef)} — {filtradas.length} profissional(is)
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-secondary text-sm" onClick={gerarTodosVTVA} disabled={gerando !== null || loading}>
                {gerando === '__vtva__' ? 'Gerando...' : 'Recibos VT/VA'}
              </button>
              <button className="btn-secondary text-sm" onClick={gerarTodosVales} disabled={gerando !== null || loading}>
                {gerando === '__vales__' ? 'Gerando...' : 'Recibos de Vales'}
              </button>
              <button className="btn-primary text-sm" onClick={exportarCSV} disabled={gerando !== null || loading || filtradas.length === 0}>
                CSV Banco
              </button>
            </div>
          </div>

          <div className="overflow-x-auto mt-4">
            {loading ? (
              <div className="text-center py-12 text-gray-400 text-sm">Carregando...</div>
            ) : filtradas.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                Nenhum profissional em {fmtMes(mesRef)}.<br />
                <span className="text-xs">Importe o salário líquido e/ou lance as competências de VT/VA.</span>
              </div>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="table-header">Empresa</th>
                    <th className="table-header">Profissional</th>
                    <th className="table-header text-right">Líquido</th>
                    <th className="table-header text-right">VT/VA</th>
                    <th className="table-header text-right">Vales</th>
                    <th className="table-header text-right">Total a Pagar</th>
                    <th className="table-header text-center">Pix</th>
                    <th className="table-header text-right">Recibos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtradas.map((l) => (
                    <tr key={l.funcionario_id} className="hover:bg-gray-50 transition-colors">
                      <td className="table-cell text-xs text-gray-500">{l.empresaNome}</td>
                      <td className="table-cell">
                        <div className="font-medium text-gray-900">{l.nome}</div>
                        {l.funcao && <div className="text-xs text-gray-400">{l.funcao}</div>}
                      </td>
                      <td className="table-cell text-right">{l.liquido > 0 ? formatarMoeda(l.liquido) : <span className="text-gray-300">—</span>}</td>
                      <td className="table-cell text-right text-blue-700">{l.vtvaTotal > 0 ? formatarMoeda(l.vtvaTotal) : <span className="text-gray-300">—</span>}</td>
                      <td className="table-cell text-right text-amber-700">{l.descontoVales > 0 ? `- ${formatarMoeda(l.descontoVales)}` : <span className="text-gray-300">—</span>}</td>
                      <td className="table-cell text-right font-bold text-green-700">{formatarMoeda(l.totalPagar)}</td>
                      <td className="table-cell text-center">
                        {l.pix
                          ? <span className="badge-green" title={l.pix}>ok</span>
                          : <span className="badge-red" title="Sem chave Pix">falta</span>}
                      </td>
                      <td className="table-cell text-right">
                        <div className="flex gap-2 justify-end items-center">
                          <button
                            onClick={() => gerarReciboVTVA(l)}
                            disabled={!l.reciboVTVA || gerando !== null}
                            className="text-blue-600 hover:text-blue-800 text-xs font-medium disabled:opacity-30"
                            title={l.reciboVTVA ? 'Recibo VT/VA' : 'Sem competência de VT/VA'}
                          >
                            {gerando === 'vtva:' + l.funcionario_id ? '...' : 'VT/VA'}
                          </button>
                          <button
                            onClick={() => gerarReciboVale(l)}
                            disabled={!l.reciboVales || gerando !== null}
                            className="text-amber-700 hover:text-amber-900 text-xs font-medium disabled:opacity-30"
                            title={l.reciboVales ? 'Recibo de vales do mês' : 'Sem desconto de vale no mês'}
                          >
                            {gerando === 'vale:' + l.funcionario_id ? '...' : 'Vale'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td colSpan={2} className="table-cell text-right text-sm font-semibold text-gray-600">Totais:</td>
                    <td className="table-cell text-right font-semibold">{formatarMoeda(totais.liquido)}</td>
                    <td className="table-cell text-right font-semibold text-blue-700">{formatarMoeda(totais.vtva)}</td>
                    <td className="table-cell text-right font-semibold text-amber-700">- {formatarMoeda(totais.vales)}</td>
                    <td className="table-cell text-right font-bold text-green-700">{formatarMoeda(totais.pagar)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      </div>
    </LayoutAdmin>
  )
}

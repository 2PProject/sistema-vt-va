'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase, Empresa } from '../../../lib/supabase'
import { formatarMoeda, MESES } from '../../../utils/calculoVT'
import { competenciaMesAnterior } from '../../../lib/pagamentos'
import { consolidarFechamento, montarCSVFechamento, montarReciboVTVAAvulso, LinhaFechamento } from '../../../lib/fechamento'
import { listarFechamentos, definirFechamento } from '../../../lib/fechamentoStatus'

function fmtMes(mes: string) {
  const [a, m] = mes.split('-').map(Number)
  return m ? `${MESES[m - 1]}/${a}` : mes
}
// Mês do VT/VA = mês seguinte ao do pagamento
function proxCompetencia(mesRef: string): { mes: number; ano: number; label: string } {
  const [a, m] = mesRef.split('-').map(Number)
  const d = new Date(a, m, 1)
  return { mes: d.getMonth() + 1, ano: d.getFullYear(), label: `${MESES[d.getMonth()]}/${d.getFullYear()}` }
}

type FuncAvulso = { id: string; nome: string; empresa_id: string; empresaNome: string }

export default function FechamentoPage() {
  const [mesRef, setMesRef] = useState(competenciaMesAnterior())
  const [empresaFiltro, setEmpresaFiltro] = useState('')
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [linhas, setLinhas] = useState<LinhaFechamento[]>([])
  const [loading, setLoading] = useState(false)
  const [busca, setBusca] = useState('')
  const [porEmpresa, setPorEmpresa] = useState(true)
  const [gerando, setGerando] = useState<string | null>(null)
  const [fechados, setFechados] = useState<Map<string, boolean>>(new Map())
  const [fechEmpresa, setFechEmpresa] = useState('')

  const [msg, setMsg] = useState('')
  const [msgTipo, setMsgTipo] = useState<'ok' | 'erro'>('ok')

  // Recibo avulso (funcionário novo, contratado após o fechamento)
  const [modalAvulso, setModalAvulso] = useState(false)
  const [funcsAvulso, setFuncsAvulso] = useState<FuncAvulso[]>([])
  const [avEmpresa, setAvEmpresa] = useState('')
  const [avFunc, setAvFunc] = useState('')
  const [avLoad, setAvLoad] = useState(false)

  useEffect(() => {
    supabase.from('funcionarios')
      .select('id, nome, ativo, unidades(empresa_id, empresas(razao_social))')
      .order('nome')
      .then(({ data }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const opts: FuncAvulso[] = (data ?? []).filter((f: any) => f.ativo !== false && (Array.isArray(f.unidades) ? f.unidades[0] : f.unidades)?.empresa_id)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((f: any) => {
            const uni = Array.isArray(f.unidades) ? f.unidades[0] : f.unidades
            const e = uni?.empresas ? (Array.isArray(uni.empresas) ? uni.empresas[0] : uni.empresas) : null
            return { id: f.id, nome: f.nome, empresa_id: uni.empresa_id, empresaNome: e?.razao_social ?? '' }
          })
        setFuncsAvulso(opts)
      })
  }, [])

  async function gerarAvulso() {
    if (!avFunc) { notify('Selecione o funcionário.', 'erro'); return }
    const { mes, ano } = proxCompetencia(mesRef)
    setAvLoad(true)
    try {
      const dados = await montarReciboVTVAAvulso(avFunc, mes, ano)
      if (!dados) { notify('Funcionário não encontrado.', 'erro'); return }
      const { gerarReciboPDF } = await import('../../../services/gerarReciboPDF')
      await gerarReciboPDF(dados)
      setModalAvulso(false)
      notify('Recibo VT/VA gerado.', 'ok')
    } catch (e) { console.error(e); notify('Erro ao gerar recibo.', 'erro') }
    finally { setAvLoad(false) }
  }

  useEffect(() => {
    supabase.from('empresas').select('*').order('razao_social').then(({ data }) => setEmpresas(data ?? []))
  }, [])

  const carregar = useCallback(async () => {
    const [ano, mes] = mesRef.split('-').map(Number)
    if (!ano || !mes) return
    setLoading(true)
    const [dados, status] = await Promise.all([
      consolidarFechamento({ mes, ano, empresaId: empresaFiltro || undefined }),
      listarFechamentos(mes, ano),
    ])
    setLinhas(dados)
    setFechados(status)
    setLoading(false)
  }, [mesRef, empresaFiltro])

  useEffect(() => { carregar() }, [carregar])

  async function alternarFechamento(empresaId: string, empresaNome: string, fechar: boolean) {
    const [ano, mes] = mesRef.split('-').map(Number)
    setGerando('fech:' + empresaId)
    const res = await definirFechamento(empresaId, mes, ano, fechar)
    setGerando(null)
    if (!res.ok) { notify(`Erro ao ${fechar ? 'fechar' : 'reabrir'}: ${res.erro ?? ''}`, 'erro'); return }
    setFechados(prev => { const n = new Map(prev); n.set(empresaId, fechar); return n })
    notify(`${empresaNome}: competência ${fmtMes(mesRef)} ${fechar ? 'FECHADA' : 'REABERTA'}.`, 'ok')
  }

  async function alternarTodas(fechar: boolean) {
    const [ano, mes] = mesRef.split('-').map(Number)
    const alvos = empresasNoFechamento.filter(e => (fechados.get(e.id) === true) !== fechar)
    if (alvos.length === 0) { notify(`Todas as empresas já estão ${fechar ? 'fechadas' : 'abertas'}.`, 'ok'); return }
    setGerando('fech:todas')
    const okIds: string[] = []
    for (const e of alvos) {
      const res = await definirFechamento(e.id, mes, ano, fechar)
      if (res.ok) okIds.push(e.id)
    }
    setGerando(null)
    setFechados(prev => { const n = new Map(prev); okIds.forEach(id => n.set(id, fechar)); return n })
    const falhas = alvos.length - okIds.length
    notify(`${okIds.length} empresa(s) ${fechar ? 'FECHADA(S)' : 'REABERTA(S)'} em ${fmtMes(mesRef)}.${falhas > 0 ? ` ${falhas} falhou(aram).` : ''}`, falhas > 0 ? 'erro' : 'ok')
  }

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

  // Empresas presentes no fechamento (para o painel de status)
  const empresasNoFechamento = useMemo(() => {
    const map = new Map<string, string>()
    for (const l of linhas) if (!map.has(l.empresa_id)) map.set(l.empresa_id, l.empresaNome)
    return Array.from(map.entries()).map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome))
  }, [linhas])

  // Agrupa por empresa quando "Todas" + opção ligada
  function slug(s: string) { return (s || 'empresa').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) }
  function lotesPorEmpresa(): { nome: string; linhas: LinhaFechamento[] }[] {
    if (empresaFiltro || !porEmpresa) return [{ nome: '', linhas: filtradas }]
    const map = new Map<string, { nome: string; linhas: LinhaFechamento[] }>()
    for (const l of filtradas) {
      let g = map.get(l.empresa_id)
      if (!g) { g = { nome: l.empresaNome, linhas: [] }; map.set(l.empresa_id, g) }
      g.linhas.push(l)
    }
    return Array.from(map.values())
  }

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
    const lotes = lotesPorEmpresa()
    const totalDocs = lotes.reduce((s, g) => s + g.linhas.filter(l => l.reciboVTVA).length, 0)
    if (totalDocs === 0) { notify('Nenhum recibo de VT/VA nesta competência.', 'erro'); return }
    setGerando('__vtva__')
    try {
      const { gerarMultiplosPDFs } = await import('../../../services/gerarReciboPDF')
      for (const g of lotes) {
        const lista = g.linhas.filter(l => l.reciboVTVA).map(l => l.reciboVTVA!)
        if (!lista.length) continue
        await gerarMultiplosPDFs(lista, `recibos_vtva_${mesRef}${g.nome ? '_' + slug(g.nome) : ''}.pdf`)
      }
    } catch (e) { console.error(e); notify('Erro ao gerar recibos VT/VA.', 'erro') }
    finally { setGerando(null) }
  }

  async function gerarTodosVales() {
    const lotes = lotesPorEmpresa()
    const totalDocs = lotes.reduce((s, g) => s + g.linhas.filter(l => l.reciboVales).length, 0)
    if (totalDocs === 0) { notify('Nenhum desconto de vale nesta competência.', 'erro'); return }
    setGerando('__vales__')
    try {
      const { gerarMultiplosConsolidados } = await import('../../../services/gerarReciboValePDF')
      for (const g of lotes) {
        const lista = g.linhas.filter(l => l.reciboVales).map(l => l.reciboVales!)
        if (!lista.length) continue
        await gerarMultiplosConsolidados(lista, `recibos_vales_${mesRef}${g.nome ? '_' + slug(g.nome) : ''}.pdf`)
      }
    } catch (e) { console.error(e); notify('Erro ao gerar recibos de vales.', 'erro') }
    finally { setGerando(null) }
  }

  function baixarCSV(csv: string, nome: string) {
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = nome; a.click()
    URL.revokeObjectURL(url)
  }

  async function gerarTudo() {
    if (filtradas.length === 0) { notify('Nada para gerar nesta competência.', 'erro'); return }
    setGerando('__tudo__')
    try {
      const { gerarMultiplosPDFs } = await import('../../../services/gerarReciboPDF')
      const { gerarMultiplosConsolidados } = await import('../../../services/gerarReciboValePDF')
      let semPix = 0
      const lotes = lotesPorEmpresa()
      for (const g of lotes) {
        const suf = g.nome ? '_' + slug(g.nome) : ''
        const vtva = g.linhas.filter(l => l.reciboVTVA).map(l => l.reciboVTVA!)
        if (vtva.length) await gerarMultiplosPDFs(vtva, `recibos_vtva_${mesRef}${suf}.pdf`)
        const vales = g.linhas.filter(l => l.reciboVales).map(l => l.reciboVales!)
        if (vales.length) await gerarMultiplosConsolidados(vales, `recibos_vales_${mesRef}${suf}.pdf`)
        const { csv, semPix: sp } = montarCSVFechamento(g.linhas)
        semPix += sp
        baixarCSV(csv, `fechamento_banco_${mesRef}${suf}.csv`)
      }
      const aviso = semPix > 0 ? ` Atenção: ${semPix} sem chave Pix.` : ''
      notify(`Fechamento gerado: recibos VT/VA, recibos de vales e CSV do banco.${aviso}`, semPix > 0 ? 'erro' : 'ok')
    } catch (e) { console.error(e); notify('Erro ao gerar o fechamento.', 'erro') }
    finally { setGerando(null) }
  }

  function exportarCSV() {
    if (filtradas.length === 0) return
    const lotes = lotesPorEmpresa()
    let semPix = 0
    for (const g of lotes) {
      const { csv, semPix: sp } = montarCSVFechamento(g.linhas)
      semPix += sp
      baixarCSV(csv, `fechamento_banco_${mesRef}${g.nome ? '_' + slug(g.nome) : ''}.csv`)
    }
    const qtd = lotes.length > 1 ? ` (${lotes.length} arquivos)` : ''
    if (semPix > 0) notify(`CSV gerado${qtd}. Atenção: ${semPix} profissional(is) sem chave Pix.`, 'erro')
    else notify(`CSV do banco gerado com sucesso${qtd}.`, 'ok')
  }

  const avFuncs = avEmpresa ? funcsAvulso.filter(f => f.empresa_id === avEmpresa) : funcsAvulso

  return (
    <LayoutAdmin
      title="Fechamento do Mês"
      actions={
        <button className="btn-secondary flex items-center gap-2 text-sm" onClick={() => { setModalAvulso(true); setAvEmpresa(empresaFiltro); setAvFunc('') }}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Recibo avulso VT/VA
        </button>
      }
    >
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
          {!empresaFiltro && (
            <div className="mt-4">
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input type="checkbox" className="w-4 h-4" checked={porEmpresa} onChange={e => setPorEmpresa(e.target.checked)} />
                Gerar arquivos separados por empresa (CSV e recibos)
              </label>
            </div>
          )}
        </div>

        {/* Fechamento do mês — um único fechamento por empresa (dropdown, escala) */}
        {empresasNoFechamento.length > 0 && (() => {
          const sel = fechEmpresa && empresasNoFechamento.some(e => e.id === fechEmpresa)
            ? fechEmpresa : (empresasNoFechamento[0]?.id ?? '')
          const fechadoSel = fechados.get(sel) === true
          const nomeSel = empresasNoFechamento.find(e => e.id === sel)?.nome ?? ''
          const totalFechadas = empresasNoFechamento.filter(e => fechados.get(e.id) === true).length
          const todasFechadas = totalFechadas === empresasNoFechamento.length
          return (
            <div className="card">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h2 className="text-sm font-semibold text-gray-700">Fechamento de {fmtMes(mesRef)}</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Um único fechamento por empresa trava TUDO do mês: salário, vales e VT/VA. Reabra para editar.</p>
                </div>
                <span className={`shrink-0 text-xs font-semibold px-2 py-1 rounded ${todasFechadas ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                  {totalFechadas}/{empresasNoFechamento.length} fechada(s)
                </span>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[240px]">
                  <label className="label-field">Empresa</label>
                  <select className="input-field" value={sel} onChange={e => setFechEmpresa(e.target.value)}>
                    {empresasNoFechamento.map(e => (
                      <option key={e.id} value={e.id}>{(fechados.get(e.id) ? '🔒 ' : '🔓 ') + e.nome}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-3 pb-0.5">
                  <span className={`text-sm font-semibold ${fechadoSel ? 'text-red-600' : 'text-green-700'}`}>{fechadoSel ? '🔒 Fechado' : '🔓 Aberto'}</span>
                  <button
                    className={`text-sm font-medium px-4 py-2 rounded-lg text-white disabled:opacity-50 transition-colors ${fechadoSel ? 'bg-blue-600 hover:bg-blue-700' : 'bg-red-600 hover:bg-red-700'}`}
                    onClick={() => alternarFechamento(sel, nomeSel, !fechadoSel)}
                    disabled={!sel || gerando === 'fech:' + sel}
                  >
                    {gerando === 'fech:' + sel ? '...' : fechadoSel ? 'Reabrir empresa' : 'Fechar empresa'}
                  </button>
                </div>
                <div className="flex gap-2 pb-0.5">
                  <button className="btn-secondary text-sm" onClick={() => alternarTodas(true)} disabled={gerando !== null}>Fechar todas</button>
                  <button className="btn-secondary text-sm" onClick={() => alternarTodas(false)} disabled={gerando !== null}>Reabrir todas</button>
                </div>
              </div>
            </div>
          )
        })()}


        {/* Resumo */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Salário Líquido</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{formatarMoeda(totais.liquido)}</p>
          </div>
          <div className="card">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">VT / VA <span className="normal-case text-[10px] text-gray-400">(mês seg.)</span></p>
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
              <button className="btn-secondary text-sm" onClick={exportarCSV} disabled={gerando !== null || loading || filtradas.length === 0}>
                CSV Banco
              </button>
              <button
                className="text-sm bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors font-medium"
                onClick={gerarTudo}
                disabled={gerando !== null || loading || filtradas.length === 0}
              >
                {gerando === '__tudo__' ? 'Gerando...' : '✓ Gerar Tudo'}
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

        {/* Modal Recibo avulso VT/VA */}
        {modalAvulso && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) setModalAvulso(false) }}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
              <h2 className="text-lg font-bold text-gray-800 mb-1">Recibo avulso VT/VA</h2>
              <p className="text-xs text-gray-500 mb-4">
                Para funcionário contratado após o fechamento. Gera o recibo de <strong>{proxCompetencia(mesRef).label}</strong> com
                os valores do cadastro (proporcional à admissão), sem alterar nada do fechamento.
              </p>
              <div className="space-y-4">
                <div>
                  <label className="label-field">Empresa</label>
                  <select className="input-field" value={avEmpresa} onChange={e => { setAvEmpresa(e.target.value); setAvFunc('') }}>
                    <option value="">Todas as empresas</option>
                    {empresas.map(e => <option key={e.id} value={e.id}>{e.razao_social}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label-field">Funcionário</label>
                  <select className="input-field" value={avFunc} onChange={e => setAvFunc(e.target.value)}>
                    <option value="">Selecione o funcionário</option>
                    {avFuncs.map(f => <option key={f.id} value={f.id}>{f.nome}{avEmpresa ? '' : ` — ${f.empresaNome}`}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-3 pt-5">
                <button className="btn-primary flex-1" onClick={gerarAvulso} disabled={avLoad || !avFunc}>
                  {avLoad ? 'Gerando...' : 'Gerar recibo'}
                </button>
                <button className="btn-secondary flex-1" onClick={() => setModalAvulso(false)}>Cancelar</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </LayoutAdmin>
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase, Empresa } from '../../../lib/supabase'
import { listarRegistros, RegistroComDetalhes } from '../../../lib/salao'

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

function mesAtual() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
}

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type SortField = 'nome' | 'empresa' | 'mes' | 'comissao' | 'status'
type SortDir = 'asc' | 'desc'

function SortIcon({ field, active, dir }: { field: string; active: boolean; dir: SortDir }) {
  if (!active) return <span className="ml-1 text-slate-400">↕</span>
  return <span className="ml-1 text-blue-600">{dir === 'asc' ? '↑' : '↓'}</span>
}

type ConsolidadoRow = {
  empresa_id: string
  empresa: string
  count: number
  pendentes: number
  recebidas: number
  foraPrazo: number
  total: number
}

export default function SalaoRelatoriosPage() {
  const [mesRef, setMesRef] = useState(mesAtual())
  const [empresaFiltro, setEmpresaFiltro] = useState('')
  const [statusFiltro, setStatusFiltro] = useState('')
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [todos, setTodos] = useState<RegistroComDetalhes[]>([])
  const [loading, setLoading] = useState(false)
  const [sortField, setSortField] = useState<SortField>('nome')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  useEffect(() => {
    supabase.from('empresas').select('*').order('razao_social').then(r => setEmpresas(r.data ?? []))
  }, [])

  const carregar = useCallback(async () => {
    setLoading(true)
    const data = await listarRegistros({
      mesReferencia: mesRef || undefined,
      empresaId: empresaFiltro || undefined,
    })
    setTodos(data)
    setLoading(false)
  }, [mesRef, empresaFiltro])

  useEffect(() => { carregar() }, [carregar])

  // KPIs
  const kpis = {
    total: todos.length,
    pendente: todos.filter(r => r.status === 'pendente').length,
    recebida: todos.filter(r => r.status === 'nf_recebida').length,
    foraPrazo: todos.filter(r => r.status === 'fora_do_prazo').length,
    totalBRL: todos.reduce((s, r) => s + r.valor_comissao, 0),
  }

  // Consolidado by empresa (always from full dataset)
  const consolidado: ConsolidadoRow[] = (() => {
    const map = new Map<string, ConsolidadoRow>()
    todos.forEach(r => {
      const k = r.empresa_id
      const ex = map.get(k)
      if (ex) {
        ex.total += r.valor_comissao
        ex.count++
        if (r.status === 'pendente') ex.pendentes++
        else if (r.status === 'nf_recebida') ex.recebidas++
        else ex.foraPrazo++
      } else {
        map.set(k, {
          empresa_id: k,
          empresa: r.empresas?.razao_social ?? '—',
          total: r.valor_comissao,
          count: 1,
          pendentes: r.status === 'pendente' ? 1 : 0,
          recebidas: r.status === 'nf_recebida' ? 1 : 0,
          foraPrazo: r.status === 'fora_do_prazo' ? 1 : 0,
        })
      }
    })
    return Array.from(map.values()).sort((a, b) => a.empresa.localeCompare(b.empresa))
  })()

  // Filtered + sorted detail list
  const detalhe = (() => {
    let list = statusFiltro ? todos.filter(r => r.status === statusFiltro) : todos
    list = [...list].sort((a, b) => {
      let va = '', vb = ''
      if (sortField === 'nome') { va = a.profissionais?.nome ?? ''; vb = b.profissionais?.nome ?? '' }
      else if (sortField === 'empresa') { va = a.empresas?.razao_social ?? ''; vb = b.empresas?.razao_social ?? '' }
      else if (sortField === 'mes') { va = a.mes_referencia; vb = b.mes_referencia }
      else if (sortField === 'status') { va = a.status; vb = b.status }
      else if (sortField === 'comissao') {
        const diff = a.valor_comissao - b.valor_comissao
        return sortDir === 'asc' ? diff : -diff
      }
      const cmp = va.localeCompare(vb)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return list
  })()

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  function Th({ field, label, right }: { field: SortField; label: string; right?: boolean }) {
    return (
      <th
        className="table-header cursor-pointer select-none"
        style={right ? { textAlign: 'right' } : {}}
        onClick={() => toggleSort(field)}
      >
        {label}<SortIcon field={field} active={sortField === field} dir={sortDir} />
      </th>
    )
  }

  const [ano, mesNum] = mesRef.split('-').map(Number)
  const mesLabel = mesNum ? `${MESES[mesNum-1]}/${ano}` : mesRef

  async function exportarExcel() {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()

    // Sheet 1 – Resumo KPIs
    const wsResumo = XLSX.utils.aoa_to_sheet([
      ['Relatório Salão NF – ' + mesLabel],
      [],
      ['Indicador', 'Valor'],
      ['Total de Registros', kpis.total],
      ['Pendentes', kpis.pendente],
      ['NF Recebidas', kpis.recebida],
      ['Fora do Prazo', kpis.foraPrazo],
      ['Total de Comissões (R$)', kpis.totalBRL],
    ])
    XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo')

    // Sheet 2 – Por Empresa
    const wsEmpresa = XLSX.utils.json_to_sheet(consolidado.map(r => ({
      'Empresa': r.empresa,
      'Total Registros': r.count,
      'Pendentes': r.pendentes,
      'NF Recebidas': r.recebidas,
      'Fora do Prazo': r.foraPrazo,
      '% Recebidas': r.count > 0 ? Math.round(r.recebidas / r.count * 100) + '%' : '0%',
      'Total Comissões (R$)': r.total,
    })))
    XLSX.utils.book_append_sheet(wb, wsEmpresa, 'Por Empresa')

    // Sheet 3 – Detalhe
    const wsDetalhe = XLSX.utils.json_to_sheet(detalhe.map(r => {
      const [a2, m2] = r.mes_referencia.split('-').map(Number)
      const row: Record<string, unknown> = {
        'Profissional': r.profissionais?.nome ?? '—',
        'CPF/CNPJ': r.profissionais?.cpf ?? r.profissionais?.cnpj ?? '—',
        'Empresa': r.empresas?.razao_social ?? '—',
        'Mês Referência': `${MESES[m2-1]}/${a2}`,
        'Comissão (R$)': r.valor_comissao,
        'Status': r.status === 'pendente' ? 'Pendente' : r.status === 'nf_recebida' ? 'NF Recebida' : 'Fora do Prazo',
      }
      if (r.confirmacao) {
        row['Número NF'] = r.confirmacao.numero_nf
        row['Data NF'] = r.confirmacao.data_nf
        row['Valor NF (R$)'] = r.confirmacao.valor_nf
      }
      return row
    }))
    XLSX.utils.book_append_sheet(wb, wsDetalhe, 'Detalhe')

    XLSX.writeFile(wb, `relatorio_salao_${mesRef}${empresaFiltro ? '_emp' : ''}${statusFiltro ? '_' + statusFiltro : ''}.xlsx`)
  }

  async function exportarPDF() {
    const { default: jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const W = 297
    const M = 15
    let y = 0

    // Header bar
    doc.setFillColor(15, 23, 42)
    doc.rect(0, 0, W, 18, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.text('Relatório Salão NF – ' + mesLabel, W / 2, 11, { align: 'center' })
    y = 26

    // KPI boxes
    const kpiBoxes = [
      { label: 'Total', val: String(kpis.total), color: [59, 130, 246] as [number,number,number] },
      { label: 'Pendentes', val: String(kpis.pendente), color: [245, 158, 11] as [number,number,number] },
      { label: 'NF Recebidas', val: String(kpis.recebida), color: [34, 197, 94] as [number,number,number] },
      { label: 'Fora do Prazo', val: String(kpis.foraPrazo), color: [239, 68, 68] as [number,number,number] },
      { label: 'Total R$', val: 'R$ ' + fmtBRL(kpis.totalBRL), color: [99, 102, 241] as [number,number,number] },
    ]
    const boxW = (W - M * 2 - 4 * 4) / 5
    kpiBoxes.forEach((box, i) => {
      const x = M + i * (boxW + 4)
      doc.setFillColor(...box.color)
      doc.roundedRect(x, y, boxW, 16, 2, 2, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(7)
      doc.setFont('helvetica', 'normal')
      doc.text(box.label, x + boxW / 2, y + 5, { align: 'center' })
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.text(box.val, x + boxW / 2, y + 12, { align: 'center' })
    })
    y += 24

    // Consolidado table
    doc.setTextColor(15, 23, 42)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text('Consolidado por Empresa', M, y)
    y += 5
    doc.setFillColor(241, 245, 249)
    doc.rect(M, y, W - M * 2, 7, 'F')
    doc.setFontSize(7.5)
    doc.text('Empresa', M + 2, y + 5)
    doc.text('Total', 100, y + 5, { align: 'right' })
    doc.text('Pendentes', 122, y + 5, { align: 'right' })
    doc.text('Recebidas', 146, y + 5, { align: 'right' })
    doc.text('Fora Prazo', 170, y + 5, { align: 'right' })
    doc.text('% Recebidas', 200, y + 5, { align: 'right' })
    doc.text('Total R$', W - M - 2, y + 5, { align: 'right' })
    y += 8
    doc.setFont('helvetica', 'normal')
    consolidado.forEach((row, i) => {
      if (i % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(M, y - 2, W - M * 2, 6, 'F') }
      doc.setTextColor(15, 23, 42)
      const pct = row.count > 0 ? Math.round(row.recebidas / row.count * 100) : 0
      doc.text(row.empresa, M + 2, y + 2)
      doc.text(String(row.count), 100, y + 2, { align: 'right' })
      doc.text(String(row.pendentes), 122, y + 2, { align: 'right' })
      doc.text(String(row.recebidas), 146, y + 2, { align: 'right' })
      doc.text(String(row.foraPrazo), 170, y + 2, { align: 'right' })
      doc.text(pct + '%', 200, y + 2, { align: 'right' })
      doc.text('R$ ' + fmtBRL(row.total), W - M - 2, y + 2, { align: 'right' })
      y += 6
      if (y > 170) { doc.addPage(); y = 20 }
    })
    y += 6

    // Detail table
    if (y > 160) { doc.addPage(); y = 20 }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(15, 23, 42)
    doc.text('Detalhamento', M, y)
    y += 5
    doc.setFillColor(241, 245, 249)
    doc.rect(M, y, W - M * 2, 7, 'F')
    doc.setFontSize(7.5)
    doc.text('Profissional', M + 2, y + 5)
    doc.text('Empresa', 90, y + 5)
    doc.text('Referência', 160, y + 5)
    doc.text('Comissão', 200, y + 5, { align: 'right' })
    doc.text('Status', W - M - 2, y + 5, { align: 'right' })
    y += 8
    doc.setFont('helvetica', 'normal')
    detalhe.forEach((r, i) => {
      if (i % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(M, y - 2, W - M * 2, 6, 'F') }
      doc.setTextColor(15, 23, 42)
      const [a2, m2] = r.mes_referencia.split('-').map(Number)
      const st = r.status === 'pendente' ? 'Pendente' : r.status === 'nf_recebida' ? 'NF Recebida' : 'Fora do Prazo'
      doc.text((r.profissionais?.nome ?? '—').substring(0, 28), M + 2, y + 2)
      doc.text((r.empresas?.razao_social ?? '—').substring(0, 30), 90, y + 2)
      doc.text(`${MESES[m2-1]}/${a2}`, 160, y + 2)
      doc.text('R$ ' + fmtBRL(r.valor_comissao), 200, y + 2, { align: 'right' })
      doc.text(st, W - M - 2, y + 2, { align: 'right' })
      y += 6
      if (y > 190) { doc.addPage(); y = 20 }
    })

    // Footer
    const pages = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages()
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p)
      doc.setFontSize(7)
      doc.setTextColor(148, 163, 184)
      doc.text(`Gerado em ${new Date().toLocaleDateString('pt-BR')} · Página ${p}/${pages}`, W / 2, 207, { align: 'center' })
    }

    doc.save(`relatorio_salao_${mesRef}.pdf`)
  }

  return (
    <LayoutAdmin
      title="Relatórios – Salão NF"
      actions={
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={exportarPDF} disabled={loading || todos.length === 0}>Exportar PDF</button>
          <button className="btn-secondary" onClick={exportarExcel} disabled={loading || todos.length === 0}>Exportar Excel</button>
        </div>
      }
    >
      <div className="space-y-5">

        {/* Filtros */}
        <div className="card">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="form-group" style={{ marginBottom: 0, minWidth: 160 }}>
              <label className="label-field">Mês Referência</label>
              <input type="month" className="input-field" value={mesRef} onChange={e => setMesRef(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 0, minWidth: 200 }}>
              <label className="label-field">Empresa</label>
              <select className="input-field" value={empresaFiltro} onChange={e => setEmpresaFiltro(e.target.value)}>
                <option value="">Todas as empresas</option>
                {empresas.map(e => <option key={e.id} value={e.id}>{e.razao_social}</option>)}
              </select>
            </div>
            <button className="btn-primary" onClick={carregar} disabled={loading}>
              {loading ? 'Carregando...' : 'Atualizar'}
            </button>
            {loading && (
              <span className="text-sm text-slate-500 flex items-center gap-1">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Carregando dados...
              </span>
            )}
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {/* Total */}
          <div
            className="rounded-xl p-4 cursor-pointer transition-all hover:scale-105"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)', color: 'white' }}
            onClick={() => setStatusFiltro('')}
          >
            <p className="text-xs font-medium opacity-80">Total Geral</p>
            <p className="text-3xl font-bold mt-1">{kpis.total}</p>
            <p className="text-xs opacity-70 mt-1">R$ {fmtBRL(kpis.totalBRL)}</p>
          </div>

          {/* Pendentes */}
          <div
            className={`rounded-xl p-4 cursor-pointer transition-all hover:scale-105 ${statusFiltro === 'pendente' ? 'ring-2 ring-amber-400' : ''}`}
            style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: 'white' }}
            onClick={() => setStatusFiltro(s => s === 'pendente' ? '' : 'pendente')}
          >
            <p className="text-xs font-medium opacity-80">Pendentes</p>
            <p className="text-3xl font-bold mt-1">{kpis.pendente}</p>
            <p className="text-xs opacity-70 mt-1">{kpis.total > 0 ? Math.round(kpis.pendente / kpis.total * 100) : 0}% do total</p>
          </div>

          {/* NF Recebidas */}
          <div
            className={`rounded-xl p-4 cursor-pointer transition-all hover:scale-105 ${statusFiltro === 'nf_recebida' ? 'ring-2 ring-green-400' : ''}`}
            style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: 'white' }}
            onClick={() => setStatusFiltro(s => s === 'nf_recebida' ? '' : 'nf_recebida')}
          >
            <p className="text-xs font-medium opacity-80">NF Recebidas</p>
            <p className="text-3xl font-bold mt-1">{kpis.recebida}</p>
            <p className="text-xs opacity-70 mt-1">{kpis.total > 0 ? Math.round(kpis.recebida / kpis.total * 100) : 0}% do total</p>
          </div>

          {/* Fora do Prazo */}
          <div
            className={`rounded-xl p-4 cursor-pointer transition-all hover:scale-105 ${statusFiltro === 'fora_do_prazo' ? 'ring-2 ring-red-400' : ''}`}
            style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)', color: 'white' }}
            onClick={() => setStatusFiltro(s => s === 'fora_do_prazo' ? '' : 'fora_do_prazo')}
          >
            <p className="text-xs font-medium opacity-80">Fora do Prazo</p>
            <p className="text-3xl font-bold mt-1">{kpis.foraPrazo}</p>
            <p className="text-xs opacity-70 mt-1">{kpis.total > 0 ? Math.round(kpis.foraPrazo / kpis.total * 100) : 0}% do total</p>
          </div>

          {/* Taxa de Recebimento */}
          <div className="rounded-xl p-4" style={{ background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', color: 'white' }}>
            <p className="text-xs font-medium opacity-80">Taxa de Recebimento</p>
            <p className="text-3xl font-bold mt-1">
              {kpis.total > 0 ? Math.round(kpis.recebida / kpis.total * 100) : 0}%
            </p>
            <p className="text-xs opacity-70 mt-1">{kpis.recebida} de {kpis.total} registros</p>
          </div>
        </div>

        {/* Status filter active badge */}
        {statusFiltro && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">Filtrando por:</span>
            <span className={`badge ${statusFiltro === 'pendente' ? 'badge-amber' : statusFiltro === 'nf_recebida' ? 'badge-green' : 'badge-red'}`}>
              {statusFiltro === 'pendente' ? 'Pendentes' : statusFiltro === 'nf_recebida' ? 'NF Recebidas' : 'Fora do Prazo'}
            </span>
            <button className="text-xs text-blue-600 hover:underline" onClick={() => setStatusFiltro('')}>Limpar filtro</button>
          </div>
        )}

        {/* Consolidado por Empresa */}
        {consolidado.length > 0 && (
          <div className="card">
            <h2 className="text-sm font-bold text-slate-700 mb-3">Consolidado por Empresa – {mesLabel}</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="table-header">Empresa</th>
                    <th className="table-header" style={{ textAlign: 'right' }}>Total</th>
                    <th className="table-header" style={{ textAlign: 'right' }}>Pendentes</th>
                    <th className="table-header" style={{ textAlign: 'right' }}>Recebidas</th>
                    <th className="table-header" style={{ textAlign: 'right' }}>Fora Prazo</th>
                    <th className="table-header" style={{ minWidth: 120 }}>% Recebidas</th>
                    <th className="table-header" style={{ textAlign: 'right' }}>Total R$</th>
                  </tr>
                </thead>
                <tbody>
                  {consolidado.map((row, i) => {
                    const pct = row.count > 0 ? Math.round(row.recebidas / row.count * 100) : 0
                    const barColor = pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444'
                    return (
                      <tr key={i} className="hover:bg-slate-50 cursor-pointer" onClick={() => setEmpresaFiltro(row.empresa_id)}>
                        <td className="table-cell font-semibold">{row.empresa}</td>
                        <td className="table-cell text-right">{row.count}</td>
                        <td className="table-cell text-right">
                          {row.pendentes > 0 ? <span className="badge badge-amber">{row.pendentes}</span> : <span className="text-slate-400">0</span>}
                        </td>
                        <td className="table-cell text-right">
                          {row.recebidas > 0 ? <span className="badge badge-green">{row.recebidas}</span> : <span className="text-slate-400">0</span>}
                        </td>
                        <td className="table-cell text-right">
                          {row.foraPrazo > 0 ? <span className="badge badge-red">{row.foraPrazo}</span> : <span className="text-slate-400">0</span>}
                        </td>
                        <td className="table-cell">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-slate-200 rounded-full h-2">
                              <div className="h-2 rounded-full transition-all" style={{ width: pct + '%', background: barColor }} />
                            </div>
                            <span className="text-xs font-semibold tabular-nums" style={{ color: barColor, minWidth: 32, textAlign: 'right' }}>{pct}%</span>
                          </div>
                        </td>
                        <td className="table-cell text-right font-semibold">R$ {fmtBRL(row.total)}</td>
                      </tr>
                    )
                  })}
                  {/* Totals row */}
                  <tr className="bg-slate-100 font-bold">
                    <td className="table-cell">Total</td>
                    <td className="table-cell text-right">{kpis.total}</td>
                    <td className="table-cell text-right">{kpis.pendente}</td>
                    <td className="table-cell text-right">{kpis.recebida}</td>
                    <td className="table-cell text-right">{kpis.foraPrazo}</td>
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-200 rounded-full h-2">
                          <div className="h-2 rounded-full bg-blue-500" style={{ width: (kpis.total > 0 ? Math.round(kpis.recebida / kpis.total * 100) : 0) + '%' }} />
                        </div>
                        <span className="text-xs font-bold tabular-nums text-blue-600" style={{ minWidth: 32, textAlign: 'right' }}>
                          {kpis.total > 0 ? Math.round(kpis.recebida / kpis.total * 100) : 0}%
                        </span>
                      </div>
                    </td>
                    <td className="table-cell text-right">R$ {fmtBRL(kpis.totalBRL)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Detalhe */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-700">
              Detalhamento
              {statusFiltro && (
                <span className="ml-2 font-normal text-slate-500">
                  · {statusFiltro === 'pendente' ? 'Pendentes' : statusFiltro === 'nf_recebida' ? 'NF Recebidas' : 'Fora do Prazo'}
                </span>
              )}
            </h2>
            <span className="text-xs text-slate-500">{detalhe.length} registro(s)</span>
          </div>

          {loading ? (
            <div className="loading">Carregando...</div>
          ) : detalhe.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-sm">Nenhum registro encontrado para os filtros selecionados.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <Th field="nome" label="Profissional" />
                    <Th field="empresa" label="Empresa" />
                    <Th field="mes" label="Referência" />
                    <Th field="comissao" label="Comissão" right />
                    <Th field="status" label="Status" />
                    <th className="table-header">NF</th>
                  </tr>
                </thead>
                <tbody>
                  {detalhe.map(r => {
                    const [a2, m2] = r.mes_referencia.split('-').map(Number)
                    return (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td className="table-cell font-semibold">{r.profissionais?.nome ?? '—'}</td>
                        <td className="table-cell">{r.empresas?.razao_social ?? '—'}</td>
                        <td className="table-cell">{MESES[m2-1]}/{a2}</td>
                        <td className="table-cell text-right">R$ {fmtBRL(r.valor_comissao)}</td>
                        <td className="table-cell">
                          <span className={`badge ${r.status === 'pendente' ? 'badge-amber' : r.status === 'nf_recebida' ? 'badge-green' : 'badge-red'}`}>
                            {r.status === 'pendente' ? 'Pendente' : r.status === 'nf_recebida' ? 'NF Recebida' : 'Fora do Prazo'}
                          </span>
                        </td>
                        <td className="table-cell text-xs text-slate-500">
                          {r.confirmacao
                            ? `NF ${r.confirmacao.numero_nf} · ${r.confirmacao.data_nf?.split('-').reverse().join('/')}`
                            : <span className="text-slate-300">—</span>
                          }
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </LayoutAdmin>
  )
}

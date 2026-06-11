'use client'

import { useState } from 'react'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase, Empresa, SalaoNFStatus } from '../../../lib/supabase'
import { listarRegistros, RegistroComDetalhes } from '../../../lib/salao'

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

const RELATORIOS = [
  { id: 'pendencias', label: 'Pendências do Mês', desc: 'Profissionais que ainda não entregaram NF', status: 'pendente' as SalaoNFStatus },
  { id: 'recebidas', label: 'Notas Recebidas', desc: 'NFs confirmadas no período', status: 'nf_recebida' as SalaoNFStatus },
  { id: 'fora_prazo', label: 'Fora do Prazo', desc: 'Registros com prazo vencido', status: 'fora_do_prazo' as SalaoNFStatus },
  { id: 'consolidado', label: 'Consolidado por Empresa', desc: 'Resumo total por empresa', status: undefined },
]

function mesAtual() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
}

export default function SalaoRelatoriosPage() {
  const [relatorio, setRelatorio] = useState('pendencias')
  const [mesRef, setMesRef] = useState(mesAtual())
  const [empresaFiltro, setEmpresaFiltro] = useState('')
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [dados, setDados] = useState<RegistroComDetalhes[]>([])
  const [loading, setLoading] = useState(false)
  const [gerado, setGerado] = useState(false)

  useState(() => {
    supabase.from('empresas').select('*').order('razao_social').then(r => setEmpresas(r.data ?? []))
  })

  async function gerar() {
    setLoading(true)
    setGerado(false)
    const rel = RELATORIOS.find(r => r.id === relatorio)
    const data = await listarRegistros({
      mesReferencia: mesRef || undefined,
      empresaId: empresaFiltro || undefined,
      status: rel?.status,
    })
    setDados(data)
    setLoading(false)
    setGerado(true)
  }

  async function exportarPDF() {
    const { default: jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const W = 297
    const margin = 15
    let y = 20

    const [ano, mesNum] = mesRef.split('-').map(Number)
    const mesLabel = mesNum ? `${MESES[mesNum-1]}/${ano}` : mesRef
    const rel = RELATORIOS.find(r => r.id === relatorio)

    doc.setFillColor(30, 41, 59)
    doc.rect(0, 0, W, 16, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text(`${rel?.label ?? relatorio} – ${mesLabel}`, W / 2, 10, { align: 'center' })

    y = 26
    doc.setTextColor(30, 41, 59)

    if (relatorio === 'consolidado') {
      // Group by empresa
      const byEmpresa = new Map<string, { empresa: string; total: number; count: number; pendentes: number; recebidas: number; foraPrazo: number }>()
      dados.forEach(r => {
        const k = r.empresa_id
        const existing = byEmpresa.get(k)
        if (existing) {
          existing.total += r.valor_comissao
          existing.count++
          if (r.status === 'pendente') existing.pendentes++
          else if (r.status === 'nf_recebida') existing.recebidas++
          else existing.foraPrazo++
        } else {
          byEmpresa.set(k, {
            empresa: r.empresas?.razao_social ?? '—',
            total: r.valor_comissao,
            count: 1,
            pendentes: r.status === 'pendente' ? 1 : 0,
            recebidas: r.status === 'nf_recebida' ? 1 : 0,
            foraPrazo: r.status === 'fora_do_prazo' ? 1 : 0,
          })
        }
      })

      doc.setFontSize(9)
      doc.setFont('helvetica', 'bold')
      doc.setFillColor(248, 250, 252)
      doc.rect(margin, y-4, W-margin*2, 8, 'F')
      doc.text('Empresa', margin+2, y+1)
      doc.text('Total Reg.', 100, y+1)
      doc.text('Pendentes', 130, y+1)
      doc.text('Recebidas', 165, y+1)
      doc.text('Fora Prazo', 200, y+1)
      doc.text('Total R$', W-margin-2, y+1, { align: 'right' })
      y += 10

      doc.setFont('helvetica', 'normal')
      byEmpresa.forEach(row => {
        doc.text(row.empresa, margin+2, y)
        doc.text(String(row.count), 100, y)
        doc.text(String(row.pendentes), 130, y)
        doc.text(String(row.recebidas), 165, y)
        doc.text(String(row.foraPrazo), 200, y)
        doc.text(`R$ ${row.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, W-margin-2, y, { align: 'right' })
        y += 7
        if (y > 180) { doc.addPage(); y = 20 }
      })
    } else {
      doc.setFontSize(9)
      doc.setFont('helvetica', 'bold')
      doc.setFillColor(248, 250, 252)
      doc.rect(margin, y-4, W-margin*2, 8, 'F')
      doc.text('Profissional', margin+2, y+1)
      doc.text('Empresa', 80, y+1)
      doc.text('Referência', 155, y+1)
      doc.text('Comissão', 185, y+1)
      if (relatorio === 'recebidas') doc.text('NF', 215, y+1)
      y += 10

      doc.setFont('helvetica', 'normal')
      dados.forEach(r => {
        const [a, m] = r.mes_referencia.split('-').map(Number)
        doc.text(r.profissionais?.nome ?? '—', margin+2, y)
        doc.text(r.empresas?.razao_social ?? '—', 80, y)
        doc.text(`${MESES[m-1]}/${a}`, 155, y)
        doc.text(`R$ ${r.valor_comissao.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 185, y)
        if (relatorio === 'recebidas' && r.confirmacao) doc.text(r.confirmacao.numero_nf, 215, y)
        y += 7
        if (y > 190) { doc.addPage(); y = 20 }
      })
    }

    doc.save(`relatorio_${relatorio}_${mesRef}.pdf`)
  }

  async function exportarExcel() {
    const XLSX = await import('xlsx')
    const [ano, mesNum] = mesRef.split('-').map(Number)
    const mesLabel = mesNum ? `${MESES[mesNum-1]}_${ano}` : mesRef

    let rows: Record<string, unknown>[]

    if (relatorio === 'consolidado') {
      const byEmpresa = new Map<string, { Empresa: string; Total: number; Pendentes: number; Recebidas: number; ForaPrazo: number }>()
      dados.forEach(r => {
        const k = r.empresa_id
        const ex = byEmpresa.get(k)
        if (ex) {
          ex.Total += r.valor_comissao
          if (r.status === 'pendente') ex.Pendentes++
          else if (r.status === 'nf_recebida') ex.Recebidas++
          else ex.ForaPrazo++
        } else {
          byEmpresa.set(k, {
            Empresa: r.empresas?.razao_social ?? '—',
            Total: r.valor_comissao,
            Pendentes: r.status === 'pendente' ? 1 : 0,
            Recebidas: r.status === 'nf_recebida' ? 1 : 0,
            ForaPrazo: r.status === 'fora_do_prazo' ? 1 : 0,
          })
        }
      })
      rows = Array.from(byEmpresa.values())
    } else {
      rows = dados.map(r => {
        const [a, m] = r.mes_referencia.split('-').map(Number)
        const row: Record<string, unknown> = {
          Profissional: r.profissionais?.nome ?? '—',
          CPF: r.profissionais?.cpf ?? '—',
          Empresa: r.empresas?.razao_social ?? '—',
          'Mês Referência': `${MESES[m-1]}/${a}`,
          'Comissão (R$)': r.valor_comissao,
          Status: r.status === 'pendente' ? 'Pendente' : r.status === 'nf_recebida' ? 'NF Recebida' : 'Fora do Prazo',
        }
        if (r.confirmacao) {
          row['Número NF'] = r.confirmacao.numero_nf
          row['Data NF'] = r.confirmacao.data_nf
          row['Valor NF (R$)'] = r.confirmacao.valor_nf
        }
        return row
      })
    }

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, ws, 'Relatório')
    XLSX.writeFile(wb, `relatorio_${relatorio}_${mesLabel}.xlsx`)
  }

  const rel = RELATORIOS.find(r => r.id === relatorio)
  const [ano, mesNum] = mesRef.split('-').map(Number)
  const mesLabel = mesNum ? `${MESES[mesNum-1]}/${ano}` : mesRef

  // Consolidado
  const consolidado = relatorio === 'consolidado' ? (() => {
    const byEmpresa = new Map<string, { empresa: string; total: number; count: number; pendentes: number; recebidas: number; foraPrazo: number }>()
    dados.forEach(r => {
      const k = r.empresa_id
      const ex = byEmpresa.get(k)
      if (ex) {
        ex.total += r.valor_comissao
        ex.count++
        if (r.status === 'pendente') ex.pendentes++
        else if (r.status === 'nf_recebida') ex.recebidas++
        else ex.foraPrazo++
      } else {
        byEmpresa.set(k, { empresa: r.empresas?.razao_social ?? '—', total: r.valor_comissao, count: 1, pendentes: r.status === 'pendente' ? 1 : 0, recebidas: r.status === 'nf_recebida' ? 1 : 0, foraPrazo: r.status === 'fora_do_prazo' ? 1 : 0 })
      }
    })
    return Array.from(byEmpresa.values())
  })() : null

  return (
    <LayoutAdmin
      title="Relatórios – Salão"
      actions={gerado && dados.length > 0 ? (
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={exportarPDF}>Exportar PDF</button>
          <button className="btn-secondary" onClick={exportarExcel}>Exportar Excel</button>
        </div>
      ) : undefined}
    >
      <div>

      {/* Seletor de relatório */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
        {RELATORIOS.map(r => (
          <div
            key={r.id}
            className="card"
            style={{ cursor: 'pointer', borderLeft: `4px solid ${relatorio === r.id ? '#3b82f6' : '#e2e8f0'}`, background: relatorio === r.id ? '#eff6ff' : '#fff', marginBottom: 0 }}
            onClick={() => setRelatorio(r.id)}
          >
            <div style={{ fontWeight: 700, fontSize: 13, color: relatorio === r.id ? '#1d4ed8' : '#374151' }}>{r.label}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{r.desc}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="card">
        <div className="form-grid" style={{ alignItems: 'flex-end' }}>
          <div className="form-group">
            <label className="label-field">Mês Referência</label>
            <input type="month" className="input-field" value={mesRef} onChange={e => setMesRef(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="label-field">Empresa</label>
            <select className="input-field" value={empresaFiltro} onChange={e => setEmpresaFiltro(e.target.value)}>
              <option value="">Todas as empresas</option>
              {empresas.map(e => <option key={e.id} value={e.id}>{e.razao_social}</option>)}
            </select>
          </div>
          <div>
            <button className="btn-primary" onClick={gerar} disabled={loading}>{loading ? 'Gerando...' : 'Gerar Relatório'}</button>
          </div>
        </div>
      </div>

      {loading && <div className="loading">Carregando...</div>}

      {gerado && !loading && (
        <>
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            <strong>{rel?.label}</strong> – {mesLabel} · {dados.length} registro(s) encontrado(s)
            {empresaFiltro && ` · ${empresas.find(e => e.id === empresaFiltro)?.razao_social}`}
          </div>

          {relatorio === 'consolidado' ? (
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="table-header">Empresa</th>
                      <th className="table-header">Total Reg.</th>
                      <th className="table-header">Pendentes</th>
                      <th className="table-header">Recebidas</th>
                      <th className="table-header">Fora Prazo</th>
                      <th className="table-header">Total R$</th>
                    </tr>
                  </thead>
                  <tbody>
                    {consolidado?.length === 0 && (
                      <tr><td colSpan={6} className="table-cell" style={{ textAlign: 'center', color: '#94a3b8' }}>Nenhum dado encontrado.</td></tr>
                    )}
                    {consolidado?.map((row, i) => (
                      <tr key={i}>
                        <td className="table-cell" style={{ fontWeight: 600 }}>{row.empresa}</td>
                        <td className="table-cell">{row.count}</td>
                        <td className="table-cell"><span className="badge badge-amber">{row.pendentes}</span></td>
                        <td className="table-cell"><span className="badge badge-green">{row.recebidas}</span></td>
                        <td className="table-cell"><span className="badge badge-red">{row.foraPrazo}</span></td>
                        <td className="table-cell" style={{ fontWeight: 600 }}>R$ {row.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="table-header">Profissional</th>
                      <th className="table-header">CPF</th>
                      <th className="table-header">Empresa</th>
                      <th className="table-header">Referência</th>
                      <th className="table-header">Comissão</th>
                      <th className="table-header">Status</th>
                      {relatorio === 'recebidas' && <th className="table-header">NF</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {dados.length === 0 && (
                      <tr><td className="table-cell" colSpan={relatorio === 'recebidas' ? 7 : 6} style={{ textAlign: 'center', color: '#94a3b8' }}>Nenhum dado encontrado.</td></tr>
                    )}
                    {dados.map(r => {
                      const [a, m] = r.mes_referencia.split('-').map(Number)
                      return (
                        <tr key={r.id}>
                          <td className="table-cell" style={{ fontWeight: 600 }}>{r.profissionais?.nome}</td>
                          <td className="table-cell">{r.profissionais?.cpf || <span style={{ color: '#94a3b8' }}>—</span>}</td>
                          <td className="table-cell">{r.empresas?.razao_social}</td>
                          <td className="table-cell">{MESES[m-1]}/{a}</td>
                          <td className="table-cell">R$ {r.valor_comissao.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                          <td className="table-cell">
                            <span className={`badge ${r.status === 'pendente' ? 'badge-amber' : r.status === 'nf_recebida' ? 'badge-green' : 'badge-red'}`}>
                              {r.status === 'pendente' ? 'Pendente' : r.status === 'nf_recebida' ? 'NF Recebida' : 'Fora do Prazo'}
                            </span>
                          </td>
                          {relatorio === 'recebidas' && (
                            <td className="table-cell" style={{ fontSize: 12 }}>
                              {r.confirmacao ? `NF ${r.confirmacao.numero_nf} · ${r.confirmacao.data_nf?.split('-').reverse().join('/')} · R$ ${r.confirmacao.valor_nf?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
      </div>
    </LayoutAdmin>
  )
}

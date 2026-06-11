'use client'

import { useEffect, useState } from 'react'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase, Empresa, SalaoConfigEmpresa } from '../../../lib/supabase'
import { listarConfigs, salvarConfig } from '../../../lib/salao'

type ConfigComEmpresa = SalaoConfigEmpresa & { empresas?: Empresa }

export default function SalaoConfigPage() {
  const [configs, setConfigs] = useState<ConfigComEmpresa[]>([])
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ empresa_id: '', dia_prazo: '10', tolerancia_valor: '0.01' })
  const [modal, setModal] = useState(false)
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => { carregar() }, [])

  async function carregar() {
    const [cfgs, emps] = await Promise.all([
      listarConfigs(),
      supabase.from('empresas').select('*').order('razao_social').then(r => r.data ?? []),
    ])
    setConfigs(cfgs)
    setEmpresas(emps as Empresa[])
  }

  function abrirNovo() {
    // Find first empresa without config
    const usadas = new Set(configs.map(c => c.empresa_id))
    const livre = empresas.find(e => !usadas.has(e.id))
    setForm({ empresa_id: livre?.id ?? empresas[0]?.id ?? '', dia_prazo: '10', tolerancia_valor: '0.01' })
    setEditId(null)
    setModal(true)
  }

  function abrirEditar(c: ConfigComEmpresa) {
    setForm({ empresa_id: c.empresa_id, dia_prazo: String(c.dia_prazo), tolerancia_valor: String(c.tolerancia_valor) })
    setEditId(c.id)
    setModal(true)
  }

  async function salvar() {
    if (!form.empresa_id) return
    setLoading(true)
    await salvarConfig({
      empresa_id: form.empresa_id,
      dia_prazo: parseInt(form.dia_prazo) || 10,
      tolerancia_valor: parseFloat(form.tolerancia_valor) || 0.01,
    })
    setLoading(false)
    setModal(false)
    setMsg('Configuração salva com sucesso.')
    carregar()
  }

  return (
    <LayoutAdmin title="Configurações – Salão" actions={<button className="btn-primary" onClick={abrirNovo}>+ Nova Config</button>}>
      <div>

      {msg && <div className="alert alert-success" style={{ marginBottom: 16 }}>{msg}</div>}

      <div className="alert alert-info" style={{ marginBottom: 16 }}>
        <strong>Prazo de entrega:</strong> dia do mês seguinte ao mês de referência. Ex: prazo = 10 significa que NFs de Janeiro devem ser entregues até dia 10 de Fevereiro.<br />
        <strong>Tolerância de valor:</strong> diferença máxima aceita entre o valor da NF e o valor da comissão registrada.
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="table-header">Empresa</th>
                <th className="table-header">Prazo (dia do mês seguinte)</th>
                <th className="table-header">Tolerância Valor</th>
                <th className="table-header" style={{ width: 100 }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {configs.length === 0 && (
                <tr><td className="table-cell" colSpan={4} style={{ textAlign: 'center', color: '#94a3b8' }}>
                  Nenhuma configuração. Configure uma empresa para ativar o controle de prazos.
                </td></tr>
              )}
              {configs.map(c => (
                <tr key={c.id}>
                  <td className="table-cell" style={{ fontWeight: 600 }}>{c.empresas?.razao_social ?? c.empresa_id}</td>
                  <td className="table-cell">
                    Dia <strong>{c.dia_prazo}</strong> do mês seguinte
                  </td>
                  <td className="table-cell">
                    ± R$ {c.tolerancia_valor.toFixed(2)}
                  </td>
                  <td className="table-cell">
                    <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => abrirEditar(c)}>Editar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Empresas sem config */}
      {(() => {
        const usadas = new Set(configs.map(c => c.empresa_id))
        const semConfig = empresas.filter(e => !usadas.has(e.id))
        if (semConfig.length === 0) return null
        return (
          <div className="alert alert-warn">
            <strong>{semConfig.length} empresa(s) sem configuração:</strong>{' '}
            {semConfig.map(e => e.razao_social).join(', ')}.
            {' '}Clique em "+ Nova Config" para configurar.
          </div>
        )
      })()}

      {modal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setModal(false) }}>
          <div className="modal">
            <div className="modal-title">{editId ? 'Editar Configuração' : 'Nova Configuração'}</div>
            <div className="form-grid">
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label className="label-field">Empresa *</label>
                <select className="input-field" value={form.empresa_id} onChange={e => setForm(f => ({ ...f, empresa_id: e.target.value }))} disabled={!!editId}>
                  <option value="">Selecione...</option>
                  {empresas.map(e => <option key={e.id} value={e.id}>{e.razao_social}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="label-field">Prazo – Dia do Mês Seguinte</label>
                <input type="number" min="1" max="31" className="input-field" value={form.dia_prazo} onChange={e => setForm(f => ({ ...f, dia_prazo: e.target.value }))} />
                <span className="text-muted">Ex: 10 = NFs de Janeiro vencem em 10/02</span>
              </div>
              <div className="form-group">
                <label className="label-field">Tolerância de Valor (R$)</label>
                <input type="number" step="0.01" min="0" className="input-field" value={form.tolerancia_valor} onChange={e => setForm(f => ({ ...f, tolerancia_valor: e.target.value }))} />
                <span className="text-muted">Diferença máxima aceita entre NF e comissão</span>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setModal(false)}>Cancelar</button>
              <button className="btn-primary" onClick={salvar} disabled={loading}>{loading ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </LayoutAdmin>
  )
}

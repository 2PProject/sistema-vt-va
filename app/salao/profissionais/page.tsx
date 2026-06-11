'use client'

import { useEffect, useState } from 'react'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase, SalaoProfissional, Empresa } from '../../../lib/supabase'
import { listarProfissionais, criarProfissional, atualizarProfissional, listarProfissionalEmpresas, vincularProfissionalEmpresa } from '../../../lib/salao'

const EMPTY = { nome: '', cpf: '', email: '', telefone: '', ativo: true }

export default function SalaoProfissionaisPage() {
  const [lista, setLista] = useState<SalaoProfissional[]>([])
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [form, setForm] = useState({ ...EMPTY })
  const [editId, setEditId] = useState<string | null>(null)
  const [modal, setModal] = useState(false)
  const [vinculoModal, setVinculoModal] = useState(false)
  const [profSel, setProfSel] = useState<SalaoProfissional | null>(null)
  const [vinculosProf, setVinculosProf] = useState<any[]>([])
  const [novaEmpresaId, setNovaEmpresaId] = useState('')
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(false)
  const [busca, setBusca] = useState('')

  useEffect(() => { carregar() }, [])

  async function carregar() {
    const [profs, emps] = await Promise.all([
      listarProfissionais(),
      supabase.from('empresas').select('*').order('razao_social').then(r => r.data ?? []),
    ])
    setLista(profs)
    setEmpresas(emps)
  }

  function abrirNovo() {
    setForm({ ...EMPTY })
    setEditId(null)
    setErro('')
    setModal(true)
  }

  function abrirEditar(p: SalaoProfissional) {
    setForm({ nome: p.nome, cpf: p.cpf ?? '', email: p.email ?? '', telefone: p.telefone ?? '', ativo: p.ativo ?? true })
    setEditId(p.id)
    setErro('')
    setModal(true)
  }

  async function salvar() {
    if (!form.nome.trim()) { setErro('Nome é obrigatório.'); return }
    setLoading(true)
    setErro('')
    const payload = { nome: form.nome, cpf: form.cpf || null, email: form.email || null, telefone: form.telefone || null, ativo: form.ativo }
    if (editId) {
      await atualizarProfissional(editId, payload)
    } else {
      await criarProfissional(payload)
    }
    setLoading(false)
    setModal(false)
    carregar()
  }

  async function abrirVinculos(p: SalaoProfissional) {
    setProfSel(p)
    setVinculoModal(true)
    const links = await listarProfissionalEmpresas(p.id)
    setVinculosProf(links)
    setNovaEmpresaId(empresas[0]?.id ?? '')
  }

  async function adicionarVinculo() {
    if (!profSel || !novaEmpresaId) return
    await vincularProfissionalEmpresa(profSel.id, novaEmpresaId)
    const links = await listarProfissionalEmpresas(profSel.id)
    setVinculosProf(links)
  }

  async function removerVinculo(vincId: string) {
    await supabase.from('salao_profissional_empresa').update({ ativo: false }).eq('id', vincId)
    const links = await listarProfissionalEmpresas(profSel!.id)
    setVinculosProf(links)
  }

  const filtrado = lista.filter(p =>
    p.nome.toLowerCase().includes(busca.toLowerCase()) ||
    (p.cpf ?? '').includes(busca)
  )

  return (
    <LayoutAdmin title="Profissionais – Salão" actions={<button className="btn-primary" onClick={abrirNovo}>+ Novo Profissional</button>}>
      <div>

      <div className="card" style={{ marginBottom: 16 }}>
        <input className="input-field" placeholder="Buscar por nome ou CPF..." value={busca} onChange={e => setBusca(e.target.value)} />
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="table-header">Nome</th>
                <th className="table-header">CPF</th>
                <th className="table-header">Email</th>
                <th className="table-header">Telefone</th>
                <th className="table-header">Status</th>
                <th className="table-header" style={{ width: 160 }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrado.length === 0 && (
                <tr><td className="table-cell" colSpan={6} style={{ textAlign: 'center', color: '#94a3b8' }}>Nenhum profissional cadastrado.</td></tr>
              )}
              {filtrado.map(p => (
                <tr key={p.id}>
                  <td className="table-cell" style={{ fontWeight: 600 }}>{p.nome}</td>
                  <td className="table-cell">{p.cpf || <span style={{ color: '#94a3b8' }}>—</span>}</td>
                  <td className="table-cell">{p.email || <span style={{ color: '#94a3b8' }}>—</span>}</td>
                  <td className="table-cell">{p.telefone || <span style={{ color: '#94a3b8' }}>—</span>}</td>
                  <td className="table-cell">
                    {p.ativo ? <span className="badge badge-green">Ativo</span> : <span className="badge badge-gray">Inativo</span>}
                  </td>
                  <td className="table-cell">
                    <div className="flex gap-2">
                      <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => abrirEditar(p)}>Editar</button>
                      <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12, background: '#ede9fe', border: '1px solid #c4b5fd', color: '#7c3aed' }} onClick={() => abrirVinculos(p)}>Empresas</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Cadastro */}
      {modal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setModal(false) }}>
          <div className="modal">
            <div className="modal-title">{editId ? 'Editar Profissional' : 'Novo Profissional'}</div>
            {erro && <div className="alert alert-error">{erro}</div>}
            <div className="form-grid">
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label className="label-field">Nome Completo *</label>
                <input className="input-field" value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="label-field">CPF</label>
                <input className="input-field" value={form.cpf} onChange={e => setForm(f => ({ ...f, cpf: e.target.value }))} placeholder="000.000.000-00" />
              </div>
              <div className="form-group">
                <label className="label-field">Telefone</label>
                <input className="input-field" value={form.telefone} onChange={e => setForm(f => ({ ...f, telefone: e.target.value }))} placeholder="(00) 00000-0000" />
              </div>
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label className="label-field">Email</label>
                <input type="email" className="input-field" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                  <input type="checkbox" checked={form.ativo} onChange={e => setForm(f => ({ ...f, ativo: e.target.checked }))} />
                  Profissional ativo
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setModal(false)}>Cancelar</button>
              <button className="btn-primary" onClick={salvar} disabled={loading}>{loading ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Vínculos Empresa */}
      {vinculoModal && profSel && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setVinculoModal(false) }}>
          <div className="modal">
            <div className="modal-title">Empresas – {profSel.nome}</div>
            <div style={{ marginBottom: 16 }}>
              <div className="label-field" style={{ marginBottom: 6 }}>Vincular nova empresa</div>
              <div className="flex gap-2">
                <select className="input-field" value={novaEmpresaId} onChange={e => setNovaEmpresaId(e.target.value)}>
                  <option value="">Selecione...</option>
                  {empresas.map(e => <option key={e.id} value={e.id}>{e.razao_social}</option>)}
                </select>
                <button className="btn-primary" onClick={adicionarVinculo} disabled={!novaEmpresaId}>Vincular</button>
              </div>
            </div>
            <table style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr>
                  <th className="table-header">Empresa</th>
                  <th className="table-header">Status</th>
                  <th className="table-header" style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {vinculosProf.length === 0 && (
                  <tr><td className="table-cell" colSpan={3} style={{ textAlign: 'center', color: '#94a3b8' }}>Nenhuma empresa vinculada.</td></tr>
                )}
                {vinculosProf.map((v: any) => (
                  <tr key={v.id}>
                    <td className="table-cell">{v.empresas?.razao_social ?? '—'}</td>
                    <td className="table-cell">
                      {v.ativo ? <span className="badge badge-green">Ativo</span> : <span className="badge badge-gray">Inativo</span>}
                    </td>
                    <td className="table-cell">
                      {v.ativo && <button className="btn-danger" style={{ fontSize: 11 }} onClick={() => removerVinculo(v.id)}>Remover</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setVinculoModal(false)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
    </LayoutAdmin>
  )
}

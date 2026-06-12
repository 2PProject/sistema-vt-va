'use client'

import { useEffect, useState } from 'react'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase, SalaoProfissional, Empresa } from '../../../lib/supabase'
import { listarProfissionais, criarProfissional, atualizarProfissional, listarProfissionalEmpresas, vincularProfissionalEmpresa, importarProfissionaisExcel, processarImportacaoProfissionais, LinhaProfissionalImportacao } from '../../../lib/salao'

const EMPTY = { nome: '', cnpj: '', cpf: '', email: '', telefone: '', ativo: true }

export default function SalaoProfissionaisPage() {
  const [lista, setLista] = useState<SalaoProfissional[]>([])
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [form, setForm] = useState<{ nome: string; cnpj: string; cpf: string; email: string; telefone: string; ativo: boolean }>({ ...EMPTY })
  const [editId, setEditId] = useState<string | null>(null)
  const [modal, setModal] = useState(false)
  const [vinculoModal, setVinculoModal] = useState(false)
  const [profSel, setProfSel] = useState<SalaoProfissional | null>(null)
  const [vinculosProf, setVinculosProf] = useState<any[]>([])
  const [novaEmpresaId, setNovaEmpresaId] = useState('')
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(false)
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'ativo' | 'inativo'>('todos')
  const [sortField, setSortField] = useState<'nome' | 'cnpj' | 'status'>('nome')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [importModal, setImportModal] = useState(false)
  const [importLinhas, setImportLinhas] = useState<LinhaProfissionalImportacao[]>([])
  const [importErros, setImportErros] = useState<string[]>([])
  const [importLoading, setImportLoading] = useState(false)
  const [importEmpresaId, setImportEmpresaId] = useState('')
  const [importResultado, setImportResultado] = useState<{ vinculados: number; naoEncontrados: string[]; erros: string[] } | null>(null)

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
    setForm({ nome: p.nome, cnpj: p.cnpj ?? '', cpf: p.cpf ?? '', email: p.email ?? '', telefone: p.telefone ?? '', ativo: p.ativo ?? true })
    setEditId(p.id)
    setErro('')
    setModal(true)
  }

  async function salvar() {
    if (!form.nome.trim()) { setErro('Nome é obrigatório.'); return }
    setLoading(true)
    setErro('')

    // Duplicate check for CPF/CNPJ
    if (!editId) {
      if (form.cpf.trim()) {
        const dup = lista.find(p => p.cpf && p.cpf.replace(/\D/g,'') === form.cpf.replace(/\D/g,''))
        if (dup) { setErro(`CPF já cadastrado para: ${dup.nome}`); setLoading(false); return }
      }
      if (form.cnpj.trim()) {
        const dup = lista.find(p => p.cnpj && p.cnpj.replace(/\D/g,'') === form.cnpj.replace(/\D/g,''))
        if (dup) { setErro(`CNPJ já cadastrado para: ${dup.nome}`); setLoading(false); return }
      }
    } else {
      if (form.cpf.trim()) {
        const dup = lista.find(p => p.id !== editId && p.cpf && p.cpf.replace(/\D/g,'') === form.cpf.replace(/\D/g,''))
        if (dup) { setErro(`CPF já cadastrado para: ${dup.nome}`); setLoading(false); return }
      }
      if (form.cnpj.trim()) {
        const dup = lista.find(p => p.id !== editId && p.cnpj && p.cnpj.replace(/\D/g,'') === form.cnpj.replace(/\D/g,''))
        if (dup) { setErro(`CNPJ já cadastrado para: ${dup.nome}`); setLoading(false); return }
      }
    }

    const payload = { nome: form.nome, cnpj: form.cnpj || null, cpf: form.cpf || null, email: form.email || null, telefone: form.telefone || null, ativo: form.ativo }
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

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportLoading(true)
    setImportResultado(null)
    const { linhas, erros } = await importarProfissionaisExcel(file)
    setImportLinhas(linhas)
    setImportErros(erros)
    setImportLoading(false)
    e.target.value = ''
  }

  async function confirmarImportacao() {
    if (importLinhas.length === 0) return
    setImportLoading(true)
    const resultado = await processarImportacaoProfissionais(importLinhas, importEmpresaId || undefined)
    setImportResultado(resultado)
    setImportLinhas([])
    setImportLoading(false)
    carregar()
  }

  function fecharImportModal() {
    setImportModal(false)
    setImportLinhas([])
    setImportErros([])
    setImportResultado(null)
    setImportEmpresaId('')
  }

  function toggleSort(field: typeof sortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const SortIcon = ({ field }: { field: typeof sortField }) => (
    <span className="ml-1 inline-block opacity-50">
      {sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  )

  const filtrado = lista
    .filter(p => {
      const matchBusca = (p.nome ?? '').toLowerCase().includes(busca.toLowerCase()) ||
        (p.cpf ?? '').includes(busca) || (p.cnpj ?? '').includes(busca)
      const matchStatus = filtroStatus === 'todos' ? true : filtroStatus === 'ativo' ? (p.ativo ?? true) : !(p.ativo ?? true)
      return matchBusca && matchStatus
    })
    .sort((a, b) => {
      let va = '', vb = ''
      if (sortField === 'nome') { va = (a.nome ?? '').toLowerCase(); vb = (b.nome ?? '').toLowerCase() }
      else if (sortField === 'cnpj') { va = (a.cnpj ?? ''); vb = (b.cnpj ?? '') }
      else if (sortField === 'status') { va = String(a.ativo ?? true); vb = String(b.ativo ?? true) }
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
    })

  return (
    <LayoutAdmin title="Profissionais – Salão" actions={
      <div className="flex gap-2">
        <button className="btn-secondary" onClick={() => { setImportModal(true); setImportResultado(null); setImportLinhas([]); setImportErros([]) }}>↑ Importar Planilha</button>
        <button className="btn-primary" onClick={abrirNovo}>+ Novo Profissional</button>
      </div>
    }>
      <div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="flex flex-wrap gap-3 items-center">
          <input
            className="input-field flex-1 min-w-[180px]"
            placeholder="Buscar por nome, CPF ou CNPJ..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
          />
          <select
            className="input-field w-40"
            value={filtroStatus}
            onChange={e => setFiltroStatus(e.target.value as typeof filtroStatus)}
          >
            <option value="todos">Todos ({lista.length})</option>
            <option value="ativo">Ativos ({lista.filter(p => p.ativo !== false).length})</option>
            <option value="inativo">Inativos ({lista.filter(p => p.ativo === false).length})</option>
          </select>
          <span className="text-sm text-slate-500 whitespace-nowrap">{filtrado.length} resultado(s)</span>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="table-header cursor-pointer select-none" onClick={() => toggleSort('nome')}>
                  Nome <SortIcon field="nome" />
                </th>
                <th className="table-header cursor-pointer select-none" onClick={() => toggleSort('cnpj')}>
                  CNPJ <SortIcon field="cnpj" />
                </th>
                <th className="table-header">CPF</th>
                <th className="table-header">Email</th>
                <th className="table-header">Telefone</th>
                <th className="table-header cursor-pointer select-none" onClick={() => toggleSort('status')}>
                  Status <SortIcon field="status" />
                </th>
                <th className="table-header" style={{ width: 160 }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrado.length === 0 && (
                <tr><td className="table-cell" colSpan={7} style={{ textAlign: 'center', color: '#94a3b8' }}>Nenhum profissional cadastrado.</td></tr>
              )}
              {filtrado.map(p => (
                <tr key={p.id}>
                  <td className="table-cell" style={{ fontWeight: 600 }}>{p.nome}</td>
                  <td className="table-cell">{p.cnpj || <span style={{ color: '#94a3b8' }}>—</span>}</td>
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
                <label className="label-field">CNPJ</label>
                <input className="input-field" value={form.cnpj} onChange={e => setForm(f => ({ ...f, cnpj: e.target.value }))} placeholder="00.000.000/0000-00" />
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

      {/* Modal Importar Planilha */}
      {importModal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) fecharImportModal() }}>
          <div className="modal" style={{ maxWidth: 640 }}>
            <div className="modal-title">Importar Profissionais – Planilha</div>

            {!importResultado ? (
              <>
                <div className="alert alert-info" style={{ marginBottom: 12 }}>
                  Planilha com colunas: <strong>Nome</strong> e <strong>CNPJ</strong> (primeira aba).
                  A importação <strong>apenas vincula</strong> profissionais já cadastrados no sistema.
                  Profissionais não encontrados serão listados como inconsistência — nenhum cadastro será criado automaticamente.
                </div>

                <div className="form-group" style={{ marginBottom: 12 }}>
                  <label className="label-field">Vincular à empresa (opcional)</label>
                  <select className="input-field" value={importEmpresaId} onChange={e => setImportEmpresaId(e.target.value)}>
                    <option value="">— Não vincular agora —</option>
                    {empresas.map(e => (
                      <option key={e.id} value={e.id}>{e.razao_social}</option>
                    ))}
                  </select>
                  {importEmpresaId && (
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                      Todos os profissionais importados serão vinculados a esta empresa.
                    </div>
                  )}
                </div>

                <div className="form-group" style={{ marginBottom: 12 }}>
                  <label className="label-field">Selecionar arquivo (.xlsx, .xls, .csv)</label>
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile}
                    className="input-field" style={{ padding: '6px 8px' }} disabled={importLoading} />
                </div>

                {importErros.length > 0 && (
                  <div className="alert alert-warn" style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Avisos ({importErros.length})</div>
                    {importErros.map((e, i) => <div key={i}>{e}</div>)}
                  </div>
                )}

                {importLinhas.length > 0 && (
                  <>
                    <div style={{ fontSize: 13, color: '#64748b', marginBottom: 6 }}>
                      {importLinhas.length} registro(s) encontrado(s). Revise antes de importar:
                    </div>
                    <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 12 }}>
                      <table style={{ width: '100%', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: '#f8fafc' }}>
                            <th className="table-header">#</th>
                            <th className="table-header">Nome</th>
                            <th className="table-header">CNPJ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importLinhas.map((l, i) => (
                            <tr key={i}>
                              <td className="table-cell" style={{ color: '#94a3b8' }}>{i + 1}</td>
                              <td className="table-cell">{l.nome}</td>
                              <td className="table-cell">{l.cnpj || <span style={{ color: '#94a3b8' }}>—</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                <div className="modal-footer">
                  <button className="btn-secondary" onClick={fecharImportModal}>Cancelar</button>
                  <button className="btn-primary" onClick={confirmarImportacao}
                    disabled={importLoading || importLinhas.length === 0}>
                    {importLoading ? 'Importando...' : `Importar ${importLinhas.length} profissional(is)`}
                  </button>
                </div>
              </>
            ) : (
              <>
                {importResultado.naoEncontrados.length > 0 && (
                  <div className="alert alert-error" style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>
                      ⚠ {importResultado.naoEncontrados.length} profissional(is) não encontrado(s) no cadastro — nenhum registro foi criado para eles:
                    </div>
                    <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                      {importResultado.naoEncontrados.map((n, i) => (
                        <div key={i} style={{ fontSize: 12, paddingLeft: 8 }}>• {n}</div>
                      ))}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 12, color: '#991b1b' }}>
                      Cadastre esses profissionais manualmente antes de importar novamente.
                    </div>
                  </div>
                )}
                {importResultado.erros.length > 0 && (
                  <div className="alert alert-warn" style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Erros técnicos ({importResultado.erros.length})</div>
                    {importResultado.erros.map((e, i) => <div key={i} style={{ fontSize: 12 }}>{e}</div>)}
                  </div>
                )}
                <div className={`alert ${importResultado.vinculados > 0 ? 'alert-success' : 'alert-info'}`}>
                  {importResultado.vinculados > 0
                    ? <><strong>{importResultado.vinculados}</strong> profissional(is) vinculado(s) à empresa com sucesso.</>
                    : <>Nenhum profissional foi vinculado. Verifique as inconsistências acima.</>
                  }
                </div>
                <div className="modal-footer">
                  <button className="btn-primary" onClick={fecharImportModal}>Fechar</button>
                </div>
              </>
            )}
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

'use client'

import { useEffect, useMemo, useState } from 'react'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase, SalaoProfissional, Empresa } from '../../../lib/supabase'
import {
  listarProfissionaisComEmpresas, ProfissionalComEmpresas,
  criarProfissional, atualizarProfissional,
  listarProfissionalEmpresas, vincularProfissionalEmpresa,
  importarProfissionaisExcel, processarImportacaoProfissionais, LinhaProfissionalImportacao,
} from '../../../lib/salao'

const EMPTY = { nome: '', cnpj: '', cpf: '', email: '', telefone: '', especialidade: '', ativo: true }
const PAGE_SIZE = 50

type SortField = 'nome' | 'empresa' | 'cadastro' | 'status'

function soDigitos(v?: string | null) { return (v ?? '').replace(/\D/g, '') }

// Lista de pendências cadastrais de um profissional
function inconsistencias(p: ProfissionalComEmpresas): string[] {
  const issues: string[] = []
  const cnpj = soDigitos(p.cnpj)
  if (!cnpj || cnpj.length < 14) issues.push('CNPJ ausente ou inválido')
  if (p.empresas_vinculadas.filter(e => e.ativo).length === 0) issues.push('Sem empresa vinculada')
  return issues
}

export default function SalaoProfissionaisPage() {
  const [lista, setLista] = useState<ProfissionalComEmpresas[]>([])
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [carregando, setCarregando] = useState(true)

  // Form / modais
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY })
  const [editId, setEditId] = useState<string | null>(null)
  const [modal, setModal] = useState(false)
  const [vinculoModal, setVinculoModal] = useState(false)
  const [profSel, setProfSel] = useState<SalaoProfissional | null>(null)
  const [vinculosProf, setVinculosProf] = useState<any[]>([])
  const [novaEmpresaId, setNovaEmpresaId] = useState('')
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(false)

  // Filtros / ordenação
  const [busca, setBusca] = useState('')
  const [filtroEmpresa, setFiltroEmpresa] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'ativo' | 'inativo'>('todos')
  const [soInconsistencias, setSoInconsistencias] = useState(false)
  const [sortField, setSortField] = useState<SortField>('nome')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)

  // Importação
  const [importModal, setImportModal] = useState(false)
  const [importLinhas, setImportLinhas] = useState<LinhaProfissionalImportacao[]>([])
  const [importErros, setImportErros] = useState<string[]>([])
  const [importLoading, setImportLoading] = useState(false)
  const [importEmpresaId, setImportEmpresaId] = useState('')
  const [importResultado, setImportResultado] = useState<{ vinculados: number; naoEncontrados: string[]; erros: string[] } | null>(null)

  useEffect(() => { carregar() }, [])

  async function carregar() {
    setCarregando(true)
    const [profs, emps] = await Promise.all([
      listarProfissionaisComEmpresas(),
      supabase.from('empresas').select('*').order('razao_social').then(r => r.data ?? []),
    ])
    setLista(profs)
    setEmpresas(emps)
    setCarregando(false)
  }

  function abrirNovo() {
    setForm({ ...EMPTY })
    setEditId(null)
    setErro('')
    setModal(true)
  }

  function abrirEditar(p: ProfissionalComEmpresas) {
    setForm({
      nome: p.nome, cnpj: p.cnpj ?? '', cpf: p.cpf ?? '', email: p.email ?? '',
      telefone: p.telefone ?? '', especialidade: p.especialidade ?? '', ativo: p.ativo ?? true,
    })
    setEditId(p.id)
    setErro('')
    setModal(true)
  }

  async function salvar() {
    if (!form.nome.trim()) { setErro('Nome é obrigatório.'); return }
    setLoading(true)
    setErro('')

    const cpfNorm = soDigitos(form.cpf)
    const cnpjNorm = soDigitos(form.cnpj)
    if (cpfNorm) {
      const dup = lista.find(p => p.id !== editId && soDigitos(p.cpf) === cpfNorm)
      if (dup) { setErro(`CPF já cadastrado para: ${dup.nome}`); setLoading(false); return }
    }
    if (cnpjNorm) {
      const dup = lista.find(p => p.id !== editId && soDigitos(p.cnpj) === cnpjNorm)
      if (dup) { setErro(`CNPJ já cadastrado para: ${dup.nome}`); setLoading(false); return }
    }

    const payload = {
      nome: form.nome, cnpj: form.cnpj || null, cpf: form.cpf || null,
      email: form.email || null, telefone: form.telefone || null,
      especialidade: form.especialidade || null, ativo: form.ativo,
    }
    if (editId) await atualizarProfissional(editId, payload)
    else await criarProfissional(payload)
    setLoading(false)
    setModal(false)
    carregar()
  }

  async function toggleAtivo(p: ProfissionalComEmpresas) {
    await atualizarProfissional(p.id, { ativo: !(p.ativo ?? true) })
    setLista(prev => prev.map(x => x.id === p.id ? { ...x, ativo: !(x.ativo ?? true) } : x))
  }

  async function abrirVinculos(p: SalaoProfissional) {
    setProfSel(p)
    setVinculoModal(true)
    const links = await listarProfissionalEmpresas(p.id)
    setVinculosProf(links)
    setNovaEmpresaId('')
  }

  async function adicionarVinculo() {
    if (!profSel || !novaEmpresaId) return
    await vincularProfissionalEmpresa(profSel.id, novaEmpresaId)
    const links = await listarProfissionalEmpresas(profSel.id)
    setVinculosProf(links)
    setNovaEmpresaId('')
    carregar()
  }

  async function removerVinculo(vincId: string) {
    await supabase.from('salao_profissional_empresa').update({ ativo: false }).eq('id', vincId)
    const links = await listarProfissionalEmpresas(profSel!.id)
    setVinculosProf(links)
    carregar()
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

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
    setPage(1)
  }

  const SortIcon = ({ field }: { field: SortField }) => (
    <span className="ml-1 inline-block opacity-50">
      {sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  )

  // Contadores para os cards
  const stats = useMemo(() => {
    const ativos = lista.filter(p => p.ativo !== false).length
    const comProblema = lista.filter(p => inconsistencias(p).length > 0).length
    return { total: lista.length, ativos, inativos: lista.length - ativos, comProblema }
  }, [lista])

  // Filtro + ordenação (client-side, rápido mesmo com volume alto)
  const filtrado = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const qDig = soDigitos(busca)
    return lista
      .filter(p => {
        if (filtroStatus === 'ativo' && p.ativo === false) return false
        if (filtroStatus === 'inativo' && p.ativo !== false) return false
        if (filtroEmpresa && !p.empresas_vinculadas.some(e => e.id === filtroEmpresa && e.ativo)) return false
        if (soInconsistencias && inconsistencias(p).length === 0) return false
        if (q || qDig) {
          const texto = (p.nome ?? '').toLowerCase() + ' ' + (p.especialidade ?? '').toLowerCase() +
            ' ' + (p.telefone ?? '').toLowerCase() + ' ' + (p.email ?? '').toLowerCase()
          const docs = soDigitos(p.cpf) + soDigitos(p.cnpj) + soDigitos(p.telefone)
          const matchTexto = q ? texto.includes(q) : false
          const matchDoc = qDig ? docs.includes(qDig) : false
          if (!matchTexto && !matchDoc) return false
        }
        return true
      })
      .sort((a, b) => {
        let va = '', vb = ''
        if (sortField === 'nome') { va = (a.nome ?? '').toLowerCase(); vb = (b.nome ?? '').toLowerCase() }
        else if (sortField === 'empresa') {
          va = (a.empresas_vinculadas[0]?.razao_social ?? '').toLowerCase()
          vb = (b.empresas_vinculadas[0]?.razao_social ?? '').toLowerCase()
        }
        else if (sortField === 'cadastro') { va = a.criado_em ?? ''; vb = b.criado_em ?? '' }
        else if (sortField === 'status') { va = String(a.ativo ?? true); vb = String(b.ativo ?? true) }
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
      })
  }, [lista, busca, filtroEmpresa, filtroStatus, soInconsistencias, sortField, sortDir])

  const totalPaginas = Math.max(1, Math.ceil(filtrado.length / PAGE_SIZE))
  const pageSafe = Math.min(page, totalPaginas)
  const pagina = filtrado.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE)

  function limparFiltros() {
    setBusca(''); setFiltroEmpresa(''); setFiltroStatus('todos'); setSoInconsistencias(false); setPage(1)
  }

  return (
    <LayoutAdmin title="Profissionais – Salão" actions={
      <div className="flex gap-2">
        <button className="btn-secondary" onClick={() => { setImportModal(true); setImportResultado(null); setImportLinhas([]); setImportErros([]) }}>↑ Importar Planilha</button>
        <button className="btn-primary" onClick={abrirNovo}>+ Novo Profissional</button>
      </div>
    }>
      <div className="space-y-4">

        {/* Cards de resumo */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <button
            className={`stat-card text-left transition-all hover:shadow-md ${filtroStatus === 'todos' && !soInconsistencias ? 'ring-2 ring-blue-400' : ''}`}
            onClick={() => { setFiltroStatus('todos'); setSoInconsistencias(false); setPage(1) }}
          >
            <p className="stat-label">Total</p>
            <p className="stat-value text-slate-800">{stats.total}</p>
            <p className="stat-sub">profissionais cadastrados</p>
          </button>
          <button
            className={`stat-card text-left transition-all hover:shadow-md ${filtroStatus === 'ativo' ? 'ring-2 ring-green-400' : ''}`}
            onClick={() => { setFiltroStatus('ativo'); setSoInconsistencias(false); setPage(1) }}
          >
            <p className="stat-label">Ativos</p>
            <p className="stat-value text-green-600">{stats.ativos}</p>
            <p className="stat-sub">em operação</p>
          </button>
          <button
            className={`stat-card text-left transition-all hover:shadow-md ${filtroStatus === 'inativo' ? 'ring-2 ring-slate-400' : ''}`}
            onClick={() => { setFiltroStatus('inativo'); setSoInconsistencias(false); setPage(1) }}
          >
            <p className="stat-label">Inativos</p>
            <p className="stat-value text-slate-400">{stats.inativos}</p>
            <p className="stat-sub">desativados</p>
          </button>
          <button
            className={`stat-card text-left transition-all hover:shadow-md ${soInconsistencias ? 'ring-2 ring-red-400' : ''}`}
            onClick={() => { setSoInconsistencias(v => !v); setFiltroStatus('todos'); setPage(1) }}
          >
            <p className="stat-label">Inconsistências</p>
            <p className={`stat-value ${stats.comProblema > 0 ? 'text-red-600' : 'text-slate-300'}`}>{stats.comProblema}</p>
            <p className="stat-sub">{soInconsistencias ? 'filtrando…' : 'clique para filtrar'}</p>
          </button>
        </div>

        {/* Barra de filtros */}
        <div className="card">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[220px]">
              <input
                className="input-field w-full pl-9"
                placeholder="Buscar por nome, CPF, telefone ou especialidade..."
                value={busca}
                onChange={e => { setBusca(e.target.value); setPage(1) }}
              />
              <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <select
              className="input-field min-w-[200px]"
              value={filtroEmpresa}
              onChange={e => { setFiltroEmpresa(e.target.value); setPage(1) }}
            >
              <option value="">Todas as empresas</option>
              {empresas.map(e => (
                <option key={e.id} value={e.id}>
                  {e.razao_social}{e.cnpj ? ` — ${e.cnpj}` : ''}
                </option>
              ))}
            </select>
            <select
              className="input-field w-36"
              value={filtroStatus}
              onChange={e => { setFiltroStatus(e.target.value as typeof filtroStatus); setPage(1) }}
            >
              <option value="todos">Todos status</option>
              <option value="ativo">Ativos</option>
              <option value="inativo">Inativos</option>
            </select>
            <span className="text-sm text-slate-500 whitespace-nowrap">{filtrado.length} resultado(s)</span>
            {(busca || filtroEmpresa || filtroStatus !== 'todos' || soInconsistencias) && (
              <button className="text-xs text-blue-600 hover:underline" onClick={limparFiltros}>Limpar filtros</button>
            )}
          </div>
        </div>

        {/* Tabela */}
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="table-header" style={{ width: 36 }}></th>
                  <th className="table-header cursor-pointer select-none" onClick={() => toggleSort('nome')}>
                    Profissional <SortIcon field="nome" />
                  </th>
                  <th className="table-header">CNPJ / CPF</th>
                  <th className="table-header">Especialidade</th>
                  <th className="table-header">Telefone</th>
                  <th className="table-header cursor-pointer select-none" onClick={() => toggleSort('empresa')}>
                    Empresas <SortIcon field="empresa" />
                  </th>
                  <th className="table-header cursor-pointer select-none" onClick={() => toggleSort('cadastro')}>
                    Cadastro <SortIcon field="cadastro" />
                  </th>
                  <th className="table-header cursor-pointer select-none" onClick={() => toggleSort('status')}>
                    Status <SortIcon field="status" />
                  </th>
                  <th className="table-header" style={{ width: 200 }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {carregando && (
                  <tr><td className="table-cell" colSpan={9} style={{ textAlign: 'center', color: '#94a3b8' }}>Carregando…</td></tr>
                )}
                {!carregando && pagina.length === 0 && (
                  <tr><td className="table-cell" colSpan={9} style={{ textAlign: 'center', color: '#94a3b8' }}>Nenhum profissional encontrado para os filtros.</td></tr>
                )}
                {pagina.map(p => {
                  const issues = inconsistencias(p)
                  const inativo = p.ativo === false
                  const empresasAtivas = p.empresas_vinculadas.filter(e => e.ativo)
                  return (
                    <tr key={p.id} style={{ opacity: inativo ? 0.6 : 1 }}>
                      <td className="table-cell" style={{ borderLeft: `3px solid ${inativo ? '#cbd5e1' : '#22c55e'}` }}>
                        {issues.length > 0 && (
                          <span title={issues.join(' • ')} style={{ color: '#dc2626', cursor: 'help', fontSize: 16 }}>⚠</span>
                        )}
                      </td>
                      <td className="table-cell" style={{ fontWeight: 600 }}>
                        {p.nome}
                        {p.email && <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>{p.email}</div>}
                      </td>
                      <td className="table-cell" style={{ fontSize: 12 }}>
                        {p.cnpj ? <div>{p.cnpj}</div> : <div style={{ color: '#dc2626' }}>sem CNPJ</div>}
                        {p.cpf && <div style={{ color: '#94a3b8' }}>{p.cpf}</div>}
                      </td>
                      <td className="table-cell">{p.especialidade || <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                      <td className="table-cell">{p.telefone || <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                      <td className="table-cell" style={{ fontSize: 12 }}>
                        {empresasAtivas.length === 0
                          ? <span className="badge badge-red">Sem vínculo</span>
                          : (
                            <div className="flex flex-wrap gap-1">
                              {empresasAtivas.slice(0, 2).map(e => (
                                <span key={e.id} className="badge badge-blue">{e.razao_social}</span>
                              ))}
                              {empresasAtivas.length > 2 && <span className="badge badge-gray">+{empresasAtivas.length - 2}</span>}
                            </div>
                          )}
                      </td>
                      <td className="table-cell" style={{ fontSize: 12, color: '#64748b' }}>
                        {p.criado_em ? new Date(p.criado_em).toLocaleDateString('pt-BR') : '—'}
                      </td>
                      <td className="table-cell">
                        {p.ativo !== false ? <span className="badge badge-green">Ativo</span> : <span className="badge badge-gray">Inativo</span>}
                      </td>
                      <td className="table-cell">
                        <div className="flex gap-1.5">
                          <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => abrirEditar(p)}>Editar</button>
                          <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12, background: '#ede9fe', border: '1px solid #c4b5fd', color: '#7c3aed' }} onClick={() => abrirVinculos(p)}>Empresas</button>
                          <button className="btn-secondary" style={{ padding: '4px 8px', fontSize: 12 }} title={inativo ? 'Reativar' : 'Desativar'} onClick={() => toggleAtivo(p)}>
                            {inativo ? '↻' : '⏻'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Paginação */}
          {totalPaginas > 1 && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
              <span className="text-xs text-slate-500">
                Mostrando {(pageSafe - 1) * PAGE_SIZE + 1}–{Math.min(pageSafe * PAGE_SIZE, filtrado.length)} de {filtrado.length}
              </span>
              <div className="flex gap-1 items-center">
                <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} disabled={pageSafe <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>‹ Anterior</button>
                <span className="text-xs text-slate-600 px-2">{pageSafe} / {totalPaginas}</span>
                <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} disabled={pageSafe >= totalPaginas} onClick={() => setPage(p => Math.min(totalPaginas, p + 1))}>Próxima ›</button>
              </div>
            </div>
          )}
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
                <label className="label-field">Especialidade</label>
                <input className="input-field" value={form.especialidade} onChange={e => setForm(f => ({ ...f, especialidade: e.target.value }))} placeholder="Ex.: Cabeleireiro, Manicure" />
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
    </LayoutAdmin>
  )
}

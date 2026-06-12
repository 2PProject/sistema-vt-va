'use client'

import { useEffect, useState } from 'react'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase, Empresa, SalaoNFStatus } from '../../../lib/supabase'
import {
  listarRegistros, confirmarNF, substituirNF, buscarHistorico,
  importarExcel, processarImportacao, listarConfigs, verificarPrazos,
  marcarForaPrazo, RegistroComDetalhes
} from '../../../lib/salao'

const STATUS_LABEL: Record<SalaoNFStatus, string> = {
  pendente: 'Pendente',
  nf_recebida: 'NF Recebida',
  fora_do_prazo: 'Fora do Prazo',
}

const STATUS_BADGE: Record<SalaoNFStatus, string> = {
  pendente: 'badge-amber',
  nf_recebida: 'badge-green',
  fora_do_prazo: 'badge-red',
}

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

function mesAtual() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
}

export default function SalaoNFPage() {
  const [mesRef, setMesRef] = useState(mesAtual())
  const [empresaFiltro, setEmpresaFiltro] = useState('')
  const [statusFiltro, setStatusFiltro] = useState('')
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [registros, setRegistros] = useState<RegistroComDetalhes[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgTipo, setMsgTipo] = useState<'ok'|'erro'>('ok')

  // Modais
  const [modalConf, setModalConf] = useState(false)
  const [modalSubst, setModalSubst] = useState(false)
  const [modalHist, setModalHist] = useState(false)
  const [modalImport, setModalImport] = useState(false)
  const [regSel, setRegSel] = useState<RegistroComDetalhes | null>(null)
  const [historico, setHistorico] = useState<any[]>([])

  // Form confirmação
  const [confNumero, setConfNumero] = useState('')
  const [confData, setConfData] = useState('')
  const [confValor, setConfValor] = useState('')
  const [confErro, setConfErro] = useState('')
  const [confLoad, setConfLoad] = useState(false)

  // Form substituição
  const [substMotivo, setSubstMotivo] = useState('')

  // Import
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importMes, setImportMes] = useState(mesAtual())
  const [importPreview, setImportPreview] = useState<any[]>([])
  const [importErros, setImportErros] = useState<string[]>([])
  const [importLoad, setImportLoad] = useState(false)

  // Config tolerance map
  const [toleranciaMap, setToleranciaMap] = useState<Map<string, number>>(new Map())

  // Seleção em massa
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkLoad, setBulkLoad] = useState(false)

  // Pesquisa e ordenação client-side
  const [busca, setBusca] = useState('')
  const [sortField, setSortField] = useState<'nome' | 'empresa' | 'valor' | 'status' | 'mes'>('mes')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleSort(field: typeof sortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const registrosFiltrados = registros
    .filter(r => !busca || (r.profissionais?.nome ?? '').toLowerCase().includes(busca.toLowerCase()))
    .sort((a, b) => {
      let va: string | number = '', vb: string | number = ''
      if (sortField === 'nome') { va = a.profissionais?.nome ?? ''; vb = b.profissionais?.nome ?? '' }
      else if (sortField === 'empresa') { va = a.empresas?.razao_social ?? ''; vb = b.empresas?.razao_social ?? '' }
      else if (sortField === 'valor') { va = a.valor_comissao; vb = b.valor_comissao }
      else if (sortField === 'status') { va = a.status; vb = b.status }
      else { va = a.mes_referencia; vb = b.mes_referencia }
      if (typeof va === 'number') return sortDir === 'asc' ? (va - (vb as number)) : ((vb as number) - va)
      return sortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
    })

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === registros.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(registros.map(r => r.id)))
    }
  }

  async function bulkMarcarForaPrazo() {
    if (selectedIds.size === 0) return
    setBulkLoad(true)
    const ids = Array.from(selectedIds)
    await Promise.all(ids.map(id => marcarForaPrazo(id)))
    setSelectedIds(new Set())
    setBulkLoad(false)
    setMsg(`${ids.length} registro(s) marcado(s) como Fora do Prazo.`)
    setMsgTipo('ok')
    buscar()
  }

  useEffect(() => { carregarEmpresas() }, [])
  useEffect(() => { buscar() }, [mesRef, empresaFiltro, statusFiltro])

  async function carregarEmpresas() {
    const { data } = await supabase.from('empresas').select('*').order('razao_social')
    setEmpresas(data ?? [])
    // Load tolerance configs
    const configs = await listarConfigs()
    const map = new Map<string, number>()
    configs.forEach(c => map.set(c.empresa_id, c.tolerancia_valor))
    setToleranciaMap(map)
  }

  async function buscar() {
    setLoading(true)
    setSelectedIds(new Set())
    const data = await listarRegistros({
      mesReferencia: mesRef || undefined,
      empresaId: empresaFiltro || undefined,
      status: statusFiltro || undefined,
    })
    setRegistros(data)
    setLoading(false)
  }

  async function verificarTodosPrazos() {
    setLoading(true)
    const n = await verificarPrazos(mesRef)
    setMsg(`${n} registro(s) marcado(s) como Fora do Prazo.`)
    setMsgTipo('ok')
    setLoading(false)
    buscar()
  }

  // Confirmar NF
  function abrirConfirmar(reg: RegistroComDetalhes) {
    setRegSel(reg)
    setConfNumero(reg.confirmacao?.numero_nf ?? '')
    setConfData(reg.confirmacao?.data_nf ?? '')
    setConfValor(reg.confirmacao?.valor_nf?.toString() ?? '')
    setConfErro('')
    setModalConf(true)
  }

  async function salvarConfirmacao() {
    if (!regSel) return
    if (!confNumero || !confData || !confValor) { setConfErro('Preencha todos os campos.'); return }
    setConfLoad(true)
    setConfErro('')
    const tolerancia = toleranciaMap.get(regSel.empresa_id) ?? 0.01
    const res = await confirmarNF({
      registroId: regSel.id,
      numeroNF: confNumero,
      dataNF: confData,
      valorNF: parseFloat(confValor),
      tolerancia,
      valorComissao: regSel.valor_comissao,
    })
    setConfLoad(false)
    if (!res.ok) { setConfErro(res.erro ?? 'Erro ao confirmar.'); return }
    setModalConf(false)
    setMsg('NF confirmada com sucesso.')
    setMsgTipo('ok')
    buscar()
  }

  // Substituir NF
  function abrirSubstituir(reg: RegistroComDetalhes) {
    setRegSel(reg)
    setConfNumero(reg.confirmacao?.numero_nf ?? '')
    setConfData(reg.confirmacao?.data_nf ?? '')
    setConfValor(reg.confirmacao?.valor_nf?.toString() ?? '')
    setSubstMotivo('')
    setConfErro('')
    setModalSubst(true)
  }

  async function salvarSubstituicao() {
    if (!regSel) return
    if (!confNumero || !confData || !confValor || !substMotivo) { setConfErro('Preencha todos os campos incluindo o motivo.'); return }
    setConfLoad(true)
    setConfErro('')
    const tolerancia = toleranciaMap.get(regSel.empresa_id) ?? 0.01
    const res = await substituirNF({
      registroId: regSel.id,
      numeroNF: confNumero,
      dataNF: confData,
      valorNF: parseFloat(confValor),
      motivo: substMotivo,
      tolerancia,
      valorComissao: regSel.valor_comissao,
    })
    setConfLoad(false)
    if (!res.ok) { setConfErro(res.erro ?? 'Erro.'); return }
    setModalSubst(false)
    setMsg('NF substituída com sucesso.')
    setMsgTipo('ok')
    buscar()
  }

  // Histórico
  async function abrirHistorico(reg: RegistroComDetalhes) {
    setRegSel(reg)
    const hist = await buscarHistorico(reg.id)
    setHistorico(hist)
    setModalHist(true)
  }

  // Import Excel
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportFile(file)
    setImportLoad(true)
    setImportPreview([])
    setImportErros([])
    const { linhas, erros } = await importarExcel(file, importMes)
    setImportPreview(linhas)
    setImportErros(erros)
    setImportLoad(false)
    e.target.value = ''
  }

  async function executarImportacao() {
    if (!importPreview.length) return
    setImportLoad(true)
    const { criados, erros } = await processarImportacao(importPreview)
    setImportErros(prev => [...erros, ...prev])
    setImportLoad(false)
    setMsg(`Importação concluída: ${criados} registro(s) criado(s).${erros.length ? ` ${erros.length} erro(s).` : ''}`)
    setMsgTipo(erros.length ? 'erro' : 'ok')
    setModalImport(false)
    buscar()
  }

  const [ano, mesNum] = mesRef.split('-').map(Number)
  const mesLabel = mesNum ? `${MESES[mesNum-1]}/${ano}` : mesRef

  return (
    <LayoutAdmin
      title="Notas Fiscais – Salão"
      actions={
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setModalImport(true)}>Importar Excel</button>
          <button className="btn-secondary" style={{ background: '#fef3c7', borderColor: '#fde68a', color: '#d97706' }} onClick={verificarTodosPrazos}>
            Verificar Prazos
          </button>
        </div>
      }
    >
      <div>

      {msg && (
        <div className={`alert ${msgTipo === 'ok' ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 16 }}>
          {msg}
          <button onClick={() => setMsg('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>×</button>
        </div>
      )}

      {/* Filtros */}
      <div className="card">
        <div className="flex flex-wrap gap-3" style={{ alignItems: 'flex-end' }}>
          <div className="form-group" style={{ minWidth: 140 }}>
            <label className="label-field">Mês Referência</label>
            <input type="month" className="input-field" value={mesRef} onChange={e => setMesRef(e.target.value)} />
          </div>
          <div className="form-group" style={{ minWidth: 180 }}>
            <label className="label-field">Empresa</label>
            <select className="input-field" value={empresaFiltro} onChange={e => setEmpresaFiltro(e.target.value)}>
              <option value="">Todas as empresas</option>
              {empresas.map(e => <option key={e.id} value={e.id}>{e.razao_social}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ minWidth: 140 }}>
            <label className="label-field">Status</label>
            <select className="input-field" value={statusFiltro} onChange={e => setStatusFiltro(e.target.value)}>
              <option value="">Todos</option>
              <option value="pendente">Pendente</option>
              <option value="nf_recebida">NF Recebida</option>
              <option value="fora_do_prazo">Fora do Prazo</option>
            </select>
          </div>
          <div className="form-group flex-1" style={{ minWidth: 180 }}>
            <label className="label-field">Buscar profissional</label>
            <input
              className="input-field"
              placeholder="Nome do profissional..."
              value={busca}
              onChange={e => setBusca(e.target.value)}
            />
          </div>
          {busca && (
            <div style={{ fontSize: 12, color: '#64748b', paddingBottom: 6 }}>
              {registrosFiltrados.length} de {registros.length} resultado(s)
            </div>
          )}
        </div>
      </div>

      {/* Resumo */}
      {!loading && (
        <div className="stats-grid">
          {(['pendente', 'nf_recebida', 'fora_do_prazo'] as SalaoNFStatus[]).map(s => {
            const count = registros.filter(r => r.status === s).length
            const total = registros.filter(r => r.status === s).reduce((a, r) => a + r.valor_comissao, 0)
            return (
              <div key={s} className="stat-card">
                <div className="stat-label">{STATUS_LABEL[s]}</div>
                <div className="stat-value">{count}</div>
                <div className="stat-sub">R$ {total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
              </div>
            )
          })}
          <div className="stat-card">
            <div className="stat-label">Total</div>
            <div className="stat-value">{registros.length}</div>
            <div className="stat-sub">R$ {registros.reduce((a, r) => a + r.valor_comissao, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
          </div>
        </div>
      )}

      {loading && <div className="loading">Carregando...</div>}

      {!loading && (
        <div className="card">
          {/* Barra de ações em massa */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 mb-4 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg">
              <span className="text-sm font-semibold text-blue-800">
                {selectedIds.size} selecionado(s)
              </span>
              <button
                className="btn-danger"
                style={{ fontSize: 12, padding: '4px 12px' }}
                onClick={bulkMarcarForaPrazo}
                disabled={bulkLoad}
              >
                {bulkLoad ? 'Processando...' : 'Marcar Fora do Prazo'}
              </button>
              <button
                className="btn-secondary"
                style={{ fontSize: 12, padding: '4px 10px' }}
                onClick={() => setSelectedIds(new Set())}
              >
                Limpar seleção
              </button>
            </div>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="table-header" style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={registrosFiltrados.length > 0 && selectedIds.size === registrosFiltrados.length}
                      ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < registrosFiltrados.length }}
                      onChange={() => {
                        if (selectedIds.size === registrosFiltrados.length) setSelectedIds(new Set())
                        else setSelectedIds(new Set(registrosFiltrados.map(r => r.id)))
                      }}
                      className="w-4 h-4 cursor-pointer"
                    />
                  </th>
                  <th className="table-header cursor-pointer select-none" onClick={() => toggleSort('nome')}>
                    Profissional {sortField === 'nome' ? (sortDir === 'asc' ? '↑' : '↓') : <span style={{opacity:0.4}}>↕</span>}
                  </th>
                  <th className="table-header cursor-pointer select-none" onClick={() => toggleSort('empresa')}>
                    Empresa {sortField === 'empresa' ? (sortDir === 'asc' ? '↑' : '↓') : <span style={{opacity:0.4}}>↕</span>}
                  </th>
                  <th className="table-header cursor-pointer select-none" onClick={() => toggleSort('mes')}>
                    Referência {sortField === 'mes' ? (sortDir === 'asc' ? '↑' : '↓') : <span style={{opacity:0.4}}>↕</span>}
                  </th>
                  <th className="table-header cursor-pointer select-none" onClick={() => toggleSort('valor')}>
                    Comissão {sortField === 'valor' ? (sortDir === 'asc' ? '↑' : '↓') : <span style={{opacity:0.4}}>↕</span>}
                  </th>
                  <th className="table-header cursor-pointer select-none" onClick={() => toggleSort('status')}>
                    Status {sortField === 'status' ? (sortDir === 'asc' ? '↑' : '↓') : <span style={{opacity:0.4}}>↕</span>}
                  </th>
                  <th className="table-header">NF</th>
                  <th className="table-header" style={{ width: 160 }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {registrosFiltrados.length === 0 && (
                  <tr><td className="table-cell" colSpan={8} style={{ textAlign: 'center', color: '#94a3b8' }}>
                    {registros.length === 0 ? 'Nenhum registro encontrado. Importe uma planilha para começar.' : 'Nenhum resultado para a busca.'}
                  </td></tr>
                )}
                {registrosFiltrados.map(reg => (
                  <tr
                    key={reg.id}
                    className={selectedIds.has(reg.id) ? 'bg-blue-50' : ''}
                    style={{ cursor: 'default' }}
                  >
                    <td className="table-cell" style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(reg.id)}
                        onChange={() => toggleSelect(reg.id)}
                        className="w-4 h-4 cursor-pointer"
                      />
                    </td>
                    <td className="table-cell" style={{ fontWeight: 600 }}>{reg.profissionais?.nome}</td>
                    <td className="table-cell">{reg.empresas?.razao_social}</td>
                    <td className="table-cell">
                      {(() => {
                        const [a, m] = reg.mes_referencia.split('-').map(Number)
                        return `${MESES[m-1]}/${a}`
                      })()}
                    </td>
                    <td className="table-cell">
                      R$ {reg.valor_comissao.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="table-cell">
                      <span className={`badge ${STATUS_BADGE[reg.status]}`}>{STATUS_LABEL[reg.status]}</span>
                    </td>
                    <td className="table-cell" style={{ fontSize: 12 }}>
                      {reg.confirmacao ? (
                        <div>
                          <div style={{ fontWeight: 600 }}>NF {reg.confirmacao.numero_nf}</div>
                          <div style={{ color: '#64748b' }}>{reg.confirmacao.data_nf?.split('-').reverse().join('/')}</div>
                          <div>R$ {reg.confirmacao.valor_nf?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                        </div>
                      ) : <span style={{ color: '#94a3b8' }}>—</span>}
                    </td>
                    <td className="table-cell">
                      <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                        {(reg.status === 'pendente' || reg.status === 'fora_do_prazo') && (
                          <button className="btn-success" onClick={() => abrirConfirmar(reg)}>Confirmar NF</button>
                        )}
                        {reg.status === 'nf_recebida' && (
                          <button className="btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => abrirSubstituir(reg)}>Substituir</button>
                        )}
                        <button className="btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => abrirHistorico(reg)}>Histórico</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Confirmar NF */}
      {modalConf && regSel && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setModalConf(false) }}>
          <div className="modal">
            <div className="modal-title">Confirmar Nota Fiscal</div>
            <div style={{ marginBottom: 14, fontSize: 13, color: '#374151' }}>
              <strong>{regSel.profissionais?.nome}</strong> – {regSel.empresas?.razao_social}<br />
              Comissão esperada: <strong>R$ {regSel.valor_comissao.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
              {' '}(tolerância ±R$ {(toleranciaMap.get(regSel.empresa_id) ?? 0.01).toFixed(2)})
            </div>
            {confErro && <div className="alert alert-error">{confErro}</div>}
            <div className="form-grid">
              <div className="form-group">
                <label className="label-field">Número da NF *</label>
                <input className="input-field" value={confNumero} onChange={e => setConfNumero(e.target.value)} placeholder="Ex: 000123" />
              </div>
              <div className="form-group">
                <label className="label-field">Data da NF *</label>
                <input type="date" className="input-field" value={confData} onChange={e => setConfData(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="label-field">Valor da NF (R$) *</label>
                <input type="number" step="0.01" className="input-field" value={confValor} onChange={e => setConfValor(e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setModalConf(false)}>Cancelar</button>
              <button className="btn-primary" onClick={salvarConfirmacao} disabled={confLoad}>{confLoad ? 'Salvando...' : 'Confirmar NF'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Substituir NF */}
      {modalSubst && regSel && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setModalSubst(false) }}>
          <div className="modal">
            <div className="modal-title">Substituir Nota Fiscal</div>
            <div className="alert alert-warn" style={{ marginBottom: 14 }}>
              Esta ação substituirá a NF atual e será registrada no histórico. Informe o motivo.
            </div>
            <div style={{ marginBottom: 14, fontSize: 13, color: '#374151' }}>
              <strong>{regSel.profissionais?.nome}</strong> – Comissão: R$ {regSel.valor_comissao.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </div>
            {confErro && <div className="alert alert-error">{confErro}</div>}
            <div className="form-grid">
              <div className="form-group">
                <label className="label-field">Novo Número NF *</label>
                <input className="input-field" value={confNumero} onChange={e => setConfNumero(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="label-field">Nova Data NF *</label>
                <input type="date" className="input-field" value={confData} onChange={e => setConfData(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="label-field">Novo Valor (R$) *</label>
                <input type="number" step="0.01" className="input-field" value={confValor} onChange={e => setConfValor(e.target.value)} />
              </div>
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label className="label-field">Motivo da Substituição *</label>
                <input className="input-field" value={substMotivo} onChange={e => setSubstMotivo(e.target.value)} placeholder="Informe o motivo..." />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setModalSubst(false)}>Cancelar</button>
              <button className="btn-primary" onClick={salvarSubstituicao} disabled={confLoad}>{confLoad ? 'Salvando...' : 'Substituir NF'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Histórico */}
      {modalHist && regSel && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setModalHist(false) }}>
          <div className="modal" style={{ maxWidth: 580 }}>
            <div className="modal-title">Histórico – {regSel.profissionais?.nome}</div>
            {historico.length === 0 && <div style={{ color: '#94a3b8', fontSize: 13 }}>Nenhum registro de histórico.</div>}
            {historico.map((h, i) => (
              <div key={h.id ?? i} style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: 12, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <strong>{h.acao}</strong>
                  <span style={{ color: '#64748b', fontSize: 11 }}>{h.criado_em ? new Date(h.criado_em).toLocaleString('pt-BR') : ''}</span>
                </div>
                {h.descricao && <div style={{ fontSize: 12, color: '#374151', marginTop: 4 }}>{h.descricao}</div>}
                {h.usuario && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Por: {h.usuario}</div>}
              </div>
            ))}
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setModalHist(false)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Importar Excel */}
      {modalImport && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) { setModalImport(false); setImportPreview([]); setImportErros([]) } }}>
          <div className="modal" style={{ maxWidth: 640 }}>
            <div className="modal-title">Importar Excel – Comissões</div>
            <div className="alert alert-info" style={{ marginBottom: 14, fontSize: 12 }}>
              <strong>Formato da planilha:</strong> uma aba por empresa — o <strong>nome da aba</strong> deve ser o <strong>apelido</strong> cadastrado na empresa.<br />
              Colunas: <strong>Nome</strong> (profissional) e <strong>Valor</strong> (comissão). O mês de referência é selecionado abaixo.
            </div>

            <div className="form-grid" style={{ marginBottom: 16 }}>
              <div className="form-group">
                <label className="label-field">Competência (Mês / Ano) *</label>
                <input
                  type="month"
                  className="input-field"
                  value={importMes}
                  onChange={e => { setImportMes(e.target.value); setImportPreview([]); setImportErros([]) }}
                />
              </div>
              <div className="form-group">
                <label className="label-field">Arquivo .xlsx / .xls</label>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="input-field"
                  onChange={handleFileChange}
                  style={{ padding: '6px' }}
                  disabled={!importMes}
                />
              </div>
            </div>

            {importLoad && <div className="loading">Lendo arquivo...</div>}

            {importErros.length > 0 && (
              <div className="alert alert-warn" style={{ marginBottom: 12, fontSize: 12 }}>
                <strong>Avisos / Erros ({importErros.length}):</strong>
                <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                  {importErros.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}

            {importPreview.length > 0 && !importLoad && (
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                  {importPreview.length} registro(s) encontrado(s) — competência:{' '}
                  <span style={{ color: '#1d4ed8' }}>
                    {(() => { const [a, m] = importMes.split('-').map(Number); return `${MESES[m-1]}/${a}` })()}
                  </span>
                </div>
                <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                  <table style={{ width: '100%', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: '#f8fafc' }}>
                        <th className="table-header" style={{ fontSize: 11 }}>Profissional</th>
                        <th className="table-header" style={{ fontSize: 11 }}>Empresa</th>
                        <th className="table-header" style={{ fontSize: 11 }}>Aba</th>
                        <th className="table-header" style={{ fontSize: 11 }}>Comissão</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.slice(0, 30).map((l, i) => (
                        <tr key={i}>
                          <td className="table-cell">{l.profissionalNome}</td>
                          <td className="table-cell">{l.empresaNome}</td>
                          <td className="table-cell">
                            <span className="inline-block bg-blue-100 text-blue-800 font-mono text-xs px-1.5 py-0.5 rounded">{l.empresaApelido}</span>
                          </td>
                          <td className="table-cell">R$ {l.valorComissao.toFixed(2)}</td>
                        </tr>
                      ))}
                      {importPreview.length > 30 && (
                        <tr><td colSpan={4} style={{ padding: '6px 12px', color: '#94a3b8', fontSize: 11 }}>... e mais {importPreview.length - 30} linhas</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => { setModalImport(false); setImportPreview([]); setImportErros([]) }}>Cancelar</button>
              <button className="btn-primary" onClick={executarImportacao} disabled={importLoad || importPreview.length === 0}>
                {importLoad ? 'Importando...' : `Importar ${importPreview.length} registro(s)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </LayoutAdmin>
  )
}

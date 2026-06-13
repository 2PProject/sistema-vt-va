'use client'

import { useEffect, useMemo, useState } from 'react'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase, Empresa, SalaoNFStatus } from '../../../lib/supabase'
import {
  listarRegistros, confirmarNF, substituirNF, buscarHistorico, salvarObservacao,
  importarExcel, processarImportacao, listarConfigs, verificarPrazos,
  marcarForaPrazo, RegistroComDetalhes,
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
const STATUS_BORDER: Record<SalaoNFStatus, string> = {
  pendente: '#f59e0b',
  nf_recebida: '#22c55e',
  fora_do_prazo: '#ef4444',
}

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

function mesAtual() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
}
function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtMes(mes: string) {
  const [a, m] = mes.split('-').map(Number)
  return m ? `${MESES[m-1]}/${a}` : mes
}
function hoje() { return new Date().toISOString().split('T')[0] }

type SortField = 'nome' | 'empresa' | 'mes' | 'valor' | 'status'
const PAGE_SIZE = 50

export default function SalaoNFPage() {
  // Filtros DB
  const [mesRef, setMesRef] = useState(mesAtual())
  const [empresaFiltro, setEmpresaFiltro] = useState('')
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [registros, setRegistros] = useState<RegistroComDetalhes[]>([])
  const [loading, setLoading] = useState(false)

  // Filtros client-side
  const [statusFiltro, setStatusFiltro] = useState('')
  const [busca, setBusca] = useState('')
  const [valorMin, setValorMin] = useState('')
  const [valorMax, setValorMax] = useState('')
  const [sortField, setSortField] = useState<SortField>('mes')
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc')
  const [page, setPage] = useState(1)

  // Seleção
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkLoad, setBulkLoad] = useState(false)

  // Notificação
  const [msg, setMsg] = useState('')
  const [msgTipo, setMsgTipo] = useState<'ok'|'erro'>('ok')

  // Tolerâncias por empresa
  const [toleranciaMap, setToleranciaMap] = useState<Map<string, number>>(new Map())

  // ── Modais ──────────────────────────────────────────────────
  // Confirmar NF
  const [modalConf, setModalConf] = useState(false)
  const [regSel, setRegSel] = useState<RegistroComDetalhes | null>(null)
  const [confNumero, setConfNumero] = useState('')
  const [confData, setConfData] = useState('')
  const [confValor, setConfValor] = useState('')
  const [confObs, setConfObs] = useState('')
  const [confErro, setConfErro] = useState('')
  const [confLoad, setConfLoad] = useState(false)

  // Observação standalone
  const [modalObs, setModalObs] = useState(false)
  const [obsTexto, setObsTexto] = useState('')
  const [obsLoad, setObsLoad] = useState(false)

  // Bulk confirmar
  const [modalBulkConf, setModalBulkConf] = useState(false)
  const [bulkRegs, setBulkRegs] = useState<RegistroComDetalhes[]>([])
  const [bulkDate, setBulkDate] = useState('')
  const [bulkNFs, setBulkNFs] = useState<Record<string, string>>({})
  const [bulkValores, setBulkValores] = useState<Record<string, string>>({})
  const [bulkResultados, setBulkResultados] = useState<Record<string, { ok: boolean; erro?: string }>>({})
  const [bulkDone, setBulkDone] = useState(false)

  // Substituir
  const [modalSubst, setModalSubst] = useState(false)
  const [substMotivo, setSubstMotivo] = useState('')

  // Histórico
  const [modalHist, setModalHist] = useState(false)
  const [historico, setHistorico] = useState<any[]>([])

  // Importar Excel
  const [modalImport, setModalImport] = useState(false)
  const [importMes, setImportMes] = useState(mesAtual())
  const [importPreview, setImportPreview] = useState<any[]>([])
  const [importErros, setImportErros] = useState<string[]>([])
  const [importLoad, setImportLoad] = useState(false)

  // ── Inicialização ────────────────────────────────────────────
  useEffect(() => { carregarEmpresas() }, [])
  useEffect(() => { buscar() }, [mesRef, empresaFiltro])

  async function carregarEmpresas() {
    const [empRes, configs] = await Promise.all([
      supabase.from('empresas').select('*').order('razao_social'),
      listarConfigs(),
    ])
    setEmpresas(empRes.data ?? [])
    const map = new Map<string, number>()
    configs.forEach(c => map.set(c.empresa_id, c.tolerancia_valor))
    setToleranciaMap(map)
  }

  async function buscar() {
    setLoading(true)
    setSelectedIds(new Set())
    setPage(1)
    const data = await listarRegistros({
      mesReferencia: mesRef || undefined,
      empresaId: empresaFiltro || undefined,
    })
    setRegistros(data)
    setLoading(false)
  }

  function notify(text: string, tipo: 'ok'|'erro') {
    setMsg(text); setMsgTipo(tipo)
    setTimeout(() => setMsg(''), 6000)
  }

  // ── KPIs (derivados, sem re-fetch) ───────────────────────────
  const kpis = useMemo(() => ({
    pendente: registros.filter(r => r.status === 'pendente').length,
    recebida: registros.filter(r => r.status === 'nf_recebida').length,
    foraPrazo: registros.filter(r => r.status === 'fora_do_prazo').length,
    total: registros.length,
    valorTotal: registros.reduce((s, r) => s + r.valor_comissao, 0),
    comObs: registros.filter(r => r.observacao).length,
  }), [registros])

  // ── Lista filtrada/ordenada (client-side) ────────────────────
  const registrosFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const vMin = valorMin ? parseFloat(valorMin) : null
    const vMax = valorMax ? parseFloat(valorMax) : null
    return registros
      .filter(r => {
        if (statusFiltro && r.status !== statusFiltro) return false
        if (vMin !== null && r.valor_comissao < vMin) return false
        if (vMax !== null && r.valor_comissao > vMax) return false
        if (q) {
          const txt = [(r.profissionais?.nome ?? ''), (r.empresas?.razao_social ?? ''), (r.confirmacao?.numero_nf ?? '')]
            .join(' ').toLowerCase()
          if (!txt.includes(q)) return false
        }
        return true
      })
      .sort((a, b) => {
        let va: string|number = '', vb: string|number = ''
        if (sortField === 'nome')    { va = a.profissionais?.nome ?? ''; vb = b.profissionais?.nome ?? '' }
        else if (sortField === 'empresa') { va = a.empresas?.razao_social ?? ''; vb = b.empresas?.razao_social ?? '' }
        else if (sortField === 'valor')   { va = a.valor_comissao; vb = b.valor_comissao }
        else if (sortField === 'status')  { va = a.status; vb = b.status }
        else { va = a.mes_referencia; vb = b.mes_referencia }
        if (typeof va === 'number') return sortDir === 'asc' ? (va - (vb as number)) : ((vb as number) - va)
        return sortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
      })
  }, [registros, statusFiltro, busca, valorMin, valorMax, sortField, sortDir])

  const totalPaginas = Math.max(1, Math.ceil(registrosFiltrados.length / PAGE_SIZE))
  const pageSafe = Math.min(page, totalPaginas)
  const pagina = registrosFiltrados.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE)

  const selectedPendentes = useMemo(
    () => registrosFiltrados.filter(r => selectedIds.has(r.id) && (r.status === 'pendente' || r.status === 'fora_do_prazo')),
    [registrosFiltrados, selectedIds]
  )

  // ── Ordenação ────────────────────────────────────────────────
  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
    setPage(1)
  }

  function SortIcon({ field }: { field: SortField }) {
    return <span className="ml-1 opacity-50">{sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
  }

  // ── Seleção ──────────────────────────────────────────────────
  function toggleSelect(id: string) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleSelectAll() {
    if (selectedIds.size === registrosFiltrados.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(registrosFiltrados.map(r => r.id)))
  }

  // ── Confirmar NF (modal rápido) ──────────────────────────────
  function abrirConfirmar(reg: RegistroComDetalhes) {
    setRegSel(reg)
    setConfNumero(reg.confirmacao?.numero_nf ?? '')
    setConfData(reg.confirmacao?.data_nf ?? hoje())
    setConfValor(reg.confirmacao?.valor_nf?.toString() ?? reg.valor_comissao.toFixed(2))
    setConfObs(reg.observacao ?? '')
    setConfErro('')
    setModalConf(true)
  }

  async function salvarConfirmacao() {
    if (!regSel) return
    if (!confNumero.trim() || !confData || !confValor) { setConfErro('Preencha número da NF, data e valor.'); return }
    setConfLoad(true); setConfErro('')
    const tolerancia = toleranciaMap.get(regSel.empresa_id) ?? 0.01
    const res = await confirmarNF({
      registroId: regSel.id,
      numeroNF: confNumero.trim(),
      dataNF: confData,
      valorNF: parseFloat(confValor),
      tolerancia,
      valorComissao: regSel.valor_comissao,
    })
    if (!res.ok) { setConfErro(res.erro ?? 'Erro ao confirmar.'); setConfLoad(false); return }
    if (confObs.trim() !== (regSel.observacao ?? '').trim()) {
      await salvarObservacao(regSel.id, confObs.trim() || null)
    }
    setConfLoad(false)
    setModalConf(false)
    notify('NF confirmada com sucesso.', 'ok')
    buscar()
  }

  // ── Observação standalone ────────────────────────────────────
  function abrirObs(reg: RegistroComDetalhes) {
    setRegSel(reg); setObsTexto(reg.observacao ?? ''); setModalObs(true)
  }

  async function salvarObs(override?: string | null) {
    if (!regSel) return
    setObsLoad(true)
    const texto = override !== undefined ? override : (obsTexto.trim() || null)
    await salvarObservacao(regSel.id, texto)
    setObsLoad(false)
    setModalObs(false)
    setRegistros(prev => prev.map(r => r.id === regSel.id ? { ...r, observacao: texto } : r))
    notify(texto ? 'Observação salva.' : 'Observação removida.', 'ok')
  }

  // ── Substituir NF ────────────────────────────────────────────
  function abrirSubstituir(reg: RegistroComDetalhes) {
    setRegSel(reg)
    setConfNumero(reg.confirmacao?.numero_nf ?? '')
    setConfData(reg.confirmacao?.data_nf ?? '')
    setConfValor(reg.confirmacao?.valor_nf?.toString() ?? reg.valor_comissao.toFixed(2))
    setSubstMotivo(''); setConfErro(''); setModalSubst(true)
  }

  async function salvarSubstituicao() {
    if (!regSel) return
    if (!confNumero || !confData || !confValor || !substMotivo) { setConfErro('Preencha todos os campos, incluindo o motivo.'); return }
    setConfLoad(true); setConfErro('')
    const tolerancia = toleranciaMap.get(regSel.empresa_id) ?? 0.01
    const res = await substituirNF({
      registroId: regSel.id, numeroNF: confNumero, dataNF: confData,
      valorNF: parseFloat(confValor), motivo: substMotivo, tolerancia, valorComissao: regSel.valor_comissao,
    })
    setConfLoad(false)
    if (!res.ok) { setConfErro(res.erro ?? 'Erro.'); return }
    setModalSubst(false)
    notify('NF substituída com sucesso.', 'ok')
    buscar()
  }

  // ── Bulk confirmar ───────────────────────────────────────────
  function abrirBulkConf() {
    if (selectedPendentes.length === 0) { notify('Selecione registros pendentes para confirmar em lote.', 'erro'); return }
    const nfs: Record<string, string> = {}
    const vals: Record<string, string> = {}
    selectedPendentes.forEach(r => { nfs[r.id] = r.confirmacao?.numero_nf ?? ''; vals[r.id] = r.valor_comissao.toFixed(2) })
    setBulkRegs(selectedPendentes)
    setBulkDate(hoje()); setBulkNFs(nfs); setBulkValores(vals)
    setBulkResultados({}); setBulkDone(false); setModalBulkConf(true)
  }

  async function executarBulkConf() {
    if (!bulkDate) { notify('Informe a data da NF.', 'erro'); return }
    setBulkLoad(true)
    const resultados: Record<string, { ok: boolean; erro?: string }> = {}
    await Promise.all(bulkRegs.map(async r => {
      const numero = bulkNFs[r.id]?.trim()
      if (!numero) { resultados[r.id] = { ok: false, erro: 'Número NF obrigatório' }; return }
      const tolerancia = toleranciaMap.get(r.empresa_id) ?? 0.01
      resultados[r.id] = await confirmarNF({
        registroId: r.id, numeroNF: numero, dataNF: bulkDate,
        valorNF: parseFloat(bulkValores[r.id] ?? r.valor_comissao.toFixed(2)),
        tolerancia, valorComissao: r.valor_comissao,
      })
    }))
    setBulkResultados(resultados); setBulkDone(true); setBulkLoad(false)
    const ok = Object.values(resultados).filter(r => r.ok).length
    notify(`${ok} de ${bulkRegs.length} NF(s) confirmada(s).${ok < bulkRegs.length ? ' Verifique os erros.' : ''}`, ok > 0 ? 'ok' : 'erro')
    buscar()
  }

  // ── Bulk fora do prazo ───────────────────────────────────────
  async function bulkMarcarForaPrazo() {
    if (selectedIds.size === 0) return
    setBulkLoad(true)
    await Promise.all(Array.from(selectedIds).map(id => marcarForaPrazo(id)))
    notify(`${selectedIds.size} registro(s) marcado(s) como Fora do Prazo.`, 'ok')
    setSelectedIds(new Set()); setBulkLoad(false); buscar()
  }

  // ── Histórico ────────────────────────────────────────────────
  async function abrirHistorico(reg: RegistroComDetalhes) {
    setRegSel(reg)
    setHistorico(await buscarHistorico(reg.id))
    setModalHist(true)
  }

  // ── Verificar prazos ─────────────────────────────────────────
  async function verificarTodosPrazos() {
    setLoading(true)
    const n = await verificarPrazos(mesRef)
    notify(`${n} registro(s) marcado(s) como Fora do Prazo.`, 'ok')
    buscar()
  }

  // ── Importar Excel ───────────────────────────────────────────
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setImportLoad(true); setImportPreview([]); setImportErros([])
    const { linhas, erros } = await importarExcel(file, importMes)
    setImportPreview(linhas); setImportErros(erros); setImportLoad(false)
    e.target.value = ''
  }

  async function executarImportacao() {
    if (!importPreview.length) return
    setImportLoad(true)
    const { criados, erros } = await processarImportacao(importPreview)
    setImportLoad(false)
    notify(`Importação: ${criados} registro(s) criado(s).${erros.length ? ` ${erros.length} sem correspondência.` : ''}`, erros.length ? 'erro' : 'ok')
    setModalImport(false); buscar()
  }

  const mesLabel = fmtMes(mesRef)

  return (
    <LayoutAdmin
      title="Notas Fiscais – Salão"
      actions={
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setModalImport(true)}>↑ Importar Excel</button>
          <button
            className="btn-secondary"
            style={{ background: '#fef3c7', borderColor: '#fde68a', color: '#d97706' }}
            onClick={verificarTodosPrazos}
          >
            Verificar Prazos
          </button>
        </div>
      }
    >
      <div className="space-y-4">

        {/* Notificação */}
        {msg && (
          <div className={`alert ${msgTipo === 'ok' ? 'alert-success' : 'alert-error'} flex justify-between items-center`}>
            <span>{msg}</span>
            <button onClick={() => setMsg('')} className="font-bold text-lg leading-none ml-4 opacity-60 hover:opacity-100">×</button>
          </div>
        )}

        {/* KPI Cards — clicáveis para filtrar por status */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <button
            className={`stat-card text-left hover:shadow-md transition-all ${!statusFiltro ? 'ring-2 ring-blue-400' : ''}`}
            onClick={() => { setStatusFiltro(''); setPage(1) }}
          >
            <p className="stat-label">Total Período</p>
            <p className="stat-value text-slate-800">{kpis.total}</p>
            <p className="stat-sub">R$ {fmtBRL(kpis.valorTotal)}</p>
          </button>
          <button
            className={`stat-card text-left hover:shadow-md transition-all ${statusFiltro === 'pendente' ? 'ring-2 ring-amber-400' : ''}`}
            onClick={() => { setStatusFiltro(s => s === 'pendente' ? '' : 'pendente'); setPage(1) }}
          >
            <p className="stat-label">Pendentes</p>
            <p className="stat-value text-amber-500">{kpis.pendente}</p>
            <p className="stat-sub">aguardando NF</p>
          </button>
          <button
            className={`stat-card text-left hover:shadow-md transition-all ${statusFiltro === 'nf_recebida' ? 'ring-2 ring-green-400' : ''}`}
            onClick={() => { setStatusFiltro(s => s === 'nf_recebida' ? '' : 'nf_recebida'); setPage(1) }}
          >
            <p className="stat-label">NF Recebidas</p>
            <p className="stat-value text-green-600">{kpis.recebida}</p>
            <p className="stat-sub">confirmadas</p>
          </button>
          <button
            className={`stat-card text-left hover:shadow-md transition-all ${statusFiltro === 'fora_do_prazo' ? 'ring-2 ring-red-400' : ''}`}
            onClick={() => { setStatusFiltro(s => s === 'fora_do_prazo' ? '' : 'fora_do_prazo'); setPage(1) }}
          >
            <p className="stat-label">Fora do Prazo</p>
            <p className="stat-value text-red-500">{kpis.foraPrazo}</p>
            <p className="stat-sub">prazo vencido</p>
          </button>
          <div className="stat-card">
            <p className="stat-label">Com Observação</p>
            <p className={`stat-value ${kpis.comObs > 0 ? 'text-orange-500' : 'text-slate-300'}`}>{kpis.comObs}</p>
            <p className="stat-sub">divergências</p>
          </div>
        </div>

        {/* Barra de filtros */}
        <div className="card">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="form-group" style={{ minWidth: 140, marginBottom: 0 }}>
              <label className="label-field">Mês Referência</label>
              <input type="month" className="input-field" value={mesRef} onChange={e => setMesRef(e.target.value)} />
            </div>
            <div className="form-group" style={{ minWidth: 180, marginBottom: 0 }}>
              <label className="label-field">Empresa</label>
              <select className="input-field" value={empresaFiltro} onChange={e => setEmpresaFiltro(e.target.value)}>
                <option value="">Todas as empresas</option>
                {empresas.map(e => <option key={e.id} value={e.id}>{e.razao_social}</option>)}
              </select>
            </div>
            <div className="flex-1 relative" style={{ minWidth: 200 }}>
              <label className="label-field">Buscar</label>
              <input
                className="input-field w-full pl-9"
                placeholder="Profissional, empresa ou Nº NF..."
                value={busca}
                onChange={e => { setBusca(e.target.value); setPage(1) }}
              />
              <svg className="w-4 h-4 absolute left-3 text-slate-400" style={{ bottom: 10 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <div className="flex gap-2 items-end">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="label-field">Val. mín.</label>
                <input type="number" className="input-field" style={{ width: 90 }} placeholder="0,00" value={valorMin} onChange={e => { setValorMin(e.target.value); setPage(1) }} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="label-field">Val. máx.</label>
                <input type="number" className="input-field" style={{ width: 90 }} placeholder="0,00" value={valorMax} onChange={e => { setValorMax(e.target.value); setPage(1) }} />
              </div>
            </div>
            <div className="flex items-end gap-2 pb-0.5">
              <span className="text-sm text-slate-500">{registrosFiltrados.length} resultado(s)</span>
              {(busca || valorMin || valorMax || statusFiltro || empresaFiltro) && (
                <button className="text-xs text-blue-600 hover:underline" onClick={() => { setBusca(''); setValorMin(''); setValorMax(''); setStatusFiltro(''); setEmpresaFiltro(''); setPage(1) }}>Limpar</button>
              )}
            </div>
          </div>
        </div>

        {loading && <div className="loading">Carregando...</div>}

        {!loading && (
          <div className="card">
            {/* Barra de ações em massa */}
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-3 mb-4 px-4 py-3 rounded-lg flex-wrap" style={{ background: '#eff6ff', border: '1px solid #bfdbfe' }}>
                <span className="text-sm font-bold text-blue-800">{selectedIds.size} selecionado(s)</span>
                {selectedPendentes.length > 0 && (
                  <button className="btn-success" style={{ fontSize: 12, padding: '4px 12px' }} onClick={abrirBulkConf} disabled={bulkLoad}>
                    ✓ Confirmar {selectedPendentes.length} NF(s)
                  </button>
                )}
                <button className="btn-danger" style={{ fontSize: 12, padding: '4px 12px' }} onClick={bulkMarcarForaPrazo} disabled={bulkLoad}>
                  Marcar Fora do Prazo
                </button>
                <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setSelectedIds(new Set())}>
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
                        className="w-4 h-4 cursor-pointer"
                        checked={registrosFiltrados.length > 0 && selectedIds.size === registrosFiltrados.length}
                        ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < registrosFiltrados.length }}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th className="table-header" style={{ width: 4, padding: 0 }}></th>
                    <th className="table-header cursor-pointer select-none" onClick={() => toggleSort('nome')}>
                      Profissional <SortIcon field="nome" />
                    </th>
                    <th className="table-header cursor-pointer select-none" onClick={() => toggleSort('empresa')}>
                      Empresa <SortIcon field="empresa" />
                    </th>
                    <th className="table-header cursor-pointer select-none" onClick={() => toggleSort('mes')}>
                      Referência <SortIcon field="mes" />
                    </th>
                    <th className="table-header cursor-pointer select-none" onClick={() => toggleSort('valor')}>
                      Comissão <SortIcon field="valor" />
                    </th>
                    <th className="table-header">Dados da NF</th>
                    <th className="table-header cursor-pointer select-none" onClick={() => toggleSort('status')}>
                      Status <SortIcon field="status" />
                    </th>
                    <th className="table-header" style={{ width: 200 }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {pagina.length === 0 && (
                    <tr><td className="table-cell" colSpan={9} style={{ textAlign: 'center', color: '#94a3b8' }}>
                      {registros.length === 0 ? 'Nenhum registro encontrado. Importe uma planilha para começar.' : 'Nenhum resultado para os filtros aplicados.'}
                    </td></tr>
                  )}
                  {pagina.map(reg => {
                    const tolerancia = toleranciaMap.get(reg.empresa_id) ?? 0.01
                    const valorNF = reg.confirmacao?.valor_nf
                    const valorOk = valorNF !== undefined && Math.abs(valorNF - reg.valor_comissao) <= tolerancia

                    return (
                      <tr key={reg.id} className={selectedIds.has(reg.id) ? 'bg-blue-50' : 'hover:bg-slate-50'}>
                        <td className="table-cell" style={{ width: 36 }}>
                          <input
                            type="checkbox"
                            className="w-4 h-4 cursor-pointer"
                            checked={selectedIds.has(reg.id)}
                            onChange={() => toggleSelect(reg.id)}
                          />
                        </td>
                        {/* Borda colorida de status */}
                        <td style={{ width: 4, padding: 0, borderLeft: `4px solid ${STATUS_BORDER[reg.status]}` }}></td>
                        <td className="table-cell" style={{ fontWeight: 600 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {reg.profissionais?.nome ?? '—'}
                            {reg.observacao && (
                              <span
                                title={reg.observacao}
                                style={{ color: '#f59e0b', fontSize: 14, cursor: 'help', flexShrink: 0 }}
                              >⚠</span>
                            )}
                          </div>
                        </td>
                        <td className="table-cell" style={{ fontSize: 13 }}>{reg.empresas?.razao_social ?? '—'}</td>
                        <td className="table-cell">{fmtMes(reg.mes_referencia)}</td>
                        <td className="table-cell" style={{ fontWeight: 600 }}>
                          R$ {fmtBRL(reg.valor_comissao)}
                        </td>
                        <td className="table-cell" style={{ fontSize: 12 }}>
                          {reg.confirmacao ? (
                            <div>
                              <div style={{ fontWeight: 600 }}>NF {reg.confirmacao.numero_nf}</div>
                              <div style={{ color: '#64748b' }}>{reg.confirmacao.data_nf?.split('-').reverse().join('/')}</div>
                              <div style={{ color: valorOk ? '#16a34a' : '#dc2626', fontWeight: 500 }}>
                                R$ {fmtBRL(reg.confirmacao.valor_nf)}
                                {!valorOk && <span title="Valor diverge da comissão"> ⚠</span>}
                              </div>
                            </div>
                          ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                        </td>
                        <td className="table-cell">
                          <span className={`badge ${STATUS_BADGE[reg.status]}`}>{STATUS_LABEL[reg.status]}</span>
                        </td>
                        <td className="table-cell">
                          <div className="flex gap-1 flex-wrap">
                            {(reg.status === 'pendente' || reg.status === 'fora_do_prazo') && (
                              <button
                                className="btn-success"
                                style={{ fontSize: 11, padding: '3px 10px' }}
                                onClick={() => abrirConfirmar(reg)}
                              >
                                ✓ Confirmar
                              </button>
                            )}
                            {reg.status === 'nf_recebida' && (
                              <button
                                className="btn-secondary"
                                style={{ fontSize: 11, padding: '3px 8px' }}
                                onClick={() => abrirSubstituir(reg)}
                              >
                                ⟳ Subst.
                              </button>
                            )}
                            <button
                              className="btn-secondary"
                              style={{
                                fontSize: 11, padding: '3px 8px',
                                background: reg.observacao ? '#fffbeb' : undefined,
                                borderColor: reg.observacao ? '#fde68a' : undefined,
                                color: reg.observacao ? '#92400e' : undefined,
                              }}
                              onClick={() => abrirObs(reg)}
                              title={reg.observacao ? `Obs: ${reg.observacao}` : 'Adicionar observação'}
                            >
                              ✎ Obs
                            </button>
                            <button
                              className="btn-secondary"
                              style={{ fontSize: 11, padding: '3px 8px' }}
                              onClick={() => abrirHistorico(reg)}
                            >
                              Hist.
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
                  {(pageSafe - 1) * PAGE_SIZE + 1}–{Math.min(pageSafe * PAGE_SIZE, registrosFiltrados.length)} de {registrosFiltrados.length}
                </span>
                <div className="flex gap-1 items-center">
                  <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} disabled={pageSafe <= 1} onClick={() => setPage(p => p - 1)}>‹ Anterior</button>
                  <span className="text-xs px-2">{pageSafe}/{totalPaginas}</span>
                  <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} disabled={pageSafe >= totalPaginas} onClick={() => setPage(p => p + 1)}>Próxima ›</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Modal Confirmar NF ─────────────────────────────── */}
        {modalConf && regSel && (
          <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setModalConf(false) }}>
            <div className="modal">
              <div className="modal-title">Confirmar Nota Fiscal</div>
              {/* Resumo do registro */}
              <div className="rounded-lg p-3 mb-4 text-sm" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{regSel.profissionais?.nome}</div>
                <div style={{ color: '#64748b' }}>{regSel.empresas?.razao_social} · {fmtMes(regSel.mes_referencia)}</div>
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ color: '#374151' }}>Comissão esperada:</span>
                  <span style={{ fontWeight: 700, color: '#16a34a', fontSize: 16 }}>R$ {fmtBRL(regSel.valor_comissao)}</span>
                  <span style={{ color: '#94a3b8', fontSize: 11 }}>
                    (tolerância ±R$ {(toleranciaMap.get(regSel.empresa_id) ?? 0.01).toFixed(2)})
                  </span>
                </div>
              </div>
              {confErro && <div className="alert alert-error">{confErro}</div>}
              <div className="form-grid">
                <div className="form-group">
                  <label className="label-field">Número da NF *</label>
                  <input className="input-field" value={confNumero} onChange={e => setConfNumero(e.target.value)} placeholder="Ex: 000123" autoFocus />
                </div>
                <div className="form-group">
                  <label className="label-field">Data da NF *</label>
                  <input type="date" className="input-field" value={confData} onChange={e => setConfData(e.target.value)} />
                </div>
                <div className="form-group" style={{ gridColumn: 'span 2' }}>
                  <label className="label-field">
                    Valor da NF (R$) *
                    <span style={{ fontWeight: 400, color: '#64748b', marginLeft: 8, fontSize: 11 }}>
                      pré-preenchido com a comissão — altere se o valor da NF for diferente
                    </span>
                  </label>
                  <input
                    type="number" step="0.01" className="input-field" value={confValor}
                    onChange={e => setConfValor(e.target.value)}
                    style={{
                      borderColor: confValor && Math.abs(parseFloat(confValor) - regSel.valor_comissao) <= (toleranciaMap.get(regSel.empresa_id) ?? 0.01)
                        ? '#86efac' : undefined,
                    }}
                  />
                </div>
                <div className="form-group" style={{ gridColumn: 'span 2' }}>
                  <label className="label-field">
                    Observação
                    <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: 8, fontSize: 11 }}>
                      opcional — registre divergências ou anotações
                    </span>
                  </label>
                  <textarea
                    className="input-field" rows={2} value={confObs}
                    onChange={e => setConfObs(e.target.value)}
                    placeholder="Ex.: Valor lançado a menor. Duplicidade identificada. Aguardando correção..."
                    style={{ resize: 'vertical' }}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn-secondary" onClick={() => setModalConf(false)}>Cancelar</button>
                <button className="btn-primary" onClick={salvarConfirmacao} disabled={confLoad}>
                  {confLoad ? 'Confirmando...' : 'Confirmar NF'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal Observação ───────────────────────────────── */}
        {modalObs && regSel && (
          <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setModalObs(false) }}>
            <div className="modal" style={{ maxWidth: 480 }}>
              <div className="modal-title">Observação / Divergência</div>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
                <strong style={{ color: '#374151' }}>{regSel.profissionais?.nome}</strong>
                {' · '}{regSel.empresas?.razao_social}
                {' · '}{fmtMes(regSel.mes_referencia)}
                {' · '}R$ {fmtBRL(regSel.valor_comissao)}
              </div>
              <div className="form-group">
                <label className="label-field">Registre divergências, erros ou anotações relevantes</label>
                <textarea
                  className="input-field" rows={4} value={obsTexto}
                  onChange={e => setObsTexto(e.target.value)}
                  placeholder="Ex.: Valor lançado a maior. Erro de profissional. Duplicidade identificada. Aguardando correção do responsável..."
                  style={{ resize: 'vertical' }}
                  autoFocus
                />
              </div>
              <div className="modal-footer">
                <button className="btn-secondary" onClick={() => setModalObs(false)}>Cancelar</button>
                {regSel.observacao && (
                  <button className="btn-danger" style={{ fontSize: 12 }} disabled={obsLoad} onClick={() => salvarObs(null)}>
                    Remover
                  </button>
                )}
                <button className="btn-primary" onClick={() => salvarObs()} disabled={obsLoad}>
                  {obsLoad ? 'Salvando...' : 'Salvar Observação'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal Bulk Confirmar ───────────────────────────── */}
        {modalBulkConf && (
          <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !bulkDone) setModalBulkConf(false) }}>
            <div className="modal" style={{ maxWidth: 740 }}>
              <div className="modal-title">Confirmar Notas Fiscais em Lote</div>

              {!bulkDone ? (
                <>
                  <div className="alert alert-info" style={{ marginBottom: 12, fontSize: 12 }}>
                    Valores pré-preenchidos com a comissão de cada registro.
                    Informe o número da NF para cada profissional e a data de emissão (aplicada a todos).
                  </div>
                  <div className="form-group" style={{ marginBottom: 16 }}>
                    <label className="label-field">Data da NF — aplicada a todos *</label>
                    <input type="date" className="input-field" style={{ maxWidth: 200 }} value={bulkDate} onChange={e => setBulkDate(e.target.value)} />
                  </div>
                  <div style={{ maxHeight: 340, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 16 }}>
                    <table style={{ width: '100%', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
                          <th className="table-header">Profissional</th>
                          <th className="table-header">Empresa</th>
                          <th className="table-header">Comissão</th>
                          <th className="table-header">Nº NF *</th>
                          <th className="table-header">Valor NF</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bulkRegs.map(r => (
                          <tr key={r.id}>
                            <td className="table-cell" style={{ fontWeight: 600 }}>{r.profissionais?.nome}</td>
                            <td className="table-cell">{r.empresas?.razao_social}</td>
                            <td className="table-cell">R$ {fmtBRL(r.valor_comissao)}</td>
                            <td className="table-cell">
                              <input
                                className="input-field"
                                style={{ padding: '3px 8px', fontSize: 12 }}
                                placeholder="Nº NF"
                                value={bulkNFs[r.id] ?? ''}
                                onChange={e => setBulkNFs(prev => ({ ...prev, [r.id]: e.target.value }))}
                              />
                            </td>
                            <td className="table-cell">
                              <input
                                type="number" step="0.01"
                                className="input-field"
                                style={{ padding: '3px 8px', fontSize: 12, width: 90 }}
                                value={bulkValores[r.id] ?? r.valor_comissao.toFixed(2)}
                                onChange={e => setBulkValores(prev => ({ ...prev, [r.id]: e.target.value }))}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="modal-footer">
                    <button className="btn-secondary" onClick={() => setModalBulkConf(false)}>Cancelar</button>
                    <button className="btn-primary" onClick={executarBulkConf} disabled={bulkLoad || !bulkDate}>
                      {bulkLoad ? 'Confirmando...' : `Confirmar ${bulkRegs.length} NF(s)`}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ maxHeight: 380, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 16 }}>
                    <table style={{ width: '100%', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: '#f8fafc' }}>
                          <th className="table-header">Profissional</th>
                          <th className="table-header">NF</th>
                          <th className="table-header">Resultado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bulkRegs.map(r => {
                          const res = bulkResultados[r.id]
                          return (
                            <tr key={r.id}>
                              <td className="table-cell" style={{ fontWeight: 600 }}>{r.profissionais?.nome}</td>
                              <td className="table-cell">{bulkNFs[r.id] || '—'}</td>
                              <td className="table-cell">
                                {res?.ok
                                  ? <span className="badge badge-green">✓ Confirmada</span>
                                  : <span className="badge badge-red">✗ {res?.erro ?? 'Erro'}</span>
                                }
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="modal-footer">
                    <button className="btn-primary" onClick={() => { setModalBulkConf(false); setSelectedIds(new Set()) }}>Fechar</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Modal Substituir NF ────────────────────────────── */}
        {modalSubst && regSel && (
          <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setModalSubst(false) }}>
            <div className="modal">
              <div className="modal-title">Substituir Nota Fiscal</div>
              <div className="alert alert-warn" style={{ marginBottom: 14 }}>
                Esta ação substituirá a NF atual e será registrada no histórico. Informe o motivo.
              </div>
              <div style={{ marginBottom: 14, fontSize: 13 }}>
                <strong>{regSel.profissionais?.nome}</strong> — Comissão: R$ {fmtBRL(regSel.valor_comissao)}
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
                <button className="btn-primary" onClick={salvarSubstituicao} disabled={confLoad}>
                  {confLoad ? 'Salvando...' : 'Substituir NF'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal Histórico ────────────────────────────────── */}
        {modalHist && regSel && (
          <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setModalHist(false) }}>
            <div className="modal" style={{ maxWidth: 580 }}>
              <div className="modal-title">Histórico – {regSel.profissionais?.nome}</div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
                {regSel.empresas?.razao_social} · {fmtMes(regSel.mes_referencia)} · R$ {fmtBRL(regSel.valor_comissao)}
              </div>
              {historico.length === 0 && <div style={{ color: '#94a3b8', fontSize: 13 }}>Nenhum registro de histórico.</div>}
              {historico.map((h, i) => (
                <div key={h.id ?? i} style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: 10, marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <strong>{h.acao}</strong>
                    <span style={{ color: '#64748b', fontSize: 11 }}>{h.criado_em ? new Date(h.criado_em).toLocaleString('pt-BR') : ''}</span>
                  </div>
                  {h.descricao && <div style={{ fontSize: 12, color: '#374151', marginTop: 3 }}>{h.descricao}</div>}
                  {h.usuario && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Por: {h.usuario}</div>}
                </div>
              ))}
              <div className="modal-footer">
                <button className="btn-secondary" onClick={() => setModalHist(false)}>Fechar</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal Importar Excel ───────────────────────────── */}
        {modalImport && (
          <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) { setModalImport(false); setImportPreview([]); setImportErros([]) } }}>
            <div className="modal" style={{ maxWidth: 640 }}>
              <div className="modal-title">Importar Excel – Comissões</div>
              <div className="alert alert-info" style={{ marginBottom: 14, fontSize: 12 }}>
                <strong>Formato:</strong> uma aba por empresa — o <strong>nome da aba</strong> deve ser o <strong>apelido</strong> da empresa.<br />
                Colunas: <strong>Nome</strong> (profissional) e <strong>Valor</strong> ou <strong>Crédito</strong> (comissão). O mês é selecionado abaixo.
              </div>
              <div className="form-grid" style={{ marginBottom: 16 }}>
                <div className="form-group">
                  <label className="label-field">Competência (Mês/Ano) *</label>
                  <input type="month" className="input-field" value={importMes} onChange={e => { setImportMes(e.target.value); setImportPreview([]); setImportErros([]) }} />
                </div>
                <div className="form-group">
                  <label className="label-field">Arquivo .xlsx / .xls</label>
                  <input type="file" accept=".xlsx,.xls" className="input-field" onChange={handleFileChange} style={{ padding: '6px' }} disabled={!importMes} />
                </div>
              </div>
              {importLoad && <div className="loading">Lendo arquivo...</div>}
              {importErros.length > 0 && (
                <div className="alert alert-warn" style={{ marginBottom: 12, fontSize: 12 }}>
                  <strong>Avisos / Erros ({importErros.length}):</strong>
                  <ul style={{ marginTop: 6, paddingLeft: 18 }}>{importErros.map((e, i) => <li key={i}>{e}</li>)}</ul>
                </div>
              )}
              {importPreview.length > 0 && !importLoad && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                    {importPreview.length} registro(s) — <span style={{ color: '#1d4ed8' }}>{fmtMes(importMes)}</span>
                  </div>
                  <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                    <table style={{ width: '100%', fontSize: 12 }}>
                      <thead><tr style={{ background: '#f8fafc' }}>
                        <th className="table-header" style={{ fontSize: 11 }}>Profissional</th>
                        <th className="table-header" style={{ fontSize: 11 }}>Empresa</th>
                        <th className="table-header" style={{ fontSize: 11 }}>Comissão</th>
                      </tr></thead>
                      <tbody>
                        {importPreview.slice(0, 30).map((l, i) => (
                          <tr key={i}>
                            <td className="table-cell">{l.profissionalNome}</td>
                            <td className="table-cell">{l.empresaNome}</td>
                            <td className="table-cell">R$ {l.valorComissao.toFixed(2)}</td>
                          </tr>
                        ))}
                        {importPreview.length > 30 && (
                          <tr><td colSpan={3} style={{ padding: '6px 12px', color: '#94a3b8', fontSize: 11 }}>... e mais {importPreview.length - 30} linhas</td></tr>
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

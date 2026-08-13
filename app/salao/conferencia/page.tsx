'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase, Empresa } from '../../../lib/supabase'
import { formatarMoeda, MESES } from '../../../utils/calculoVT'
import { SALAO_ENABLED } from '../../../lib/salao/config'
import {
  consultarConferencia, reconciliarCompetencia, refazerConferencia,
  vincularNota, desvincular, corrigirCnpj, notasDoCnpj, editarComissao, editarNota, excluirNota,
  SITUACAO_LABEL, type LinhaConsulta, type NotaLivre, type Filtros, type Ordenacao, type Situacao, type Indicadores,
} from '../../../lib/salao/conferencia'

function mesAtual() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
function fmtMes(m: string) { const [a, mm] = (m || '').split('-').map(Number); return mm ? `${MESES[mm - 1]}/${a}` : (m || '—') }
function fmtData(iso: string | null | undefined) { if (!iso) return '—'; const [a, m, d] = iso.split('-'); return d ? `${d}/${m}/${a}` : iso }
function fmtDoc(d: string | null | undefined) {
  const s = (d ?? '').replace(/\D/g, '')
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  return s || '—'
}

const SIT_COR: Record<Situacao, string> = {
  conferido: 'bg-green-100 text-green-700', corrigido_manual: 'bg-emerald-100 text-emerald-700',
  divergencia_valor: 'bg-amber-100 text-amber-700', sem_nota: 'bg-gray-100 text-gray-600',
  nota_sem_vinculo: 'bg-blue-100 text-blue-700', falta_cnpj: 'bg-orange-100 text-orange-700',
  cnpj_invalido: 'bg-orange-100 text-orange-700', nota_outra_empresa: 'bg-red-100 text-red-700',
  possivel_duplicidade: 'bg-purple-100 text-purple-700', vinculo_sugerido: 'bg-teal-100 text-teal-700',
  aguardando_confirmacao: 'bg-cyan-100 text-cyan-700',
}

const COLS = [
  { key: 'nome', label: 'Profissional', sort: 'nome' as const },
  { key: 'documento', label: 'CPF/CNPJ', sort: 'documento' as const },
  { key: 'empresa', label: 'Empresa', sort: 'empresa' as const },
  { key: 'competencia', label: 'Competência', sort: 'competencia' as const },
  { key: 'valor_comissao', label: 'Valor esperado', sort: 'valor' as const, num: true },
  { key: 'nf_numero', label: 'Nº nota' },
  { key: 'nf_data', label: 'Emissão' },
  { key: 'nf_valor', label: 'Valor nota', num: true },
  { key: 'diferenca', label: 'Diferença', sort: 'diferenca' as const, num: true },
  { key: 'situacao', label: 'Situação', sort: 'situacao' as const },
  { key: 'confianca', label: 'Confiança' },
  { key: 'acoes', label: 'Ações' },
]
type ColKey = typeof COLS[number]['key']

const FILTROS_INI: Filtros = { competencia: mesAtual(), empresaId: '', nome: '', documento: '', situacao: 'todas', vinculo: 'todas', valorMin: null, valorMax: null, soDivergencia: false, emissaoDe: null, emissaoAte: null, numeroNota: '', busca: '' }
const ORD_INI: Ordenacao = { campo: 'nome', dir: 'asc' }

export default function SalaoConferenciaPage() {
  const router = useRouter()
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_INI)
  const [ord, setOrd] = useState<Ordenacao>(ORD_INI)
  const [pagina, setPagina] = useState(1)
  const [tamanho, setTamanho] = useState(50)
  const [cols, setCols] = useState<Set<ColKey>>(new Set(COLS.map(c => c.key)))
  const [colMenu, setColMenu] = useState(false)

  const [linhas, setLinhas] = useState<LinhaConsulta[]>([])
  const [total, setTotal] = useState(0)
  const [ind, setInd] = useState<Indicadores | null>(null)
  const [distComp, setDistComp] = useState<{ comp: string; n: number }[]>([])
  const [loading, setLoading] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [msg, setMsg] = useState(''); const [msgTipo, setMsgTipo] = useState<'ok' | 'erro'>('ok')

  const [modal, setModal] = useState<{ tipo: 'vincular'; item: LinhaConsulta } | { tipo: 'editarCom'; item: LinhaConsulta } | { tipo: 'editarNota'; item: LinhaConsulta } | null>(null)
  const [candNotas, setCandNotas] = useState<NotaLivre[]>([])
  const [form, setForm] = useState<Record<string, string>>({})
  const carregouSalvo = useRef(false)

  useEffect(() => {
    if (!SALAO_ENABLED) { router.replace('/dashboard'); return }
    supabase.from('empresas').select('*').order('razao_social').then(({ data }) => setEmpresas(data ?? []))
    // preserva filtros ao voltar
    try {
      const raw = localStorage.getItem('salao.conf.v1')
      if (raw) { const s = JSON.parse(raw); if (s.filtros) setFiltros({ ...FILTROS_INI, ...s.filtros }); if (s.ord) setOrd(s.ord); if (s.tamanho) setTamanho(s.tamanho); if (s.cols) setCols(new Set(s.cols)) }
      else {
        supabase.from('salon_comissoes').select('mes_ref').order('mes_ref', { ascending: false }).limit(1)
          .then(({ data }) => { const m = data?.[0]?.mes_ref; if (m) setFiltros(f => ({ ...f, competencia: m })) })
      }
    } catch { /* ignore */ }
    carregouSalvo.current = true
  }, [router])

  useEffect(() => {
    if (!carregouSalvo.current) return
    try { localStorage.setItem('salao.conf.v1', JSON.stringify({ filtros, ord, tamanho, cols: Array.from(cols) })) } catch { /* ignore */ }
  }, [filtros, ord, tamanho, cols])

  const carregar = useCallback(async () => {
    if (!filtros.competencia) return
    setLoading(true)
    const r = await consultarConferencia(filtros, ord, pagina, tamanho)
    setLinhas(r.linhas); setTotal(r.total); setInd(r.indicadores); setDistComp(r.distComp)
    setLoading(false)
  }, [filtros, ord, pagina, tamanho])
  useEffect(() => { if (SALAO_ENABLED) carregar() }, [carregar])

  function notify(t: string, tipo: 'ok' | 'erro') { setMsg(t); setMsgTipo(tipo); setTimeout(() => setMsg(''), 8000) }
  function setF<K extends keyof Filtros>(k: K, v: Filtros[K]) { setPagina(1); setFiltros(f => ({ ...f, [k]: v })) }
  function clicarSituacao(s: Situacao | 'todas') { setPagina(1); setFiltros(f => ({ ...f, situacao: f.situacao === s ? 'todas' : s })) }
  function sortPor(campo: Ordenacao['campo']) { setOrd(o => o.campo === campo ? { campo, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { campo, dir: 'asc' }) }

  async function reconciliar() { setOcupado(true); const r = await reconciliarCompetencia(filtros.competencia, filtros.empresaId || undefined); setOcupado(false); notify(`Conciliado: ${r.conferidas} casada(s)${r.outraEmpresa ? ` (${r.outraEmpresa} em outra unidade)` : ''}. ${r.pendentes} pendente(s).`, 'ok'); carregar() }
  async function refazer() {
    if (!window.confirm(`Refazer a conferência de ${fmtMes(filtros.competencia)}? Desfaz os vínculos automáticos e concilia do zero.`)) return
    setOcupado(true); const r = await refazerConferencia(filtros.competencia, filtros.empresaId || undefined); setOcupado(false)
    notify(`Refeito: ${r.limpos} limpo(s) · ${r.conferidas} casada(s). ${r.pendentes} pendente(s).`, 'ok'); carregar()
  }

  async function abrirVincular(l: LinhaConsulta) { setModal({ tipo: 'vincular', item: l }); setCandNotas([]); setCandNotas(await notasDoCnpj('', l.documento)) }
  async function vincular(comissaoId: string, n: NotaLivre) { const r = await vincularNota(comissaoId, { id: n.id, numero: n.numero, valor: n.valor, data_emissao: n.data_emissao }); if (!r.ok) return notify(r.erro ?? 'Erro.', 'erro'); setModal(null); notify('Nota vinculada.', 'ok'); carregar() }
  async function confirmarSugestao(l: LinhaConsulta) { if (!l.sugestaoNotaId) return; const r = await vincularNota(l.id, { id: l.sugestaoNotaId, numero: null, valor: null, data_emissao: null }); if (!r.ok) return notify(r.erro ?? 'Erro.', 'erro'); notify('Vínculo confirmado.', 'ok'); carregar() }
  async function desfazer(l: LinhaConsulta) { const r = await desvincular(l.id); if (!r.ok) return notify(r.erro ?? 'Erro.', 'erro'); notify('Vínculo desfeito.', 'ok'); carregar() }

  function abrirEditar(l: LinhaConsulta) {
    if (l.tipo === 'nota') { setForm({ emitente_nome: l.nome ?? '', documento: l.documento ?? '', numero: l.nf_numero ?? '', data_emissao: l.nf_data ?? '', competencia: l.nota_competencia ?? '', valor: String(l.nf_valor ?? ''), observacao: '' }); setModal({ tipo: 'editarNota', item: l }) }
    else { setForm({ nome: l.nome ?? '', documento: l.documento ?? '', valor_comissao: String(l.valor_comissao ?? ''), empresa_id: l.empresa_id, mes_ref: l.mes_ref, observacao: '' }); setModal({ tipo: 'editarCom', item: l }) }
  }
  async function salvarEdicao() {
    if (!modal) return
    if (modal.tipo === 'editarCom') {
      const r = await editarComissao(modal.item.id, { nome: form.nome, documento: form.documento, valor_comissao: form.valor_comissao, empresa_id: form.empresa_id, mes_ref: form.mes_ref, observacao: form.observacao })
      if (!r.ok) return notify(r.erro ?? 'Erro.', 'erro')
      notify(`Registro atualizado${r.desvinculou ? ' (vínculo desfeito por ficar incompatível)' : ''}.`, 'ok')
    } else if (modal.tipo === 'editarNota') {
      const r = await editarNota(modal.item.id, { emitente_nome: form.emitente_nome, documento: form.documento, numero: form.numero, data_emissao: form.data_emissao || null, competencia: form.competencia, valor: form.valor, observacao: form.observacao })
      if (!r.ok) return notify(r.erro ?? 'Erro.', 'erro'); notify('Nota atualizada.', 'ok')
    }
    setModal(null); carregar()
  }
  async function excluir(l: LinhaConsulta) {
    const motivo = window.prompt('Motivo da exclusão da nota (obrigatório):') ?? ''
    if (!motivo.trim()) return
    const r = await excluirNota(l.id, motivo); if (!r.ok) return notify(r.erro ?? 'Erro.', 'erro'); notify('Nota excluída (lógica).', 'ok'); carregar()
  }
  async function salvarCnpjRapido(l: LinhaConsulta, doc: string) {
    const r = await corrigirCnpj(l.id, doc); if (!r.ok) return notify(r.erro ?? 'Erro.', 'erro'); notify('CNPJ corrigido.', 'ok'); await reconciliarCompetencia(filtros.competencia); carregar()
  }

  async function exportarCSV() {
    setOcupado(true)
    const r = await consultarConferencia(filtros, ord, 1, 100000)
    setOcupado(false)
    const head = ['Profissional', 'CPF/CNPJ', 'Empresa', 'Competência', 'Valor esperado', 'Nº nota', 'Emissão', 'Valor nota', 'Diferença', 'Situação', 'Confiança']
    const linhasCsv = r.linhas.map(l => [l.nome ?? '', fmtDoc(l.documento), l.empresaNome, l.mes_ref, l.valor_comissao ?? '', l.nf_numero ?? '', l.nf_data ?? '', l.nf_valor ?? '', l.diferenca ?? '', SITUACAO_LABEL[l.situacao], l.confianca ?? ''])
    const csv = [head, ...linhasCsv].map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `conferencia_${filtros.competencia}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }

  const chips = useMemo(() => {
    const c: { k: keyof Filtros; label: string }[] = []
    if (filtros.empresaId) c.push({ k: 'empresaId', label: `Empresa: ${empresas.find(e => e.id === filtros.empresaId)?.apelido || '—'}` })
    if (filtros.nome) c.push({ k: 'nome', label: `Nome: ${filtros.nome}` })
    if (filtros.documento) c.push({ k: 'documento', label: `CNPJ: ${filtros.documento}` })
    if (filtros.situacao && filtros.situacao !== 'todas') c.push({ k: 'situacao', label: `Situação: ${SITUACAO_LABEL[filtros.situacao]}` })
    if (filtros.vinculo && filtros.vinculo !== 'todas') c.push({ k: 'vinculo', label: `Vínculo: ${filtros.vinculo === 'vinculado' ? 'vinculado' : 'não vinculado'}` })
    if (filtros.valorMin != null) c.push({ k: 'valorMin', label: `Valor ≥ ${filtros.valorMin}` })
    if (filtros.valorMax != null) c.push({ k: 'valorMax', label: `Valor ≤ ${filtros.valorMax}` })
    if (filtros.soDivergencia) c.push({ k: 'soDivergencia', label: 'Só divergências' })
    if (filtros.emissaoDe) c.push({ k: 'emissaoDe', label: `Emissão ≥ ${fmtData(filtros.emissaoDe)}` })
    if (filtros.emissaoAte) c.push({ k: 'emissaoAte', label: `Emissão ≤ ${fmtData(filtros.emissaoAte)}` })
    if (filtros.numeroNota) c.push({ k: 'numeroNota', label: `Nº ${filtros.numeroNota}` })
    if (filtros.busca) c.push({ k: 'busca', label: `Busca: ${filtros.busca}` })
    return c
  }, [filtros, empresas])
  function removerChip(k: keyof Filtros) { const reset: Partial<Filtros> = { [k]: (k === 'situacao' ? 'todas' : k === 'vinculo' ? 'todas' : k === 'soDivergencia' ? false : ['valorMin', 'valorMax', 'emissaoDe', 'emissaoAte'].includes(k as string) ? null : '') as never }; setPagina(1); setFiltros(f => ({ ...f, ...reset })) }
  function limparFiltros() { setPagina(1); setFiltros(f => ({ ...FILTROS_INI, competencia: f.competencia, empresaId: f.empresaId })) }

  if (!SALAO_ENABLED) return null
  const totalPag = Math.max(1, Math.ceil(total / tamanho))

  const Card = ({ label, valor, cor, sit }: { label: string; valor: string | number; cor: string; sit?: Situacao }) => (
    <button onClick={() => sit && clicarSituacao(sit)} disabled={!sit}
      className={`text-left rounded-lg border p-3 transition ${sit ? 'hover:shadow cursor-pointer' : 'cursor-default'} ${sit && filtros.situacao === sit ? 'ring-2 ring-blue-500 border-blue-300' : 'border-gray-200'} bg-white`}>
      <div className="text-[11px] text-gray-400 leading-tight">{label}</div>
      <div className={`text-lg font-bold ${cor}`}>{valor}</div>
    </button>
  )

  return (
    <LayoutAdmin title="Salão — Conferência da Competência"
      actions={<div className="flex gap-2">
        <button onClick={refazer} disabled={ocupado || loading} className="bg-white border border-emerald-600 text-emerald-700 font-medium py-2 px-3 rounded-lg hover:bg-emerald-50 disabled:opacity-60 text-sm">{ocupado ? '...' : 'Refazer'}</button>
        <button onClick={reconciliar} disabled={ocupado || loading} className="bg-emerald-600 text-white font-medium py-2 px-3 rounded-lg hover:bg-emerald-700 disabled:opacity-60 text-sm">{ocupado ? 'Conciliando...' : 'Conciliar automático'}</button>
      </div>}
    >
      <div className="space-y-4">
        {msg && <div className={`px-4 py-3 rounded-lg text-sm flex justify-between ${msgTipo === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}><span>{msg}</span><button onClick={() => setMsg('')} className="font-bold opacity-60">×</button></div>}

        {/* Filtros base */}
        <div className="card">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <div><label className="label-field">Competência</label><input type="month" className="input-field" value={filtros.competencia} onChange={e => setF('competencia', e.target.value)} /></div>
            <div><label className="label-field">Empresa</label><select className="input-field" value={filtros.empresaId} onChange={e => setF('empresaId', e.target.value)}><option value="">Todas</option>{empresas.map(e => <option key={e.id} value={e.id}>{e.apelido || e.razao_social}</option>)}</select></div>
            <div><label className="label-field">Profissional</label><input className="input-field" value={filtros.nome} onChange={e => setF('nome', e.target.value)} placeholder="nome" /></div>
            <div><label className="label-field">CPF/CNPJ</label><input className="input-field" value={filtros.documento} onChange={e => setF('documento', e.target.value)} placeholder="dígitos" /></div>
            <div><label className="label-field">Vínculo</label><select className="input-field" value={filtros.vinculo} onChange={e => setF('vinculo', e.target.value as Filtros['vinculo'])}><option value="todas">Todos</option><option value="vinculado">Vinculados</option><option value="nao_vinculado">Não vinculados</option></select></div>
            <div><label className="label-field">Situação</label><select className="input-field" value={filtros.situacao} onChange={e => setF('situacao', e.target.value as Situacao | 'todas')}><option value="todas">Todas</option>{(Object.keys(SITUACAO_LABEL) as Situacao[]).map(s => <option key={s} value={s}>{SITUACAO_LABEL[s]}</option>)}</select></div>
            <div><label className="label-field">Valor ≥</label><input type="number" className="input-field" value={filtros.valorMin ?? ''} onChange={e => setF('valorMin', e.target.value === '' ? null : Number(e.target.value))} /></div>
            <div><label className="label-field">Valor ≤</label><input type="number" className="input-field" value={filtros.valorMax ?? ''} onChange={e => setF('valorMax', e.target.value === '' ? null : Number(e.target.value))} /></div>
            <div><label className="label-field">Emissão de</label><input type="date" className="input-field" value={filtros.emissaoDe ?? ''} onChange={e => setF('emissaoDe', e.target.value || null)} /></div>
            <div><label className="label-field">Emissão até</label><input type="date" className="input-field" value={filtros.emissaoAte ?? ''} onChange={e => setF('emissaoAte', e.target.value || null)} /></div>
            <div><label className="label-field">Nº nota</label><input className="input-field" value={filtros.numeroNota} onChange={e => setF('numeroNota', e.target.value)} /></div>
            <div><label className="label-field">Busca geral</label><input className="input-field" value={filtros.busca} onChange={e => setF('busca', e.target.value)} placeholder="nome, CNPJ, nota..." /></div>
          </div>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <label className="flex items-center gap-1 text-sm text-gray-600"><input type="checkbox" checked={filtros.soDivergencia} onChange={e => setF('soDivergencia', e.target.checked)} /> Só divergências</label>
            {chips.map((c, i) => <span key={i} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded-full">{c.label}<button onClick={() => removerChip(c.k)} className="font-bold">×</button></span>)}
            {chips.length > 0 && <button onClick={limparFiltros} className="text-xs text-red-600 underline">Limpar filtros</button>}
          </div>
        </div>

        {/* Indicadores clicáveis */}
        {ind && (
          <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-9 gap-2">
            <Card label="Esperados" valor={ind.esperados} cor="text-gray-800" />
            <Card label="Conferidos" valor={ind.conferidos} cor="text-green-700" sit="conferido" />
            <Card label="Sem nota" valor={ind.semNota} cor="text-gray-600" sit="sem_nota" />
            <Card label="Notas s/ vínculo" valor={ind.notasSemVinculo} cor="text-blue-700" sit="nota_sem_vinculo" />
            <Card label="Divergências" valor={ind.divergencias} cor="text-amber-700" sit="divergencia_valor" />
            <Card label="Sem CNPJ" valor={ind.semCnpj} cor="text-orange-700" sit="falta_cnpj" />
            <Card label="Outra empresa" valor={ind.outraEmpresa} cor="text-red-700" sit="nota_outra_empresa" />
            <Card label="Duplicidades" valor={ind.duplicidades} cor="text-purple-700" sit="possivel_duplicidade" />
            <Card label="Aguardando" valor={ind.aguardando} cor="text-cyan-700" sit="aguardando_confirmacao" />
            <Card label="Valor esperado" valor={formatarMoeda(ind.valorEsperado)} cor="text-gray-800" />
            <Card label="Valor vinculado" valor={formatarMoeda(ind.valorVinculado)} cor="text-green-700" />
            <Card label="Diferença" valor={formatarMoeda(ind.diferenca)} cor={Math.abs(ind.diferenca) < 0.01 ? 'text-green-700' : 'text-amber-700'} />
          </div>
        )}
        {distComp.length > 0 && (
          <div className="text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-1">
            <span className="text-gray-400">Notas dos pendentes por competência:</span>
            {distComp.map(d => <span key={d.comp} className={d.comp === filtros.competencia ? 'text-green-700 font-semibold' : ''}>{d.comp}: <strong>{d.n}</strong></span>)}
          </div>
        )}

        {/* Tabela */}
        <div className="card">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="text-sm text-gray-500">{total} registro(s)</div>
            <div className="flex items-center gap-2 relative">
              <button onClick={exportarCSV} disabled={ocupado} className="text-xs border border-gray-200 rounded px-2 py-1 hover:bg-gray-50">Exportar CSV</button>
              <button onClick={() => setColMenu(v => !v)} className="text-xs border border-gray-200 rounded px-2 py-1 hover:bg-gray-50">Colunas ▾</button>
              {colMenu && (
                <div className="absolute right-0 top-8 z-20 bg-white border border-gray-200 rounded-lg shadow-lg p-2 w-48">
                  {COLS.filter(c => c.key !== 'acoes').map(c => (
                    <label key={c.key} className="flex items-center gap-2 text-xs py-1"><input type="checkbox" checked={cols.has(c.key)} onChange={() => setCols(s => { const n = new Set(s); n.has(c.key) ? n.delete(c.key) : n.add(c.key); return n })} />{c.label}</label>
                  ))}
                </div>
              )}
              <select className="text-xs border border-gray-200 rounded px-2 py-1" value={tamanho} onChange={e => { setPagina(1); setTamanho(Number(e.target.value)) }}>
                {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n}/pág.</option>)}
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead><tr className="bg-gray-50 border-b border-gray-200">
                {COLS.filter(c => cols.has(c.key)).map(c => (
                  <th key={c.key} className={`table-header ${c.num ? 'text-right' : ''} ${c.sort ? 'cursor-pointer select-none' : ''}`} onClick={() => c.sort && sortPor(c.sort)}>
                    {c.label}{c.sort && ord.campo === c.sort ? (ord.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? <tr><td colSpan={cols.size} className="text-center py-10 text-gray-400">Carregando...</td></tr> :
                  linhas.length === 0 ? <tr><td colSpan={cols.size} className="text-center py-10 text-gray-400">Nenhum registro com os filtros atuais.</td></tr> :
                    linhas.map(l => (
                      <tr key={`${l.tipo}-${l.id}`} className="hover:bg-gray-50">
                        {cols.has('nome') && <td className="table-cell font-medium text-gray-900">{l.nome || '—'}{l.tipo === 'nota' && <span className="ml-1 text-[10px] text-blue-600">(nota)</span>}</td>}
                        {cols.has('documento') && <td className="table-cell text-gray-600">{fmtDoc(l.documento)}</td>}
                        {cols.has('empresa') && <td className="table-cell text-gray-500">{l.empresaNome}{l.outraEmpresa && l.nota_empresaNome ? ` ← ${l.nota_empresaNome}` : ''}</td>}
                        {cols.has('competencia') && <td className="table-cell">{fmtMes(l.mes_ref)}</td>}
                        {cols.has('valor_comissao') && <td className="table-cell text-right">{l.valor_comissao != null ? formatarMoeda(l.valor_comissao) : '—'}</td>}
                        {cols.has('nf_numero') && <td className="table-cell text-center">{l.nf_numero || '—'}</td>}
                        {cols.has('nf_data') && <td className="table-cell text-center">{fmtData(l.nf_data)}</td>}
                        {cols.has('nf_valor') && <td className="table-cell text-right">{l.nf_valor != null ? formatarMoeda(l.nf_valor) : '—'}</td>}
                        {cols.has('diferenca') && <td className={`table-cell text-right ${l.diferenca != null && Math.abs(l.diferenca) >= 0.01 ? 'text-amber-700' : 'text-gray-400'}`}>{l.diferenca != null ? formatarMoeda(l.diferenca) : '—'}</td>}
                        {cols.has('situacao') && <td className="table-cell"><span className={`px-2 py-0.5 rounded-full text-[11px] ${SIT_COR[l.situacao]}`}>{SITUACAO_LABEL[l.situacao]}</span></td>}
                        {cols.has('confianca') && <td className="table-cell text-center">{l.confianca ? <span title={l.sugestaoJustificativa ?? ''} className={`font-semibold ${l.confiancaLabel === 'alta' ? 'text-green-700' : 'text-cyan-700'}`}>{l.confianca}%</span> : '—'}</td>}
                        {cols.has('acoes') && <td className="table-cell text-right whitespace-nowrap">
                          {l.tipo === 'comissao' ? (l.nota_id
                            ? <button onClick={() => desfazer(l)} className="text-red-500 hover:text-red-700 mr-2">Desfazer</button>
                            : <>
                                {l.sugestaoNotaId && <button onClick={() => confirmarSugestao(l)} className="text-teal-600 hover:text-teal-800 mr-2" title={l.sugestaoJustificativa ?? ''}>Confirmar {l.confianca}%</button>}
                                {l.situacao === 'falta_cnpj' && <button onClick={() => { const d = window.prompt('Informe o CPF/CNPJ (dígitos):') ?? ''; if (d) salvarCnpjRapido(l, d) }} className="text-orange-600 hover:text-orange-800 mr-2">Informar CNPJ</button>}
                                <button onClick={() => abrirVincular(l)} className="text-blue-600 hover:text-blue-800 mr-2">Vincular</button>
                              </>)
                            : <button onClick={() => excluir(l)} className="text-red-500 hover:text-red-700 mr-2">Excluir</button>}
                          <button onClick={() => abrirEditar(l)} className="text-gray-500 hover:text-gray-800">Editar</button>
                        </td>}
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
          {/* Paginação */}
          <div className="flex items-center justify-between mt-3 text-sm">
            <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={pagina <= 1} className="px-3 py-1 border border-gray-200 rounded disabled:opacity-40">← Anterior</button>
            <span className="text-gray-500">Página {pagina} de {totalPag}</span>
            <button onClick={() => setPagina(p => Math.min(totalPag, p + 1))} disabled={pagina >= totalPag} className="px-3 py-1 border border-gray-200 rounded disabled:opacity-40">Próxima →</button>
          </div>
        </div>

        {/* Modais */}
        {modal?.tipo === 'vincular' && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) setModal(null) }}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 max-h-[85vh] overflow-auto">
              <h2 className="text-lg font-bold text-gray-800 mb-1">Vincular nota</h2>
              <p className="text-xs text-gray-500 mb-4">{modal.item.nome} · {fmtDoc(modal.item.documento)} · esperado {formatarMoeda(modal.item.valor_comissao ?? 0)}</p>
              {candNotas.length === 0 ? <p className="text-sm text-gray-400">Nenhuma nota livre deste CNPJ.</p> : (
                <div className="space-y-1">{candNotas.map(n => {
                  const mesmaComp = (n.competencia_conf || n.competencia || '') === modal.item.mes_ref
                  return (
                    <button key={n.id} onClick={() => vincular(modal.item.id, n)} className={`w-full text-left px-3 py-2 rounded-lg border text-sm hover:bg-blue-50 ${mesmaComp ? 'border-green-300 bg-green-50' : 'border-gray-200'}`}>
                      <div className="flex justify-between"><span className="font-medium">{n.emitente_nome || '—'}</span><span>{formatarMoeda(n.valor || 0)}</span></div>
                      <div className="text-xs text-gray-500">NF {n.numero || '—'} · emissão {fmtData(n.data_emissao)} · comp. {n.competencia_conf || n.competencia || '—'} {mesmaComp ? '· mesma competência' : ''} {n.empresaNome ? `· ${n.empresaNome}` : ''}</div>
                    </button>
                  )
                })}</div>
              )}
              <button className="btn-secondary w-full mt-4" onClick={() => setModal(null)}>Fechar</button>
            </div>
          </div>
        )}

        {(modal?.tipo === 'editarCom' || modal?.tipo === 'editarNota') && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) setModal(null) }}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 max-h-[85vh] overflow-auto space-y-3">
              <h2 className="text-lg font-bold text-gray-800">{modal.tipo === 'editarCom' ? 'Editar registro (planilha)' : 'Editar nota'}</h2>
              {modal.tipo === 'editarCom' ? <>
                <Campo label="Profissional" v={form.nome} set={v => setForm(f => ({ ...f, nome: v }))} />
                <Campo label="CPF/CNPJ" v={form.documento} set={v => setForm(f => ({ ...f, documento: v }))} />
                <Campo label="Valor esperado" v={form.valor_comissao} set={v => setForm(f => ({ ...f, valor_comissao: v }))} tipo="number" />
                <div><label className="label-field">Empresa</label><select className="input-field" value={form.empresa_id} onChange={e => setForm(f => ({ ...f, empresa_id: e.target.value }))}>{empresas.map(e => <option key={e.id} value={e.id}>{e.apelido || e.razao_social}</option>)}</select></div>
                <Campo label="Competência (YYYY-MM)" v={form.mes_ref} set={v => setForm(f => ({ ...f, mes_ref: v }))} />
                <Campo label="Observação" v={form.observacao} set={v => setForm(f => ({ ...f, observacao: v }))} />
              </> : <>
                <Campo label="Emitente" v={form.emitente_nome} set={v => setForm(f => ({ ...f, emitente_nome: v }))} />
                <Campo label="CPF/CNPJ" v={form.documento} set={v => setForm(f => ({ ...f, documento: v }))} />
                <Campo label="Número" v={form.numero} set={v => setForm(f => ({ ...f, numero: v }))} />
                <Campo label="Emissão" v={form.data_emissao} set={v => setForm(f => ({ ...f, data_emissao: v }))} tipo="date" />
                <Campo label="Competência (YYYY-MM)" v={form.competencia} set={v => setForm(f => ({ ...f, competencia: v }))} />
                <Campo label="Valor" v={form.valor} set={v => setForm(f => ({ ...f, valor: v }))} tipo="number" />
                <Campo label="Observação" v={form.observacao} set={v => setForm(f => ({ ...f, observacao: v }))} />
              </>}
              <div className="flex gap-2 pt-2"><button className="btn-primary flex-1" onClick={salvarEdicao}>Salvar</button><button className="btn-secondary" onClick={() => setModal(null)}>Cancelar</button></div>
            </div>
          </div>
        )}
      </div>
    </LayoutAdmin>
  )
}

function Campo({ label, v, set, tipo = 'text' }: { label: string; v: string; set: (v: string) => void; tipo?: string }) {
  return <div><label className="label-field">{label}</label><input type={tipo} className="input-field" value={v ?? ''} onChange={e => set(e.target.value)} /></div>
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase, Empresa } from '../../../lib/supabase'
import { formatarMoeda, MESES } from '../../../utils/calculoVT'
import { SALAO_ENABLED } from '../../../lib/salao/config'
import { listarNotas, conferirNota, resumoNotas, type NotaRecebida } from '../../../lib/salao/notas'

function hoje() { return new Date().toISOString().slice(0, 10) }
function umAnoAtras() { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10) }
function fmtData(iso: string | null) { if (!iso) return '—'; const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}` }
function fmtComp(c: string | null) { if (!c) return '—'; const [a, m] = c.split('-').map(Number); return m ? `${MESES[m - 1]}/${a}` : c }
function fmtDoc(d: string | null) {
  const s = (d ?? '').replace(/\D/g, '')
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  return s || '—'
}

export default function SalaoConferenciaPage() {
  const router = useRouter()
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [usuario, setUsuario] = useState<string | undefined>()

  // Filtros
  const [empresaId, setEmpresaId] = useState('')
  const [profissional, setProfissional] = useState('')
  const [de, setDe] = useState(umAnoAtras())
  const [ate, setAte] = useState(hoje())
  const [competencia, setCompetencia] = useState('')
  const [status, setStatus] = useState<'' | 'pendente' | 'conferida'>('')
  const [busca, setBusca] = useState('')

  const [linhas, setLinhas] = useState<NotaRecebida[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState(''); const [msgTipo, setMsgTipo] = useState<'ok' | 'erro'>('ok')

  // Modal de conferência
  const [alvo, setAlvo] = useState<NotaRecebida | null>(null)
  const [cComp, setCComp] = useState(''); const [cObs, setCObs] = useState(''); const [cConf, setCConf] = useState(false)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!SALAO_ENABLED) { router.replace('/dashboard'); return }
    supabase.from('empresas').select('*').order('razao_social').then(({ data }) => setEmpresas(data ?? []))
    supabase.auth.getUser().then(({ data }) => setUsuario(data.user?.email ?? undefined))
  }, [router])

  const carregar = useCallback(async () => {
    setLoading(true)
    setLinhas(await listarNotas({
      empresaId: empresaId || undefined, profissional: profissional || undefined,
      de: de || undefined, ate: ate || undefined, competencia: competencia || undefined,
      status: status || undefined, busca: busca || undefined,
    }))
    setLoading(false)
  }, [empresaId, profissional, de, ate, competencia, status, busca])
  useEffect(() => { if (SALAO_ENABLED) carregar() }, [carregar])

  function notify(t: string, tipo: 'ok' | 'erro') { setMsg(t); setMsgTipo(tipo); setTimeout(() => setMsg(''), 6000) }
  const resumo = useMemo(() => resumoNotas(linhas), [linhas])

  function abrir(n: NotaRecebida) {
    setAlvo(n)
    setCComp(n.competencia_conf || n.competencia || '')
    setCObs(n.observacao || '')
    setCConf(n.conferida)
  }
  async function salvar() {
    if (!alvo) return
    setSalvando(true)
    const res = await conferirNota(alvo.id, { competencia_conf: cComp || null, observacao: cObs, conferida: cConf }, usuario)
    setSalvando(false)
    if (!res.ok) { notify(res.erro ?? 'Erro ao salvar.', 'erro'); return }
    setAlvo(null); notify('Conferência salva.', 'ok'); carregar()
  }
  async function alternarConferida(n: NotaRecebida) {
    const res = await conferirNota(n.id, { conferida: !n.conferida }, usuario)
    if (!res.ok) { notify(res.erro ?? 'Erro.', 'erro'); return }
    carregar()
  }

  if (!SALAO_ENABLED) return null

  return (
    <LayoutAdmin title="Salão — Conferência de Notas">
      <div className="space-y-6">
        {msg && (
          <div className={`px-4 py-3 rounded-lg text-sm flex justify-between items-center ${msgTipo === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            <span>{msg}</span>
            <button onClick={() => setMsg('')} className="font-bold text-lg leading-none ml-4 opacity-60 hover:opacity-100">×</button>
          </div>
        )}

        {/* Resumo */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="card"><p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Notas</p><p className="text-2xl font-bold text-gray-800 mt-1">{resumo.total}</p></div>
          <div className="card"><p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Conferidas</p><p className="text-2xl font-bold text-green-700 mt-1">{resumo.conferidas}</p></div>
          <div className="card"><p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Pendentes</p><p className="text-2xl font-bold text-amber-600 mt-1">{resumo.pendentes}</p></div>
          <div className="card"><p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Comp. divergente</p><p className="text-2xl font-bold text-red-600 mt-1">{resumo.divergentes}</p></div>
          <div className="card"><p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Valor total</p><p className="text-xl font-bold text-gray-800 mt-1">{formatarMoeda(resumo.valor)}</p></div>
        </div>

        {/* Filtros */}
        <div className="card">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <div>
              <label className="label-field">Unidade (empresa)</label>
              <select className="input-field" value={empresaId} onChange={e => setEmpresaId(e.target.value)}>
                <option value="">Todas</option>
                {empresas.map(e => <option key={e.id} value={e.id}>{e.apelido || e.razao_social}</option>)}
              </select>
            </div>
            <div className="lg:col-span-2"><label className="label-field">Profissional (nome ou CPF/CNPJ)</label><input className="input-field" value={profissional} onChange={e => setProfissional(e.target.value)} placeholder="Ex.: Maria, ou 12345678900" /></div>
            <div>
              <label className="label-field">Status</label>
              <select className="input-field" value={status} onChange={e => setStatus(e.target.value as '' | 'pendente' | 'conferida')}>
                <option value="">Todas</option>
                <option value="pendente">Pendentes de conferência</option>
                <option value="conferida">Conferidas</option>
              </select>
            </div>
            <div><label className="label-field">Emissão — de</label><input type="date" className="input-field" value={de} onChange={e => setDe(e.target.value)} /></div>
            <div><label className="label-field">Emissão — até</label><input type="date" className="input-field" value={ate} onChange={e => setAte(e.target.value)} /></div>
            <div><label className="label-field">Competência</label><input type="month" className="input-field" value={competencia} onChange={e => setCompetencia(e.target.value)} /></div>
            <div><label className="label-field">Buscar (nº)</label><input className="input-field" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Nome, doc ou nº" /></div>
          </div>
          <p className="text-xs text-gray-400 mt-2">O período por data de emissão aceita intervalos longos (ex.: um ano). Deixe a competência em branco para não filtrar por ela.</p>
        </div>

        {/* Tabela */}
        <div className="card">
          {loading ? (
            <div className="text-center py-12 text-gray-400 text-sm">Carregando...</div>
          ) : linhas.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">Nenhuma nota para os filtros.<br /><span className="text-xs">Baixe as notas em Salão → Notas Recebidas.</span></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="table-header">Unidade</th>
                    <th className="table-header">Profissional</th>
                    <th className="table-header text-center">Nº</th>
                    <th className="table-header text-center">Emissão</th>
                    <th className="table-header text-center">Competência</th>
                    <th className="table-header text-right">Valor</th>
                    <th className="table-header">Obs.</th>
                    <th className="table-header text-center">Conferida</th>
                    <th className="table-header text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {linhas.map(l => {
                    const divergente = !!(l.competenciaEfetiva && l.data_emissao && l.data_emissao.slice(0, 7) !== l.competenciaEfetiva)
                    return (
                      <tr key={l.id} className="hover:bg-gray-50">
                        <td className="table-cell text-xs text-gray-500">{l.empresaNome}</td>
                        <td className="table-cell">
                          <div className="font-medium text-gray-900">{l.emitente_nome || '—'}</div>
                          <div className="text-xs text-gray-400">{fmtDoc(l.documento)}</div>
                        </td>
                        <td className="table-cell text-center text-xs">{l.numero || '—'}</td>
                        <td className="table-cell text-center text-xs">{fmtData(l.data_emissao)}</td>
                        <td className="table-cell text-center text-xs">
                          <span className={divergente ? 'text-red-600 font-semibold' : ''}>{fmtComp(l.competenciaEfetiva ?? null)}</span>
                          {l.competencia_conf && <span className="block text-[10px] text-blue-500">ajustada</span>}
                        </td>
                        <td className="table-cell text-right">{formatarMoeda(l.valor || 0)}</td>
                        <td className="table-cell text-xs text-gray-500 max-w-[160px] truncate" title={l.observacao || ''}>{l.observacao || ''}</td>
                        <td className="table-cell text-center">
                          <input type="checkbox" className="w-4 h-4" checked={l.conferida} onChange={() => alternarConferida(l)} />
                        </td>
                        <td className="table-cell text-right">
                          <button onClick={() => abrir(l)} className="text-blue-600 hover:text-blue-800 text-xs font-medium">Conferir</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal conferência */}
        {alvo && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) setAlvo(null) }}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
              <h2 className="text-lg font-bold text-gray-800 mb-1">Conferir nota</h2>
              <p className="text-xs text-gray-500 mb-4">{alvo.emitente_nome} · NF {alvo.numero || '—'} · {formatarMoeda(alvo.valor || 0)} · emissão {fmtData(alvo.data_emissao)}</p>
              <div className="space-y-4">
                <div>
                  <label className="label-field">Competência</label>
                  <input type="month" className="input-field" value={cComp} onChange={e => setCComp(e.target.value)} />
                  <p className="text-xs text-gray-400 mt-1">Original (XML): {fmtComp(alvo.competencia)}. Ajuste aqui se a emissão não bate com a competência correta.</p>
                </div>
                <div><label className="label-field">Observação</label><textarea className="input-field h-24" value={cObs} onChange={e => setCObs(e.target.value)} placeholder="Anotação da análise (opcional)" /></div>
                <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" className="w-4 h-4" checked={cConf} onChange={e => setCConf(e.target.checked)} /> Marcar como conferida</label>
              </div>
              <div className="flex gap-3 pt-5">
                <button className="btn-primary flex-1" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar'}</button>
                <button className="btn-secondary flex-1" onClick={() => setAlvo(null)}>Cancelar</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </LayoutAdmin>
  )
}

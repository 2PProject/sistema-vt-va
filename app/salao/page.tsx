'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import LayoutAdmin from '../../components/LayoutAdmin'
import { supabase, Empresa } from '../../lib/supabase'
import { formatarMoeda, MESES } from '../../utils/calculoVT'
import { SALAO_ENABLED, STATUS_LABEL, STATUS_CLASSE, type StatusComissao } from '../../lib/salao/config'
import { listarComissoes, resumoDoMes, confirmarNFManual, substituirNF } from '../../lib/salao/comissoes'
import { sincronizarNFSe } from '../../lib/salao/certificados'
import type { Comissao } from '../../lib/salao/tipos'

function competenciaAtual() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function fmtMes(m: string) { const [a, mm] = m.split('-').map(Number); return mm ? `${MESES[mm - 1]}/${a}` : m }
function fmtData(iso: string | null) { if (!iso) return ''; const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}` }

export default function SalaoPainelPage() {
  const router = useRouter()
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresaFiltro, setEmpresaFiltro] = useState('')
  const [mes, setMes] = useState(competenciaAtual())
  const [statusFiltro, setStatusFiltro] = useState<StatusComissao | ''>('')
  const [linhas, setLinhas] = useState<Comissao[]>([])
  const [loading, setLoading] = useState(false)
  const [sincronizando, setSincronizando] = useState(false)
  const [usuario, setUsuario] = useState<string | undefined>()

  const [msg, setMsg] = useState('')
  const [msgTipo, setMsgTipo] = useState<'ok' | 'erro'>('ok')

  // Modal confirmar/substituir NF
  const [modal, setModal] = useState<{ c: Comissao; substituir: boolean } | null>(null)
  const [nfNumero, setNfNumero] = useState('')
  const [nfData, setNfData] = useState('')
  const [nfValor, setNfValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!SALAO_ENABLED) { router.replace('/dashboard'); return }
    supabase.from('empresas').select('*').order('razao_social').then(({ data }) => setEmpresas(data ?? []))
    supabase.auth.getUser().then(({ data }) => setUsuario(data.user?.email ?? undefined))
  }, [router])

  const carregar = useCallback(async () => {
    setLoading(true)
    const data = await listarComissoes({ empresaId: empresaFiltro || undefined, mes, status: statusFiltro || undefined })
    setLinhas(data)
    setLoading(false)
  }, [empresaFiltro, mes, statusFiltro])

  useEffect(() => { if (SALAO_ENABLED) carregar() }, [carregar])

  function notify(t: string, tipo: 'ok' | 'erro') { setMsg(t); setMsgTipo(tipo); setTimeout(() => setMsg(''), 7000) }

  const resumo = useMemo(() => resumoDoMes(linhas), [linhas])

  async function sincronizar() {
    setSincronizando(true)
    const r = await sincronizarNFSe(empresaFiltro || undefined)
    setSincronizando(false)
    if (r.erro) { notify(r.erro, 'erro'); return }
    notify(`${r.notasEncontradas} nota(s) encontrada(s), ${r.registrosAtualizados} registro(s) atualizado(s).`, 'ok')
    carregar()
  }

  function abrirModal(c: Comissao, substituir: boolean) {
    setModal({ c, substituir })
    setNfNumero(c.nf_numero ?? ''); setNfData(c.nf_data ?? ''); setNfValor(c.nf_valor ? String(c.nf_valor) : String(c.valor_comissao || '')); setMotivo('')
  }

  async function salvarNF() {
    if (!modal) return
    const nf = { numero: nfNumero, data: nfData, valor: parseFloat(nfValor.replace(',', '.')) || 0 }
    setSalvando(true)
    const res = modal.substituir
      ? await substituirNF(modal.c.id, nf, motivo, usuario)
      : await confirmarNFManual(modal.c.id, nf, usuario)
    setSalvando(false)
    if (!res.ok) { notify(res.erro ?? 'Erro ao salvar.', 'erro'); return }
    setModal(null); notify(modal.substituir ? 'NF substituída.' : 'NF confirmada.', 'ok'); carregar()
  }

  if (!SALAO_ENABLED) return null

  return (
    <LayoutAdmin
      title="Salão — Controle de NFS-e"
      actions={
        <button onClick={sincronizar} disabled={sincronizando}
          className="bg-emerald-600 text-white font-medium py-2 px-4 rounded-lg hover:bg-emerald-700 disabled:opacity-60 flex items-center gap-2">
          <svg className={`w-4 h-4 ${sincronizando ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          {sincronizando ? 'Sincronizando...' : 'Sincronizar NFS-e'}
        </button>
      }
    >
      <div className="space-y-6">
        {msg && (
          <div className={`px-4 py-3 rounded-lg text-sm flex justify-between items-center ${msgTipo === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            <span>{msg}</span>
            <button onClick={() => setMsg('')} className="font-bold text-lg leading-none ml-4 opacity-60 hover:opacity-100">×</button>
          </div>
        )}

        {/* Cards de resumo */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Profissionais</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{resumo.totalProfissionais}</p>
          </div>
          <div className="card">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">NFs recebidas</p>
            <p className="text-2xl font-bold text-green-700 mt-1">{resumo.recebidas} <span className="text-sm font-medium text-gray-400">({resumo.percentualRecebidas}%)</span></p>
          </div>
          <div className="card">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Pendentes</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{resumo.pendentes}</p>
            <p className="text-xs text-gray-400">{formatarMoeda(resumo.valorPendente)} em aberto</p>
          </div>
          <div className="card">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Fora do prazo</p>
            <p className="text-2xl font-bold text-red-600 mt-1">{resumo.foraPrazo}</p>
          </div>
        </div>

        {/* Filtros */}
        <div className="card">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <label className="label-field">Empresa</label>
              <select className="input-field" value={empresaFiltro} onChange={e => setEmpresaFiltro(e.target.value)}>
                <option value="">Todas as empresas</option>
                {empresas.map(e => <option key={e.id} value={e.id}>{e.apelido || e.razao_social}</option>)}
              </select>
            </div>
            <div>
              <label className="label-field">Mês de referência</label>
              <input type="month" className="input-field" value={mes} onChange={e => setMes(e.target.value)} />
            </div>
            <div>
              <label className="label-field">Status</label>
              <select className="input-field" value={statusFiltro} onChange={e => setStatusFiltro(e.target.value as StatusComissao | '')}>
                <option value="">Todos</option>
                <option value="recebida">NF recebida</option>
                <option value="pendente">Pendente</option>
                <option value="fora_prazo">Fora do prazo</option>
              </select>
            </div>
          </div>
        </div>

        {/* Tabela */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800">{fmtMes(mes)} — {linhas.length} registro(s)</h2>
          </div>
          {loading ? (
            <div className="text-center py-12 text-gray-400 text-sm">Carregando...</div>
          ) : linhas.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">Nenhuma comissão para {fmtMes(mes)}.<br /><span className="text-xs">Importe a planilha do mês em Salão → Importar.</span></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="table-header">Empresa</th>
                    <th className="table-header">Profissional</th>
                    <th className="table-header text-right">Comissão</th>
                    <th className="table-header text-center">Status</th>
                    <th className="table-header">NF Nº</th>
                    <th className="table-header text-center">Data NF</th>
                    <th className="table-header text-right">Valor NF</th>
                    <th className="table-header text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {linhas.map(l => (
                    <tr key={l.id} className="hover:bg-gray-50">
                      <td className="table-cell text-xs text-gray-500">{l.empresaNome}</td>
                      <td className="table-cell">
                        <div className="font-medium text-gray-900">{l.profissionalNome}</div>
                        <div className="text-xs text-gray-400">{l.profissionalDoc}</div>
                      </td>
                      <td className="table-cell text-right">{formatarMoeda(l.valor_comissao)}</td>
                      <td className="table-cell text-center">
                        <span className={`text-xs font-semibold px-2 py-1 rounded ${STATUS_CLASSE[l.status]}`}>{STATUS_LABEL[l.status]}</span>
                      </td>
                      <td className="table-cell text-xs">{l.nf_numero ?? <span className="text-gray-300">—</span>}</td>
                      <td className="table-cell text-center text-xs">{l.nf_data ? fmtData(l.nf_data) : <span className="text-gray-300">—</span>}</td>
                      <td className="table-cell text-right text-xs">{l.nf_valor ? formatarMoeda(l.nf_valor) : <span className="text-gray-300">—</span>}</td>
                      <td className="table-cell text-right">
                        {l.status === 'recebida'
                          ? <button onClick={() => abrirModal(l, true)} className="text-blue-600 hover:text-blue-800 text-xs font-medium">Substituir</button>
                          : <button onClick={() => abrirModal(l, false)} className="text-emerald-700 hover:text-emerald-900 text-xs font-medium">Confirmar NF</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal confirmar/substituir NF */}
        {modal && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) setModal(null) }}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
              <h2 className="text-lg font-bold text-gray-800 mb-1">{modal.substituir ? 'Substituir NF' : 'Confirmar NF manualmente'}</h2>
              <p className="text-xs text-gray-500 mb-4">{modal.c.profissionalNome} · {fmtMes(modal.c.mes_ref)}</p>
              <div className="space-y-3">
                <div><label className="label-field">Número da NF</label><input className="input-field" value={nfNumero} onChange={e => setNfNumero(e.target.value)} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label-field">Data de emissão</label><input type="date" className="input-field" value={nfData} onChange={e => setNfData(e.target.value)} /></div>
                  <div><label className="label-field">Valor (R$)</label><input className="input-field text-right" value={nfValor} onChange={e => setNfValor(e.target.value)} /></div>
                </div>
                {modal.substituir && (
                  <div><label className="label-field">Motivo da substituição</label><input className="input-field" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Obrigatório" /></div>
                )}
              </div>
              <div className="flex gap-3 pt-5">
                <button className="btn-primary flex-1" onClick={salvarNF} disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar'}</button>
                <button className="btn-secondary flex-1" onClick={() => setModal(null)}>Cancelar</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </LayoutAdmin>
  )
}

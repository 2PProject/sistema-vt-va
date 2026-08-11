'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase, Empresa } from '../../../lib/supabase'
import { formatarMoeda } from '../../../utils/calculoVT'
import { SALAO_ENABLED } from '../../../lib/salao/config'
import { sincronizarNFSe, rotuloAmbiente } from '../../../lib/salao/certificados'
import { listarNotas, type NotaRecebida } from '../../../lib/salao/notas'

function primeiroDiaMes() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }
function hoje() { return new Date().toISOString().slice(0, 10) }
function fmtData(iso: string | null) { if (!iso) return ''; const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}` }
function fmtDoc(d: string | null) {
  const s = (d ?? '').replace(/\D/g, '')
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  return s
}

export default function SalaoNotasPage() {
  const router = useRouter()
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresaId, setEmpresaId] = useState('')
  const [de, setDe] = useState(primeiroDiaMes())
  const [ate, setAte] = useState(hoje())
  const [busca, setBusca] = useState('')
  const [linhas, setLinhas] = useState<NotaRecebida[]>([])
  const [loading, setLoading] = useState(false)
  const [sincronizando, setSincronizando] = useState(false)
  const [msg, setMsg] = useState(''); const [msgTipo, setMsgTipo] = useState<'ok' | 'erro'>('ok')

  useEffect(() => {
    if (!SALAO_ENABLED) { router.replace('/dashboard'); return }
    supabase.from('empresas').select('*').order('razao_social').then(({ data }) => setEmpresas(data ?? []))
  }, [router])

  const carregar = useCallback(async () => {
    setLoading(true)
    setLinhas(await listarNotas({ empresaId: empresaId || undefined, de, ate }))
    setLoading(false)
  }, [empresaId, de, ate])
  useEffect(() => { if (SALAO_ENABLED) carregar() }, [carregar])

  function notify(t: string, tipo: 'ok' | 'erro') { setMsg(t); setMsgTipo(tipo); setTimeout(() => setMsg(''), 8000) }

  async function sincronizar() {
    setSincronizando(true)
    const r = await sincronizarNFSe(empresaId || undefined)
    setSincronizando(false)
    if (r.erro) { notify(r.erro, 'erro'); return }
    const amb = rotuloAmbiente(r.ambiente)
    const avisos = (r.empresas ?? []).filter(e => e.erro).map(e => e.erro as string)
    if (avisos.length) { notify(`Avisos: ${avisos.join(' · ')}`, 'erro'); carregar(); return }
    const dica = r.notasEncontradas === 0 && amb === 'ambiente de teste' ? ' — o ambiente de teste não traz suas notas reais; troque para produção.' : ''
    notify(`${r.notasEncontradas} nota(s) trazida(s) do gov.br${amb ? ` · ${amb}` : ''}.${dica}`, 'ok')
    carregar()
  }

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return linhas
    return linhas.filter(l => (l.emitente_nome ?? '').toLowerCase().includes(q) || (l.documento ?? '').includes(q.replace(/\D/g, '')) || (l.numero ?? '').includes(q))
  }, [linhas, busca])
  const total = useMemo(() => filtradas.reduce((s, l) => s + (l.valor || 0), 0), [filtradas])

  if (!SALAO_ENABLED) return null

  return (
    <LayoutAdmin
      title="Salão — Notas Recebidas"
      actions={
        <button onClick={sincronizar} disabled={sincronizando}
          className="bg-emerald-600 text-white font-medium py-2 px-4 rounded-lg hover:bg-emerald-700 disabled:opacity-60 flex items-center gap-2">
          <svg className={`w-4 h-4 ${sincronizando ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          {sincronizando ? 'Buscando...' : 'Buscar notas no gov.br'}
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

        <div className="card">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="label-field">Empresa</label>
              <select className="input-field" value={empresaId} onChange={e => setEmpresaId(e.target.value)}>
                <option value="">Todas as empresas</option>
                {empresas.map(e => <option key={e.id} value={e.id}>{e.apelido || e.razao_social}</option>)}
              </select>
            </div>
            <div><label className="label-field">De (emissão)</label><input type="date" className="input-field" value={de} onChange={e => setDe(e.target.value)} /></div>
            <div><label className="label-field">Até</label><input type="date" className="input-field" value={ate} onChange={e => setAte(e.target.value)} /></div>
            <div><label className="label-field">Buscar</label><input className="input-field" placeholder="Emitente, CPF/CNPJ ou nº" value={busca} onChange={e => setBusca(e.target.value)} /></div>
          </div>
          <p className="text-xs text-gray-400 mt-2">As notas são trazidas do gov.br pela sincronização e ficam guardadas aqui. O filtro é pela data de emissão.</p>
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800">{filtradas.length} nota(s)</h2>
            <span className="text-sm font-semibold text-gray-700">Total: {formatarMoeda(total)}</span>
          </div>
          {loading ? (
            <div className="text-center py-12 text-gray-400 text-sm">Carregando...</div>
          ) : filtradas.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">Nenhuma nota no período.<br /><span className="text-xs">Clique em &quot;Buscar notas no gov.br&quot; para sincronizar.</span></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="table-header">Empresa</th>
                    <th className="table-header">Emitida por</th>
                    <th className="table-header">CPF/CNPJ</th>
                    <th className="table-header text-center">Nº</th>
                    <th className="table-header text-center">Competência</th>
                    <th className="table-header text-center">Emissão</th>
                    <th className="table-header text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtradas.map(l => (
                    <tr key={l.id} className="hover:bg-gray-50">
                      <td className="table-cell text-xs text-gray-500">{l.empresaNome}</td>
                      <td className="table-cell font-medium text-gray-900">{l.emitente_nome || '—'}</td>
                      <td className="table-cell text-gray-600">{fmtDoc(l.documento)}</td>
                      <td className="table-cell text-center text-xs">{l.numero || '—'}</td>
                      <td className="table-cell text-center text-xs">{l.competencia || '—'}</td>
                      <td className="table-cell text-center text-xs">{fmtData(l.data_emissao)}</td>
                      <td className="table-cell text-right">{formatarMoeda(l.valor || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </LayoutAdmin>
  )
}

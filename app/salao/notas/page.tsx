'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase, Empresa } from '../../../lib/supabase'
import { formatarMoeda } from '../../../utils/calculoVT'
import { SALAO_ENABLED } from '../../../lib/salao/config'
import { sincronizarNFSe, rotuloAmbiente, type DiagEmpresaSync } from '../../../lib/salao/certificados'
import { listarNotas, type NotaRecebida } from '../../../lib/salao/notas'

function primeiroDiaMes() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }
function hoje() { return new Date().toISOString().slice(0, 10) }
function fmtData(iso: string | null) { if (!iso) return ''; const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}` }
function fmtDoc(d: string | null) {
  const s = (d ?? '').replace(/\D/g, '')
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  return s || '—'
}

export default function SalaoNotasPage() {
  const router = useRouter()
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresaId, setEmpresaId] = useState('')          // '' = todas
  const [de, setDe] = useState(primeiroDiaMes())
  const [ate, setAte] = useState(hoje())
  const [busca, setBusca] = useState('')
  const [linhas, setLinhas] = useState<NotaRecebida[]>([])
  const [loading, setLoading] = useState(false)

  const [sincronizando, setSincronizando] = useState(false)
  const [diag, setDiag] = useState<{ ambiente?: string; empresas: DiagEmpresaSync[] } | null>(null)
  const [erroGeral, setErroGeral] = useState('')
  const [aviso, setAviso] = useState('')

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

  async function sincronizar(reset = false) {
    setSincronizando(true); setErroGeral(''); setAviso(''); setDiag(null)
    const r = await sincronizarNFSe(empresaId || undefined, reset)
    setSincronizando(false)
    if (r.erro) { setErroGeral(r.erro); return }
    setDiag({ ambiente: r.ambiente, empresas: r.empresas ?? [] })
    const totalGrav = (r.empresas ?? []).reduce((s, e) => s + (e.gravadas || 0), 0)
    const amb = rotuloAmbiente(r.ambiente)
    if (totalGrav === 0 && amb === 'ambiente de teste') {
      setAviso('Você está no AMBIENTE DE TESTE (produção restrita), que não tem suas notas reais. Defina SALON_ADN_AMBIENTE=producao no Vercel e faça Redeploy.')
    }
    carregar()
  }

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return linhas
    return linhas.filter(l => (l.emitente_nome ?? '').toLowerCase().includes(q) || (l.documento ?? '').includes(q.replace(/\D/g, '')) || (l.numero ?? '').includes(q))
  }, [linhas, busca])
  const total = useMemo(() => filtradas.reduce((s, l) => s + (l.valor || 0), 0), [filtradas])

  if (!SALAO_ENABLED) return null
  const alvoNome = empresaId ? (empresas.find(e => e.id === empresaId)?.apelido || empresas.find(e => e.id === empresaId)?.razao_social || '') : 'todas as empresas'

  return (
    <LayoutAdmin title="Salão — Notas Recebidas">
      <div className="space-y-6">
        {/* 1) Sincronização (por empresa ou todas) */}
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Buscar notas no gov.br</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[240px]">
              <label className="label-field">Empresa</label>
              <select className="input-field" value={empresaId} onChange={e => setEmpresaId(e.target.value)}>
                <option value="">Todas as empresas</option>
                {empresas.map(e => <option key={e.id} value={e.id}>{e.apelido || e.razao_social}</option>)}
              </select>
            </div>
            <button onClick={() => sincronizar(false)} disabled={sincronizando}
              className="bg-emerald-600 text-white font-medium py-2 px-4 rounded-lg hover:bg-emerald-700 disabled:opacity-60 flex items-center gap-2">
              <svg className={`w-4 h-4 ${sincronizando ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              {sincronizando ? 'Buscando...' : `Sincronizar (${empresaId ? '1 empresa' : 'todas'})`}
            </button>
            <button onClick={() => sincronizar(true)} disabled={sincronizando} title="Zera o NSU e rebusca tudo do zero" className="btn-secondary text-sm">
              Rebuscar tudo
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">Busca as NFS-e recebidas de <strong>{alvoNome}</strong> e grava aqui. A consulta é incremental (só o que é novo); use &quot;Rebuscar tudo&quot; para puxar desde o início.</p>
        </div>

        {/* Erro geral */}
        {erroGeral && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
            <strong>Não foi possível sincronizar:</strong> {erroGeral}
          </div>
        )}
        {aviso && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3">{aviso}</div>
        )}

        {/* 2) Resultado da sincronização (por empresa, com motivo/diagnóstico) */}
        {diag && (
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              Resultado {diag.ambiente ? <span className="font-normal text-gray-400">· {rotuloAmbiente(diag.ambiente)} ({diag.ambiente})</span> : null}
            </h2>
            <div className="space-y-2">
              {diag.empresas.map(e => (
                <div key={e.empresa_id} className={`rounded-lg border px-3 py-2 text-sm ${e.ok ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-800">{e.ok ? '✅' : '❌'} {e.empresaNome}</span>
                    <span className="text-xs text-gray-500">HTTP {e.status || '—'}</span>
                  </div>
                  {e.ok
                    ? <div className="text-xs text-green-700 mt-0.5">{e.encontradas} encontrada(s) · {e.gravadas} gravada(s){typeof e.ultimoNsu === 'number' ? ` · NSU ${e.ultimoNsu}` : ''}</div>
                    : <div className="text-xs text-red-700 mt-0.5">{e.erro}</div>}
                  {e.amostra && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-gray-500 text-xs">ver resposta do gov.br</summary>
                      <pre className="mt-1 whitespace-pre-wrap break-all bg-gray-900 text-gray-100 rounded p-2 max-h-40 overflow-auto text-[11px]">{e.amostra}</pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3) Filtro do período e lista */}
        <div className="card">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div><label className="label-field">De (emissão)</label><input type="date" className="input-field" value={de} onChange={e => setDe(e.target.value)} /></div>
            <div><label className="label-field">Até</label><input type="date" className="input-field" value={ate} onChange={e => setAte(e.target.value)} /></div>
            <div><label className="label-field">Buscar</label><input className="input-field" placeholder="Emitente, CPF/CNPJ ou nº" value={busca} onChange={e => setBusca(e.target.value)} /></div>
          </div>

          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-800">{filtradas.length} nota(s) · {alvoNome}</h2>
            <span className="text-sm font-semibold text-gray-700">Total: {formatarMoeda(total)}</span>
          </div>

          {loading ? (
            <div className="text-center py-12 text-gray-400 text-sm">Carregando...</div>
          ) : filtradas.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">Nenhuma nota guardada neste período.<br /><span className="text-xs">Use &quot;Sincronizar&quot; acima para buscar no gov.br.</span></div>
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

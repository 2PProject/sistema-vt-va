'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase, Empresa } from '../../../lib/supabase'
import { formatarMoeda } from '../../../utils/calculoVT'
import { SALAO_ENABLED } from '../../../lib/salao/config'
import { sincronizarNFSe, rotuloAmbiente, type DiagEmpresaSync } from '../../../lib/salao/certificados'
import { listarNotas, type NotaRecebida } from '../../../lib/salao/notas'
import { MESES } from '../../../utils/calculoVT'

function mesAtual() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
function fmtMesLabel(mes: string) { const [a, m] = mes.split('-').map(Number); return m ? `${MESES[m - 1]}/${a}` : mes }
function fmtData(iso: string | null) { if (!iso) return ''; const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}` }
function iniciais(nome: string | null) {
  return (nome || 'Emitente').trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase()).join('') || '—'
}
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
  const [mes, setMes] = useState(mesAtual())              // mês fechado (1º ao último dia)
  const [busca, setBusca] = useState('')
  const [linhas, setLinhas] = useState<NotaRecebida[]>([])
  const [loading, setLoading] = useState(false)

  const [sincronizando, setSincronizando] = useState(false)
  const [progresso, setProgresso] = useState('')
  const pararRef = useState<{ v: boolean }>(() => ({ v: false }))[0]
  const [diag, setDiag] = useState<{ ambiente?: string; empresas: DiagEmpresaSync[] } | null>(null)
  const [erroGeral, setErroGeral] = useState('')
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    if (!SALAO_ENABLED) { router.replace('/dashboard'); return }
    supabase.from('empresas').select('*').order('razao_social').then(({ data }) => setEmpresas(data ?? []))
  }, [router])

  const carregar = useCallback(async () => {
    setLoading(true)
    setLinhas(await listarNotas({ empresaId: empresaId || undefined, mes }))
    setLoading(false)
  }, [empresaId, mes])
  useEffect(() => { if (SALAO_ENABLED) carregar() }, [carregar])

  // Baixa TODO o histórico automaticamente (a API do gov.br é sequencial por NSU,
  // da nota mais antiga para a mais recente). Faz vários lotes seguidos, mostra
  // o progresso e trata o limite 429 esperando e continuando.
  async function baixarTudo(reset = false) {
    const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms))
    pararRef.v = false
    setSincronizando(true); setErroGeral(''); setAviso(''); setDiag(null); setProgresso('Iniciando...')
    let totalGrav = 0, totalIgn = 0
    const acc: Record<string, DiagEmpresaSync> = {}
    let ambiente: string | undefined
    for (let rodada = 1; rodada <= 120; rodada++) {
      if (pararRef.v) { setProgresso(`Parado. ${totalGrav} recebidas gravadas até aqui.`); break }
      const r = await sincronizarNFSe(empresaId || undefined, reset && rodada === 1)
      if (r.erro) { setErroGeral(r.erro); break }
      ambiente = r.ambiente
      let rate = false, mais = false
      for (const e of (r.empresas ?? [])) {
        totalGrav += e.gravadas || 0; totalIgn += e.ignoradas || 0
        if (e.status === 429) rate = true
        if (e.houveMais) mais = true
        const a = acc[e.empresa_id]
        acc[e.empresa_id] = { ...e, gravadas: (a?.gravadas || 0) + (e.gravadas || 0), ignoradas: (a?.ignoradas || 0) + (e.ignoradas || 0), encontradas: (a?.encontradas || 0) + (e.encontradas || 0) }
      }
      setDiag({ ambiente, empresas: Object.values(acc) })
      await carregar()
      const amb = rotuloAmbiente(ambiente)
      if (totalGrav === 0 && !mais && amb === 'ambiente de teste') {
        setAviso('Você está no AMBIENTE DE TESTE (produção restrita), que não tem suas notas reais. Defina SALON_ADN_AMBIENTE=producao no Vercel e faça Redeploy.')
        break
      }
      if (rate) { setProgresso(`gov.br limitou (429). Aguardando 30s para continuar... (${totalGrav} recebidas até agora)`); await sleep(30000); continue }
      if (!mais) { setProgresso(`Concluído: ${totalGrav} nota(s) recebida(s) gravada(s).`); break }
      setProgresso(`Baixando... ${totalGrav} recebidas gravadas (${totalIgn} próprias ignoradas). Continua...`)
      await sleep(1200)
    }
    setSincronizando(false)
  }

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return linhas
    return linhas.filter(l => (l.emitente_nome ?? '').toLowerCase().includes(q) || (l.documento ?? '').includes(q.replace(/\D/g, '')) || (l.numero ?? '').includes(q))
  }, [linhas, busca])
  const total = useMemo(() => filtradas.reduce((s, l) => s + (l.valor || 0), 0), [filtradas])
  const emitentes = useMemo(() => new Set(filtradas.map(l => l.documento || l.emitente_nome).filter(Boolean)).size, [filtradas])
  const ticketMedio = filtradas.length ? total / filtradas.length : 0

  if (!SALAO_ENABLED) return null
  const alvoNome = empresaId ? (empresas.find(e => e.id === empresaId)?.apelido || empresas.find(e => e.id === empresaId)?.razao_social || '') : 'todas as empresas'

  return (
    <LayoutAdmin title="Salão — Notas Recebidas">
      <div className="space-y-6">
        <section className="overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-900 px-6 py-7 text-white shadow-sm" aria-labelledby="notas-title">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">Módulo de Notas</p>
          <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 id="notas-title" className="text-2xl font-bold">Notas recebidas</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-300">Acompanhe as NFS-e importadas do gov.br, confira emitentes e analise os valores do período.</p>
            </div>
            <span className="w-fit rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-emerald-100 ring-1 ring-white/15">{fmtMesLabel(mes)} · {alvoNome}</span>
          </div>
        </section>

        {/* 1) Baixar notas do gov.br */}
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">1. Baixar notas recebidas do gov.br</h2>
          <p className="text-xs text-gray-500 mb-3">
            O gov.br entrega as notas em ordem (da mais antiga para a mais recente), então é preciso baixar o histórico uma vez.
            Depois é só filtrar pelo mês na seção abaixo. As notas emitidas pela própria empresa são descartadas.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[240px]">
              <label className="label-field">Empresa</label>
              <select className="input-field" value={empresaId} onChange={e => setEmpresaId(e.target.value)} disabled={sincronizando}>
                <option value="">Todas as empresas</option>
                {empresas.map(e => <option key={e.id} value={e.id}>{e.apelido || e.razao_social}</option>)}
              </select>
            </div>
            {!sincronizando ? (
              <>
                <button onClick={() => baixarTudo(false)}
                  className="bg-emerald-600 text-white font-medium py-2 px-4 rounded-lg hover:bg-emerald-700 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                  Baixar notas ({empresaId ? '1 empresa' : 'todas'})
                </button>
                <button onClick={() => baixarTudo(true)} title="Apaga o marcador e baixa desde o início" className="btn-secondary text-sm">
                  Rebaixar do zero
                </button>
              </>
            ) : (
              <button onClick={() => { pararRef.v = true }} className="bg-red-600 text-white font-medium py-2 px-4 rounded-lg hover:bg-red-700">
                Parar
              </button>
            )}
          </div>
          {(sincronizando || progresso) && (
            <div className="mt-3 text-sm text-gray-700 flex items-center gap-2">
              {sincronizando && <svg className="w-4 h-4 animate-spin text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>}
              <span>{progresso}</span>
            </div>
          )}
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
                    ? <div className="text-xs text-green-700 mt-0.5">{e.encontradas} no lote · <strong>{e.gravadas} recebida(s) gravada(s)</strong>{e.ignoradas ? ` · ${e.ignoradas} emitida(s) pela própria empresa (ignoradas)` : ''}{typeof e.ultimoNsu === 'number' ? ` · NSU ${e.ultimoNsu}` : ''}</div>
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

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicadores do período">
          {[
            { label: 'Notas recebidas', value: String(filtradas.length), detail: fmtMesLabel(mes), tone: 'text-blue-700 bg-blue-50' },
            { label: 'Valor total', value: formatarMoeda(total), detail: 'no filtro atual', tone: 'text-emerald-700 bg-emerald-50' },
            { label: 'Emitentes', value: String(emitentes), detail: 'CPF/CNPJ únicos', tone: 'text-violet-700 bg-violet-50' },
            { label: 'Ticket médio', value: formatarMoeda(ticketMedio), detail: 'por nota', tone: 'text-amber-700 bg-amber-50' },
          ].map(item => (
            <div key={item.label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className={`mb-3 inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${item.tone}`}>{item.label}</div>
              <p className="text-xl font-bold tracking-tight text-gray-900">{item.value}</p>
              <p className="mt-1 text-xs text-gray-500">{item.detail}</p>
            </div>
          ))}
        </section>

        {/* 3) Filtro por mês e lista */}
        <div className="card" aria-labelledby="lista-notas-title">
          <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50/70 p-4">
            <div className="mb-3 flex items-center justify-between gap-3"><div><h2 id="lista-notas-title" className="font-semibold text-gray-900">Consultar notas</h2><p className="text-xs text-gray-500">Refine o período e encontre uma nota específica.</p></div>{busca && <button type="button" onClick={() => setBusca('')} className="text-xs font-medium text-emerald-700 hover:text-emerald-800">Limpar busca</button>}</div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div><label htmlFor="filtro-mes" className="label-field">Mês de referência</label><input id="filtro-mes" type="month" className="input-field" value={mes} onChange={e => setMes(e.target.value)} /></div>
              <div><label htmlFor="filtro-busca" className="label-field">Buscar nota</label><input id="filtro-busca" type="search" className="input-field" placeholder="Emitente, CPF/CNPJ ou número" value={busca} onChange={e => setBusca(e.target.value)} autoComplete="off" /></div>
            </div>
          </div>

          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-800">Resultados <span className="font-normal text-gray-500">({filtradas.length})</span></h2>
            <span className="text-sm font-semibold text-gray-700">Total: {formatarMoeda(total)}</span>
          </div>

          {loading ? (
            <div className="text-center py-12 text-gray-400 text-sm" role="status" aria-live="polite">Carregando notas...</div>
          ) : filtradas.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">Nenhuma nota guardada neste período.<br /><span className="text-xs">Use &quot;Sincronizar&quot; acima para buscar no gov.br.</span></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <caption className="sr-only">Notas fiscais recebidas no período selecionado</caption>
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th scope="col" className="table-header">Empresa</th>
                    <th scope="col" className="table-header">Emitida por</th>
                    <th scope="col" className="table-header">CPF/CNPJ</th>
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
                      <td className="table-cell">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700" aria-hidden="true">{iniciais(l.emitente_nome)}</span>
                          <span className="font-medium text-gray-900">{l.emitente_nome || 'Emitente não identificado'}</span>
                        </div>
                      </td>
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

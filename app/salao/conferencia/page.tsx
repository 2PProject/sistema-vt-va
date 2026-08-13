'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase, Empresa } from '../../../lib/supabase'
import { formatarMoeda, MESES } from '../../../utils/calculoVT'
import { SALAO_ENABLED } from '../../../lib/salao/config'
import { listarConferencia, reconciliarCompetencia, limparVinculos, vincularNota, desvincular, corrigirCnpj, notasDoCnpj, type Esperada, type NotaLivre } from '../../../lib/salao/conferencia'

function mesAtual() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
function fmtMes(m: string) { const [a, mm] = m.split('-').map(Number); return mm ? `${MESES[mm - 1]}/${a}` : m }
function fmtData(iso: string | null) { if (!iso) return '—'; const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}` }
function fmtDoc(d: string | null) {
  const s = (d ?? '').replace(/\D/g, '')
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  return s || '—'
}

type Aba = 'pendentes' | 'conferidas' | 'sem_vinculo' | 'falta_cnpj'

export default function SalaoConferenciaPage() {
  const router = useRouter()
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresaId, setEmpresaId] = useState('')
  const [competencia, setCompetencia] = useState(mesAtual())
  const [aba, setAba] = useState<Aba>('pendentes')
  const [dados, setDados] = useState<{ pendentes: Esperada[]; conferidas: Esperada[]; semVinculo: NotaLivre[]; pendenciasImport: Esperada[] }>({ pendentes: [], conferidas: [], semVinculo: [], pendenciasImport: [] })
  const [cnpjEdit, setCnpjEdit] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [msg, setMsg] = useState(''); const [msgTipo, setMsgTipo] = useState<'ok' | 'erro'>('ok')

  // modal de vínculo manual
  const [modal, setModal] = useState<{ tipo: 'pendente'; item: Esperada } | { tipo: 'nota'; item: NotaLivre } | null>(null)
  const [candNotas, setCandNotas] = useState<NotaLivre[]>([])

  async function abrirPendente(p: Esperada) {
    setModal({ tipo: 'pendente', item: p }); setCandNotas([])
    setCandNotas(await notasDoCnpj(p.empresa_id, p.documento))
  }

  useEffect(() => {
    if (!SALAO_ENABLED) { router.replace('/dashboard'); return }
    supabase.from('empresas').select('*').order('razao_social').then(({ data }) => setEmpresas(data ?? []))
    // Abre já na ÚLTIMA competência importada (evita cair no mês atual, que costuma estar vazio).
    supabase.from('salon_comissoes').select('mes_ref').order('mes_ref', { ascending: false }).limit(1)
      .then(({ data }) => { const m = data?.[0]?.mes_ref; if (m) setCompetencia(m) })
  }, [router])

  const carregar = useCallback(async () => {
    setLoading(true)
    setDados(await listarConferencia(competencia, empresaId || undefined))
    setLoading(false)
  }, [competencia, empresaId])
  useEffect(() => { if (SALAO_ENABLED) carregar() }, [carregar])

  function notify(t: string, tipo: 'ok' | 'erro') { setMsg(t); setMsgTipo(tipo); setTimeout(() => setMsg(''), 7000) }

  async function reconciliar() {
    setOcupado(true)
    const r = await reconciliarCompetencia(competencia, empresaId || undefined)
    setOcupado(false)
    notify(`Conferência automática (CNPJ + competência): ${r.conferidas} nota(s) casada(s)${r.divergencias ? ` · ${r.divergencias} com valor divergente (crédito ≠ nota — normal)` : ''}${r.outraEmpresa ? ` · ${r.outraEmpresa} em outra unidade` : ''}. Restam ${r.pendentes} pendente(s).`, 'ok')
    carregar()
  }
  async function refazer() {
    if (!window.confirm(`Refazer a conferência de ${fmtMes(competencia)}? Isso desfaz os vínculos automáticos deste mês e concilia do zero (as correções manuais também serão refeitas).`)) return
    setOcupado(true)
    const { limpos } = await limparVinculos(competencia, empresaId || undefined)
    const r = await reconciliarCompetencia(competencia, empresaId || undefined)
    setOcupado(false)
    notify(`Refeito: ${limpos} vínculo(s) limpo(s) · ${r.conferidas} casada(s)${r.outraEmpresa ? ` (${r.outraEmpresa} em outra unidade)` : ''}. Restam ${r.pendentes} pendente(s).`, 'ok')
    carregar()
  }
  async function vincular(comissaoId: string, n: NotaLivre) {
    const res = await vincularNota(comissaoId, { id: n.id, numero: n.numero, valor: n.valor, data_emissao: n.data_emissao })
    if (!res.ok) { notify(res.erro ?? 'Erro.', 'erro'); return }
    setModal(null); notify('Nota vinculada.', 'ok'); carregar()
  }
  async function desfazer(c: Esperada) {
    const res = await desvincular(c.id, c.nota_id)
    if (!res.ok) { notify(res.erro ?? 'Erro.', 'erro'); return }
    notify('Vínculo desfeito.', 'ok'); carregar()
  }
  async function salvarCnpj(c: Esperada) {
    const doc = cnpjEdit[c.id] ?? ''
    const res = await corrigirCnpj(c.id, doc)
    if (!res.ok) { notify(res.erro ?? 'Erro.', 'erro'); return }
    // tenta conciliar essa competência já com o CNPJ corrigido
    await reconciliarCompetencia(competencia, empresaId || undefined)
    notify('CNPJ corrigido.', 'ok'); carregar()
  }

  const resumo = useMemo(() => ({
    pend: dados.pendentes.length, conf: dados.conferidas.length, orf: dados.semVinculo.length, falta: dados.pendenciasImport.length,
    valorPend: dados.pendentes.reduce((s, p) => s + (p.valor_comissao || 0), 0),
  }), [dados])

  // candidatos do modal
  const candidatos = useMemo(() => {
    if (!modal) return { notas: [] as NotaLivre[], pendentes: [] as Esperada[] }
    if (modal.tipo === 'pendente') {
      const doc = (modal.item.documento ?? '').replace(/\D/g, '')
      const notas = [...dados.semVinculo].sort((a, b) => {
        const da = (a.documento ?? '').replace(/\D/g, '') === doc ? 0 : 1
        const db = (b.documento ?? '').replace(/\D/g, '') === doc ? 0 : 1
        return da - db
      })
      return { notas, pendentes: [] }
    }
    const doc = (modal.item.documento ?? '').replace(/\D/g, '')
    const pendentes = [...dados.pendentes].sort((a, b) => {
      const da = (a.documento ?? '').replace(/\D/g, '') === doc ? 0 : 1
      const db = (b.documento ?? '').replace(/\D/g, '') === doc ? 0 : 1
      return da - db
    })
    return { notas: [], pendentes }
  }, [modal, dados])

  if (!SALAO_ENABLED) return null

  return (
    <LayoutAdmin
      title="Salão — Conferência da Competência"
      actions={<div className="flex gap-2">
        <button onClick={refazer} disabled={ocupado || loading} className="bg-white border border-emerald-600 text-emerald-700 font-medium py-2 px-4 rounded-lg hover:bg-emerald-50 disabled:opacity-60" title="Limpa os vínculos deste mês e concilia do zero">{ocupado ? '...' : 'Refazer conferência'}</button>
        <button onClick={reconciliar} disabled={ocupado || loading} className="bg-emerald-600 text-white font-medium py-2 px-4 rounded-lg hover:bg-emerald-700 disabled:opacity-60">{ocupado ? 'Conciliando...' : 'Conciliar automático'}</button>
      </div>}
    >
      <div className="space-y-6">
        {msg && (
          <div className={`px-4 py-3 rounded-lg text-sm flex justify-between items-center ${msgTipo === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            <span>{msg}</span><button onClick={() => setMsg('')} className="font-bold text-lg leading-none ml-4 opacity-60 hover:opacity-100">×</button>
          </div>
        )}

        {/* Filtros */}
        <div className="card">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="label-field">Empresa</label>
              <select className="input-field" value={empresaId} onChange={e => setEmpresaId(e.target.value)}>
                <option value="">Todas as empresas</option>
                {empresas.map(e => <option key={e.id} value={e.id}>{e.apelido || e.razao_social}</option>)}
              </select>
            </div>
            <div><label className="label-field">Competência</label><input type="month" className="input-field" value={competencia} onChange={e => setCompetencia(e.target.value)} /></div>
          </div>
        </div>

        {/* Abas com contadores */}
        <div className="flex flex-wrap gap-2">
          {([['pendentes', `Pendentes (${resumo.pend})`, 'amber'], ['conferidas', `Conferidas (${resumo.conf})`, 'green'], ['sem_vinculo', `Sem vínculo (${resumo.orf})`, 'red'], ['falta_cnpj', `Falta CNPJ (${resumo.falta})`, 'amber']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setAba(k)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${aba === k ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {label}
            </button>
          ))}
          <div className="ml-auto text-sm text-gray-500 self-center">Valor pendente: <strong>{formatarMoeda(resumo.valorPend)}</strong></div>
        </div>

        <div className="card">
          {loading ? <div className="text-center py-12 text-gray-400 text-sm">Carregando...</div> : (
            <div className="overflow-x-auto">
              {aba === 'pendentes' && (
                <table className="w-full border-collapse">
                  <thead><tr className="bg-gray-50 border-b border-gray-200">
                    <th className="table-header">Empresa</th><th className="table-header">Profissional</th><th className="table-header">CNPJ/CPF</th><th className="table-header text-right">Crédito (planilha)</th><th className="table-header">Nota mais recente deste CNPJ</th><th className="table-header text-right">Ação</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {dados.pendentes.length === 0 ? <tr><td colSpan={6} className="text-center py-10 text-gray-400 text-sm">Nenhum profissional pendente em {fmtMes(competencia)}.</td></tr> :
                      dados.pendentes.map(p => {
                        const temNota = typeof p.dicaNotaValor === 'number'
                        const compBate = temNota && (p.dicaNotaComp || '') === competencia
                        return (
                          <tr key={p.id} className="hover:bg-gray-50">
                            <td className="table-cell text-xs text-gray-500">{p.empresaNome}</td>
                            <td className="table-cell font-medium text-gray-900">{p.nome || '—'}</td>
                            <td className="table-cell text-gray-600">{fmtDoc(p.documento)}</td>
                            <td className="table-cell text-right">{formatarMoeda(p.valor_comissao)}</td>
                            <td className="table-cell text-xs">
                              {!temNota
                                ? <span className="text-gray-400">nenhuma nota deste CNPJ baixada</span>
                                : <span className={p.dicaOutraEmpresa ? 'text-red-600' : (compBate ? 'text-green-700' : 'text-amber-700')}>
                                    {formatarMoeda(p.dicaNotaValor || 0)}{p.dicaNotaComp ? ` · comp. ${p.dicaNotaComp}` : ''}
                                    {p.dicaOutraEmpresa
                                      ? ` · ⚠ na empresa "${p.dicaNotaEmpresa}"`
                                      : (compBate ? ' · vincule manualmente' : ' · fora da competência (nota deste mês ainda não emitida/baixada)')}
                                  </span>}
                            </td>
                            <td className="table-cell text-right"><button onClick={() => abrirPendente(p)} className="text-blue-600 hover:text-blue-800 text-xs font-medium">Vincular nota</button></td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              )}

              {aba === 'conferidas' && (
                <table className="w-full border-collapse">
                  <thead><tr className="bg-gray-50 border-b border-gray-200">
                    <th className="table-header">Empresa</th><th className="table-header">Profissional</th><th className="table-header">CNPJ/CPF</th><th className="table-header text-right">Crédito</th><th className="table-header text-center">NF</th><th className="table-header text-right">Valor NF</th><th className="table-header text-center">Valor</th><th className="table-header text-right">Ação</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {dados.conferidas.length === 0 ? <tr><td colSpan={8} className="text-center py-10 text-gray-400 text-sm">Nenhuma conferida.</td></tr> :
                      dados.conferidas.map(c => {
                        const vNota = c.nota?.valor ?? c.nf_valor ?? 0
                        const diff = (vNota || 0) - (c.valor_comissao || 0)
                        const bate = Math.abs(diff) < 0.01
                        return (
                        <tr key={c.id} className="hover:bg-gray-50">
                          <td className="table-cell text-xs text-gray-500">{c.empresaNome}</td>
                          <td className="table-cell font-medium text-gray-900">{c.nome || '—'}</td>
                          <td className="table-cell text-gray-600">{fmtDoc(c.documento)}</td>
                          <td className="table-cell text-right">{formatarMoeda(c.valor_comissao)}</td>
                          <td className="table-cell text-center text-xs">{c.nota?.numero || c.nf_numero || '—'}</td>
                          <td className="table-cell text-right text-xs">{formatarMoeda(vNota)}</td>
                          <td className="table-cell text-center text-xs">
                            {bate
                              ? <span className="text-green-700">✓ confere</span>
                              : <span className="text-amber-700" title="A comissão da planilha difere do valor bruto da NFS-e (esperado)">Δ {formatarMoeda(diff)}</span>}
                          </td>
                          <td className="table-cell text-right"><button onClick={() => desfazer(c)} className="text-red-500 hover:text-red-700 text-xs font-medium">Desfazer</button></td>
                        </tr>
                        )
                      })}
                  </tbody>
                </table>
              )}

              {aba === 'sem_vinculo' && (
                <>
                  <p className="text-xs text-gray-500 mb-3">Notas recebidas na competência {fmtMes(competencia)} que <strong>não casaram</strong> com a planilha (CNPJ fora da lista, valor diferente, ou ainda pendente). Vincule manualmente a um profissional pendente, se for o caso.</p>
                  <table className="w-full border-collapse">
                    <thead><tr className="bg-gray-50 border-b border-gray-200">
                      <th className="table-header">Empresa</th><th className="table-header">Emitente</th><th className="table-header">CNPJ/CPF</th><th className="table-header text-center">NF</th><th className="table-header text-center">Emissão</th><th className="table-header text-right">Valor</th><th className="table-header text-right">Ação</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {dados.semVinculo.length === 0 ? <tr><td colSpan={7} className="text-center py-10 text-gray-400 text-sm">Nenhuma nota sem vínculo.</td></tr> :
                        dados.semVinculo.map(n => (
                          <tr key={n.id} className="hover:bg-gray-50">
                            <td className="table-cell text-xs text-gray-500">{n.empresaNome}</td>
                            <td className="table-cell font-medium text-gray-900">{n.emitente_nome || '—'}</td>
                            <td className="table-cell text-gray-600">{fmtDoc(n.documento)}</td>
                            <td className="table-cell text-center text-xs">{n.numero || '—'}</td>
                            <td className="table-cell text-center text-xs">{fmtData(n.data_emissao)}</td>
                            <td className="table-cell text-right">{formatarMoeda(n.valor || 0)}</td>
                            <td className="table-cell text-right"><button onClick={() => setModal({ tipo: 'nota', item: n })} className="text-blue-600 hover:text-blue-800 text-xs font-medium">Vincular a pendente</button></td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </>
              )}

              {aba === 'falta_cnpj' && (
                <>
                  <p className="text-xs text-gray-500 mb-3">Profissionais importados <strong>sem CNPJ</strong> na planilha (não foram perdidos). Informe o CNPJ/CPF para que entrem na conferência automática.</p>
                  <table className="w-full border-collapse">
                    <thead><tr className="bg-gray-50 border-b border-gray-200">
                      <th className="table-header">Empresa</th><th className="table-header">Profissional</th><th className="table-header text-right">Valor</th><th className="table-header">Motivo</th><th className="table-header">Informar CNPJ/CPF</th><th className="table-header text-right">Ação</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {dados.pendenciasImport.length === 0 ? <tr><td colSpan={6} className="text-center py-10 text-gray-400 text-sm">Nenhuma pendência de importação.</td></tr> :
                        dados.pendenciasImport.map(p => (
                          <tr key={p.id} className="hover:bg-gray-50 bg-amber-50/40">
                            <td className="table-cell text-xs text-gray-500">{p.empresaNome}</td>
                            <td className="table-cell font-medium text-gray-900">{p.nome || '—'}</td>
                            <td className="table-cell text-right">{formatarMoeda(p.valor_comissao)}</td>
                            <td className="table-cell text-xs text-amber-700">{p.pendencia}</td>
                            <td className="table-cell"><input className="input-field" style={{ padding: '4px 8px', maxWidth: 200 }} placeholder="Só números" value={cnpjEdit[p.id] ?? ''} onChange={e => setCnpjEdit(prev => ({ ...prev, [p.id]: e.target.value }))} /></td>
                            <td className="table-cell text-right"><button onClick={() => salvarCnpj(p)} className="text-blue-600 hover:text-blue-800 text-xs font-medium">Salvar</button></td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}
        </div>

        {/* Modal de vínculo manual */}
        {modal && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) setModal(null) }}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 max-h-[85vh] overflow-auto">
              {modal.tipo === 'pendente' ? (
                <>
                  <h2 className="text-lg font-bold text-gray-800 mb-1">Vincular nota ao profissional</h2>
                  <p className="text-xs text-gray-500 mb-4">{modal.item.nome} · {fmtDoc(modal.item.documento)} · esperado {formatarMoeda(modal.item.valor_comissao)}</p>
                  {candNotas.length === 0 ? <p className="text-sm text-gray-400">Nenhuma nota deste CNPJ disponível (em nenhuma competência). Baixe mais notas em &quot;Notas Recebidas&quot; se ainda faltar histórico.</p> : (
                    <div className="space-y-1">
                      {candNotas.map(n => {
                        const mesmoDoc = (n.documento ?? '').replace(/\D/g, '') === (modal.item.documento ?? '').replace(/\D/g, '')
                        const nComp = n.competencia_conf || n.competencia || ''
                        const mesmaComp = nComp === competencia
                        const mesmoValor = Math.abs((n.valor || 0) - modal.item.valor_comissao) < 0.01
                        return (
                          <button key={n.id} onClick={() => vincular(modal.item.id, n)} className={`w-full text-left px-3 py-2 rounded-lg border text-sm hover:bg-blue-50 ${mesmoDoc && mesmaComp ? 'border-green-300 bg-green-50' : 'border-gray-200'}`}>
                            <div className="flex justify-between"><span className="font-medium">{n.emitente_nome || '—'}</span><span>{formatarMoeda(n.valor || 0)}</span></div>
                            <div className="text-xs text-gray-500">{fmtDoc(n.documento)} · NF {n.numero || '—'} · emissão {fmtData(n.data_emissao)} · comp. {nComp || '—'} {mesmoDoc ? '· mesmo CNPJ' : ''} {mesmaComp ? '· mesma competência' : ''} {mesmoValor ? '· mesmo valor' : ''}</div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <h2 className="text-lg font-bold text-gray-800 mb-1">Vincular nota a um profissional pendente</h2>
                  <p className="text-xs text-gray-500 mb-4">{modal.item.emitente_nome} · {fmtDoc(modal.item.documento)} · {formatarMoeda(modal.item.valor || 0)}</p>
                  {candidatos.pendentes.length === 0 ? <p className="text-sm text-gray-400">Nenhum profissional pendente nesta competência.</p> : (
                    <div className="space-y-1">
                      {candidatos.pendentes.map(p => {
                        const mesmoDoc = (p.documento ?? '').replace(/\D/g, '') === (modal.item.documento ?? '').replace(/\D/g, '')
                        const mesmoValor = Math.abs((p.valor_comissao || 0) - (modal.item.valor || 0)) < 0.01
                        return (
                          <button key={p.id} onClick={() => vincular(p.id, modal.item)} className={`w-full text-left px-3 py-2 rounded-lg border text-sm hover:bg-blue-50 ${mesmoDoc && mesmoValor ? 'border-green-300 bg-green-50' : 'border-gray-200'}`}>
                            <div className="flex justify-between"><span className="font-medium">{p.nome || '—'}</span><span>{formatarMoeda(p.valor_comissao)}</span></div>
                            <div className="text-xs text-gray-500">{fmtDoc(p.documento)} {mesmoDoc ? '· mesmo CNPJ' : ''} {mesmoValor ? '· mesmo valor' : ''}</div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
              <div className="pt-4"><button className="btn-secondary w-full" onClick={() => setModal(null)}>Fechar</button></div>
            </div>
          </div>
        )}
      </div>
    </LayoutAdmin>
  )
}

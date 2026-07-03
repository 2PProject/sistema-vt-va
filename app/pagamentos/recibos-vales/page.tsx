'use client'

import { useEffect, useMemo, useState } from 'react'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase, Empresa } from '../../../lib/supabase'
import { formatarMoeda, MESES } from '../../../utils/calculoVT'
import {
  competenciaMesAnterior,
  listarVales,
  descontoDoVale,
  statusParcelasVale,
  PagamentoVale,
} from '../../../lib/pagamentos'
import type { DadosReciboVale } from '../../../services/gerarReciboValePDF'

function fmtMes(mes: string) {
  const [a, m] = mes.split('-').map(Number)
  return m ? `${MESES[m - 1]}/${a}` : mes
}
function fmtData(iso: string) {
  if (!iso) return ''
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}
function competenciasParcelas(mesInicio: string, parcelas: number): string[] {
  const [ay, am] = mesInicio.split('-').map(Number)
  const out: string[] = []
  for (let i = 0; i < parcelas; i++) {
    const d = new Date(ay, am - 1 + i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

export default function RecibosValesPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [vales, setVales] = useState<PagamentoVale[]>([])
  const [loading, setLoading] = useState(false)
  const [gerando, setGerando] = useState<string | null>(null)

  const [empresaFiltro, setEmpresaFiltro] = useState('')
  const [refComp, setRefComp] = useState(competenciaMesAnterior())
  const [soAtivos, setSoAtivos] = useState(false)
  const [soEmAberto, setSoEmAberto] = useState(false)
  const [busca, setBusca] = useState('')

  const [msg, setMsg] = useState('')
  const [msgTipo, setMsgTipo] = useState<'ok' | 'erro'>('ok')

  useEffect(() => {
    supabase.from('empresas').select('*').order('razao_social').then(({ data }) => setEmpresas(data ?? []))
  }, [])

  useEffect(() => { carregar() }, [empresaFiltro]) // eslint-disable-line react-hooks/exhaustive-deps

  async function carregar() {
    setLoading(true)
    setVales(await listarVales({ empresaId: empresaFiltro || undefined }))
    setLoading(false)
  }

  function notify(text: string, tipo: 'ok' | 'erro') {
    setMsg(text); setMsgTipo(tipo)
    setTimeout(() => setMsg(''), 6000)
  }

  // Vales + status calculado na competência de referência
  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return vales
      .map(v => ({ v, st: statusParcelasVale(v, refComp) }))
      .filter(({ v, st }) => {
        if (soAtivos && !descontoDoVale(v, refComp)) return false
        if (soEmAberto && st.restantes === 0) return false
        if (q) {
          const txt = `${v.funcionarios?.nome ?? ''} ${v.empresas?.razao_social ?? ''} ${v.descricao ?? ''}`.toLowerCase()
          if (!txt.includes(q)) return false
        }
        return true
      })
  }, [vales, refComp, soAtivos, soEmAberto, busca])

  const totais = useMemo(() => ({
    total: linhas.reduce((s, l) => s + l.v.valor_total, 0),
    descontado: linhas.reduce((s, l) => s + l.st.valorDescontado, 0),
    restante: linhas.reduce((s, l) => s + l.st.valorRestante, 0),
  }), [linhas])

  function montarDados(v: PagamentoVale): DadosReciboVale {
    const parcelas = Math.max(1, v.parcelas ?? 1)
    return {
      empresaNome: v.empresas?.razao_social ?? '',
      empresaCnpj: v.empresas?.cnpj ?? '',
      funcionarioNome: v.funcionarios?.nome ?? '',
      funcao: v.funcionarios?.funcao ?? '',
      data: v.data,
      descricao: v.descricao,
      valorTotal: v.valor_total,
      parcelas,
      valorParcela: v.valor_total / parcelas,
      mesInicio: v.mes_inicio,
      mesFim: v.mes_inicio,
    }
  }

  async function gerarRecibo(v: PagamentoVale) {
    setGerando(v.id)
    try {
      const { gerarReciboValePDF } = await import('../../../services/gerarReciboValePDF')
      await gerarReciboValePDF(montarDados(v))
    } catch (err) { console.error(err); notify('Erro ao gerar recibo.', 'erro') }
    finally { setGerando(null) }
  }

  async function gerarTodos() {
    if (linhas.length === 0) return
    setGerando('__todos__')
    try {
      const { gerarMultiplosRecibosVale } = await import('../../../services/gerarReciboValePDF')
      await gerarMultiplosRecibosVale(linhas.map(l => montarDados(l.v)))
    } catch (err) { console.error(err); notify('Erro ao gerar recibos.', 'erro') }
    finally { setGerando(null) }
  }

  return (
    <LayoutAdmin title="Recibos de Vales">
      <div className="space-y-6">
        {msg && (
          <div className={`px-4 py-3 rounded-lg text-sm flex justify-between items-center ${msgTipo === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            <span>{msg}</span>
            <button onClick={() => setMsg('')} className="font-bold text-lg leading-none ml-4 opacity-60 hover:opacity-100">×</button>
          </div>
        )}

        {/* Filtros */}
        <div className="card">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <label className="label-field">Empresa</label>
              <select className="input-field" value={empresaFiltro} onChange={e => setEmpresaFiltro(e.target.value)}>
                <option value="">Todas as empresas</option>
                {empresas.map(e => <option key={e.id} value={e.id}>{e.razao_social}</option>)}
              </select>
            </div>
            <div>
              <label className="label-field">Descontadas até</label>
              <input type="month" className="input-field" value={refComp} onChange={e => setRefComp(e.target.value)} />
              <p className="text-xs text-gray-400 mt-1">Competência de referência.</p>
            </div>
            <div>
              <label className="label-field">Buscar</label>
              <input className="input-field" placeholder="Profissional ou descrição..." value={busca} onChange={e => setBusca(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-4 mt-4">
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" className="w-4 h-4" checked={soEmAberto} onChange={e => setSoEmAberto(e.target.checked)} />
              Somente com parcelas em aberto
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" className="w-4 h-4" checked={soAtivos} onChange={e => setSoAtivos(e.target.checked)} />
              Somente com parcela nesta competência ({fmtMes(refComp)})
            </label>
          </div>
        </div>

        {/* Resumo */}
        <div className="grid grid-cols-3 gap-4">
          <div className="card">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Valor Total dos Vales</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{formatarMoeda(totais.total)}</p>
          </div>
          <div className="card">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Já Descontado (até {fmtMes(refComp)})</p>
            <p className="text-2xl font-bold text-green-700 mt-1">{formatarMoeda(totais.descontado)}</p>
          </div>
          <div className="card">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Falta Descontar</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{formatarMoeda(totais.restante)}</p>
          </div>
        </div>

        {/* Lista */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800">{linhas.length} vale(s)</h2>
            {linhas.length > 0 && (
              <button className="btn-primary flex items-center gap-2 text-sm" onClick={gerarTodos} disabled={gerando !== null}>
                {gerando === '__todos__' ? 'Gerando...' : 'Gerar Todos os Recibos'}
              </button>
            )}
          </div>

          {loading ? (
            <div className="text-center py-12 text-gray-400 text-sm">Carregando...</div>
          ) : linhas.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              Nenhum vale encontrado.<br />
              <span className="text-xs">Lance vales em Pagamentos → Vales / Descontos.</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="table-header">Data</th>
                    <th className="table-header">Profissional</th>
                    <th className="table-header">Descrição</th>
                    <th className="table-header text-right">Valor Total</th>
                    <th className="table-header text-center">Progresso</th>
                    <th className="table-header text-center">Faltam</th>
                    <th className="table-header text-right">Restante</th>
                    <th className="table-header text-right">Recibo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {linhas.map(({ v, st }) => {
                    const comps = competenciasParcelas(v.mes_inicio, st.parcelas)
                    const periodo = st.parcelas > 1
                      ? `${fmtMes(comps[0])} → ${fmtMes(comps[comps.length - 1])}`
                      : fmtMes(v.mes_inicio)
                    const pct = Math.round((st.descontadas / st.parcelas) * 100)
                    const quitado = st.restantes === 0
                    return (
                      <tr key={v.id} className="hover:bg-gray-50 transition-colors">
                        <td className="table-cell text-xs text-gray-500">{fmtData(v.data)}</td>
                        <td className="table-cell">
                          <div className="font-medium text-gray-900">{v.funcionarios?.nome ?? '—'}</div>
                          <div className="text-xs text-gray-400">{v.empresas?.razao_social ?? ''}</div>
                        </td>
                        <td className="table-cell">{v.descricao}</td>
                        <td className="table-cell text-right">
                          {formatarMoeda(v.valor_total)}
                          <div className="text-xs text-gray-400">{st.parcelas}x {formatarMoeda(st.valorParcela)}</div>
                        </td>
                        <td className="table-cell" style={{ minWidth: 150 }}>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className={quitado ? 'text-green-700 font-medium' : 'text-gray-600'}>
                              {st.descontadas}/{st.parcelas} descontada(s)
                            </span>
                            <span className="text-gray-400">{periodo}</span>
                          </div>
                          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${quitado ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
                          </div>
                        </td>
                        <td className="table-cell text-center">
                          {quitado
                            ? <span className="badge-green">Quitado</span>
                            : <span className="text-amber-700 font-semibold">{st.restantes}</span>}
                        </td>
                        <td className="table-cell text-right">
                          {st.valorRestante > 0
                            ? <span className="text-amber-700 font-medium">{formatarMoeda(st.valorRestante)}</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="table-cell text-right">
                          <button
                            onClick={() => gerarRecibo(v)}
                            disabled={gerando === v.id}
                            className="inline-flex items-center gap-1 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                          >
                            {gerando === v.id ? 'Gerando...' : 'Recibo'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td colSpan={3} className="table-cell text-right text-sm font-semibold text-gray-600">Totais:</td>
                    <td className="table-cell text-right font-semibold">{formatarMoeda(totais.total)}</td>
                    <td className="table-cell text-center text-xs text-gray-500">descontado {formatarMoeda(totais.descontado)}</td>
                    <td />
                    <td className="table-cell text-right font-bold text-amber-700">{formatarMoeda(totais.restante)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </LayoutAdmin>
  )
}

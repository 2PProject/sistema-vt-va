'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import LayoutAdmin from '../../components/LayoutAdmin'
import { supabase, Empresa } from '../../lib/supabase'
import { formatarMoeda, MESES } from '../../utils/calculoVT'
import { listarRecibosVTVA, montarReciboVTVAAvulso, LinhaReciboVTVA } from '../../lib/fechamento'

const TODAS = '__todas__'
type FuncAvulso = { id: string; nome: string; empresa_id: string; empresaNome: string }

export default function RecibosPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [linhas, setLinhas] = useState<LinhaReciboVTVA[]>([])
  const [loading, setLoading] = useState(false)
  const [gerando, setGerando] = useState<string | null>(null)

  const [empresaId, setEmpresaId] = useState<string>(TODAS)
  const [mes, setMes] = useState(new Date().getMonth() + 1)
  const [ano, setAno] = useState(new Date().getFullYear())
  const [busca, setBusca] = useState('')

  const [msg, setMsg] = useState('')

  // Recibo avulso
  const [modalAvulso, setModalAvulso] = useState(false)
  const [funcsAvulso, setFuncsAvulso] = useState<FuncAvulso[]>([])
  const [avEmpresa, setAvEmpresa] = useState('')
  const [avFunc, setAvFunc] = useState('')
  const [avLoad, setAvLoad] = useState(false)
  const [avMsg, setAvMsg] = useState('')

  useEffect(() => {
    supabase.from('empresas').select('*').order('razao_social').then(({ data }) => setEmpresas(data ?? []))
    supabase.from('funcionarios')
      .select('id, nome, ativo, unidades(empresa_id, empresas(razao_social))').order('nome')
      .then(({ data }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const opts: FuncAvulso[] = (data ?? []).filter((f: any) => f.ativo !== false && (Array.isArray(f.unidades) ? f.unidades[0] : f.unidades)?.empresa_id)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((f: any) => {
            const uni = Array.isArray(f.unidades) ? f.unidades[0] : f.unidades
            const e = uni?.empresas ? (Array.isArray(uni.empresas) ? uni.empresas[0] : uni.empresas) : null
            return { id: f.id, nome: f.nome, empresa_id: uni.empresa_id, empresaNome: e?.razao_social ?? '' }
          })
        setFuncsAvulso(opts)
      })
  }, [])

  const carregar = useCallback(async () => {
    setLoading(true)
    const data = await listarRecibosVTVA({ mes, ano, empresaId: empresaId === TODAS ? undefined : empresaId })
    setLinhas(data)
    setLoading(false)
  }, [mes, ano, empresaId])

  useEffect(() => { carregar() }, [carregar])

  function notify(t: string) { setMsg(t); setTimeout(() => setMsg(''), 5000) }

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return linhas
    return linhas.filter(l => l.nome.toLowerCase().includes(q) || l.empresaNome.toLowerCase().includes(q))
  }, [linhas, busca])

  const totalGeral = filtradas.reduce((s, l) => s + l.valorTotal, 0)
  const modoTodas = empresaId === TODAS
  const avFuncs = avEmpresa ? funcsAvulso.filter(f => f.empresa_id === avEmpresa) : funcsAvulso

  async function gerarPDF(l: LinhaReciboVTVA) {
    setGerando(l.funcionario_id)
    try {
      const { gerarReciboPDF } = await import('../../services/gerarReciboPDF')
      await gerarReciboPDF(l.dados)
    } catch (e) { console.error(e); notify('Erro ao gerar PDF.') }
    finally { setGerando(null) }
  }

  async function gerarTodos() {
    if (filtradas.length === 0) return
    setGerando('__todos__')
    try {
      const { gerarMultiplosPDFs } = await import('../../services/gerarReciboPDF')
      await gerarMultiplosPDFs(filtradas.map(l => l.dados), `recibos_vtva_${ano}-${String(mes).padStart(2, '0')}.pdf`)
    } catch (e) { console.error(e); notify('Erro ao gerar PDFs.') }
    finally { setGerando(null) }
  }

  async function gerarXLSX() {
    if (filtradas.length === 0) return
    setGerando('__xlsx__')
    try {
      const { utils, writeFile } = await import('xlsx')
      const dados = filtradas.map(l => ({
        'Empresa': l.empresaNome, 'Funcionário': l.nome, 'Função': l.funcao,
        'Dias Efetivos': l.diasEfetivos, 'VA (R$)': l.totalVA, 'VT (R$)': l.totalVT,
        'VT Sábado (R$)': l.totalVTSabado, 'Total (R$)': l.valorTotal,
      }))
      const wb = utils.book_new()
      utils.book_append_sheet(wb, utils.json_to_sheet(dados), `${MESES[mes - 1]} ${ano}`)
      writeFile(wb, `recibos_vtva_${mes}_${ano}.xlsx`)
    } catch (e) { console.error(e); notify('Erro ao exportar.') }
    finally { setGerando(null) }
  }

  async function gerarAvulso() {
    if (!avFunc) { setAvMsg('Selecione o funcionário.'); return }
    setAvLoad(true); setAvMsg('')
    try {
      const dados = await montarReciboVTVAAvulso(avFunc, mes, ano)
      if (!dados) { setAvMsg('Não gerado: funcionário não encontrado ou não trabalha nesse mês (verifique a admissão).'); return }
      const { gerarReciboPDF } = await import('../../services/gerarReciboPDF')
      await gerarReciboPDF(dados)
      setModalAvulso(false)
    } catch (e) { console.error(e); setAvMsg('Erro ao gerar recibo.') }
    finally { setAvLoad(false) }
  }

  return (
    <LayoutAdmin
      title="Recibos VT/VA"
      actions={
        <button className="btn-secondary flex items-center gap-2 text-sm" onClick={() => { setModalAvulso(true); setAvEmpresa(modoTodas ? '' : empresaId); setAvFunc(''); setAvMsg('') }}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Recibo avulso
        </button>
      }
    >
      <div className="space-y-6">
        {msg && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{msg}</div>}

        {/* Filtros */}
        <div className="card">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="label-field">Mês / Ano</label>
              <input
                type="month"
                className="input-field"
                value={`${ano}-${String(mes).padStart(2, '0')}`}
                onChange={e => { const [a, m] = e.target.value.split('-').map(Number); if (a && m) { setAno(a); setMes(m) } }}
              />
            </div>
            <div className="md:col-span-2">
              <label className="label-field">Empresa</label>
              <select value={empresaId} onChange={e => setEmpresaId(e.target.value)} className="input-field">
                <option value={TODAS}>— Todas as empresas —</option>
                {empresas.map(emp => <option key={emp.id} value={emp.id}>{emp.razao_social}</option>)}
              </select>
            </div>
            <div>
              <label className="label-field">Buscar</label>
              <input className="input-field" placeholder="Funcionário ou empresa..." value={busca} onChange={e => setBusca(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="card">
          {loading ? (
            <div className="text-center py-12 text-gray-400 text-sm">Calculando VT/VA...</div>
          ) : filtradas.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              Nenhum funcionário ativo para {MESES[mes - 1]}/{ano}.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
                <div>
                  <h2 className="text-base font-semibold text-gray-800">{MESES[mes - 1]}/{ano} — {filtradas.length} funcionário(s)</h2>
                  <p className="text-sm text-gray-500 mt-0.5">Total geral: <span className="font-semibold text-blue-600">{formatarMoeda(totalGeral)}</span></p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={gerarXLSX} className="btn-secondary text-sm" disabled={gerando !== null}>{gerando === '__xlsx__' ? 'Gerando...' : 'Exportar XLSX'}</button>
                  <button onClick={gerarTodos} className="btn-primary text-sm" disabled={gerando !== null}>{gerando === '__todos__' ? 'Gerando...' : 'Gerar Todos os PDFs'}</button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      {modoTodas && <th className="table-header text-left">Empresa</th>}
                      <th className="table-header">Funcionário</th>
                      <th className="table-header text-right">VA/dia</th>
                      <th className="table-header text-right">VT/dia</th>
                      <th className="table-header text-right">VT Sáb.</th>
                      <th className="table-header text-center">Dias Ef.</th>
                      <th className="table-header text-right">Total mês</th>
                      <th className="table-header text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtradas.map(l => (
                      <tr key={l.funcionario_id} className="hover:bg-gray-50 transition-colors">
                        {modoTodas && <td className="table-cell text-xs text-gray-500">{l.empresaNome}</td>}
                        <td className="table-cell">
                          <div className="font-medium text-gray-900">{l.nome}</div>
                          <div className="text-xs text-gray-400">{l.funcao}</div>
                        </td>
                        <td className="table-cell text-right text-sm">{l.valorVA > 0 ? formatarMoeda(l.valorVA) : <span className="text-gray-300">—</span>}</td>
                        <td className="table-cell text-right text-sm">{l.valorVT > 0 ? formatarMoeda(l.valorVT) : <span className="text-gray-300">—</span>}</td>
                        <td className="table-cell text-right text-sm">{l.valorVTSabado > 0 ? formatarMoeda(l.valorVTSabado) : <span className="text-gray-300">—</span>}</td>
                        <td className="table-cell text-center font-mono text-sm">{l.diasEfetivos}</td>
                        <td className="table-cell text-right font-semibold text-blue-700">{formatarMoeda(l.valorTotal)}</td>
                        <td className="table-cell text-right">
                          <button onClick={() => gerarPDF(l)} disabled={gerando === l.funcionario_id}
                            className="inline-flex items-center gap-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                            {gerando === l.funcionario_id ? 'Gerando...' : 'PDF'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 bg-gray-50">
                      <td colSpan={modoTodas ? 6 : 5} className="table-cell text-right text-sm font-semibold text-gray-600">Total geral:</td>
                      <td className="table-cell text-right font-bold text-blue-700">{formatarMoeda(totalGeral)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Modal Recibo avulso */}
        {modalAvulso && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) setModalAvulso(false) }}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
              <h2 className="text-lg font-bold text-gray-800 mb-1">Recibo avulso VT/VA</h2>
              <p className="text-xs text-gray-500 mb-4">Gera o recibo de <strong>{MESES[mes - 1]}/{ano}</strong> de um funcionário específico (valores do cadastro, proporcional à admissão).</p>
              {avMsg && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm mb-3">{avMsg}</div>}
              <div className="space-y-4">
                <div>
                  <label className="label-field">Empresa</label>
                  <select className="input-field" value={avEmpresa} onChange={e => { setAvEmpresa(e.target.value); setAvFunc('') }}>
                    <option value="">Todas as empresas</option>
                    {empresas.map(e => <option key={e.id} value={e.id}>{e.razao_social}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label-field">Funcionário</label>
                  <select className="input-field" value={avFunc} onChange={e => setAvFunc(e.target.value)}>
                    <option value="">Selecione o funcionário</option>
                    {avFuncs.map(f => <option key={f.id} value={f.id}>{f.nome}{avEmpresa ? '' : ` — ${f.empresaNome}`}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-3 pt-5">
                <button className="btn-primary flex-1" onClick={gerarAvulso} disabled={avLoad || !avFunc}>{avLoad ? 'Gerando...' : 'Gerar recibo'}</button>
                <button className="btn-secondary flex-1" onClick={() => setModalAvulso(false)}>Cancelar</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </LayoutAdmin>
  )
}

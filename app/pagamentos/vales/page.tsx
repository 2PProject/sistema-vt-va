'use client'

import { useEffect, useMemo, useState } from 'react'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase, Empresa } from '../../../lib/supabase'
import { formatarMoeda, MESES } from '../../../utils/calculoVT'
import {
  competenciaMesAnterior,
  listarVales,
  criarVale,
  excluirVale,
  PagamentoVale,
} from '../../../lib/pagamentos'

type FuncOpt = { id: string; nome: string; empresa_id: string; empresaNome: string }

function fmtMes(mes: string) {
  const [a, m] = mes.split('-').map(Number)
  return m ? `${MESES[m - 1]}/${a}` : mes
}
function fmtData(iso: string) {
  if (!iso) return ''
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}
function hoje() { return new Date().toISOString().split('T')[0] }

/** Retorna a lista de competências afetadas por um parcelamento. */
function competenciasParcelas(mesInicio: string, parcelas: number): string[] {
  const [ay, am] = mesInicio.split('-').map(Number)
  const out: string[] = []
  for (let i = 0; i < parcelas; i++) {
    const d = new Date(ay, am - 1 + i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

export default function ValesPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [funcs, setFuncs] = useState<FuncOpt[]>([])
  const [vales, setVales] = useState<PagamentoVale[]>([])
  const [loading, setLoading] = useState(false)
  const [gerando, setGerando] = useState<string | null>(null)

  const [filtroEmpresa, setFiltroEmpresa] = useState('')
  const [busca, setBusca] = useState('')

  const [msg, setMsg] = useState('')
  const [msgTipo, setMsgTipo] = useState<'ok' | 'erro'>('ok')

  // Form
  const [showForm, setShowForm] = useState(false)
  const [fEmpresa, setFEmpresa] = useState('')
  const [fFunc, setFFunc] = useState('')
  const [fData, setFData] = useState(hoje())
  const [fDescricao, setFDescricao] = useState('')
  const [fValor, setFValor] = useState('')
  const [fParcelas, setFParcelas] = useState(1)
  const [fMesInicio, setFMesInicio] = useState(competenciaMesAnterior())
  const [fErro, setFErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    supabase.from('empresas').select('*').order('razao_social').then(({ data }) => setEmpresas(data ?? []))
    carregarFuncs()
  }, [])

  useEffect(() => { carregarVales() }, [filtroEmpresa]) // eslint-disable-line react-hooks/exhaustive-deps

  async function carregarFuncs() {
    const { data } = await supabase
      .from('funcionarios')
      .select('id, nome, ativo, unidades(empresa_id, empresas(razao_social))')
      .order('nome')
    const opts: FuncOpt[] = (data ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((f: any) => f.ativo !== false && f.unidades?.empresa_id)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((f: any) => ({
        id: f.id,
        nome: f.nome,
        empresa_id: f.unidades.empresa_id,
        empresaNome: f.unidades?.empresas?.razao_social ?? '',
      }))
    setFuncs(opts)
  }

  async function carregarVales() {
    setLoading(true)
    const data = await listarVales({ empresaId: filtroEmpresa || undefined })
    setVales(data)
    setLoading(false)
  }

  function notify(text: string, tipo: 'ok' | 'erro') {
    setMsg(text); setMsgTipo(tipo)
    setTimeout(() => setMsg(''), 6000)
  }

  // Profissionais do formulário — filtrados pela empresa escolhida no modal
  const funcsForm = useMemo(
    () => fEmpresa ? funcs.filter(f => f.empresa_id === fEmpresa) : funcs,
    [funcs, fEmpresa]
  )

  const valesFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return vales
    return vales.filter(v =>
      (v.funcionarios?.nome ?? '').toLowerCase().includes(q) ||
      (v.descricao ?? '').toLowerCase().includes(q))
  }, [vales, busca])

  function abrirForm() {
    setFEmpresa(filtroEmpresa); setFFunc(''); setFData(hoje()); setFDescricao(''); setFValor(''); setFParcelas(1)
    setFMesInicio(competenciaMesAnterior()); setFErro(''); setShowForm(true)
  }

  const valorNum = parseFloat(fValor.replace(',', '.'))
  const valorParcela = !isNaN(valorNum) && fParcelas > 0 ? valorNum / fParcelas : 0

  async function salvar() {
    if (!fFunc) { setFErro('Selecione o profissional.'); return }
    if (!fDescricao.trim()) { setFErro('Informe a descrição.'); return }
    if (isNaN(valorNum) || valorNum <= 0) { setFErro('Informe um valor válido.'); return }
    if (fParcelas < 1) { setFErro('Número de parcelas inválido.'); return }
    const func = funcs.find(f => f.id === fFunc)
    if (!func) { setFErro('Profissional inválido.'); return }

    setSalvando(true); setFErro('')
    const res = await criarVale({
      funcionario_id: func.id,
      empresa_id: func.empresa_id,
      data: fData || hoje(),
      descricao: fDescricao.trim(),
      valor_total: valorNum,
      parcelas: fParcelas,
      mes_inicio: fMesInicio,
    })
    setSalvando(false)
    if (!res.ok) { setFErro(res.erro ?? 'Erro ao salvar.'); return }
    setShowForm(false)
    notify('Vale/desconto lançado com sucesso.', 'ok')
    carregarVales()
  }

  async function remover(v: PagamentoVale) {
    if (!confirm(`Excluir o vale "${v.descricao}" de ${v.funcionarios?.nome ?? ''}?`)) return
    await excluirVale(v.id)
    notify('Vale/desconto excluído.', 'ok')
    carregarVales()
  }

  async function gerarRecibo(v: PagamentoVale) {
    setGerando(v.id)
    try {
      const { gerarReciboValePDF } = await import('../../../services/gerarReciboValePDF')
      const parcelas = Math.max(1, v.parcelas ?? 1)
      await gerarReciboValePDF({
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
      })
    } catch (err) { console.error(err); notify('Erro ao gerar recibo.', 'erro') }
    finally { setGerando(null) }
  }

  return (
    <LayoutAdmin
      title="Vales / Descontos"
      actions={
        <button className="btn-primary flex items-center gap-2" onClick={abrirForm}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Novo Vale / Desconto
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

        {/* Filtros */}
        <div className="card">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="label-field">Empresa</label>
              <select className="input-field" value={filtroEmpresa} onChange={e => setFiltroEmpresa(e.target.value)}>
                <option value="">Todas as empresas</option>
                {empresas.map(e => <option key={e.id} value={e.id}>{e.razao_social}</option>)}
              </select>
            </div>
            <div>
              <label className="label-field">Buscar</label>
              <input className="input-field" placeholder="Profissional ou descrição..." value={busca} onChange={e => setBusca(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Lista */}
        <div className="card">
          <div className="mb-4 text-sm font-semibold text-gray-600">
            {loading ? 'Carregando...' : `${valesFiltrados.length} vale(s) / desconto(s)`}
          </div>
          {loading ? (
            <div className="text-center py-12 text-gray-400 text-sm">Carregando...</div>
          ) : valesFiltrados.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">Nenhum vale/desconto lançado.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="table-header">Data</th>
                    <th className="table-header">Profissional</th>
                    <th className="table-header">Descrição</th>
                    <th className="table-header text-right">Valor Total</th>
                    <th className="table-header text-center">Parcelas</th>
                    <th className="table-header text-right">Valor Parcela</th>
                    <th className="table-header">Período</th>
                    <th className="table-header text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {valesFiltrados.map((v) => {
                    const parcelas = Math.max(1, v.parcelas ?? 1)
                    const comps = competenciasParcelas(v.mes_inicio, parcelas)
                    const periodo = parcelas > 1
                      ? `${fmtMes(comps[0])} → ${fmtMes(comps[comps.length - 1])}`
                      : fmtMes(v.mes_inicio)
                    return (
                      <tr key={v.id} className="hover:bg-gray-50 transition-colors">
                        <td className="table-cell text-xs text-gray-500">{fmtData(v.data)}</td>
                        <td className="table-cell">
                          <div className="font-medium text-gray-900">{v.funcionarios?.nome ?? '—'}</div>
                          <div className="text-xs text-gray-400">{v.empresas?.razao_social ?? ''}</div>
                        </td>
                        <td className="table-cell">{v.descricao}</td>
                        <td className="table-cell text-right">{formatarMoeda(v.valor_total)}</td>
                        <td className="table-cell text-center">{parcelas > 1 ? `${parcelas}x` : 'À vista'}</td>
                        <td className="table-cell text-right">{formatarMoeda(v.valor_total / parcelas)}</td>
                        <td className="table-cell text-xs text-gray-600">{periodo}</td>
                        <td className="table-cell text-right">
                          <div className="flex gap-2 justify-end items-center">
                            <button
                              onClick={() => gerarRecibo(v)}
                              disabled={gerando === v.id}
                              className="inline-flex items-center gap-1 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                            >
                              {gerando === v.id ? 'Gerando...' : 'Recibo'}
                            </button>
                            <button onClick={() => remover(v)} className="text-red-500 hover:text-red-700 text-xs font-medium">Excluir</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal Form */}
        {showForm && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) setShowForm(false) }}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-auto">
              <h2 className="text-lg font-bold text-gray-800 mb-5">Novo Vale / Desconto</h2>
              {fErro && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">{fErro}</div>}

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label-field">Empresa</label>
                    <select className="input-field" value={fEmpresa} onChange={e => { setFEmpresa(e.target.value); setFFunc('') }}>
                      <option value="">Todas as empresas</option>
                      {empresas.map(e => <option key={e.id} value={e.id}>{e.razao_social}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label-field">Profissional</label>
                    <select className="input-field" value={fFunc} onChange={e => setFFunc(e.target.value)}>
                      <option value="">Selecione o profissional</option>
                      {funcsForm.map(f => (
                        <option key={f.id} value={f.id}>{f.nome}{fEmpresa ? '' : ` — ${f.empresaNome}`}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label-field">Data do lançamento</label>
                    <input type="date" className="input-field" value={fData} onChange={e => setFData(e.target.value)} />
                  </div>
                  <div>
                    <label className="label-field">Valor total do desconto (R$)</label>
                    <input type="number" step="0.01" min="0" className="input-field" value={fValor} onChange={e => setFValor(e.target.value)} placeholder="0,00" />
                  </div>
                </div>

                <div>
                  <label className="label-field">Descrição</label>
                  <input className="input-field" value={fDescricao} onChange={e => setFDescricao(e.target.value)} placeholder="Ex.: Vale, Adiantamento, Uniforme..." />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label-field">Nº de parcelas (quantas vezes)</label>
                    <input type="number" min="1" max="60" className="input-field" value={fParcelas} onChange={e => setFParcelas(Math.max(1, Number(e.target.value)))} />
                  </div>
                  <div>
                    <label className="label-field">Competência da 1ª parcela</label>
                    <input type="month" className="input-field" value={fMesInicio} onChange={e => setFMesInicio(e.target.value)} />
                  </div>
                </div>

                {valorParcela > 0 && (
                  <div className="bg-blue-50 border border-blue-200 text-blue-800 text-xs rounded-lg p-3">
                    {fParcelas > 1 ? (
                      <>Serão descontadas automaticamente <strong>{fParcelas} parcelas</strong> de <strong>{formatarMoeda(valorParcela)}</strong>, de{' '}
                      <strong>{fmtMes(competenciasParcelas(fMesInicio, fParcelas)[0])}</strong> a{' '}
                      <strong>{fmtMes(competenciasParcelas(fMesInicio, fParcelas)[fParcelas - 1])}</strong>.</>
                    ) : (
                      <>Desconto único de <strong>{formatarMoeda(valorParcela)}</strong> na competência <strong>{fmtMes(fMesInicio)}</strong>.</>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-5">
                <button className="btn-primary flex-1" onClick={salvar} disabled={salvando}>
                  {salvando ? 'Salvando...' : 'Lançar'}
                </button>
                <button className="btn-secondary flex-1" onClick={() => setShowForm(false)}>Cancelar</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </LayoutAdmin>
  )
}

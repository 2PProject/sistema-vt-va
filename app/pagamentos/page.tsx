'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import LayoutAdmin from '../../components/LayoutAdmin'
import { supabase, Empresa } from '../../lib/supabase'
import { formatarMoeda, MESES } from '../../utils/calculoVT'
import {
  competenciaMesAnterior,
  consolidarPagamentos,
  importarPlanilhaSalarios,
  processarImportacaoSalarios,
  baixarModeloPlanilhaSalarios,
  LinhaPagamento,
  LinhaImportSalario,
} from '../../lib/pagamentos'

function fmtMes(mes: string) {
  const [a, m] = mes.split('-').map(Number)
  return m ? `${MESES[m - 1]}/${a}` : mes
}

export default function PagamentosPage() {
  const [mesRef, setMesRef] = useState(competenciaMesAnterior())
  const [empresaFiltro, setEmpresaFiltro] = useState('')
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [linhas, setLinhas] = useState<LinhaPagamento[]>([])
  const [loading, setLoading] = useState(false)
  const [busca, setBusca] = useState('')

  const [msg, setMsg] = useState('')
  const [msgTipo, setMsgTipo] = useState<'ok' | 'erro'>('ok')

  // Import
  const [modalImport, setModalImport] = useState(false)
  const [importPreview, setImportPreview] = useState<LinhaImportSalario[]>([])
  const [importErros, setImportErros] = useState<string[]>([])
  const [importLoad, setImportLoad] = useState(false)

  useEffect(() => {
    supabase.from('empresas').select('*').order('razao_social').then(({ data }) => setEmpresas(data ?? []))
  }, [])

  const carregar = useCallback(async () => {
    setLoading(true)
    const data = await consolidarPagamentos({ mesReferencia: mesRef, empresaId: empresaFiltro || undefined })
    setLinhas(data)
    setLoading(false)
  }, [mesRef, empresaFiltro])

  useEffect(() => { carregar() }, [carregar])

  function notify(text: string, tipo: 'ok' | 'erro') {
    setMsg(text); setMsgTipo(tipo)
    setTimeout(() => setMsg(''), 6000)
  }

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return linhas
    return linhas.filter(l =>
      l.funcionarioNome.toLowerCase().includes(q) || l.empresaNome.toLowerCase().includes(q))
  }, [linhas, busca])

  const totais = useMemo(() => ({
    liquido: filtradas.reduce((s, l) => s + l.valorLiquido, 0),
    descontos: filtradas.reduce((s, l) => s + l.totalDescontos, 0),
    pagar: filtradas.reduce((s, l) => s + l.valorAPagar, 0),
  }), [filtradas])

  // ── Importação ──────────────────────────────────────────────
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setImportLoad(true); setImportPreview([]); setImportErros([])
    const { linhas: ls, erros } = await importarPlanilhaSalarios(file)
    setImportPreview(ls); setImportErros(erros); setImportLoad(false)
    e.target.value = ''
  }

  async function executarImport() {
    if (importPreview.length === 0) return
    setImportLoad(true)
    const { gravados, erros } = await processarImportacaoSalarios(importPreview, mesRef)
    setImportLoad(false)
    notify(`${gravados} salário(s) importado(s) para ${fmtMes(mesRef)}.${erros.length ? ' Verifique os erros.' : ''}`, erros.length && !gravados ? 'erro' : 'ok')
    if (erros.length) setImportErros(erros)
    else { setModalImport(false); setImportPreview([]); setImportErros([]); carregar() }
  }

  return (
    <LayoutAdmin
      title="Pagamentos"
      actions={
        <button className="btn-primary flex items-center gap-2" onClick={() => setModalImport(true)}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          Importar Salários
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

        {/* Seletor de competência */}
        <div className="card">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="label-field">Competência (mês anterior)</label>
              <input type="month" className="input-field" value={mesRef} onChange={e => setMesRef(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <label className="label-field">Empresa</label>
              <select className="input-field" value={empresaFiltro} onChange={e => setEmpresaFiltro(e.target.value)}>
                <option value="">Todas as empresas</option>
                {empresas.map(e => <option key={e.id} value={e.id}>{e.razao_social}</option>)}
              </select>
            </div>
            <div>
              <label className="label-field">Buscar</label>
              <input className="input-field" placeholder="Profissional ou empresa..." value={busca} onChange={e => setBusca(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Resumo */}
        <div className="grid grid-cols-3 gap-4">
          <div className="card">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Salário Líquido</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{formatarMoeda(totais.liquido)}</p>
          </div>
          <div className="card">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Descontos</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{formatarMoeda(totais.descontos)}</p>
          </div>
          <div className="card">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">A Pagar</p>
            <p className="text-2xl font-bold text-green-700 mt-1">{formatarMoeda(totais.pagar)}</p>
          </div>
        </div>

        {/* Tabela */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800">
              {fmtMes(mesRef)} — {filtradas.length} profissional(is)
            </h2>
            <span className="text-xs text-gray-400">Recibos e CSV do banco: use o Fechamento do Mês.</span>
          </div>

          {loading ? (
            <div className="text-center py-12 text-gray-400 text-sm">Carregando...</div>
          ) : filtradas.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              Nenhum pagamento para {fmtMes(mesRef)}.<br />
              <span className="text-xs">Importe a planilha de salário líquido para começar.</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="table-header">Empresa</th>
                    <th className="table-header">Profissional</th>
                    <th className="table-header text-right">Salário Líquido</th>
                    <th className="table-header text-center">Descontos</th>
                    <th className="table-header text-right">Total Desc.</th>
                    <th className="table-header text-right">A Pagar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtradas.map((l) => (
                    <tr key={l.funcionario_id} className="hover:bg-gray-50 transition-colors">
                      <td className="table-cell text-xs text-gray-500">{l.empresaNome}</td>
                      <td className="table-cell">
                        <div className="font-medium text-gray-900">{l.funcionarioNome}</div>
                        {l.funcao && <div className="text-xs text-gray-400">{l.funcao}</div>}
                      </td>
                      <td className="table-cell text-right">{formatarMoeda(l.valorLiquido)}</td>
                      <td className="table-cell text-center">
                        {l.descontos.length === 0 ? (
                          <span className="text-gray-300">—</span>
                        ) : (
                          <div className="flex flex-col gap-0.5 items-center">
                            {l.descontos.map((d) => (
                              <span key={d.vale.id} className="text-xs text-amber-700" title={d.vale.descricao}>
                                {d.vale.descricao}
                                {d.totalParcelas > 1 && <span className="text-amber-500"> ({d.parcelaAtual}/{d.totalParcelas})</span>}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="table-cell text-right text-amber-700">
                        {l.totalDescontos > 0 ? `- ${formatarMoeda(l.totalDescontos)}` : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="table-cell text-right font-semibold text-green-700">{formatarMoeda(l.valorAPagar)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td colSpan={2} className="table-cell text-right text-sm font-semibold text-gray-600">Totais:</td>
                    <td className="table-cell text-right font-semibold">{formatarMoeda(totais.liquido)}</td>
                    <td />
                    <td className="table-cell text-right font-semibold text-amber-700">- {formatarMoeda(totais.descontos)}</td>
                    <td className="table-cell text-right font-bold text-green-700">{formatarMoeda(totais.pagar)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Modal Importar */}
        {modalImport && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) { setModalImport(false); setImportPreview([]); setImportErros([]) } }}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-auto">
              <h2 className="text-lg font-bold text-gray-800 mb-4">Importar Salário Líquido — {fmtMes(mesRef)}</h2>
              <div className="bg-blue-50 border border-blue-200 text-blue-800 text-xs rounded-lg p-3 mb-4">
                Colunas: <strong>Unidade</strong> (apelido da empresa, ou CNPJ), <strong>Nome</strong> do profissional e <strong>Valor</strong> líquido.
                Opcional: <strong>PIX</strong> — quando presente, atualiza a chave Pix do cadastro.
                O profissional é casado pelo nome dentro da empresa. Competência aplicada: <strong>{fmtMes(mesRef)}</strong> (selecione acima antes de importar).
              </div>
              <div className="flex items-center justify-between gap-3 mb-4">
                <input type="file" accept=".xlsx,.xls" onChange={handleFile} disabled={importLoad} className="input-field flex-1" />
                <button type="button" onClick={() => baixarModeloPlanilhaSalarios()} className="btn-secondary text-sm whitespace-nowrap flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Baixar modelo
                </button>
              </div>

              {importLoad && <div className="text-sm text-gray-400 mb-3">Processando...</div>}

              {importErros.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg p-3 mb-4">
                  <strong>Avisos / não encontrados ({importErros.length}):</strong>
                  <ul className="mt-1 list-disc pl-5 max-h-40 overflow-auto">
                    {importErros.map((er, i) => <li key={i}>{er}</li>)}
                  </ul>
                </div>
              )}

              {importPreview.length > 0 && (
                <div className="mb-4">
                  <div className="text-sm font-semibold mb-2">{importPreview.length} registro(s) prontos para importar</div>
                  <div className="border border-gray-200 rounded-lg max-h-60 overflow-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="bg-gray-50 sticky top-0">
                        <th className="table-header">Profissional</th>
                        <th className="table-header">Empresa</th>
                        <th className="table-header text-right">Líquido</th>
                      </tr></thead>
                      <tbody>
                        {importPreview.map((l, i) => (
                          <tr key={i} className="border-t border-gray-100">
                            <td className="table-cell">{l.funcionarioNome}</td>
                            <td className="table-cell">{l.empresaNome}</td>
                            <td className="table-cell text-right">{formatarMoeda(l.valorLiquido)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button className="btn-primary flex-1" onClick={executarImport} disabled={importLoad || importPreview.length === 0}>
                  {importLoad ? 'Importando...' : `Importar ${importPreview.length} registro(s)`}
                </button>
                <button className="btn-secondary flex-1" onClick={() => { setModalImport(false); setImportPreview([]); setImportErros([]) }}>Fechar</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </LayoutAdmin>
  )
}

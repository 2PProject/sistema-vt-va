'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { formatarMoeda, MESES } from '../../../utils/calculoVT'
import { SALAO_ENABLED } from '../../../lib/salao/config'
import { importarPlanilhaComissoes, processarImportacaoComissoes, type LinhaImportComissao } from '../../../lib/salao/comissoes'

function fmtMes(m: string) { const [a, mm] = m.split('-').map(Number); return mm ? `${MESES[mm - 1]}/${a}` : m }

export default function SalaoImportarPage() {
  const router = useRouter()
  const [preview, setPreview] = useState<LinhaImportComissao[]>([])
  const [erros, setErros] = useState<string[]>([])
  const [sobrescrever, setSobrescrever] = useState(true)
  const [load, setLoad] = useState(false)
  const [msg, setMsg] = useState(''); const [msgTipo, setMsgTipo] = useState<'ok' | 'erro'>('ok')

  useEffect(() => { if (!SALAO_ENABLED) { router.replace('/dashboard'); return } }, [router])
  function notify(t: string, tipo: 'ok' | 'erro') { setMsg(t); setMsgTipo(tipo); setTimeout(() => setMsg(''), 8000) }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setLoad(true); setPreview([]); setErros([])
    const { linhas, erros } = await importarPlanilhaComissoes(file)
    setPreview(linhas); setErros(erros); setLoad(false); e.target.value = ''
  }
  async function confirmar() {
    if (preview.length === 0) return
    setLoad(true)
    const { gravados, atualizados, ignorados } = await processarImportacaoComissoes(preview, sobrescrever)
    setLoad(false)
    notify(`${gravados} nova(s), ${atualizados} atualizada(s)${ignorados ? `, ${ignorados} ignorada(s)` : ''}.`, 'ok')
    setPreview([]); setErros([])
  }

  if (!SALAO_ENABLED) return null

  return (
    <LayoutAdmin title="Salão — Importar Planilha do Mês">
      <div className="space-y-6">
        {msg && <div className={`px-4 py-3 rounded-lg text-sm ${msgTipo === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>{msg}</div>}

        <div className="card">
          <div className="bg-blue-50 border border-blue-200 text-blue-800 text-xs rounded-lg p-3 mb-4">
            Cada <strong>aba</strong> = uma <strong>empresa</strong> (o nome da aba deve coincidir com a empresa/apelido no sistema). Colunas: <strong>Nome do Profissional</strong> · <strong>Mês de Referência</strong> (ex.: Maio/2026) · <strong>Valor da Comissão</strong>. Colunas extras são ignoradas.
          </div>
          <input type="file" accept=".xlsx,.xls" onChange={handleFile} disabled={load} className="input-field" />
          {load && <div className="text-sm text-gray-400 mt-2">Processando...</div>}
        </div>

        {erros.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg p-3">
            <strong>Alertas ({erros.length}):</strong>
            <ul className="mt-1 list-disc pl-5 max-h-48 overflow-auto">{erros.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}

        {preview.length > 0 && (
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-gray-700">{preview.length} registro(s) prontos</div>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" className="w-4 h-4" checked={sobrescrever} onChange={e => setSobrescrever(e.target.checked)} />
                Sobrescrever valores já importados (mesmo mês/empresa)
              </label>
            </div>
            <div className="border border-gray-200 rounded-lg max-h-72 overflow-auto">
              <table className="w-full text-xs">
                <thead><tr className="bg-gray-50 sticky top-0">
                  <th className="table-header">Empresa</th><th className="table-header">Profissional</th><th className="table-header">Mês</th><th className="table-header text-right">Comissão</th>
                </tr></thead>
                <tbody>
                  {preview.map((l, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="table-cell">{l.empresaNome}</td>
                      <td className="table-cell">{l.profissionalNome}</td>
                      <td className="table-cell">{fmtMes(l.mes_ref)}</td>
                      <td className="table-cell text-right">{formatarMoeda(l.valor_comissao)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-3 pt-4">
              <button className="btn-primary" onClick={confirmar} disabled={load}>{load ? 'Importando...' : `Confirmar importação (${preview.length})`}</button>
              <button className="btn-secondary" onClick={() => { setPreview([]); setErros([]) }}>Cancelar</button>
            </div>
          </div>
        )}
      </div>
    </LayoutAdmin>
  )
}

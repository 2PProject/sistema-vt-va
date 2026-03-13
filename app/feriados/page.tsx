'use client'

import { useEffect, useState } from 'react'
import LayoutAdmin from '../../components/LayoutAdmin'
import { supabase, Feriado } from '../../lib/supabase'
import { MESES } from '../../utils/calculoVT'

export default function FeriadosPage() {
  const [feriados, setFeriados] = useState<Feriado[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editando, setEditando] = useState<Feriado | null>(null)
  const [filtroAno, setFiltroAno] = useState(new Date().getFullYear())

  // Form state
  const [data, setData] = useState('')
  const [descricao, setDescricao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [importando, setImportando] = useState(false)
  const [msgImport, setMsgImport] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null)

  useEffect(() => { carregar() }, [])

  async function carregar() {
    setLoading(true)
    const { data: rows } = await supabase
      .from('feriados')
      .select('*')
      .order('data')
    setFeriados(rows ?? [])
    setLoading(false)
  }

  function abrirNovo() {
    setEditando(null)
    setData('')
    setDescricao('')
    setShowForm(true)
  }

  function abrirEditar(f: Feriado) {
    setEditando(f)
    setData(f.data)
    setDescricao(f.descricao)
    setShowForm(true)
  }

  function fechar() {
    setShowForm(false)
    setEditando(null)
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setSalvando(true)
    if (editando) {
      await supabase.from('feriados').update({ data, descricao }).eq('id', editando.id)
    } else {
      await supabase.from('feriados').insert({ data, descricao })
    }
    await carregar()
    fechar()
    setSalvando(false)
  }

  async function excluir(id: string) {
    if (!confirm('Excluir este feriado?')) return
    await supabase.from('feriados').delete().eq('id', id)
    await carregar()
  }

  async function importarBrasilAPI() {
    setImportando(true)
    setMsgImport(null)
    try {
      const resp = await fetch(`https://brasilapi.com.br/api/feriados/v1/${filtroAno}`)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const lista: Array<{ date: string; name: string }> = await resp.json()

      // Busca feriados já existentes no ano
      const { data: existentes } = await supabase
        .from('feriados').select('data').gte('data', `${filtroAno}-01-01`).lte('data', `${filtroAno}-12-31`)
      const datasExistentes = new Set((existentes ?? []).map(f => f.data))

      let inseridos = 0
      for (const f of lista) {
        if (!datasExistentes.has(f.date)) {
          await supabase.from('feriados').insert({ data: f.date, descricao: f.name })
          inseridos++
        }
      }

      await carregar()
      setMsgImport({ tipo: 'sucesso', texto: `${inseridos} feriado(s) importado(s) de ${lista.length} nacionais para ${filtroAno}.` })
    } catch (e) {
      setMsgImport({ tipo: 'erro', texto: `Erro ao importar: ${e instanceof Error ? e.message : 'falha de rede'}` })
    } finally {
      setImportando(false)
      setTimeout(() => setMsgImport(null), 5000)
    }
  }

  // Group by year for display
  const anos = Array.from(new Set(feriados.map(f => new Date(f.data + 'T00:00:00').getFullYear()))).sort()
  const feriadosFiltrados = feriados.filter(f => {
    const ano = new Date(f.data + 'T00:00:00').getFullYear()
    return ano === filtroAno
  })

  function formatarData(iso: string) {
    const d = new Date(iso + 'T00:00:00')
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
  }

  function nomeMes(iso: string) {
    const d = new Date(iso + 'T00:00:00')
    return MESES[d.getMonth()]
  }

  function nomeDia(iso: string) {
    const dias = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado']
    return dias[new Date(iso + 'T00:00:00').getDay()]
  }

  return (
    <LayoutAdmin
      title="Feriados"
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={importarBrasilAPI}
            disabled={importando}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            {importando ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            )}
            Importar {filtroAno} (Brasil API)
          </button>
          <button onClick={abrirNovo} className="btn-primary flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Novo Feriado
          </button>
        </div>
      }
    >
      <div className="space-y-6">

        {/* Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
              <h2 className="text-lg font-bold text-gray-800 mb-5">
                {editando ? 'Editar Feriado' : 'Novo Feriado'}
              </h2>
              <form onSubmit={salvar} className="space-y-4">
                <div>
                  <label className="label-field">Data</label>
                  <input
                    type="date"
                    value={data}
                    onChange={(e) => setData(e.target.value)}
                    required
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="label-field">Descrição</label>
                  <input
                    type="text"
                    value={descricao}
                    onChange={(e) => setDescricao(e.target.value)}
                    required
                    className="input-field"
                    placeholder="Ex: Natal, Proclamação da República..."
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="submit" disabled={salvando} className="btn-primary flex-1">
                    {salvando ? 'Salvando...' : editando ? 'Atualizar' : 'Cadastrar'}
                  </button>
                  <button type="button" onClick={fechar} className="btn-secondary flex-1">
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {msgImport && (
          <div className={`px-4 py-3 rounded-lg text-sm ${msgImport.tipo === 'sucesso' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            {msgImport.texto}
          </div>
        )}

        {/* Filtro por ano */}
        <div className="card">
          <div className="flex items-center gap-4 flex-wrap">
            <label className="text-sm font-medium text-gray-600">Filtrar por ano:</label>
            <div className="flex gap-2">
              {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map(a => (
                <button
                  key={a}
                  onClick={() => setFiltroAno(a)}
                  className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                    filtroAno === a ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-400">{feriadosFiltrados.length} feriado(s) em {filtroAno}</span>
          </div>
        </div>

        {/* Tabela */}
        <div className="card">
          {loading ? (
            <div className="text-center py-12 text-gray-400 text-sm">Carregando...</div>
          ) : feriadosFiltrados.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <svg className="w-10 h-10 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-sm">Nenhum feriado cadastrado para {filtroAno}.</p>
            </div>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="table-header text-left">Data</th>
                  <th className="table-header text-left">Dia da Semana</th>
                  <th className="table-header text-left">Mês</th>
                  <th className="table-header text-left">Descrição</th>
                  <th className="table-header text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {feriadosFiltrados.map((f) => (
                  <tr key={f.id} className="hover:bg-gray-50">
                    <td className="table-cell font-mono font-medium">{formatarData(f.data)}</td>
                    <td className="table-cell">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                        nomeDia(f.data) === 'Domingo' || nomeDia(f.data) === 'Sábado'
                          ? 'bg-orange-100 text-orange-700'
                          : 'bg-blue-50 text-blue-700'
                      }`}>
                        {nomeDia(f.data)}
                      </span>
                    </td>
                    <td className="table-cell text-gray-500">{nomeMes(f.data)}</td>
                    <td className="table-cell font-medium text-gray-800">{f.descricao}</td>
                    <td className="table-cell text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => abrirEditar(f)} className="text-xs text-blue-600 hover:underline">Editar</button>
                        <button onClick={() => excluir(f.id)} className="text-xs text-red-600 hover:underline">Excluir</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Todos os anos com data */}
        {anos.length > 0 && (
          <div className="card">
            <p className="text-xs text-gray-500">
              Total cadastrado: {feriados.length} feriado(s) em {anos.length} ano(s)
            </p>
          </div>
        )}
      </div>
    </LayoutAdmin>
  )
}

'use client'

import { useEffect, useState } from 'react'
import LayoutAdmin from '../../components/LayoutAdmin'
import { supabase, TipoDesconto } from '../../lib/supabase'

export default function TiposDescontoPage() {
  const [tipos, setTipos] = useState<TipoDesconto[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editando, setEditando] = useState<TipoDesconto | null>(null)
  const [nome, setNome] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { carregar() }, [])

  async function carregar() {
    setLoading(true)
    const { data } = await supabase.from('tipos_desconto').select('*').order('nome')
    setTipos(data ?? [])
    setLoading(false)
  }

  function abrirNovo() {
    setEditando(null)
    setNome('')
    setError('')
    setShowForm(true)
  }

  function abrirEditar(t: TipoDesconto) {
    setEditando(t)
    setNome(t.nome)
    setError('')
    setShowForm(true)
  }

  function fechar() {
    setShowForm(false)
    setEditando(null)
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (!nome.trim()) { setError('Informe o nome.'); return }
    setSalvando(true)
    setError('')
    if (editando) {
      const { error: err } = await supabase.from('tipos_desconto').update({ nome }).eq('id', editando.id)
      if (err) { setError('Nome já existe.'); setSalvando(false); return }
    } else {
      const { error: err } = await supabase.from('tipos_desconto').insert({ nome })
      if (err) { setError('Nome já existe.'); setSalvando(false); return }
    }
    await carregar()
    fechar()
    setSalvando(false)
  }

  async function excluir(id: string) {
    if (!confirm('Excluir este tipo de desconto?')) return
    await supabase.from('tipos_desconto').delete().eq('id', id)
    await carregar()
  }

  const icones: Record<string, string> = {
    'Falta Injustificada': '❌',
    'Atestado Médico': '🏥',
    'Suspensão': '⛔',
    'Licença': '📋',
  }

  return (
    <LayoutAdmin
      title="Tipos de Desconto"
      actions={
        <button onClick={abrirNovo} className="btn-primary flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Novo Tipo
        </button>
      }
    >
      <div className="space-y-6">

        {/* Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
              <h2 className="text-lg font-bold text-gray-800 mb-5">
                {editando ? 'Editar Tipo de Desconto' : 'Novo Tipo de Desconto'}
              </h2>
              <form onSubmit={salvar} className="space-y-4">
                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{error}</div>
                )}
                <div>
                  <label className="label-field">Nome</label>
                  <input
                    type="text"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    required
                    className="input-field"
                    placeholder="Ex: Falta Injustificada, Atestado Médico..."
                    autoFocus
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

        <div className="card">
          <p className="text-sm text-gray-500 mb-4">
            Tipos de desconto disponíveis ao lançar ausências nas competências mensais.
          </p>

          {loading ? (
            <div className="text-center py-10 text-gray-400 text-sm">Carregando...</div>
          ) : tipos.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <p className="text-sm">Nenhum tipo cadastrado.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {tipos.map((t) => (
                <div key={t.id} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg bg-gray-50 hover:bg-white transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{icones[t.nome] ?? '📌'}</span>
                    <span className="text-sm font-medium text-gray-800">{t.nome}</span>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => abrirEditar(t)} className="text-xs text-blue-600 hover:underline">Editar</button>
                    <button onClick={() => excluir(t.id)} className="text-xs text-red-600 hover:underline">Excluir</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </LayoutAdmin>
  )
}

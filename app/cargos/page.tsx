'use client'

import { useEffect, useState } from 'react'
import LayoutAdmin from '../../components/LayoutAdmin'
import FormCargo from '../../components/FormCargo'
import TableCargos from '../../components/TableCargos'
import { supabase, Cargo } from '../../lib/supabase'

export default function CargosPage() {
  const [cargos, setCargos] = useState<Cargo[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editando, setEditando] = useState<Cargo | null>(null)
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState('')

  useEffect(() => {
    carregar()
  }, [])

  async function carregar() {
    setLoading(true)
    const { data } = await supabase.from('cargos').select('*').order('nome')
    setCargos(data ?? [])
    setLoading(false)
  }

  async function salvar(data: Omit<Cargo, 'id'>) {
    setErro('')
    if (editando) {
      const { error } = await supabase
        .from('cargos')
        .update(data)
        .eq('id', editando.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('cargos').insert(data)
      if (error) throw error
    }
    await carregar()
    fecharForm()
  }

  async function excluir(id: string) {
    const { error } = await supabase.from('cargos').delete().eq('id', id)
    if (error) {
      setErro('Não foi possível excluir o cargo. Verifique se não está em uso.')
      return
    }
    await carregar()
  }

  function editar(cargo: Cargo) {
    setEditando(cargo)
    setShowForm(true)
  }

  function novoCargo() {
    setEditando(null)
    setShowForm(true)
  }

  function fecharForm() {
    setShowForm(false)
    setEditando(null)
  }

  const cargosFiltrados = cargos.filter((c) =>
    c.nome.toLowerCase().includes(busca.toLowerCase())
  )

  return (
    <LayoutAdmin
      title="Cargos / Funções"
      actions={
        <button onClick={novoCargo} className="btn-primary flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Novo Cargo
        </button>
      }
    >
      <div className="space-y-6">
        {/* Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
              <h2 className="text-lg font-bold text-gray-800 mb-5">
                {editando ? 'Editar Cargo' : 'Novo Cargo'}
              </h2>
              <FormCargo cargo={editando} onSave={salvar} onCancel={fecharForm} />
            </div>
          </div>
        )}

        {erro && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {erro}
            <button onClick={() => setErro('')} className="ml-auto text-red-400 hover:text-red-600">✕</button>
          </div>
        )}

        {/* Info */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-5 py-4 text-sm text-blue-700 flex items-start gap-3">
          <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>
            Cadastre todos os cargos e funções da empresa. Ao registrar um funcionário, basta selecionar o cargo — sem precisar digitar novamente.
          </span>
        </div>

        {/* Busca */}
        <div className="card">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Buscar cargo..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="flex-1 border-0 outline-none text-sm text-gray-700 placeholder-gray-400 bg-transparent"
            />
          </div>
        </div>

        {/* Tabela */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-600">
              {loading ? 'Carregando...' : `${cargosFiltrados.length} cargo(s) cadastrado(s)`}
            </h2>
          </div>
          {loading ? (
            <div className="text-center py-12 text-gray-400 text-sm">Carregando cargos...</div>
          ) : (
            <TableCargos cargos={cargosFiltrados} onEdit={editar} onDelete={excluir} />
          )}
        </div>
      </div>
    </LayoutAdmin>
  )
}

'use client'

import { useEffect, useState } from 'react'
import LayoutAdmin from '../../components/LayoutAdmin'
import FormEmpresa from '../../components/FormEmpresa'
import TableEmpresas from '../../components/TableEmpresas'
import { supabase, Empresa } from '../../lib/supabase'

export default function EmpresasPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editando, setEditando] = useState<Empresa | null>(null)
  const [busca, setBusca] = useState('')

  useEffect(() => {
    carregar()
  }, [])

  async function carregar() {
    setLoading(true)
    const { data } = await supabase
      .from('empresas')
      .select('*')
      .order('razao_social')
    setEmpresas(data ?? [])
    setLoading(false)
  }

  async function salvar(data: Omit<Empresa, 'id'>) {
    if (editando) {
      await supabase.from('empresas').update(data).eq('id', editando.id)
    } else {
      await supabase.from('empresas').insert(data)
    }
    await carregar()
    fecharForm()
  }

  async function excluir(id: number) {
    await supabase.from('empresas').delete().eq('id', id)
    await carregar()
  }

  function editar(empresa: Empresa) {
    setEditando(empresa)
    setShowForm(true)
  }

  function novaEmpresa() {
    setEditando(null)
    setShowForm(true)
  }

  function fecharForm() {
    setShowForm(false)
    setEditando(null)
  }

  const empresasFiltradas = empresas.filter(
    (e) =>
      e.razao_social.toLowerCase().includes(busca.toLowerCase()) ||
      e.cnpj.includes(busca)
  )

  return (
    <LayoutAdmin
      title="Empresas"
      actions={
        <button onClick={novaEmpresa} className="btn-primary flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nova Empresa
        </button>
      }
    >
      <div className="space-y-6">
        {/* Modal de formulário */}
        {showForm && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
              <h2 className="text-lg font-bold text-gray-800 mb-5">
                {editando ? 'Editar Empresa' : 'Nova Empresa'}
              </h2>
              <FormEmpresa empresa={editando} onSave={salvar} onCancel={fecharForm} />
            </div>
          </div>
        )}

        {/* Busca */}
        <div className="card">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Buscar por razão social ou CNPJ..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="flex-1 border-0 outline-none text-sm text-gray-700 placeholder-gray-400 bg-transparent"
            />
            {busca && (
              <button onClick={() => setBusca('')} className="text-gray-400 hover:text-gray-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Tabela */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-600">
              {loading ? 'Carregando...' : `${empresasFiltradas.length} empresa(s) encontrada(s)`}
            </h2>
          </div>

          {loading ? (
            <div className="text-center py-12 text-gray-400 text-sm">Carregando empresas...</div>
          ) : (
            <TableEmpresas empresas={empresasFiltradas} onEdit={editar} onDelete={excluir} />
          )}
        </div>
      </div>
    </LayoutAdmin>
  )
}

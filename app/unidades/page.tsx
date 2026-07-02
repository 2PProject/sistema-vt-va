'use client'

import { useEffect, useState } from 'react'
import LayoutAdmin from '../../components/LayoutAdmin'
import FormUnidade from '../../components/FormUnidade'
import TableUnidades from '../../components/TableUnidades'
import { supabase, Unidade, Empresa } from '../../lib/supabase'

export default function UnidadesPage() {
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editando, setEditando] = useState<Unidade | null>(null)
  const [filtroEmpresa, setFiltroEmpresa] = useState<string>('')
  const [busca, setBusca] = useState('')

  useEffect(() => {
    Promise.all([carregar(), carregarEmpresas()])
  }, [])

  async function carregar() {
    setLoading(true)
    const { data } = await supabase
      .from('unidades')
      .select('*, empresas(id, razao_social, cnpj)')
      .order('nome')
    setUnidades((data as Unidade[]) ?? [])
    setLoading(false)
  }

  async function carregarEmpresas() {
    const { data } = await supabase.from('empresas').select('*').order('razao_social')
    setEmpresas(data ?? [])
  }

  async function salvar(data: Omit<Unidade, 'id' | 'empresas'>) {
    if (editando) {
      await supabase.from('unidades').update(data).eq('id', editando.id)
    } else {
      await supabase.from('unidades').insert(data)
    }
    await carregar()
    fecharForm()
  }

  async function excluir(id: string) {
    await supabase.from('unidades').delete().eq('id', id)
    await carregar()
  }

  function editar(unidade: Unidade) {
    setEditando(unidade)
    setShowForm(true)
  }

  function novaUnidade() {
    setEditando(null)
    setShowForm(true)
  }

  function fecharForm() {
    setShowForm(false)
    setEditando(null)
  }

  const unidadesFiltradas = unidades.filter((u) => {
    const matchEmpresa = filtroEmpresa ? u.empresa_id === filtroEmpresa : true
    const matchBusca =
      u.nome.toLowerCase().includes(busca.toLowerCase()) ||
      u.codigo.toLowerCase().includes(busca.toLowerCase())
    return matchEmpresa && matchBusca
  })

  return (
    <LayoutAdmin
      title="Unidades"
      actions={
        <button onClick={novaUnidade} className="btn-primary flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nova Unidade
        </button>
      }
    >
      <div className="space-y-6">
        {/* Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
              <h2 className="text-lg font-bold text-gray-800 mb-5">
                {editando ? 'Editar Unidade' : 'Nova Unidade'}
              </h2>
              <FormUnidade
                unidade={editando}
                empresas={empresas}
                onSave={salvar}
                onCancel={fecharForm}
              />
            </div>
          </div>
        )}

        {/* Filtros */}
        <div className="card">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex items-center gap-3 flex-1">
              <svg className="w-5 h-5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Buscar por nome ou código..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="flex-1 border-0 outline-none text-sm text-gray-700 placeholder-gray-400 bg-transparent"
              />
            </div>
            <select
              value={filtroEmpresa}
              onChange={(e) => setFiltroEmpresa(e.target.value)}
              className="input-field sm:w-64"
            >
              <option value="">Todas as empresas</option>
              {empresas.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.razao_social}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Tabela */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-600">
              {loading ? 'Carregando...' : `${unidadesFiltradas.length} unidade(s) encontrada(s)`}
            </h2>
          </div>
          {loading ? (
            <div className="text-center py-12 text-gray-400 text-sm">Carregando unidades...</div>
          ) : (
            <TableUnidades unidades={unidadesFiltradas} onEdit={editar} onDelete={excluir} />
          )}
        </div>
      </div>
    </LayoutAdmin>
  )
}

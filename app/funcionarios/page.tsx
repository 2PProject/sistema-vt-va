'use client'

import { useEffect, useState } from 'react'
import LayoutAdmin from '../../components/LayoutAdmin'
import FormFuncionario from '../../components/FormFuncionario'
import TableFuncionarios from '../../components/TableFuncionarios'
import { supabase, Funcionario, Unidade } from '../../lib/supabase'

export default function FuncionariosPage() {
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([])
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editando, setEditando] = useState<Funcionario | null>(null)
  const [busca, setBusca] = useState('')
  const [filtroUnidade, setFiltroUnidade] = useState<number | ''>('')
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'ativo' | 'inativo'>('todos')

  useEffect(() => {
    Promise.all([carregar(), carregarUnidades()])
  }, [])

  async function carregar() {
    setLoading(true)
    const { data } = await supabase
      .from('funcionarios')
      .select('*, unidades(id, codigo, nome, empresa_id)')
      .order('nome')
    setFuncionarios((data as Funcionario[]) ?? [])
    setLoading(false)
  }

  async function carregarUnidades() {
    const { data } = await supabase.from('unidades').select('*').order('nome')
    setUnidades(data ?? [])
  }

  async function salvar(data: Omit<Funcionario, 'id' | 'unidades'>) {
    if (editando) {
      await supabase.from('funcionarios').update(data).eq('id', editando.id)
    } else {
      await supabase.from('funcionarios').insert(data)
    }
    await carregar()
    fecharForm()
  }

  async function excluir(id: number) {
    await supabase.from('funcionarios').delete().eq('id', id)
    await carregar()
  }

  function editar(funcionario: Funcionario) {
    setEditando(funcionario)
    setShowForm(true)
  }

  function novoFuncionario() {
    setEditando(null)
    setShowForm(true)
  }

  function fecharForm() {
    setShowForm(false)
    setEditando(null)
  }

  const funcionariosFiltrados = funcionarios.filter((f) => {
    const matchBusca =
      f.nome.toLowerCase().includes(busca.toLowerCase()) ||
      f.funcao.toLowerCase().includes(busca.toLowerCase()) ||
      f.ctps.includes(busca)
    const matchUnidade = filtroUnidade ? f.unidade_id === Number(filtroUnidade) : true
    const matchStatus =
      filtroStatus === 'todos' ? true : filtroStatus === 'ativo' ? f.ativo : !f.ativo
    return matchBusca && matchUnidade && matchStatus
  })

  return (
    <LayoutAdmin
      title="Funcionários"
      actions={
        <button onClick={novoFuncionario} className="btn-primary flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Novo Funcionário
        </button>
      }
    >
      <div className="space-y-6">
        {/* Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
              <h2 className="text-lg font-bold text-gray-800 mb-5">
                {editando ? 'Editar Funcionário' : 'Novo Funcionário'}
              </h2>
              <FormFuncionario
                funcionario={editando}
                unidades={unidades}
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
                placeholder="Buscar por nome, função ou CTPS..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="flex-1 border-0 outline-none text-sm text-gray-700 placeholder-gray-400 bg-transparent"
              />
            </div>
            <select
              value={filtroUnidade}
              onChange={(e) => setFiltroUnidade(e.target.value ? Number(e.target.value) : '')}
              className="input-field sm:w-52"
            >
              <option value="">Todas as unidades</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  [{u.codigo}] {u.nome}
                </option>
              ))}
            </select>
            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value as 'todos' | 'ativo' | 'inativo')}
              className="input-field sm:w-36"
            >
              <option value="todos">Todos</option>
              <option value="ativo">Ativos</option>
              <option value="inativo">Inativos</option>
            </select>
          </div>
        </div>

        {/* Tabela */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-600">
              {loading ? 'Carregando...' : `${funcionariosFiltrados.length} funcionário(s) encontrado(s)`}
            </h2>
          </div>
          {loading ? (
            <div className="text-center py-12 text-gray-400 text-sm">Carregando funcionários...</div>
          ) : (
            <TableFuncionarios
              funcionarios={funcionariosFiltrados}
              onEdit={editar}
              onDelete={excluir}
            />
          )}
        </div>
      </div>
    </LayoutAdmin>
  )
}

'use client'

import { Funcionario } from '../lib/supabase'

interface TableFuncionariosProps {
  funcionarios: Funcionario[]
  onEdit: (funcionario: Funcionario) => void
  onDelete: (id: string) => void
}

export default function TableFuncionarios({
  funcionarios,
  onEdit,
  onDelete,
}: TableFuncionariosProps) {
  if (funcionarios.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <p className="text-sm">Nenhum funcionário cadastrado.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="table-header">Nome</th>
            <th className="table-header">CTPS / Série</th>
            <th className="table-header">Cargo / Função</th>
            <th className="table-header">Empresa</th>
            <th className="table-header">Folga</th>
            <th className="table-header">Status</th>
            <th className="table-header text-right">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {funcionarios.map((f) => (
            <tr key={f.id} className="hover:bg-gray-50 transition-colors">
              <td className="table-cell font-medium text-gray-900">{f.nome}</td>
              <td className="table-cell text-gray-500 font-mono text-xs">
                {f.ctps} / {f.serie}
              </td>
              <td className="table-cell text-gray-600 text-sm">{f.funcao}</td>
              <td className="table-cell text-gray-500 text-sm">
                {f.unidades?.empresas?.razao_social ?? '—'}
              </td>
              <td className="table-cell text-gray-500 text-sm">{f.folga_semanal}</td>
              <td className="table-cell">
                {f.ativo ? (
                  <span className="badge-green">Ativo</span>
                ) : (
                  <span className="badge-red">Inativo</span>
                )}
              </td>
              <td className="table-cell text-right">
                <button
                  onClick={() => onEdit(f)}
                  className="text-blue-600 hover:text-blue-800 text-sm font-medium mr-4 transition-colors"
                >
                  Editar
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Excluir funcionário "${f.nome}"?`)) onDelete(f.id)
                  }}
                  className="text-red-500 hover:text-red-700 text-sm font-medium transition-colors"
                >
                  Excluir
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

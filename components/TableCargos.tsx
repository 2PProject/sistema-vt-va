'use client'

import { Cargo } from '../lib/supabase'

interface TableCargosProps {
  cargos: Cargo[]
  onEdit: (cargo: Cargo) => void
  onDelete: (id: string) => void
}

export default function TableCargos({ cargos, onEdit, onDelete }: TableCargosProps) {
  if (cargos.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        <p className="text-sm">Nenhum cargo cadastrado.</p>
        <p className="text-xs mt-1 text-gray-300">Cadastre os cargos para agilizar o registro de funcionários.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="table-header">#</th>
            <th className="table-header">Cargo / Função</th>
            <th className="table-header text-right">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {cargos.map((cargo, i) => (
            <tr key={cargo.id} className="hover:bg-gray-50 transition-colors">
              <td className="table-cell text-gray-400 w-12">{i + 1}</td>
              <td className="table-cell font-medium text-gray-800">{cargo.nome}</td>
              <td className="table-cell text-right">
                <button
                  onClick={() => onEdit(cargo)}
                  className="text-blue-600 hover:text-blue-800 text-sm font-medium mr-4 transition-colors"
                >
                  Editar
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Excluir o cargo "${cargo.nome}"?`)) onDelete(cargo.id)
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

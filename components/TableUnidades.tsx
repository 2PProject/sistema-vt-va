'use client'

import { Unidade } from '../lib/supabase'

interface TableUnidadesProps {
  unidades: Unidade[]
  onEdit: (unidade: Unidade) => void
  onDelete: (id: number) => void
}

export default function TableUnidades({ unidades, onEdit, onDelete }: TableUnidadesProps) {
  if (unidades.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
        </svg>
        <p className="text-sm">Nenhuma unidade cadastrada.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="table-header">Código</th>
            <th className="table-header">Nome</th>
            <th className="table-header">Empresa</th>
            <th className="table-header text-right">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {unidades.map((unidade) => (
            <tr key={unidade.id} className="hover:bg-gray-50 transition-colors">
              <td className="table-cell">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-blue-100 text-blue-800 font-mono">
                  {unidade.codigo}
                </span>
              </td>
              <td className="table-cell font-medium text-gray-900">{unidade.nome}</td>
              <td className="table-cell text-gray-500 text-sm">
                {unidade.empresas?.razao_social ?? `ID ${unidade.empresa_id}`}
              </td>
              <td className="table-cell text-right">
                <button
                  onClick={() => onEdit(unidade)}
                  className="text-blue-600 hover:text-blue-800 text-sm font-medium mr-4 transition-colors"
                >
                  Editar
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Excluir unidade "${unidade.nome}"?`)) onDelete(unidade.id)
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

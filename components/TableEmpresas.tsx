'use client'

import { Empresa } from '../lib/supabase'

interface TableEmpresasProps {
  empresas: Empresa[]
  onEdit: (empresa: Empresa) => void
  onDelete: (id: number) => void
}

export default function TableEmpresas({ empresas, onEdit, onDelete }: TableEmpresasProps) {
  if (empresas.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
        <p className="text-sm">Nenhuma empresa cadastrada.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="table-header">#</th>
            <th className="table-header">Razão Social</th>
            <th className="table-header">CNPJ</th>
            <th className="table-header text-right">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {empresas.map((empresa, i) => (
            <tr key={empresa.id} className="hover:bg-gray-50 transition-colors">
              <td className="table-cell text-gray-400 w-12">{i + 1}</td>
              <td className="table-cell font-medium text-gray-900">{empresa.razao_social}</td>
              <td className="table-cell text-gray-500 font-mono text-xs">{empresa.cnpj}</td>
              <td className="table-cell text-right">
                <button
                  onClick={() => onEdit(empresa)}
                  className="text-blue-600 hover:text-blue-800 text-sm font-medium mr-4 transition-colors"
                >
                  Editar
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Excluir "${empresa.razao_social}"?`)) onDelete(empresa.id)
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

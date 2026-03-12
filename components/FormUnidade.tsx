'use client'

import { useState, useEffect } from 'react'
import { Unidade, Empresa } from '../lib/supabase'

interface FormUnidadeProps {
  unidade?: Unidade | null
  empresas: Empresa[]
  onSave: (data: Omit<Unidade, 'id' | 'empresas'>) => Promise<void>
  onCancel: () => void
}

export default function FormUnidade({ unidade, empresas, onSave, onCancel }: FormUnidadeProps) {
  const [empresaId, setEmpresaId] = useState<string>('')
  const [codigo, setCodigo] = useState('')
  const [nome, setNome] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (unidade) {
      setEmpresaId(unidade.empresa_id)
      setCodigo(unidade.codigo)
      setNome(unidade.nome)
    } else {
      setEmpresaId('')
      setCodigo('')
      setNome('')
    }
  }, [unidade])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!empresaId) return
    setError('')
    setLoading(true)
    try {
      await onSave({ empresa_id: empresaId, codigo, nome })
    } catch (err) {
      setError('Erro ao salvar. Tente novamente.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div>
        <label className="label-field">Empresa</label>
        <select
          value={empresaId}
          onChange={(e) => setEmpresaId(e.target.value)}
          required
          className="input-field"
        >
          <option value="">Selecione a empresa</option>
          {empresas.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.razao_social}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label-field">Código</label>
        <input
          type="text"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          required
          className="input-field"
          placeholder="Ex: UN001"
        />
      </div>

      <div>
        <label className="label-field">Nome da Unidade</label>
        <input
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          required
          className="input-field"
          placeholder="Ex: Matriz São Paulo"
        />
      </div>

      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={loading} className="btn-primary flex-1">
          {loading ? 'Salvando...' : unidade ? 'Atualizar' : 'Cadastrar'}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary flex-1">
          Cancelar
        </button>
      </div>
    </form>
  )
}

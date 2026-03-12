'use client'

import { useState, useEffect } from 'react'
import { Cargo } from '../lib/supabase'

interface FormCargoProps {
  cargo?: Cargo | null
  onSave: (data: Omit<Cargo, 'id'>) => Promise<void>
  onCancel: () => void
}

export default function FormCargo({ cargo, onSave, onCancel }: FormCargoProps) {
  const [nome, setNome] = useState('')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    setNome(cargo?.nome ?? '')
  }, [cargo])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setLoading(true)
    try {
      await onSave({ nome: nome.trim() })
    } catch {
      setErro('Erro ao salvar cargo. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {erro && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {erro}
        </div>
      )}

      <div>
        <label className="label-field">Nome do Cargo / Função</label>
        <input
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          required
          className="input-field"
          placeholder="Ex: Auxiliar de Limpeza, Porteiro, Vigilante..."
          autoFocus
        />
      </div>

      <div className="flex gap-3 pt-1">
        <button type="submit" disabled={loading} className="btn-primary flex-1">
          {loading ? 'Salvando...' : cargo ? 'Atualizar' : 'Cadastrar'}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary flex-1">
          Cancelar
        </button>
      </div>
    </form>
  )
}

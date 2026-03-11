'use client'

import { useState, useEffect } from 'react'
import { Funcionario, Unidade } from '../lib/supabase'
import { FOLGAS } from '../utils/calculoVT'

interface FormFuncionarioProps {
  funcionario?: Funcionario | null
  unidades: Unidade[]
  onSave: (data: Omit<Funcionario, 'id' | 'unidades'>) => Promise<void>
  onCancel: () => void
}

export default function FormFuncionario({
  funcionario,
  unidades,
  onSave,
  onCancel,
}: FormFuncionarioProps) {
  const [nome, setNome] = useState('')
  const [ctps, setCtps] = useState('')
  const [serie, setSerie] = useState('')
  const [funcao, setFuncao] = useState('')
  const [folgaSemanal, setFolgaSemanal] = useState('Domingo')
  const [unidadeId, setUnidadeId] = useState<number | ''>('')
  const [ativo, setAtivo] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (funcionario) {
      setNome(funcionario.nome)
      setCtps(funcionario.ctps)
      setSerie(funcionario.serie)
      setFuncao(funcionario.funcao)
      setFolgaSemanal(funcionario.folga_semanal)
      setUnidadeId(funcionario.unidade_id)
      setAtivo(funcionario.ativo)
    } else {
      setNome('')
      setCtps('')
      setSerie('')
      setFuncao('')
      setFolgaSemanal('Domingo')
      setUnidadeId('')
      setAtivo(true)
    }
  }, [funcionario])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!unidadeId) return
    setError('')
    setLoading(true)
    try {
      await onSave({
        nome,
        ctps,
        serie,
        funcao,
        folga_semanal: folgaSemanal,
        unidade_id: Number(unidadeId),
        ativo,
      })
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

      <div className="grid grid-cols-1 gap-4">
        <div>
          <label className="label-field">Nome Completo</label>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            className="input-field"
            placeholder="Nome do funcionário"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label-field">CTPS</label>
            <input
              type="text"
              value={ctps}
              onChange={(e) => setCtps(e.target.value)}
              required
              className="input-field"
              placeholder="Número CTPS"
            />
          </div>
          <div>
            <label className="label-field">Série</label>
            <input
              type="text"
              value={serie}
              onChange={(e) => setSerie(e.target.value)}
              required
              className="input-field"
              placeholder="Série CTPS"
            />
          </div>
        </div>

        <div>
          <label className="label-field">Função / Cargo</label>
          <input
            type="text"
            value={funcao}
            onChange={(e) => setFuncao(e.target.value)}
            required
            className="input-field"
            placeholder="Ex: Auxiliar de Limpeza"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label-field">Folga Semanal</label>
            <select
              value={folgaSemanal}
              onChange={(e) => setFolgaSemanal(e.target.value)}
              className="input-field"
            >
              {FOLGAS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label-field">Unidade</label>
            <select
              value={unidadeId}
              onChange={(e) => setUnidadeId(Number(e.target.value))}
              required
              className="input-field"
            >
              <option value="">Selecione</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  [{u.codigo}] {u.nome}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="ativo"
            checked={ativo}
            onChange={(e) => setAtivo(e.target.checked)}
            className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
          />
          <label htmlFor="ativo" className="text-sm font-medium text-gray-700">
            Funcionário ativo
          </label>
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={loading} className="btn-primary flex-1">
          {loading ? 'Salvando...' : funcionario ? 'Atualizar' : 'Cadastrar'}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary flex-1">
          Cancelar
        </button>
      </div>
    </form>
  )
}

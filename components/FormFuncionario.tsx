'use client'

import { useState, useEffect } from 'react'
import { Funcionario, Empresa, Cargo } from '../lib/supabase'
import { FOLGAS } from '../utils/calculoVT'

interface FormFuncionarioProps {
  funcionario?: Funcionario | null
  empresas: Empresa[]
  cargos: Cargo[]
  /** empresa_id do funcionário editado (resolvida via unidades) */
  empresaIdInicial?: string
  onSave: (data: Omit<Funcionario, 'id' | 'unidades'>, empresaId: string) => Promise<void>
  onCancel: () => void
}

export default function FormFuncionario({
  funcionario,
  empresas,
  cargos,
  empresaIdInicial,
  onSave,
  onCancel,
}: FormFuncionarioProps) {
  const [nome, setNome] = useState('')
  const [ctps, setCtps] = useState('')
  const [serie, setSerie] = useState('')
  const [funcao, setFuncao] = useState('')
  const [folgaSemanal, setFolgaSemanal] = useState('Domingo')
  const [empresaId, setEmpresaId] = useState<string>('')
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
      setAtivo(funcionario.ativo)
      setEmpresaId(empresaIdInicial ?? '')
    } else {
      setNome('')
      setCtps('')
      setSerie('')
      setFuncao('')
      setFolgaSemanal('Domingo')
      setEmpresaId('')
      setAtivo(true)
    }
  }, [funcionario, empresaIdInicial])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!empresaId) {
      setError('Selecione uma empresa.')
      return
    }
    setError('')
    setLoading(true)
    try {
      // unidade_id será resolvida pelo onSave (via getOrCreateDefaultUnidade)
      await onSave(
        {
          nome,
          ctps,
          serie,
          funcao,
          folga_semanal: folgaSemanal,
          unidade_id: '', // será preenchido no handler da página
          ativo,
        },
        empresaId
      )
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
        {/* Nome */}
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

        {/* CTPS / Série */}
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

        {/* Cargo — select com cargos pré-cadastrados + opção livre */}
        <div>
          <label className="label-field">Cargo / Função</label>
          {cargos.length > 0 ? (
            <select
              value={funcao}
              onChange={(e) => setFuncao(e.target.value)}
              required
              className="input-field"
            >
              <option value="">Selecione um cargo</option>
              {cargos.map((c) => (
                <option key={c.id} value={c.nome}>
                  {c.nome}
                </option>
              ))}
              <option value="__outro__">Outro (digitar)</option>
            </select>
          ) : (
            <input
              type="text"
              value={funcao}
              onChange={(e) => setFuncao(e.target.value)}
              required
              className="input-field"
              placeholder="Ex: Auxiliar de Limpeza"
            />
          )}
          {/* Campo livre quando seleciona "Outro" */}
          {funcao === '__outro__' && (
            <input
              type="text"
              onChange={(e) => setFuncao(e.target.value)}
              required
              className="input-field mt-2"
              placeholder="Digite o cargo"
              autoFocus
            />
          )}
        </div>

        {/* Empresa + Folga */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label-field">Empresa</label>
            <select
              value={empresaId}
              onChange={(e) => setEmpresaId(e.target.value)}
              required
              className="input-field"
            >
              <option value="">Selecione</option>
              {empresas.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.razao_social}
                </option>
              ))}
            </select>
          </div>

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
        </div>

        {/* Ativo */}
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

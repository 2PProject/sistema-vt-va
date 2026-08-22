'use client'

import { useState, useEffect } from 'react'
import { Empresa } from '../lib/supabase'
import CampoMoeda from './CampoMoeda'

interface FormEmpresaProps {
  empresa?: Empresa | null
  onSave: (data: Omit<Empresa, 'id'>) => Promise<void>
  onCancel: () => void
}

export default function FormEmpresa({ empresa, onSave, onCancel }: FormEmpresaProps) {
  const [razaoSocial, setRazaoSocial] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [apelido, setApelido] = useState('')
  const [inscricaoMunicipal, setInscricaoMunicipal] = useState('')
  const [valorVA, setValorVA] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (empresa) {
      setRazaoSocial(empresa.razao_social)
      setCnpj(empresa.cnpj)
      setApelido(empresa.apelido ?? '')
      setInscricaoMunicipal(empresa.inscricao_municipal ?? '')
      setValorVA(empresa.valor_va ?? 0)
    } else {
      setRazaoSocial('')
      setCnpj('')
      setApelido('')
      setInscricaoMunicipal('')
      setValorVA(0)
    }
  }, [empresa])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await onSave({ razao_social: razaoSocial, cnpj, valor_va: valorVA, apelido: apelido.trim() || null, inscricao_municipal: inscricaoMunicipal.replace(/\D/g, '') || null })
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
        <label className="label-field">Razão Social</label>
        <input
          type="text"
          value={razaoSocial}
          onChange={(e) => setRazaoSocial(e.target.value)}
          required
          className="input-field"
          placeholder="Nome completo da empresa"
        />
      </div>

      <div>
        <label className="label-field">CNPJ</label>
        <input
          type="text"
          value={cnpj}
          onChange={(e) => setCnpj(e.target.value)}
          required
          className="input-field"
          placeholder="00.000.000/0000-00"
          maxLength={18}
        />
      </div>

      <div>
        <label className="label-field">Inscrição municipal / CF-DF (opcional)</label>
        <input
          type="text"
          inputMode="numeric"
          value={inscricaoMunicipal}
          onChange={(e) => setInscricaoMunicipal(e.target.value.replace(/\D/g, ''))}
          className="input-field"
          placeholder="Ex.: 0816355100107"
        />
        <p className="mt-1 text-xs text-gray-500">Usada automaticamente nas consultas de notas recebidas do ISS-DF.</p>
      </div>

      <div>
        <label className="label-field">Apelido (opcional)</label>
        <input
          type="text"
          value={apelido}
          onChange={(e) => setApelido(e.target.value)}
          className="input-field"
          placeholder="Nome curto p/ casar a planilha de pagamentos"
        />
      </div>

      <div>
        <label className="label-field">Valor VA padrão / dia útil (R$)</label>
        <CampoMoeda value={valorVA} onChange={setValorVA} />
      </div>

      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={loading} className="btn-primary flex-1">
          {loading ? 'Salvando...' : empresa ? 'Atualizar' : 'Cadastrar'}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary flex-1">
          Cancelar
        </button>
      </div>
    </form>
  )
}

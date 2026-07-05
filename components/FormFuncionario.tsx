'use client'

import { useState, useEffect } from 'react'
import { Funcionario, Empresa, Cargo } from '../lib/supabase'
import { FOLGAS } from '../utils/calculoVT'
import CampoMoeda from './CampoMoeda'

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
  const [outroCargo, setOutroCargo] = useState(false)
  const [folgaSemanal, setFolgaSemanal] = useState('Domingo')
  const [empresaId, setEmpresaId] = useState<string>('')
  const [ativo, setAtivo] = useState(true)
  const [valorVT, setValorVT] = useState(0)
  const [valorVTSabado, setValorVTSabado] = useState(0)
  const [valorVA, setValorVA] = useState(0)
  const [pix, setPix] = useState('')
  const [dataAdmissao, setDataAdmissao] = useState('')
  const [emAvisoPrevio, setEmAvisoPrevio] = useState(false)
  const [dataInicioAviso, setDataInicioAviso] = useState('')
  const [dataFimAviso, setDataFimAviso] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (funcionario) {
      setNome(funcionario.nome)
      setCtps(funcionario.ctps)
      setSerie(funcionario.serie)
      setFuncao(funcionario.funcao)
      setOutroCargo(!!funcionario.funcao && !cargos.some((c) => c.nome === funcionario.funcao))
      setFolgaSemanal(funcionario.folga_semanal)
      setAtivo(funcionario.ativo)
      setValorVT(funcionario.valor_vt ?? 0)
      setValorVTSabado(funcionario.valor_vt_sabado ?? 0)
      setValorVA(funcionario.valor_va ?? 0)
      setPix(funcionario.pix ?? '')
      setDataAdmissao(funcionario.data_admissao ?? '')
      setEmAvisoPrevio(funcionario.em_aviso_previo ?? false)
      setDataInicioAviso(funcionario.data_inicio_aviso ?? '')
      setDataFimAviso(funcionario.data_fim_aviso ?? '')
      setEmpresaId(empresaIdInicial ?? '')
    } else {
      setNome('')
      setCtps('')
      setSerie('')
      setFuncao('')
      setOutroCargo(false)
      setFolgaSemanal('Domingo')
      setEmpresaId('')
      setAtivo(true)
      setValorVT(0)
      setValorVTSabado(0)
      setValorVA(0)
      setPix('')
      setDataAdmissao(new Date().toISOString().split('T')[0])
      setEmAvisoPrevio(false)
      setDataInicioAviso('')
      setDataFimAviso('')
    }
  }, [funcionario, empresaIdInicial])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!empresaId) {
      setError('Selecione uma empresa.')
      return
    }
    if (emAvisoPrevio && !dataFimAviso) {
      setError('Informe a data do último dia de trabalho no aviso prévio.')
      return
    }
    setError('')
    setLoading(true)
    try {
      await onSave(
        {
          nome,
          ctps,
          serie,
          funcao,
          folga_semanal: folgaSemanal,
          unidade_id: '',
          ativo,
          valor_vt: valorVT,
          valor_vt_sabado: valorVTSabado,
          valor_va: valorVA || 0,
          pix: pix.trim() || null,
          data_admissao: dataAdmissao || null,
          em_aviso_previo: emAvisoPrevio,
          data_inicio_aviso: emAvisoPrevio ? (dataInicioAviso || null) : null,
          data_fim_aviso: emAvisoPrevio ? (dataFimAviso || null) : null,
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
    <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
      <div className="overflow-y-auto px-6 pb-4 space-y-4 flex-1 min-h-0">
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
              value={outroCargo ? '__outro__' : funcao}
              onChange={(e) => {
                if (e.target.value === '__outro__') { setOutroCargo(true); setFuncao('') }
                else { setOutroCargo(false); setFuncao(e.target.value) }
              }}
              required={!outroCargo}
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
          {outroCargo && (
            <input
              type="text"
              value={funcao}
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

        {/* Valores VT */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label-field">Valor VT / dia útil (R$)</label>
            <CampoMoeda value={valorVT} onChange={setValorVT} />
          </div>
          <div>
            <label className="label-field">Valor VT / Sábado (R$)</label>
            <CampoMoeda value={valorVTSabado} onChange={setValorVTSabado} />
          </div>
        </div>

        {/* Valor VA — exceção por funcionário */}
        <div>
          <label className="label-field">Valor VA / dia (R$) — exceção</label>
          <CampoMoeda value={valorVA} onChange={setValorVA} />
          <p className="text-xs text-gray-400 mt-1">
            Opcional. Deixe <strong>0</strong> para usar o VA da empresa/competência.
            Informe um valor apenas em caso de exceção para este funcionário.
          </p>
        </div>

        {/* Chave Pix */}
        <div>
          <label className="label-field">Chave Pix</label>
          <input
            type="text"
            value={pix}
            onChange={(e) => setPix(e.target.value)}
            className="input-field"
            placeholder="E-mail, CPF, telefone ou chave aleatória"
          />
          <p className="text-xs text-gray-400 mt-1">
            Usada para gerar o arquivo CSV de pagamento do banco. Sem formatação — cole a chave como está.
          </p>
        </div>

        {/* Data de admissão */}
        <div>
          <label className="label-field">Data de Admissão</label>
          <input
            type="date"
            value={dataAdmissao}
            onChange={(e) => setDataAdmissao(e.target.value)}
            className="input-field"
          />
          <p className="text-xs text-gray-400 mt-1">
            Usada para calcular dias proporcionais no mês de contratação.
          </p>
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

        {/* Aviso Prévio */}
        <div className="border border-amber-200 bg-amber-50 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="emAvisoPrevio"
              checked={emAvisoPrevio}
              onChange={(e) => {
                setEmAvisoPrevio(e.target.checked)
                if (!e.target.checked) { setDataInicioAviso(''); setDataFimAviso('') }
              }}
              className="w-4 h-4 text-amber-600 rounded border-amber-300 focus:ring-amber-500"
            />
            <label htmlFor="emAvisoPrevio" className="text-sm font-medium text-amber-800">
              Em aviso prévio
            </label>
          </div>
          {emAvisoPrevio && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label-field">Início do aviso</label>
                <input
                  type="date"
                  value={dataInicioAviso}
                  onChange={(e) => setDataInicioAviso(e.target.value)}
                  className="input-field"
                />
              </div>
              <div>
                <label className="label-field">Último dia de trabalho <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  value={dataFimAviso}
                  onChange={(e) => setDataFimAviso(e.target.value)}
                  required={emAvisoPrevio}
                  className="input-field"
                />
              </div>
            </div>
          )}
          {emAvisoPrevio && (
            <p className="text-xs text-amber-700">
              VT/VA calculado proporcionalmente até o último dia de trabalho.
            </p>
          )}
        </div>
      </div>
      </div>

      <div className="flex gap-3 px-6 py-4 border-t border-gray-100 shrink-0 bg-white">
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

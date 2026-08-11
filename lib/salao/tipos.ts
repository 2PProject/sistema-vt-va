import type { StatusComissao } from './config'

export type Profissional = {
  id: string
  empresa_id: string
  nome: string
  documento: string
  ativo: boolean
  criado_em?: string
  empresaNome?: string
}

export type Comissao = {
  id: string
  empresa_id: string
  profissional_id: string
  mes_ref: string
  valor_comissao: number
  status: StatusComissao
  nf_numero: string | null
  nf_data: string | null
  nf_valor: number | null
  nf_origem: string | null
  confirmado_em: string | null
  criado_em?: string
  // joins
  profissionalNome?: string
  profissionalDoc?: string
  empresaNome?: string
}

export type CertificadoInfo = {
  empresa_id: string
  empresaNome: string
  prazo_dia: number
  cert_nome: string | null
  cert_cnpj: string | null
  cert_validade: string | null
  temCertificado: boolean
}

export type ResumoMes = {
  totalProfissionais: number
  recebidas: number
  percentualRecebidas: number
  pendentes: number
  valorPendente: number
  foraPrazo: number
}

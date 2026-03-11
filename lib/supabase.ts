import { createClient } from '@supabase/supabase-js'

export type Empresa = {
  id: number
  razao_social: string
  cnpj: string
}

export type Unidade = {
  id: number
  empresa_id: number
  codigo: string
  nome: string
  empresas?: Empresa
}

export type Funcionario = {
  id: number
  nome: string
  ctps: string
  serie: string
  funcao: string
  folga_semanal: string
  unidade_id: number
  ativo: boolean
  unidades?: Unidade
}

export type Competencia = {
  id: number
  unidade_id: number
  mes: number
  ano: number
  dias_uteis: number
  unidades?: Unidade
}

export type CompetenciaFuncionario = {
  id: number
  competencia_id: number
  funcionario_id: number
  dias_feriado: number
  dias_sabado: number
  dias_desconto: number
  valor_vt: number
  valor_vt_sabado: number
  valor_va: number
  valor_total: number
  competencias?: Competencia
  funcionarios?: Funcionario
}

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export type ParamsCalculo = {
  diasUteis: number
  diasFeriado: number
  diasSabado: number
  diasDesconto: number
  valorVT: number
  valorVTSabado: number
  valorVA: number
}

export type ResultadoCalculo = {
  diasEfetivos: number
  totalVA: number
  totalVT: number
  totalVTSabado: number
  valorTotal: number
}

export function calcularVTVA(params: ParamsCalculo): ResultadoCalculo {
  const {
    diasUteis,
    diasFeriado,
    diasSabado,
    diasDesconto,
    valorVT,
    valorVTSabado,
    valorVA,
  } = params

  // Dias efetivos = dias úteis - feriados - descontos (faltas)
  const diasEfetivos = Math.max(0, diasUteis - diasFeriado - diasDesconto)

  // VA = dias efetivos × valor diário VA
  const totalVA = diasEfetivos * valorVA

  // VT = dias efetivos × valor diário VT
  const totalVT = diasEfetivos * valorVT

  // VT sábado = dias sábado × valor VT sábado
  const totalVTSabado = diasSabado * valorVTSabado

  const valorTotal = totalVA + totalVT + totalVTSabado

  return {
    diasEfetivos,
    totalVA,
    totalVT,
    totalVTSabado,
    valorTotal,
  }
}

export function formatarMoeda(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

export function formatarCNPJ(cnpj: string): string {
  const digits = cnpj.replace(/\D/g, '')
  return digits.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    '$1.$2.$3/$4-$5'
  )
}

export const MESES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]

export const FOLGAS = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
]

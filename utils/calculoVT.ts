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

/** Mapeia nome do dia de folga para getDay() index (0=Dom … 6=Sáb) */
export const FOLGA_TO_DOW: Record<string, number> = {
  'Domingo': 0,
  'Segunda-feira': 1,
  'Terça-feira': 2,
  'Quarta-feira': 3,
  'Quinta-feira': 4,
  'Sexta-feira': 5,
  'Sábado': 6,
}

/** Conta quantas vezes cada dia da semana ocorre em um mês (0=Dom…6=Sáb) */
export function contarDiasSemana(mes: number, ano: number): Record<number, number> {
  const counts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }
  const daysInMonth = new Date(ano, mes, 0).getDate() // mes é 1-based
  for (let d = 1; d <= daysInMonth; d++) {
    counts[new Date(ano, mes - 1, d).getDay()]++
  }
  return counts
}

/**
 * Calcula os dias úteis efetivos de um funcionário para o mês,
 * descontando: domingos (já excluídos), folga semanal e feriados.
 * Descontos individuais (faltas) são aplicados depois, na soma final.
 */
export function calcularDiasUteisAuto(
  mes: number,
  ano: number,
  folgaSemanal: string | null | undefined,
  feriadosDoMes: number
): number {
  const counts = contarDiasSemana(mes, ano)
  // Total de dias úteis (seg–sex).
  // Sábado é tratado separadamente na regra de VT sábado para não somar em duplicidade.
  let total = counts[1] + counts[2] + counts[3] + counts[4] + counts[5]
  // Subtrai as folgas da semana se cair em dia útil (seg–sex)
  const dow = folgaSemanal ? (FOLGA_TO_DOW[folgaSemanal] ?? -1) : -1
  if (dow >= 1 && dow <= 5) total -= counts[dow]
  // Subtrai feriados compartilhados
  total -= feriadosDoMes
  return Math.max(0, total)
}

/** Retorna quantos sábados existem no mês */
export function calcularSabadosDoMes(mes: number, ano: number): number {
  return contarDiasSemana(mes, ano)[6]
}

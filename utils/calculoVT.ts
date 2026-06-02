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

  // VA = dias efetivos × valor diário VA (inclui sábados trabalhados)
  const totalVA = diasEfetivos * valorVA

  // VT dias úteis = (dias efetivos - sábados) × valor VT
  // Sábados são tratados separadamente para evitar dupla contagem
  const diasUteisVT = Math.max(0, diasEfetivos - diasSabado)
  const totalVT = diasUteisVT * valorVT

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
 * Calcula os dias úteis efetivos de um funcionário para o mês.
 * Se dataAdmissao cair dentro do próprio mês, conta apenas a partir dela.
 * Desconta: domingos, folga semanal e feriados que caem em dias úteis.
 */
export function calcularDiasUteisAuto(
  mes: number,
  ano: number,
  folgaSemanal: string | null | undefined,
  feriadosDatas: string[],
  dataAdmissao?: string | null
): number {
  const dow = folgaSemanal ? (FOLGA_TO_DOW[folgaSemanal] ?? -1) : -1

  // Determina a data de início: admissão se for neste mês, senão dia 1
  const primeiroDia = new Date(ano, mes - 1, 1)
  primeiroDia.setHours(12, 0, 0, 0)
  let startDate = primeiroDia
  if (dataAdmissao) {
    const adm = new Date(dataAdmissao + 'T12:00:00')
    if (adm.getFullYear() === ano && adm.getMonth() + 1 === mes && adm > primeiroDia) {
      startDate = adm
    }
  }

  // Se começa no dia 1: uso o algoritmo eficiente por contagem de dias da semana
  if (startDate.getDate() === 1) {
    const counts = contarDiasSemana(mes, ano)
    let total = counts[1] + counts[2] + counts[3] + counts[4] + counts[5] + counts[6]
    if (dow >= 1 && dow <= 6) total -= counts[dow]
    for (const dateStr of feriadosDatas) {
      const d = new Date(dateStr + 'T12:00:00')
      const fd = d.getDay()
      if (fd === 0 || fd === dow) continue
      total -= 1
    }
    return Math.max(0, total)
  }

  // Contagem dia a dia a partir da admissão até o fim do mês
  const ultimoDia = new Date(ano, mes, 0)
  ultimoDia.setHours(12, 0, 0, 0)
  let total = 0
  const cur = new Date(startDate)
  while (cur <= ultimoDia) {
    const cd = cur.getDay()
    if (cd !== 0 && cd !== dow) total++
    cur.setDate(cur.getDate() + 1)
  }
  // Subtrai feriados a partir da data de admissão
  for (const dateStr of feriadosDatas) {
    const d = new Date(dateStr + 'T12:00:00')
    if (d < startDate) continue
    const fd = d.getDay()
    if (fd === 0 || fd === dow) continue
    total -= 1
  }
  return Math.max(0, total)
}

/** Retorna quantos sábados existem no mês */
export function calcularSabadosDoMes(mes: number, ano: number): number {
  return contarDiasSemana(mes, ano)[6]
}

/**
 * Retorna sábados no mês a partir da data de admissão (proporcional).
 * Se dataAdmissao não for neste mês, retorna o total do mês.
 */
export function calcularSabadosDesde(mes: number, ano: number, dataAdmissao?: string | null): number {
  if (!dataAdmissao) return calcularSabadosDoMes(mes, ano)
  const adm = new Date(dataAdmissao + 'T12:00:00')
  const primeiroDia = new Date(ano, mes - 1, 1)
  primeiroDia.setHours(12, 0, 0, 0)
  if (adm.getFullYear() !== ano || adm.getMonth() + 1 !== mes || adm <= primeiroDia) {
    return calcularSabadosDoMes(mes, ano)
  }
  const ultimoDia = new Date(ano, mes, 0)
  ultimoDia.setHours(12, 0, 0, 0)
  let count = 0
  const cur = new Date(adm)
  while (cur <= ultimoDia) {
    if (cur.getDay() === 6) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}


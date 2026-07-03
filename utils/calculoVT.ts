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

  // Sábados efetivamente trabalhados nunca podem exceder os dias efetivos.
  // Ex.: em férias, os sábados do período não são pagos — evita cobrar VT de
  // sábado quando a pessoa não trabalhou (bug: sábado diferenciado em férias).
  const diasSabadoEfetivo = Math.min(Math.max(0, diasSabado), diasEfetivos)

  // VT dias úteis = (dias efetivos - sábados) × valor VT
  // Sábados são tratados separadamente para evitar dupla contagem
  const diasUteisVT = Math.max(0, diasEfetivos - diasSabadoEfetivo)
  const totalVT = diasUteisVT * valorVT

  // VT sábado = dias sábado × valor VT sábado
  const totalVTSabado = diasSabadoEfetivo * valorVTSabado

  const valorTotal = totalVA + totalVT + totalVTSabado

  return {
    diasEfetivos,
    totalVA,
    totalVT,
    totalVTSabado,
    valorTotal,
  }
}

/**
 * Resolve o valor de VA a aplicar: se o funcionário tiver um VA de exceção
 * (> 0), ele prevalece; caso contrário usa o VA da empresa/competência.
 */
export function resolverValorVA(
  valorVAFuncionario?: number | null,
  valorVACompetencia?: number | null
): number {
  const f = valorVAFuncionario ?? 0
  if (f > 0) return f
  return valorVACompetencia ?? 0
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
 * Considera data_admissao (início proporcional) e data_fim_aviso (fim do aviso prévio).
 */
export function calcularDiasUteisAuto(
  mes: number,
  ano: number,
  folgaSemanal: string | null | undefined,
  feriadosDatas: string[],
  dataAdmissao?: string | null,
  dataFimAviso?: string | null
): number {
  const dow = folgaSemanal ? (FOLGA_TO_DOW[folgaSemanal] ?? -1) : -1

  const primeiroDia = new Date(ano, mes - 1, 1)
  primeiroDia.setHours(12, 0, 0, 0)
  const ultimoDiaMes = new Date(ano, mes, 0)
  ultimoDiaMes.setHours(12, 0, 0, 0)

  // Data de início: admissão neste mês → começa na data de admissão
  let startDate = primeiroDia
  if (dataAdmissao) {
    const adm = new Date(dataAdmissao + 'T12:00:00')
    if (adm.getFullYear() === ano && adm.getMonth() + 1 === mes && adm > primeiroDia) {
      startDate = adm
    }
  }

  // Data de fim: aviso prévio terminando neste mês → encerra na data_fim_aviso
  let endDate = ultimoDiaMes
  if (dataFimAviso) {
    const fim = new Date(dataFimAviso + 'T12:00:00')
    if (fim.getFullYear() === ano && fim.getMonth() + 1 === mes && fim < ultimoDiaMes) {
      endDate = fim
    }
  }

  // Caminho rápido: mês completo sem cortes
  if (startDate.getDate() === 1 && endDate.getTime() === ultimoDiaMes.getTime()) {
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

  // Contagem dia a dia
  let total = 0
  const cur = new Date(startDate)
  while (cur <= endDate) {
    const cd = cur.getDay()
    if (cd !== 0 && cd !== dow) total++
    cur.setDate(cur.getDate() + 1)
  }
  for (const dateStr of feriadosDatas) {
    const d = new Date(dateStr + 'T12:00:00')
    if (d < startDate || d > endDate) continue
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
 * Conta os sábados que caem dentro dos períodos de desconto (férias/faltas)
 * no mês/ano informado. Usado para não pagar VT de sábado quando o
 * profissional está afastado. Ignora descontos sem datas ou acréscimos.
 */
export function contarSabadosEmDescontos(
  descontos: { dias: number; data_inicio: string | null; data_fim: string | null }[],
  mes: number,
  ano: number
): number {
  let count = 0
  for (const d of descontos) {
    if ((d.dias ?? 0) <= 0 || !d.data_inicio) continue
    const start = new Date(d.data_inicio + 'T12:00:00')
    const end = new Date((d.data_fim || d.data_inicio) + 'T12:00:00')
    const cur = new Date(start)
    while (cur <= end) {
      if (cur.getFullYear() === ano && cur.getMonth() + 1 === mes && cur.getDay() === 6) count++
      cur.setDate(cur.getDate() + 1)
    }
  }
  return count
}

/**
 * Retorna sábados no mês respeitando data_admissao e data_fim_aviso.
 */
export function calcularSabadosDesde(mes: number, ano: number, dataAdmissao?: string | null, dataFimAviso?: string | null): number {
  const primeiroDia = new Date(ano, mes - 1, 1)
  primeiroDia.setHours(12, 0, 0, 0)
  const ultimoDiaMes = new Date(ano, mes, 0)
  ultimoDiaMes.setHours(12, 0, 0, 0)

  let startDate = primeiroDia
  if (dataAdmissao) {
    const adm = new Date(dataAdmissao + 'T12:00:00')
    if (adm.getFullYear() === ano && adm.getMonth() + 1 === mes && adm > primeiroDia) {
      startDate = adm
    }
  }

  let endDate = ultimoDiaMes
  if (dataFimAviso) {
    const fim = new Date(dataFimAviso + 'T12:00:00')
    if (fim.getFullYear() === ano && fim.getMonth() + 1 === mes && fim < ultimoDiaMes) {
      endDate = fim
    }
  }

  if (startDate.getDate() === 1 && endDate.getTime() === ultimoDiaMes.getTime()) {
    return calcularSabadosDoMes(mes, ano)
  }

  let count = 0
  const cur = new Date(startDate)
  while (cur <= endDate) {
    if (cur.getDay() === 6) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

/** Retorna true se o funcionário já estava admitido no mês/ano informado. */
export function admitidoNoMesOuAntes(dataAdmissao: string | null | undefined, mes: number, ano: number): boolean {
  if (!dataAdmissao) return true
  const [admAno, admMes] = dataAdmissao.split('-').map(Number)
  return admAno * 100 + admMes <= ano * 100 + mes
}

/**
 * Retorna true se o funcionário trabalhou no mês — admitido até o fim do mês
 * e aviso prévio (se houver) não terminou antes do início do mês.
 */
export function trabalhaNoMes(
  mes: number,
  ano: number,
  dataAdmissao: string | null | undefined,
  dataFimAviso: string | null | undefined
): boolean {
  if (!admitidoNoMesOuAntes(dataAdmissao, mes, ano)) return false
  if (dataFimAviso) {
    const [fimAno, fimMes] = dataFimAviso.split('-').map(Number)
    if (fimAno * 100 + fimMes < ano * 100 + mes) return false
  }
  return true
}


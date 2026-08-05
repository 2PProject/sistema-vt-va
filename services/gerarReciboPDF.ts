import { ResultadoCalculo, formatarMoeda, MESES } from '../utils/calculoVT'

export type DescontoRecibo = {
  tipo_nome: string
  dias: number
  data_inicio: string | null
  data_fim: string | null
}

export type DadosRecibo = {
  apelido?: string
  razaoSocial: string
  cnpj: string
  nomeFuncionario: string
  funcao: string
  ctps: string
  serie: string
  mes: number
  ano: number
  diasUteis: number
  diasEfetivos: number
  diasSabado: number
  valorVT: number
  valorVTSabado: number
  valorVA: number
  resultado: ResultadoCalculo
  dataAdmissao?: string | null   // 'YYYY-MM-DD' — recibo proporcional quando admissão é no mês
  dataFimAviso?: string | null   // 'YYYY-MM-DD' — último dia de trabalho em aviso prévio
  descontos?: DescontoRecibo[]
  acrescimos?: DescontoRecibo[]
}

/** Normaliza o apelido para uso em nome de arquivo. */
function slugEmp(s: string): string {
  return (s || '').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function desenharVia(doc: any, dados: DadosRecibo, mesNome: string, referencia: string, startY: number, via: string) {
  let y = startY

  doc.setFillColor(30, 64, 175)
  doc.rect(10, y, 190, 12, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('RECIBO DE VALE TRANSPORTE / VALE ALIMENTAÇÃO', 105, y + 8, { align: 'center' })
  y += 16

  doc.setTextColor(0, 0, 0)
  doc.setFontSize(9)

  doc.setFont('helvetica', 'bold')
  doc.text('EMPRESA:', 12, y)
  doc.setFont('helvetica', 'normal')
  doc.text(dados.razaoSocial, 35, y)
  y += 6

  doc.setFont('helvetica', 'bold')
  doc.text('CNPJ:', 12, y)
  doc.setFont('helvetica', 'normal')
  doc.text(dados.cnpj, 35, y)
  doc.setFont('helvetica', 'bold')
  doc.text('REFERÊNCIA:', 120, y)
  doc.setFont('helvetica', 'normal')
  doc.text(referencia, 148, y)
  y += 6

  doc.setDrawColor(220, 220, 220)
  doc.line(10, y, 200, y)
  y += 5

  doc.setFillColor(245, 247, 250)
  doc.rect(10, y - 3, 190, 10, 'F')
  doc.setFont('helvetica', 'bold')
  doc.text('FUNCIONÁRIO:', 12, y + 3)
  doc.setFont('helvetica', 'normal')
  doc.text(dados.nomeFuncionario, 45, y + 3)
  doc.setFont('helvetica', 'bold')
  doc.text('FUNÇÃO:', 130, y + 3)
  doc.setFont('helvetica', 'normal')
  doc.text(dados.funcao, 150, y + 3)
  y += 8

  doc.setFont('helvetica', 'bold')
  doc.text('CTPS Nº:', 12, y + 3)
  doc.setFont('helvetica', 'normal')
  doc.text(dados.ctps || '—', 35, y + 3)
  doc.setFont('helvetica', 'bold')
  doc.text('SÉRIE:', 80, y + 3)
  doc.setFont('helvetica', 'normal')
  doc.text(dados.serie || '—', 97, y + 3)
  y += 10

  doc.setFillColor(30, 64, 175)
  doc.rect(10, y - 4, 190, 8, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('DESCRIÇÃO', 12, y)
  doc.text('DIAS', 100, y)
  doc.text('VALOR UNIT.', 130, y)
  doc.text('TOTAL', 175, y)
  y += 7

  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')

  // Exceção = há valor de VT de sábado (consistente com o cálculo, que já
  // separa os sábados). Antes usava "!= valorVT" e, quando os valores eram
  // iguais, a linha de dias úteis ficava com contagem cheia e total parcial.
  const ehExcecaoPDF = dados.valorVTSabado > 0
  const diasVTUteis = ehExcecaoPDF
    ? Math.max(0, dados.diasEfetivos - dados.diasSabado)
    : dados.diasEfetivos

  const linhas = [
    ['Vale Alimentação (VA)', String(dados.diasEfetivos), formatarMoeda(dados.valorVA), formatarMoeda(dados.resultado.totalVA)],
    ['Vale Transporte - Dias Úteis', String(diasVTUteis), formatarMoeda(dados.valorVT), formatarMoeda(dados.resultado.totalVT)],
    ...(ehExcecaoPDF ? [['Vale Transporte - Sábados', String(dados.diasSabado), formatarMoeda(dados.valorVTSabado), formatarMoeda(dados.resultado.totalVTSabado)]] : []),
  ]

  linhas.forEach((linha, i) => {
    if (i % 2 === 0) {
      doc.setFillColor(249, 250, 251)
      doc.rect(10, y - 4, 190, 8, 'F')
    }
    doc.text(linha[0], 12, y)
    doc.text(linha[1], 100, y)
    doc.text(linha[2], 130, y)
    doc.text(linha[3], 175, y)
    y += 8
  })

  // Acréscimos (feriados trabalhados) — aparecem antes dos descontos
  if (dados.acrescimos && dados.acrescimos.length > 0) {
    y += 2
    doc.setFillColor(22, 163, 74)
    doc.rect(10, y - 4, 190, 8, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text('✦  FERIADOS TRABALHADOS  —  ACRÉSCIMOS', 12, y)
    y += 7

    doc.setFont('helvetica', 'normal')
    doc.setTextColor(0, 0, 0)
    dados.acrescimos.forEach((d, i) => {
      if (i % 2 === 0) {
        doc.setFillColor(220, 252, 231)
        doc.rect(10, y - 4, 190, 7, 'F')
      }
      doc.setFontSize(8)
      doc.setTextColor(5, 90, 50)
      doc.setFont('helvetica', 'bold')
      doc.text(d.tipo_nome, 12, y)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(0, 0, 0)
      doc.text(`+${d.dias} dia(s)`, 100, y)
      let dataStr = ''
      if (d.data_inicio) {
        const fmt = (s: string) => { const [a, m, dia] = s.split('-'); return `${dia}/${m}/${a}` }
        dataStr = (!d.data_fim || d.data_fim === d.data_inicio)
          ? fmt(d.data_inicio)
          : `${fmt(d.data_inicio)} a ${fmt(d.data_fim)}`
      }
      if (dataStr) doc.text(dataStr, 130, y)
      y += 7
    })
  }

  if (dados.descontos && dados.descontos.length > 0) {
    y += 2
    doc.setFillColor(254, 243, 199)
    doc.rect(10, y - 4, 190, 8, 'F')
    doc.setTextColor(120, 80, 0)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text('DESCONTOS', 12, y)
    y += 7

    doc.setFont('helvetica', 'normal')
    doc.setTextColor(0, 0, 0)
    dados.descontos.forEach((d, i) => {
      if (i % 2 === 0) {
        doc.setFillColor(255, 251, 235)
        doc.rect(10, y - 4, 190, 7, 'F')
      }
      doc.setFontSize(8)
      doc.text(d.tipo_nome, 12, y)
      doc.text(`${d.dias} dia(s)`, 100, y)
      let dataStr = ''
      if (d.data_inicio) {
        const fmt = (s: string) => { const [a, m, dia] = s.split('-'); return `${dia}/${m}/${a}` }
        dataStr = (!d.data_fim || d.data_fim === d.data_inicio)
          ? fmt(d.data_inicio)
          : `${fmt(d.data_inicio)} a ${fmt(d.data_fim)}`
      }
      if (dataStr) doc.text(dataStr, 130, y)
      y += 7
    })
  }

  y += 2
  doc.setFillColor(30, 64, 175)
  doc.rect(10, y - 4, 190, 9, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('VALOR TOTAL', 12, y + 1)
  doc.text(formatarMoeda(dados.resultado.valorTotal), 175, y + 1)
  y += 13

  doc.setTextColor(80, 80, 80)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  const totalAcrescimos = dados.acrescimos?.reduce((s, a) => s + a.dias, 0) ?? 0
  const partsRodape: string[] = [
    `Dias Úteis: ${dados.diasUteis}`,
    `Dias Efetivos: ${dados.diasEfetivos}`,
  ]
  if (dados.valorVTSabado > 0) partsRodape.push(`Sábados: ${dados.diasSabado}`)
  if (totalAcrescimos > 0) partsRodape.push(`Feriados Trabalhados: ${totalAcrescimos}`)
  const rodape = partsRodape.join('  |  ')
  doc.text(rodape, 12, y)
  y += 8

  doc.setFontSize(8)
  doc.setTextColor(80, 80, 80)
  // Dia em branco (preenchido à mão); mês e ano são os da competência
  const mesCompNome = MESES[dados.mes - 1]
  doc.text(`Brasília/DF, _____ de ${mesCompNome} de ${dados.ano}.`, 200, y, { align: 'right' })
  y += 10

  doc.setDrawColor(0, 0, 0)
  doc.line(55, y, 155, y)
  y += 5
  doc.setFontSize(7)
  doc.setTextColor(100, 100, 100)
  doc.text('Assinatura do Funcionário', 105, y, { align: 'center' })
  y += 7
  doc.setFontSize(8)
  doc.setTextColor(120, 120, 120)
  doc.text(`${via} — ${referencia}`, 105, y, { align: 'center' })
}

function montarReferencia(dados: DadosRecibo): string {
  const mesNome = MESES[dados.mes - 1]
  const mesStr = String(dados.mes).padStart(2, '0')

  // Determina início do período
  let inicioDia = '01'
  if (dados.dataAdmissao) {
    const adm = new Date(dados.dataAdmissao + 'T12:00:00')
    if (adm.getFullYear() === dados.ano && adm.getMonth() + 1 === dados.mes) {
      inicioDia = String(adm.getDate()).padStart(2, '0')
    }
  }

  // Determina fim do período
  const ultimoDiaNum = new Date(dados.ano, dados.mes, 0).getDate()
  let fimDia = String(ultimoDiaNum).padStart(2, '0')
  if (dados.dataFimAviso) {
    const fim = new Date(dados.dataFimAviso + 'T12:00:00')
    if (fim.getFullYear() === dados.ano && fim.getMonth() + 1 === dados.mes) {
      fimDia = String(fim.getDate()).padStart(2, '0')
    }
  }

  if (inicioDia === '01' && fimDia === String(ultimoDiaNum).padStart(2, '0')) {
    return `${mesNome}/${dados.ano}`
  }
  return `${inicioDia}/${mesStr}/${dados.ano} a ${fimDia}/${mesStr}/${dados.ano}`
}

export async function gerarReciboPDF(dados: DadosRecibo): Promise<void> {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const mesNome = MESES[dados.mes - 1]
  const referencia = montarReferencia(dados)

  desenharVia(doc, dados, mesNome, referencia, 10, '1ª VIA — EMPRESA')
  doc.setLineDashPattern([3, 3], 0)
  doc.setDrawColor(150, 150, 150)
  doc.line(10, 142, 200, 142)
  doc.setLineDashPattern([], 0)
  desenharVia(doc, dados, mesNome, referencia, 148, '2ª VIA — FUNCIONÁRIO')

  const emp = dados.apelido ? slugEmp(dados.apelido) + '_' : ''
  const nomeArquivo = `recibo_${emp}${dados.nomeFuncionario.replace(/\s+/g, '_')}_${dados.mes}_${dados.ano}.pdf`
  doc.save(nomeArquivo)
}

/** Gera um único PDF com todos os recibos (um por página) */
export async function gerarMultiplosPDFs(dadosList: DadosRecibo[], nomeArquivo?: string): Promise<void> {
  if (dadosList.length === 0) return
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  dadosList.forEach((dados, i) => {
    if (i > 0) doc.addPage()
    const mesNome = MESES[dados.mes - 1]
    const referencia = montarReferencia(dados)
    desenharVia(doc, dados, mesNome, referencia, 10, '1ª VIA — EMPRESA')
    doc.setLineDashPattern([3, 3], 0)
    doc.setDrawColor(150, 150, 150)
    doc.line(10, 142, 200, 142)
    doc.setLineDashPattern([], 0)
    desenharVia(doc, dados, mesNome, referencia, 148, '2ª VIA — FUNCIONÁRIO')
  })

  const first = dadosList[0]
  const empF = first.apelido ? slugEmp(first.apelido) + '_' : ''
  doc.save(nomeArquivo ?? `recibos_${empF}${first.mes}_${first.ano}.pdf`)
}

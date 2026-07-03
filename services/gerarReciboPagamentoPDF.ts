import { formatarMoeda, MESES } from '../utils/calculoVT'

export type DescontoReciboPagamento = {
  descricao: string
  valor: number
  parcelaAtual: number
  totalParcelas: number
}

export type DadosReciboPagamento = {
  empresaNome: string
  empresaCnpj: string
  funcionarioNome: string
  funcao: string
  mesReferencia: string   // 'YYYY-MM'
  valorLiquido: number
  descontos: DescontoReciboPagamento[]
  totalDescontos: number
  valorAPagar: number
}

function labelCompetencia(mesRef: string): string {
  const [a, m] = mesRef.split('-').map(Number)
  return m ? `${MESES[m - 1]}/${a}` : mesRef
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function desenharRecibo(doc: any, dados: DadosReciboPagamento, startY: number): number {
  let y = startY

  // Cabeçalho
  doc.setFillColor(30, 64, 175)
  doc.rect(10, y, 190, 12, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('RECIBO DE PAGAMENTO', 105, y + 8, { align: 'center' })
  y += 18

  doc.setTextColor(0, 0, 0)
  doc.setFontSize(9)

  doc.setFont('helvetica', 'bold')
  doc.text('EMPRESA:', 12, y)
  doc.setFont('helvetica', 'normal')
  doc.text(dados.empresaNome, 35, y)
  y += 6

  doc.setFont('helvetica', 'bold')
  doc.text('CNPJ:', 12, y)
  doc.setFont('helvetica', 'normal')
  doc.text(dados.empresaCnpj || '—', 35, y)
  doc.setFont('helvetica', 'bold')
  doc.text('COMPETÊNCIA:', 120, y)
  doc.setFont('helvetica', 'normal')
  doc.text(labelCompetencia(dados.mesReferencia), 152, y)
  y += 8

  doc.setDrawColor(220, 220, 220)
  doc.line(10, y - 2, 200, y - 2)
  y += 3

  doc.setFillColor(245, 247, 250)
  doc.rect(10, y - 4, 190, 9, 'F')
  doc.setFont('helvetica', 'bold')
  doc.text('PROFISSIONAL:', 12, y + 2)
  doc.setFont('helvetica', 'normal')
  doc.text(dados.funcionarioNome, 48, y + 2)
  if (dados.funcao) {
    doc.setFont('helvetica', 'bold')
    doc.text('FUNÇÃO:', 135, y + 2)
    doc.setFont('helvetica', 'normal')
    doc.text(dados.funcao, 155, y + 2)
  }
  y += 12

  // Salário líquido
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('Salário líquido:', 12, y)
  doc.setFont('helvetica', 'normal')
  doc.text(formatarMoeda(dados.valorLiquido), 198, y, { align: 'right' })
  y += 8

  // Descontos
  doc.setFillColor(254, 243, 199)
  doc.rect(10, y - 4, 190, 8, 'F')
  doc.setTextColor(120, 80, 0)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('DESCONTOS / VALES', 12, y)
  doc.text('PARCELA', 130, y)
  doc.text('VALOR', 198, y, { align: 'right' })
  y += 7

  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)

  if (dados.descontos.length === 0) {
    doc.setTextColor(120, 120, 120)
    doc.text('Nenhum desconto nesta competência.', 12, y)
    doc.setTextColor(0, 0, 0)
    y += 7
  } else {
    dados.descontos.forEach((d, i) => {
      if (i % 2 === 0) {
        doc.setFillColor(255, 251, 235)
        doc.rect(10, y - 4, 190, 7, 'F')
      }
      doc.text(d.descricao, 12, y)
      const parcelaLabel = d.totalParcelas > 1 ? `${d.parcelaAtual}/${d.totalParcelas}` : '—'
      doc.text(parcelaLabel, 130, y)
      doc.text(`- ${formatarMoeda(d.valor)}`, 198, y, { align: 'right' })
      y += 7
    })
    // Total descontos
    doc.setFont('helvetica', 'bold')
    doc.text('Total de descontos:', 12, y)
    doc.text(`- ${formatarMoeda(dados.totalDescontos)}`, 198, y, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    y += 8
  }

  y += 2
  // Valor final a pagar
  doc.setFillColor(22, 101, 52)
  doc.rect(10, y - 4, 190, 10, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('VALOR A PAGAR', 12, y + 2)
  doc.text(formatarMoeda(dados.valorAPagar), 198, y + 2, { align: 'right' })
  y += 16

  // Assinatura
  doc.setTextColor(80, 80, 80)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(`Recebi a importância líquida acima, referente à competência ${labelCompetencia(dados.mesReferencia)}.`, 12, y)
  y += 14
  doc.setDrawColor(0, 0, 0)
  doc.line(55, y, 155, y)
  y += 5
  doc.setFontSize(7)
  doc.setTextColor(100, 100, 100)
  doc.text(`${dados.funcionarioNome}`, 105, y, { align: 'center' })
  y += 4
  doc.text('Assinatura', 105, y, { align: 'center' })
  y += 6

  return y
}

export async function gerarReciboPagamentoPDF(dados: DadosReciboPagamento): Promise<void> {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  desenharRecibo(doc, dados, 14)
  const nome = `recibo_pagamento_${dados.funcionarioNome.replace(/\s+/g, '_')}_${dados.mesReferencia}.pdf`
  doc.save(nome)
}

/** Um único PDF com todos os recibos (um por página). */
export async function gerarMultiplosRecibosPagamento(lista: DadosReciboPagamento[]): Promise<void> {
  if (lista.length === 0) return
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  lista.forEach((dados, i) => {
    if (i > 0) doc.addPage()
    desenharRecibo(doc, dados, 14)
  })
  doc.save(`recibos_pagamento_${lista[0].mesReferencia}.pdf`)
}

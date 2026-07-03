import { formatarMoeda, MESES } from '../utils/calculoVT'

export type DadosReciboVale = {
  empresaNome: string
  empresaCnpj: string
  funcionarioNome: string
  funcao: string
  data: string            // 'YYYY-MM-DD' — data do lançamento do vale
  descricao: string
  valorTotal: number
  parcelas: number
  valorParcela: number
  mesInicio: string       // 'YYYY-MM'
  mesFim: string          // 'YYYY-MM'
}

function fmtData(iso: string): string {
  if (!iso) return ''
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}
function labelMes(mesRef: string): string {
  const [a, m] = mesRef.split('-').map(Number)
  return m ? `${MESES[m - 1]}/${a}` : mesRef
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function desenharRecibo(doc: any, d: DadosReciboVale, startY: number, via: string): number {
  let y = startY

  // Cabeçalho — cor âmbar para diferenciar do recibo de pagamento (verde/azul)
  doc.setFillColor(180, 83, 9)
  doc.rect(10, y, 190, 12, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('RECIBO DE VALE / ADIANTAMENTO', 105, y + 8, { align: 'center' })
  y += 18

  doc.setTextColor(0, 0, 0)
  doc.setFontSize(9)

  doc.setFont('helvetica', 'bold'); doc.text('EMPRESA:', 12, y)
  doc.setFont('helvetica', 'normal'); doc.text(d.empresaNome, 35, y)
  y += 6
  doc.setFont('helvetica', 'bold'); doc.text('CNPJ:', 12, y)
  doc.setFont('helvetica', 'normal'); doc.text(d.empresaCnpj || '—', 35, y)
  doc.setFont('helvetica', 'bold'); doc.text('DATA:', 130, y)
  doc.setFont('helvetica', 'normal'); doc.text(fmtData(d.data), 148, y)
  y += 8

  doc.setDrawColor(220, 220, 220); doc.line(10, y - 2, 200, y - 2); y += 3

  doc.setFillColor(245, 247, 250); doc.rect(10, y - 4, 190, 9, 'F')
  doc.setFont('helvetica', 'bold'); doc.text('PROFISSIONAL:', 12, y + 2)
  doc.setFont('helvetica', 'normal'); doc.text(d.funcionarioNome, 48, y + 2)
  if (d.funcao) {
    doc.setFont('helvetica', 'bold'); doc.text('FUNÇÃO:', 135, y + 2)
    doc.setFont('helvetica', 'normal'); doc.text(d.funcao, 155, y + 2)
  }
  y += 14

  // Valor em destaque
  doc.setFillColor(254, 243, 199); doc.rect(10, y - 5, 190, 12, 'F')
  doc.setTextColor(120, 80, 0)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
  doc.text(`DESCRIÇÃO: ${d.descricao}`, 12, y + 2)
  doc.text(formatarMoeda(d.valorTotal), 198, y + 2, { align: 'right' })
  y += 16

  // Declaração
  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  const parcelaTxt = d.parcelas > 1
    ? `a ser descontado em ${d.parcelas} parcelas de ${formatarMoeda(d.valorParcela)}, de ${labelMes(d.mesInicio)} a ${labelMes(d.mesFim)}`
    : `a ser descontado integralmente na competência ${labelMes(d.mesInicio)}`
  const texto =
    `Declaro, para os devidos fins, que recebi da empresa acima identificada a importância de ` +
    `${formatarMoeda(d.valorTotal)}, referente a "${d.descricao}", ${parcelaTxt}.`
  const linhas = doc.splitTextToSize(texto, 186)
  doc.text(linhas, 12, y)
  y += linhas.length * 5 + 6

  // Tabela de parcelas
  doc.setFillColor(180, 83, 9); doc.rect(10, y - 4, 190, 7, 'F')
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
  doc.text('PARCELA', 12, y); doc.text('COMPETÊNCIA', 60, y); doc.text('VALOR', 198, y, { align: 'right' })
  y += 6
  doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal')
  const [ay, am] = d.mesInicio.split('-').map(Number)
  for (let i = 0; i < d.parcelas; i++) {
    if (i % 2 === 0) { doc.setFillColor(255, 251, 235); doc.rect(10, y - 4, 190, 6, 'F') }
    const dt = new Date(ay, am - 1 + i, 1)
    const comp = `${MESES[dt.getMonth()]}/${dt.getFullYear()}`
    doc.text(`${i + 1}/${d.parcelas}`, 12, y)
    doc.text(comp, 60, y)
    doc.text(formatarMoeda(d.valorParcela), 198, y, { align: 'right' })
    y += 6
  }
  y += 10

  // Assinatura
  doc.setDrawColor(0, 0, 0); doc.line(55, y, 155, y); y += 5
  doc.setFontSize(7); doc.setTextColor(100, 100, 100)
  doc.text(d.funcionarioNome, 105, y, { align: 'center' }); y += 4
  doc.text('Assinatura do Profissional', 105, y, { align: 'center' }); y += 6
  doc.setFontSize(8); doc.setTextColor(120, 120, 120)
  doc.text(via, 105, y, { align: 'center' })

  return y
}

function derivar(d: DadosReciboVale): DadosReciboVale {
  const parcelas = Math.max(1, d.parcelas)
  const valorParcela = Math.round((d.valorTotal / parcelas) * 100) / 100
  const [ay, am] = d.mesInicio.split('-').map(Number)
  const fim = new Date(ay, am - 1 + (parcelas - 1), 1)
  const mesFim = `${fim.getFullYear()}-${String(fim.getMonth() + 1).padStart(2, '0')}`
  return { ...d, parcelas, valorParcela, mesFim }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function desenharValeCompleto(doc: any, dados: DadosReciboVale) {
  const d = derivar(dados)
  // Duas vias: empresa e profissional
  desenharRecibo(doc, d, 12, '1ª VIA — EMPRESA')
  doc.setLineDashPattern([3, 3], 0)
  doc.setDrawColor(150, 150, 150)
  doc.line(10, 150, 200, 150)
  doc.setLineDashPattern([], 0)
  desenharRecibo(doc, d, 156, '2ª VIA — PROFISSIONAL')
}

export async function gerarReciboValePDF(dados: DadosReciboVale): Promise<void> {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  desenharValeCompleto(doc, dados)
  doc.save(`recibo_vale_${dados.funcionarioNome.replace(/\s+/g, '_')}_${dados.data}.pdf`)
}

/** Um único PDF com vários recibos de vale (um por página). */
export async function gerarMultiplosRecibosVale(lista: DadosReciboVale[]): Promise<void> {
  if (lista.length === 0) return
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  lista.forEach((dados, i) => {
    if (i > 0) doc.addPage()
    desenharValeCompleto(doc, dados)
  })
  doc.save('recibos_vales.pdf')
}

// ── Recibo CONSOLIDADO por profissional (todos os vales num só recibo) ─────────

export type ValeConsolidadoItem = {
  descricao: string
  data: string
  valorTotal: number
  parcelas: number
  valorParcela: number
  descontadas: number
  restantes: number
  valorRestante: number
  mesInicio: string
}

export type DadosReciboConsolidado = {
  empresaNome: string
  empresaCnpj: string
  funcionarioNome: string
  funcao: string
  refCompetencia: string
  vales: ValeConsolidadoItem[]
  totalGeral: number
  totalDescontado: number
  totalRestante: number
}

function labelPeriodo(mesInicio: string, parcelas: number): string {
  const [ay, am] = mesInicio.split('-').map(Number)
  if (parcelas <= 1) return labelMes(mesInicio)
  const fim = new Date(ay, am - 1 + (parcelas - 1), 1)
  const mesFim = `${fim.getFullYear()}-${String(fim.getMonth() + 1).padStart(2, '0')}`
  return `${labelMes(mesInicio)} a ${labelMes(mesFim)}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function desenharConsolidado(doc: any, d: DadosReciboConsolidado) {
  let y = 14

  doc.setFillColor(180, 83, 9)
  doc.rect(10, y, 190, 12, 'F')
  doc.setTextColor(255, 255, 255); doc.setFontSize(11); doc.setFont('helvetica', 'bold')
  doc.text('RECIBO DE VALES / ADIANTAMENTOS', 105, y + 8, { align: 'center' })
  y += 18

  doc.setTextColor(0, 0, 0); doc.setFontSize(9)
  doc.setFont('helvetica', 'bold'); doc.text('EMPRESA:', 12, y)
  doc.setFont('helvetica', 'normal'); doc.text(d.empresaNome, 35, y)
  y += 6
  doc.setFont('helvetica', 'bold'); doc.text('CNPJ:', 12, y)
  doc.setFont('helvetica', 'normal'); doc.text(d.empresaCnpj || '—', 35, y)
  doc.setFont('helvetica', 'bold'); doc.text('POSIÇÃO EM:', 125, y)
  doc.setFont('helvetica', 'normal'); doc.text(labelMes(d.refCompetencia), 155, y)
  y += 8

  doc.setFillColor(245, 247, 250); doc.rect(10, y - 4, 190, 9, 'F')
  doc.setFont('helvetica', 'bold'); doc.text('PROFISSIONAL:', 12, y + 2)
  doc.setFont('helvetica', 'normal'); doc.text(d.funcionarioNome, 48, y + 2)
  if (d.funcao) {
    doc.setFont('helvetica', 'bold'); doc.text('FUNÇÃO:', 135, y + 2)
    doc.setFont('helvetica', 'normal'); doc.text(d.funcao, 155, y + 2)
  }
  y += 12

  // Cabeçalho da tabela
  doc.setFillColor(180, 83, 9); doc.rect(10, y - 4, 190, 7, 'F')
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
  doc.text('DESCRIÇÃO', 12, y)
  doc.text('PERÍODO', 62, y)
  doc.text('PARC.', 120, y)
  doc.text('PARCELA', 150, y, { align: 'right' })
  doc.text('SALDO', 198, y, { align: 'right' })
  y += 6

  doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  d.vales.forEach((v, i) => {
    if (y > 250) { doc.addPage(); y = 16 }
    if (i % 2 === 0) { doc.setFillColor(255, 251, 235); doc.rect(10, y - 4, 190, 6, 'F') }
    doc.text(String(v.descricao).slice(0, 32), 12, y)
    doc.text(labelPeriodo(v.mesInicio, v.parcelas), 62, y)
    doc.text(`${v.descontadas}/${v.parcelas}`, 120, y)
    doc.text(formatarMoeda(v.valorParcela), 150, y, { align: 'right' })
    doc.text(formatarMoeda(v.valorRestante), 198, y, { align: 'right' })
    y += 6
  })

  // Totais
  y += 2
  doc.setDrawColor(200, 200, 200); doc.line(10, y - 4, 200, y - 4)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  doc.text('Total dos vales:', 120, y); doc.text(formatarMoeda(d.totalGeral), 198, y, { align: 'right' }); y += 6
  doc.setTextColor(22, 101, 52)
  doc.text('Já descontado:', 120, y); doc.text(formatarMoeda(d.totalDescontado), 198, y, { align: 'right' }); y += 8

  doc.setFillColor(180, 83, 9); doc.rect(10, y - 5, 190, 11, 'F')
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
  doc.text('SALDO DEVEDOR', 12, y + 2)
  doc.text(formatarMoeda(d.totalRestante), 198, y + 2, { align: 'right' })
  y += 16

  // Declaração + assinatura
  doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  const texto = `Reconheço o(s) vale(s)/adiantamento(s) acima, cujo saldo devedor em ` +
    `${labelMes(d.refCompetencia)} é de ${formatarMoeda(d.totalRestante)}, a ser descontado ` +
    `nas próximas competências conforme o parcelamento.`
  const linhas = doc.splitTextToSize(texto, 186)
  doc.text(linhas, 12, y); y += linhas.length * 5 + 12

  doc.setDrawColor(0, 0, 0); doc.line(55, y, 155, y); y += 5
  doc.setFontSize(7); doc.setTextColor(100, 100, 100)
  doc.text(d.funcionarioNome, 105, y, { align: 'center' }); y += 4
  doc.text('Assinatura do Profissional', 105, y, { align: 'center' })
}

export async function gerarReciboConsolidadoPDF(dados: DadosReciboConsolidado): Promise<void> {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  desenharConsolidado(doc, dados)
  doc.save(`recibo_vales_${dados.funcionarioNome.replace(/\s+/g, '_')}_${dados.refCompetencia}.pdf`)
}

/** Um PDF com um recibo consolidado por profissional (um por página). */
export async function gerarMultiplosConsolidados(lista: DadosReciboConsolidado[]): Promise<void> {
  if (lista.length === 0) return
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  lista.forEach((dados, i) => {
    if (i > 0) doc.addPage()
    desenharConsolidado(doc, dados)
  })
  doc.save('recibos_vales_consolidados.pdf')
}

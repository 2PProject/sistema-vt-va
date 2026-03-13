import { ResultadoCalculo, formatarMoeda, MESES } from '../utils/calculoVT'

export type DescontoRecibo = {
  tipo_nome: string
  dias: number
  data_inicio: string | null
  data_fim: string | null
}

export type DadosRecibo = {
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
  descontos?: DescontoRecibo[]
}

export async function gerarReciboPDF(dados: DadosRecibo): Promise<void> {
  const { default: jsPDF } = await import('jspdf')

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  const mesNome = MESES[dados.mes - 1]
  const referencia = `${mesNome}/${dados.ano}`

  function desenharVia(startY: number, via: string) {
    let y = startY

    // Header azul
    doc.setFillColor(30, 64, 175)
    doc.rect(10, y, 190, 12, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text('RECIBO DE VALE TRANSPORTE / VALE ALIMENTAÇÃO', 105, y + 8, {
      align: 'center',
    })
    y += 16

    doc.setTextColor(0, 0, 0)
    doc.setFontSize(9)

    // Empresa
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

    // Linha separadora
    doc.setDrawColor(220, 220, 220)
    doc.line(10, y, 200, y)
    y += 5

    // Funcionário — linha 1: nome e função
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

    // Funcionário — linha 2: CTPS e Série
    doc.setFont('helvetica', 'bold')
    doc.text('CTPS Nº:', 12, y + 3)
    doc.setFont('helvetica', 'normal')
    doc.text(dados.ctps || '—', 35, y + 3)
    doc.setFont('helvetica', 'bold')
    doc.text('SÉRIE:', 80, y + 3)
    doc.setFont('helvetica', 'normal')
    doc.text(dados.serie || '—', 97, y + 3)
    y += 10

    // Tabela header
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

    // Para funcionários com exceção de sábado, os dias de VT úteis = diasEfetivos - diasSabado
    const diasVTUteis = dados.valorVTSabado > 0
      ? Math.max(0, dados.diasEfetivos - dados.diasSabado)
      : dados.diasEfetivos

    const linhas = [
      [
        'Vale Alimentação (VA)',
        String(dados.diasEfetivos),
        formatarMoeda(dados.valorVA),
        formatarMoeda(dados.resultado.totalVA),
      ],
      [
        'Vale Transporte - Dias Úteis',
        String(diasVTUteis),
        formatarMoeda(dados.valorVT),
        formatarMoeda(dados.resultado.totalVT),
      ],
      ...(dados.valorVTSabado > 0 ? [[
        'Vale Transporte - Sábados',
        String(dados.diasSabado),
        formatarMoeda(dados.valorVTSabado),
        formatarMoeda(dados.resultado.totalVTSabado),
      ]] : []),
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

    // Descontos
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
        // Formata a data
        let dataStr = ''
        if (d.data_inicio) {
          const fmt = (s: string) => {
            const [a, m, dia] = s.split('-')
            return `${dia}/${m}/${a}`
          }
          if (!d.data_fim || d.data_fim === d.data_inicio) {
            dataStr = fmt(d.data_inicio)
          } else {
            dataStr = `${fmt(d.data_inicio)} a ${fmt(d.data_fim)}`
          }
        }
        if (dataStr) doc.text(dataStr, 130, y)
        y += 7
      })
    }

    // Total
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
    const rodape = dados.valorVTSabado > 0
      ? `Dias Úteis: ${dados.diasUteis}  |  Dias Efetivos: ${dados.diasEfetivos}  |  Sábados Trabalhados: ${dados.diasSabado}`
      : `Dias Úteis: ${dados.diasUteis}  |  Dias Efetivos: ${dados.diasEfetivos}`
    doc.text(rodape, 12, y)
    y += 8

    // Data alinhada à direita
    doc.setFontSize(8)
    doc.setTextColor(80, 80, 80)
    doc.text(`_______________, ___ de ${mesNome} de ${dados.ano}.`, 200, y, { align: 'right' })
    y += 10

    // Assinatura do funcionário — centralizada
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

  desenharVia(10, '1ª VIA — EMPRESA')

  // Linha pontilhada separadora
  doc.setLineDashPattern([3, 3], 0)
  doc.setDrawColor(150, 150, 150)
  doc.line(10, 142, 200, 142)
  doc.setLineDashPattern([], 0)

  desenharVia(148, '2ª VIA — FUNCIONÁRIO')

  const nomeArquivo = `recibo_${dados.nomeFuncionario.replace(/\s+/g, '_')}_${dados.mes}_${dados.ano}.pdf`
  doc.save(nomeArquivo)
}

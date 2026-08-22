// Exportadores genéricos (Excel e PDF) para os relatórios do módulo Salão.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Coluna = { header: string; get: (r: any) => string | number; align?: 'left' | 'right'; peso?: number }

export type OpcoesPDF = {
  orientation?: 'portrait' | 'landscape'
  subtitulo?: string          // ex.: período + empresa
  emitente?: string           // rodapé (ex.: nome do salão)
}

// Nome + sobrenome (1º e último token) em formato de arquivo: "maria_silva".
export function slugNome(nome: string | null | undefined): string {
  const t = String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (!t.length) return ''
  const partes = t.length === 1 ? [t[0]] : [t[0], t[t.length - 1]]
  return partes.join('_')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function exportarExcel(titulo: string, colunas: Coluna[], rows: any[], nomeArq: string, subtitulo?: string) {
  const XLSX = await import('xlsx')
  const aoa: (string | number)[][] = [[titulo]]
  if (subtitulo) aoa.push([subtitulo])
  aoa.push([`Gerado em ${new Date().toLocaleString('pt-BR')}`])
  aoa.push([])
  aoa.push(colunas.map(c => c.header))
  for (const r of rows) aoa.push(colunas.map(c => c.get(r)))
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = colunas.map(c => ({ wch: Math.max(14, Math.round((c.peso ?? 1) * 22)) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Relatorio')
  XLSX.writeFile(wb, `${nomeArq}.xlsx`)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function exportarPDF(titulo: string, colunas: Coluna[], rows: any[], nomeArq: string, opcoes: OpcoesPDF = {}) {
  const { default: jsPDF } = await import('jspdf')
  const vertical = opcoes.orientation === 'portrait'
  const doc = new jsPDF({ orientation: vertical ? 'portrait' : 'landscape', unit: 'mm', format: 'a4' })
  const larg = vertical ? 210 : 297
  const alt = vertical ? 297 : 210
  const margem = 12
  const rodapeY = alt - 10
  const limiteY = rodapeY - 6
  const areaX = margem, areaW = larg - margem * 2
  const lineH = 3.8

  // Larguras proporcionais (peso) ou iguais.
  const pesos = colunas.map(c => c.peso ?? 1)
  const somaPeso = pesos.reduce((s, p) => s + p, 0)
  const colW = pesos.map(p => (p / somaPeso) * areaW)
  const colX = colW.map((_, i) => areaX + colW.slice(0, i).reduce((s, w) => s + w, 0))

  const NAVY: [number, number, number] = [23, 43, 77]
  const CINZA_CAB: [number, number, number] = [238, 242, 247]
  const ZEBRA: [number, number, number] = [248, 250, 252]
  const TXT: [number, number, number] = [33, 41, 54]
  const TXT_SUAVE: [number, number, number] = [100, 116, 139]
  const gerado = `Gerado em ${new Date().toLocaleString('pt-BR')}`

  let y = 0

  function faixaTopo() {
    doc.setFillColor(...NAVY); doc.rect(0, 0, larg, 22, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14)
    doc.text(titulo, margem, 11)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
    if (opcoes.subtitulo) doc.text(opcoes.subtitulo, margem, 17)
    doc.setFontSize(8); doc.setTextColor(203, 213, 225)
    doc.text(gerado, larg - margem, 11, { align: 'right' })
    doc.setTextColor(...TXT)
    y = 30
  }

  function cabecalhoTabela() {
    doc.setFillColor(...CINZA_CAB); doc.rect(areaX, y - 4.5, areaW, 7, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...TXT)
    colunas.forEach((c, i) => {
      const dir = c.align === 'right'
      doc.text(doc.splitTextToSize(c.header, colW[i] - 3), dir ? colX[i] + colW[i] - 2 : colX[i] + 2, y, { align: dir ? 'right' : 'left' })
    })
    y += 5
    doc.setDrawColor(210, 216, 224); doc.setLineWidth(0.2); doc.line(areaX, y, areaX + areaW, y)
    y += 3
  }

  faixaTopo(); cabecalhoTabela()

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  rows.forEach((r, idx) => {
    const textos = colunas.map((c, i) => doc.splitTextToSize(String(c.get(r) ?? ''), colW[i] - 4) as string[])
    const linhas = Math.max(1, ...textos.map(t => t.length))
    const altura = linhas * lineH + 2.4
    if (y + altura > limiteY) { doc.addPage(); faixaTopo(); cabecalhoTabela(); doc.setFont('helvetica', 'normal'); doc.setFontSize(8) }
    if (idx % 2 === 1) { doc.setFillColor(...ZEBRA); doc.rect(areaX, y - 3.4, areaW, altura, 'F') }
    doc.setTextColor(...TXT)
    textos.forEach((t, i) => {
      const dir = colunas[i].align === 'right'
      doc.text(t, dir ? colX[i] + colW[i] - 2 : colX[i] + 2, y, { align: dir ? 'right' : 'left' })
    })
    y += altura
  })

  // Rodapé em todas as páginas: total + paginação.
  const total = doc.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.2); doc.line(margem, rodapeY - 3, larg - margem, rodapeY - 3)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...TXT_SUAVE)
    doc.text(`${rows.length} registro(s)${opcoes.emitente ? ' · ' + opcoes.emitente : ''}`, margem, rodapeY)
    doc.text(`Página ${p} de ${total}`, larg - margem, rodapeY, { align: 'right' })
  }

  doc.save(`${nomeArq}.pdf`)
}

// Um "grupo" = um profissional, com seus dados de cabeçalho e as linhas da tabela.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GrupoPDF = { nome: string; documento?: string | null; unidade?: string | null; resumo?: string; rows: any[] }

/**
 * PDF por profissional. Dois modos:
 *  • 'individual' — 1 profissional por PÁGINA (como os recibos do VA);
 *  • 'sintetico'  — várias mini-tabelas empilhadas por página, com espaço entre elas.
 * Ambos compartilham o mesmo desenho de tabela, faixa de topo e rodapé paginado.
 */
export async function exportarPDFAgrupado(
  titulo: string, colunas: Coluna[], grupos: GrupoPDF[], nomeArq: string,
  opcoes: OpcoesPDF & { modo?: 'individual' | 'sintetico' } = {},
) {
  const { default: jsPDF } = await import('jspdf')
  const vertical = opcoes.orientation !== 'landscape'
  const doc = new jsPDF({ orientation: vertical ? 'portrait' : 'landscape', unit: 'mm', format: 'a4' })
  const modo = opcoes.modo ?? 'sintetico'
  const larg = vertical ? 210 : 297
  const alt = vertical ? 297 : 210
  const margem = 12
  const rodapeY = alt - 10
  const limiteY = rodapeY - 6
  const areaX = margem, areaW = larg - margem * 2
  const lineH = 3.8

  const pesos = colunas.map(c => c.peso ?? 1)
  const somaPeso = pesos.reduce((s, p) => s + p, 0)
  const colW = pesos.map(p => (p / somaPeso) * areaW)
  const colX = colW.map((_, i) => areaX + colW.slice(0, i).reduce((s, w) => s + w, 0))

  const NAVY: [number, number, number] = [23, 43, 77]
  const CINZA_CAB: [number, number, number] = [238, 242, 247]
  const ZEBRA: [number, number, number] = [248, 250, 252]
  const TXT: [number, number, number] = [33, 41, 54]
  const TXT_SUAVE: [number, number, number] = [100, 116, 139]
  const gerado = `Gerado em ${new Date().toLocaleString('pt-BR')}`
  let y = 0

  function faixaTopo() {
    doc.setFillColor(...NAVY); doc.rect(0, 0, larg, 22, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(titulo, margem, 11)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
    if (opcoes.subtitulo) doc.text(opcoes.subtitulo, margem, 17)
    doc.setFontSize(8); doc.setTextColor(203, 213, 225); doc.text(gerado, larg - margem, 11, { align: 'right' })
    doc.setTextColor(...TXT); y = 28
  }
  function cabecalhoTabela() {
    doc.setFillColor(...CINZA_CAB); doc.rect(areaX, y - 4.5, areaW, 7, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...TXT)
    colunas.forEach((c, i) => {
      const dir = c.align === 'right'
      doc.text(doc.splitTextToSize(c.header, colW[i] - 3), dir ? colX[i] + colW[i] - 2 : colX[i] + 2, y, { align: dir ? 'right' : 'left' })
    })
    y += 5; doc.setDrawColor(210, 216, 224); doc.setLineWidth(0.2); doc.line(areaX, y, areaX + areaW, y); y += 3
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function desenharLinha(r: any, idx: number) {
    const textos = colunas.map((c, i) => doc.splitTextToSize(String(c.get(r) ?? ''), colW[i] - 4) as string[])
    const linhas = Math.max(1, ...textos.map(t => t.length))
    const altura = linhas * lineH + 2.4
    if (y + altura > limiteY) { doc.addPage(); faixaTopo(); cabecalhoTabela(); doc.setFont('helvetica', 'normal'); doc.setFontSize(8) }
    if (idx % 2 === 1) { doc.setFillColor(...ZEBRA); doc.rect(areaX, y - 3.4, areaW, altura, 'F') }
    doc.setTextColor(...TXT)
    textos.forEach((t, i) => { const dir = colunas[i].align === 'right'; doc.text(t, dir ? colX[i] + colW[i] - 2 : colX[i] + 2, y, { align: dir ? 'right' : 'left' }) })
    y += altura
  }
  function cabecalhoGrupo(g: GrupoPDF) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(modo === 'individual' ? 12 : 10); doc.setTextColor(...NAVY)
    doc.text(doc.splitTextToSize(g.nome || '—', areaW * 0.62)[0], areaX, y)
    if (g.resumo) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...TXT_SUAVE); doc.text(g.resumo, larg - margem, y, { align: 'right' }) }
    y += 4.6
    const sub = [g.documento, g.unidade].filter(Boolean).join(' · ')
    if (sub) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...TXT_SUAVE); doc.text(doc.splitTextToSize(sub, areaW)[0], areaX, y); y += 4 }
    y += 1.5
  }

  faixaTopo()
  grupos.forEach((g, gi) => {
    if (modo === 'individual' && gi > 0) { doc.addPage(); faixaTopo() }
    // No sintético, evita "órfão": se não cabe o cabeçalho do grupo + 1 linha, quebra a página.
    if (modo === 'sintetico' && gi > 0 && y + 20 > limiteY) { doc.addPage(); faixaTopo() }
    cabecalhoGrupo(g)
    cabecalhoTabela()
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
    if (!g.rows.length) { doc.setTextColor(...TXT_SUAVE); doc.text('Sem lançamentos.', areaX + 2, y); y += 5 }
    else g.rows.forEach((r, idx) => desenharLinha(r, idx))
    if (modo === 'sintetico') { y += 4; doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.2); doc.line(areaX, y - 2.5, areaX + areaW, y - 2.5); y += 3 }
  })

  const total = doc.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.2); doc.line(margem, rodapeY - 3, larg - margem, rodapeY - 3)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...TXT_SUAVE)
    doc.text(`${grupos.length} profissional(is)${opcoes.emitente ? ' · ' + opcoes.emitente : ''}`, margem, rodapeY)
    doc.text(`Página ${p} de ${total}`, larg - margem, rodapeY, { align: 'right' })
  }
  doc.save(`${nomeArq}.pdf`)
}

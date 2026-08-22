// Exportadores genéricos (Excel e PDF) para os relatórios do módulo Salão.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Coluna = { header: string; get: (r: any) => string | number }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function exportarExcel(titulo: string, colunas: Coluna[], rows: any[], nomeArq: string) {
  const XLSX = await import('xlsx')
  const aoa: (string | number)[][] = [[titulo], colunas.map(c => c.header)]
  for (const r of rows) aoa.push(colunas.map(c => c.get(r)))
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = colunas.map(() => ({ wch: 24 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Relatorio')
  XLSX.writeFile(wb, `${nomeArq}.xlsx`)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function exportarPDF(titulo: string, colunas: Coluna[], rows: any[], nomeArq: string, opcoes: { orientation?: 'portrait' | 'landscape' } = {}) {
  const { default: jsPDF } = await import('jspdf')
  const vertical = opcoes.orientation === 'portrait'
  const doc = new jsPDF({ orientation: vertical ? 'portrait' : 'landscape', unit: 'mm', format: 'a4' })
  const larg = vertical ? 210 : 297, limiteY = vertical ? 282 : 195, margem = 12
  let y = 16
  doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.text(titulo, margem, y); y += 8
  doc.setFontSize(8)
  const colW = (larg - margem * 2) / colunas.length
  const cabecalho = colunas.map(c => c.header)
  function preparar(vals: (string | number)[]) {
    return vals.map(v => doc.splitTextToSize(String(v ?? ''), Math.max(12, colW - 2)) as string[])
  }
  function desenhar(vals: (string | number)[], bold: boolean) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    const textos = preparar(vals)
    const altura = Math.max(1, ...textos.map(t => t.length)) * 3.6 + 2
    if (y + altura > limiteY) {
      doc.addPage(); y = 16
      doc.setFont('helvetica', 'bold')
      const hs = preparar(cabecalho); const ha = Math.max(1, ...hs.map(t => t.length)) * 3.6 + 2
      hs.forEach((t, i) => doc.text(t, margem + i * colW, y))
      y += ha; doc.setDrawColor(210); doc.line(margem, y - 2, larg - margem, y - 2)
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
    }
    textos.forEach((t, i) => doc.text(t, margem + i * colW, y))
    y += altura
  }
  desenhar(cabecalho, true)
  doc.setDrawColor(210); doc.line(margem, y - 2, larg - margem, y - 2)
  for (const r of rows) desenhar(colunas.map(c => c.get(r)), false)
  doc.save(`${nomeArq}.pdf`)
}

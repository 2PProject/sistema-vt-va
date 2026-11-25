// 13º Salário — Vale Alimentação (2 parcelas: novembro e dezembro).
// Importação por planilha, reaproveitando o leitor/casador de salários. Gera
// VA-only: SEM vale transporte e SEM descontos. Persiste em pagamento_13_va.
import { supabase } from './supabase'
import { importarPlanilhaSalarios, baixarModeloPlanilhaSalarios, type LinhaImportSalario } from './pagamentos'
import { formatarMoeda } from '../utils/calculoVT'

export type Registro13 = {
  id: string
  funcionario_id: string
  empresa_id: string
  ano: number
  valor_parcela: number
  funcionarioNome: string
  funcao: string
  empresaNome: string
  cnpj: string
  apelido: string
}

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

/** Reaproveita o leitor de planilha de salários (colunas Apelido/Nome/Valor). */
export function importarPlanilha13(arquivo: File) { return importarPlanilhaSalarios(arquivo) }
/** Reaproveita o modelo de planilha (Apelido · Nome · Valor). */
export function baixarModelo13(empresaId?: string) { return baixarModeloPlanilhaSalarios(empresaId) }

/**
 * Grava o 13º VA do ano. `modo`:
 *  - 'parcela' (padrão): o valor da planilha é o VA de CADA parcela (nov e dez).
 *  - 'total'  : o valor da planilha é o total do 13º → divide 50/50 nas 2 parcelas.
 */
export async function processar13(linhas: LinhaImportSalario[], ano: number, modo: 'parcela' | 'total'): Promise<{ gravados: number; erro?: string }> {
  const agora = new Date().toISOString()
  const rows = linhas.map((l) => ({
    funcionario_id: l.funcionarioId,
    empresa_id: l.empresaId,
    ano,
    valor_parcela: modo === 'total' ? cent(l.valorLiquido / 2) : cent(l.valorLiquido),
    atualizado_em: agora,
  }))
  if (!rows.length) return { gravados: 0 }
  const { error } = await supabase.from('pagamento_13_va').upsert(rows, { onConflict: 'funcionario_id,ano' })
  if (error) return { gravados: 0, erro: error.message }
  return { gravados: rows.length }
}

/** Lista o 13º VA já gravado do ano (opcionalmente por empresa). */
export async function listar13(ano: number, empresaId?: string): Promise<Registro13[]> {
  let q = supabase.from('pagamento_13_va')
    .select('id, funcionario_id, empresa_id, ano, valor_parcela, funcionarios(nome, funcao), empresas(razao_social, cnpj, apelido)')
    .eq('ano', ano)
  if (empresaId) q = q.eq('empresa_id', empresaId)
  const { data } = await q
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => {
    const f = Array.isArray(r.funcionarios) ? r.funcionarios[0] : r.funcionarios
    const e = Array.isArray(r.empresas) ? r.empresas[0] : r.empresas
    return {
      id: r.id, funcionario_id: r.funcionario_id, empresa_id: r.empresa_id, ano: r.ano,
      valor_parcela: Number(r.valor_parcela || 0),
      funcionarioNome: f?.nome || '', funcao: f?.funcao || '',
      empresaNome: e?.razao_social || '', cnpj: e?.cnpj || '', apelido: e?.apelido || '',
    }
  }).sort((a, b) => a.empresaNome.localeCompare(b.empresaNome, 'pt-BR') || a.funcionarioNome.localeCompare(b.funcionarioNome, 'pt-BR'))
}

/** Remove o 13º VA do ano (opcionalmente por empresa). */
export async function limpar13(ano: number, empresaId?: string): Promise<{ ok: boolean; erro?: string }> {
  let q = supabase.from('pagamento_13_va').delete().eq('ano', ano)
  if (empresaId) q = q.eq('empresa_id', empresaId)
  const { error } = await q
  return error ? { ok: false, erro: error.message } : { ok: true }
}

function fmtDoc(v: string) {
  const s = (v || '').replace(/\D/g, '')
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return v || '—'
}

/** Gera um PDF com os recibos do 13º VA — 2 vias por funcionário, 2 parcelas. */
export async function gerarRecibos13(regs: Registro13[], ano: number): Promise<void> {
  if (!regs.length) return
  const { default: jsPDF } = await import('jspdf')
  const d = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210, M = 14, areaW = W - 2 * M
  const NAVY: [number, number, number] = [23, 43, 77], TXT: [number, number, number] = [33, 41, 54], SUAVE: [number, number, number] = [100, 116, 139]

  // Desenha UMA via a partir de y; devolve o y final.
  function via(r: Registro13, y0: number, viaLabel: string): number {
    let y = y0
    d.setDrawColor(210, 216, 224); d.setLineWidth(0.3); d.roundedRect(M, y, areaW, 118, 2, 2)
    // Cabeçalho
    d.setFillColor(...NAVY); d.rect(M, y, areaW, 16, 'F')
    d.setTextColor(255, 255, 255); d.setFont('helvetica', 'bold'); d.setFontSize(12)
    d.text('RECIBO — VALE ALIMENTAÇÃO', M + 4, y + 7)
    d.setFont('helvetica', 'normal'); d.setFontSize(9); d.text(`13º Salário · ${ano}`, M + 4, y + 12.5)
    d.setFontSize(8); d.text(viaLabel, W - M - 4, y + 7, { align: 'right' })
    d.setTextColor(...TXT); y += 22
    // Empresa / funcionário
    const linha = (rot: string, val: string) => { d.setFont('helvetica', 'normal'); d.setTextColor(...SUAVE); d.setFontSize(7); d.text(rot.toUpperCase(), M + 4, y); d.setFont('helvetica', 'bold'); d.setTextColor(...TXT); d.setFontSize(9.5); d.text(val || '—', M + 4, y + 4.5); y += 11 }
    linha('Empresa', `${r.empresaNome}${r.apelido ? `  (${r.apelido})` : ''}`)
    linha('CNPJ', fmtDoc(r.cnpj))
    linha('Funcionário', `${r.funcionarioNome}${r.funcao ? `  ·  ${r.funcao}` : ''}`)
    // Tabela de parcelas
    y += 1
    const parc: [string, number][] = [[`1ª parcela — Novembro/${ano}`, r.valor_parcela], [`2ª parcela — Dezembro/${ano}`, r.valor_parcela]]
    d.setDrawColor(226, 232, 240); d.setLineWidth(0.2)
    for (const [rot, val] of parc) {
      d.rect(M + 4, y, areaW - 8, 9)
      d.setFont('helvetica', 'normal'); d.setFontSize(9); d.setTextColor(...TXT); d.text(rot, M + 7, y + 6)
      d.setFont('helvetica', 'bold'); d.text(formatarMoeda(val), W - M - 7, y + 6, { align: 'right' })
      y += 9
    }
    d.setFillColor(238, 242, 247); d.rect(M + 4, y, areaW - 8, 9, 'F'); d.rect(M + 4, y, areaW - 8, 9)
    d.setFont('helvetica', 'bold'); d.setFontSize(9.5); d.setTextColor(...NAVY)
    d.text('TOTAL 13º (VA)', M + 7, y + 6); d.text(formatarMoeda(cent(r.valor_parcela * 2)), W - M - 7, y + 6, { align: 'right' })
    d.setTextColor(...TXT); y += 13
    // Observação + assinatura
    d.setFont('helvetica', 'italic'); d.setFontSize(7.5); d.setTextColor(...SUAVE)
    d.text('Benefício de Vale Alimentação referente ao 13º salário. Não inclui Vale Transporte nem descontos.', M + 4, y); y += 8
    d.setDrawColor(120, 130, 145); d.setLineWidth(0.3); d.line(M + 50, y + 8, W - M - 50, y + 8)
    d.setFont('helvetica', 'normal'); d.setFontSize(8); d.setTextColor(...TXT)
    d.text('Assinatura do funcionário', W / 2, y + 12, { align: 'center' })
    return y0 + 122
  }

  regs.forEach((r, i) => {
    if (i > 0) d.addPage()
    let y = M
    y = via(r, y, 'VIA DO FUNCIONÁRIO')
    via(r, y + 4, 'VIA DA EMPRESA')
  })
  d.save(`13o_VA_${ano}.pdf`)
}

/** Exporta uma planilha consolidada do 13º VA (Empresa · Funcionário · nov · dez · total). */
export async function baixarPlanilha13(regs: Registro13[], ano: number): Promise<void> {
  const XLSX = await import('xlsx')
  const linhas: (string | number)[][] = [['Empresa', 'Funcionário', 'Função', 'VA Novembro', 'VA Dezembro', 'Total 13º VA']]
  for (const r of regs) linhas.push([r.empresaNome, r.funcionarioNome, r.funcao, r.valor_parcela, r.valor_parcela, cent(r.valor_parcela * 2)])
  const ws = XLSX.utils.aoa_to_sheet(linhas)
  ws['!cols'] = [{ wch: 28 }, { wch: 28 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 14 }]
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, `13o VA ${ano}`)
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' }))
  const a = document.createElement('a'); a.href = url; a.download = `13o_VA_${ano}.xlsx`; a.click(); URL.revokeObjectURL(url)
}

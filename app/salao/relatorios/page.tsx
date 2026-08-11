'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase, Empresa } from '../../../lib/supabase'
import { formatarMoeda, MESES } from '../../../utils/calculoVT'
import { SALAO_ENABLED, STATUS_LABEL } from '../../../lib/salao/config'
import { listarComissoes, resumoDoMes, listarHistorico } from '../../../lib/salao/comissoes'
import { exportarExcel, exportarPDF, type Coluna } from '../../../lib/salao/relatorios'
import type { Comissao } from '../../../lib/salao/tipos'

function competenciaAtual() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
function fmtMes(m: string) { const [a, mm] = m.split('-').map(Number); return mm ? `${MESES[mm - 1]}/${a}` : m }
function fmtDataHora(iso: string) { return iso ? new Date(iso).toLocaleString('pt-BR') : '' }
function fmtData(iso: string | null) { if (!iso) return ''; const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}` }

type RelKey = 'pendencias' | 'recebidas' | 'consolidado' | 'fora_prazo' | 'historico'

export default function SalaoRelatoriosPage() {
  const router = useRouter()
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresaId, setEmpresaId] = useState('')
  const [mes, setMes] = useState(competenciaAtual())
  const [busy, setBusy] = useState('')

  useEffect(() => {
    if (!SALAO_ENABLED) { router.replace('/dashboard'); return }
    supabase.from('empresas').select('*').order('razao_social').then(({ data }) => setEmpresas(data ?? []))
  }, [router])

  async function dados(): Promise<Comissao[]> {
    return listarComissoes({ empresaId: empresaId || undefined, mes })
  }

  async function gerar(rel: RelKey, formato: 'pdf' | 'xlsx') {
    setBusy(rel + formato)
    try {
      const sufixo = `${mes}${empresaId ? '_emp' : ''}`
      if (rel === 'pendencias') {
        const rows = (await dados()).filter(l => l.status !== 'recebida')
        const cols: Coluna[] = [
          { header: 'Empresa', get: r => r.empresaNome }, { header: 'Profissional', get: r => r.profissionalNome },
          { header: 'CPF/CNPJ', get: r => r.profissionalDoc }, { header: 'Mês', get: r => fmtMes(r.mes_ref) },
          { header: 'Valor em aberto', get: r => formatarMoeda(r.valor_comissao) }, { header: 'Status', get: r => STATUS_LABEL[r.status as keyof typeof STATUS_LABEL] },
        ]
        await run(`Pendências — ${fmtMes(mes)}`, cols, rows, `pendencias_${sufixo}`, formato)
      } else if (rel === 'recebidas') {
        const rows = (await dados()).filter(l => l.status === 'recebida')
        const cols: Coluna[] = [
          { header: 'Empresa', get: r => r.empresaNome }, { header: 'Profissional', get: r => r.profissionalNome },
          { header: 'NF Nº', get: r => r.nf_numero ?? '' }, { header: 'Data NF', get: r => fmtData(r.nf_data) },
          { header: 'Valor NF', get: r => formatarMoeda(r.nf_valor ?? 0) }, { header: 'Origem', get: r => r.nf_origem ?? '' },
        ]
        await run(`Notas recebidas — ${fmtMes(mes)}`, cols, rows, `notas_recebidas_${sufixo}`, formato)
      } else if (rel === 'fora_prazo') {
        const rows = (await dados()).filter(l => l.status === 'fora_prazo')
        const cols: Coluna[] = [
          { header: 'Empresa', get: r => r.empresaNome }, { header: 'Profissional', get: r => r.profissionalNome },
          { header: 'CPF/CNPJ', get: r => r.profissionalDoc }, { header: 'Mês', get: r => fmtMes(r.mes_ref) },
          { header: 'Valor', get: r => formatarMoeda(r.valor_comissao) },
        ]
        await run(`Fora do prazo — ${fmtMes(mes)}`, cols, rows, `fora_prazo_${sufixo}`, formato)
      } else if (rel === 'consolidado') {
        const linhas = await dados()
        const map = new Map<string, { empresa: string; total: number; recebido: number; qtd: number; qtdRec: number }>()
        for (const l of linhas) {
          const g = map.get(l.empresa_id) ?? { empresa: l.empresaNome ?? '', total: 0, recebido: 0, qtd: 0, qtdRec: 0 }
          g.total += l.valor_comissao || 0; g.qtd++
          if (l.status === 'recebida') { g.recebido += l.nf_valor ?? l.valor_comissao ?? 0; g.qtdRec++ }
          map.set(l.empresa_id, g)
        }
        const rows = Array.from(map.values())
        const cols: Coluna[] = [
          { header: 'Empresa', get: r => r.empresa }, { header: 'Comissões (total)', get: r => formatarMoeda(r.total) },
          { header: 'Recebido (NF)', get: r => formatarMoeda(r.recebido) },
          { header: '% Conformidade', get: r => (r.qtd ? Math.round((r.qtdRec / r.qtd) * 100) : 0) + '%' },
        ]
        await run(`Consolidado por empresa — ${fmtMes(mes)}`, cols, rows, `consolidado_${sufixo}`, formato)
      } else if (rel === 'historico') {
        const rows = await listarHistorico(500)
        const cols: Coluna[] = [
          { header: 'Data/Hora', get: r => fmtDataHora(r.criado_em) }, { header: 'Ação', get: r => r.acao },
          { header: 'Empresa', get: r => r.empresa }, { header: 'Profissional', get: r => r.profissional },
          { header: 'Detalhe', get: r => r.detalhe ?? '' }, { header: 'Usuário', get: r => r.usuario ?? '' },
        ]
        await run('Histórico de ações', cols, rows, 'historico', formato)
      }
    } finally { setBusy('') }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function run(titulo: string, cols: Coluna[], rows: any[], nome: string, formato: 'pdf' | 'xlsx') {
    if (rows.length === 0) { alert('Nada para exportar neste filtro.'); return }
    if (formato === 'pdf') await exportarPDF(titulo, cols, rows, nome)
    else await exportarExcel(titulo, cols, rows, nome)
  }

  if (!SALAO_ENABLED) return null

  const relatorios: { key: RelKey; titulo: string; desc: string }[] = [
    { key: 'pendencias', titulo: 'Pendências do mês', desc: 'Profissionais sem NF, com valor em aberto.' },
    { key: 'recebidas', titulo: 'Notas recebidas', desc: 'NFs confirmadas: número, data, valor.' },
    { key: 'consolidado', titulo: 'Consolidado por empresa', desc: 'Total de comissões, recebido e % de conformidade.' },
    { key: 'fora_prazo', titulo: 'Fora do prazo', desc: 'Quem ultrapassou o prazo de emissão.' },
    { key: 'historico', titulo: 'Histórico', desc: 'Log completo de confirmações e substituições.' },
  ]

  return (
    <LayoutAdmin title="Salão — Relatórios">
      <div className="space-y-6">
        <div className="card">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="label-field">Empresa</label>
              <select className="input-field" value={empresaId} onChange={e => setEmpresaId(e.target.value)}>
                <option value="">Todas as empresas</option>
                {empresas.map(e => <option key={e.id} value={e.id}>{e.apelido || e.razao_social}</option>)}
              </select>
            </div>
            <div><label className="label-field">Mês de referência</label><input type="month" className="input-field" value={mes} onChange={e => setMes(e.target.value)} /></div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {relatorios.map(r => (
            <div key={r.key} className="card flex items-center justify-between gap-4">
              <div>
                <div className="font-semibold text-gray-800">{r.titulo}</div>
                <div className="text-xs text-gray-500 mt-0.5">{r.desc}</div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button className="btn-secondary text-sm" onClick={() => gerar(r.key, 'pdf')} disabled={!!busy}>{busy === r.key + 'pdf' ? '...' : 'PDF'}</button>
                <button className="btn-secondary text-sm" onClick={() => gerar(r.key, 'xlsx')} disabled={!!busy}>{busy === r.key + 'xlsx' ? '...' : 'Excel'}</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </LayoutAdmin>
  )
}

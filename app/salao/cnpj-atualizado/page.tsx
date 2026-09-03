'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase, type Empresa } from '../../../lib/supabase'
import { SALAO_ENABLED } from '../../../lib/salao/config'

type Item = { empresa_id: string; nome: string; cnpjAtual: string; fonte: string; divergentes: string[]; comissoes: number; aplicaveis: number }
function fmtDoc(v: string) { const s = (v || '').replace(/\D/g, ''); if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5'); if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'); return v || '—' }

export default function CnpjAtualizadoPage() {
  const router = useRouter()
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresaId, setEmpresaId] = useState('')
  const [itens, setItens] = useState<Item[]>([])
  const [analisou, setAnalisou] = useState(false)
  const [loading, setLoading] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [msg, setMsg] = useState('')
  const [soDivergentes, setSoDivergentes] = useState(true)

  useEffect(() => { if (!SALAO_ENABLED) { router.replace('/dashboard'); return } supabase.from('empresas').select('*').order('razao_social').then(({ data }) => setEmpresas(data || [])) }, [router])

  const analisar = useCallback(async (aplicar = false) => {
    if (aplicar) setAplicando(true); else setLoading(true)
    setMsg(aplicar ? 'Aplicando a atualização de CNPJ…' : 'Analisando os profissionais…')
    try {
      const res = await fetch('/api/salao/cnpj-profissionais', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ empresaId: empresaId || undefined, aplicar }) })
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.ok) throw new Error(j?.erro || `Falha (HTTP ${res.status}).`)
      setItens(j.itens || []); setAnalisou(true)
      setMsg(aplicar
        ? `Atualização aplicada: ${j.aplicadas} registro(s) de comissão corrigido(s), ${j.profissionais} profissional(is) no cadastro${j.conflitos ? `, ${j.conflitos} conflito(s) ignorado(s)` : ''}.`
        : `${j.total} profissional(is) analisado(s) · ${j.comDivergencia} com CNPJ desatualizado.`)
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Falha ao processar.') }
    finally { setLoading(false); setAplicando(false) }
  }, [empresaId])

  async function exportar() {
    const XLSX = await import('xlsx')
    const nomeEmp = (id: string) => { const e = empresas.find(x => x.id === id); return e?.apelido || e?.razao_social || '' }
    // Planilha final pedida: Nome · CNPJ · Unidade (com o CNPJ atualizado).
    const aoa: (string | number)[][] = [['Nome', 'CNPJ', 'Unidade']]
    for (const i of [...itens].sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'))) {
      aoa.push([i.nome, fmtDoc(i.cnpjAtual), nomeEmp(i.empresa_id)])
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 32 }, { wch: 20 }, { wch: 20 }]
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Profissionais')
    XLSX.writeFile(wb, `profissionais_cnpj_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const visiveis = soDivergentes ? itens.filter(i => i.aplicaveis > 0) : itens
  if (!SALAO_ENABLED) return null
  return <LayoutAdmin title="Salão — CNPJ atualizado dos profissionais"><div className="space-y-4">
    <section className="rounded-xl bg-slate-900 p-4 text-white">
      <h1 className="text-lg font-semibold">Atualização de CNPJ dos profissionais</h1>
      <p className="mt-1 max-w-3xl text-xs text-slate-300">O CNPJ/CPF atual de cada profissional (agrupado por nome na unidade) é o da <b>nota vinculada mais recente</b> que você confirmou; se não houver vínculo, é o da <b>última importação</b>. Aqui você revisa e aplica esse documento nos registros importados e no cadastro — para o casamento por CNPJ passar a bater.</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div><label className="block text-xs text-slate-300">Unidade</label><select className="mt-1 rounded-lg bg-slate-800 px-3 py-2 text-sm" value={empresaId} onChange={e => setEmpresaId(e.target.value)}><option value="">Todas</option>{empresas.map(e => <option key={e.id} value={e.id}>{e.apelido || e.razao_social}</option>)}</select></div>
        <button onClick={() => analisar(false)} disabled={loading || aplicando} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-50">{loading ? 'Analisando…' : 'Analisar'}</button>
        {analisou && itens.length > 0 && <>
          <button onClick={() => analisar(true)} disabled={aplicando || loading} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50">{aplicando ? 'Aplicando…' : 'Aplicar atualização'}</button>
          <button onClick={exportar} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold hover:bg-slate-800">Exportar planilha</button>
        </>}
      </div>
    </section>
    {msg && <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">{msg}</div>}
    {analisou && <section className="rounded-xl border bg-white shadow-sm">
      <div className="flex items-center justify-between border-b p-3">
        <h2 className="text-sm font-semibold text-slate-800">{visiveis.length} profissional(is)</h2>
        <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={soDivergentes} onChange={e => setSoDivergentes(e.target.checked)} /> Só com CNPJ desatualizado</label>
      </div>
      {visiveis.length === 0 ? <div className="py-12 text-center text-sm text-slate-400">Nenhum profissional {soDivergentes ? 'com CNPJ desatualizado.' : 'encontrado.'}</div>
        : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="bg-gray-50"><th className="table-header">Profissional</th><th className="table-header">CNPJ/CPF atual</th><th className="table-header">Fonte</th><th className="table-header">CNPJs antigos</th><th className="table-header text-right">A corrigir</th></tr></thead>
          <tbody className="divide-y">{visiveis.map((i, idx) => <tr key={idx} className="hover:bg-gray-50">
            <td className="table-cell font-medium">{i.nome}</td>
            <td className="table-cell font-mono">{fmtDoc(i.cnpjAtual)}</td>
            <td className="table-cell"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${i.fonte === 'nota vinculada' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{i.fonte}</span></td>
            <td className="table-cell font-mono text-xs text-amber-700">{i.divergentes.length ? i.divergentes.map(fmtDoc).join(' · ') : '—'}</td>
            <td className="table-cell text-right">{i.aplicaveis || '—'}</td>
          </tr>)}</tbody></table></div>}
    </section>}
  </div></LayoutAdmin>
}

'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase, type Empresa } from '../../../lib/supabase'
import { formatarMoeda } from '../../../utils/calculoVT'
import { type LinhaImportSalario } from '../../../lib/pagamentos'
import { importarPlanilha13, baixarModelo13, processar13, listar13, limpar13, gerarRecibos13, baixarPlanilha13, type Registro13 } from '../../../lib/decimoVA'

export default function Decimo13VAPage() {
  const anoAtual = new Date().getFullYear()
  const [ano, setAno] = useState(anoAtual)
  const [empresaId, setEmpresaId] = useState('')
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [preview, setPreview] = useState<LinhaImportSalario[]>([])
  const [erros, setErros] = useState<string[]>([])
  const [registros, setRegistros] = useState<Registro13[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null)

  useEffect(() => { supabase.from('empresas').select('*').order('razao_social').then(({ data }) => setEmpresas(data || [])) }, [])
  const carregar = useCallback(async () => { setRegistros(await listar13(ano, empresaId || undefined)) }, [ano, empresaId])
  useEffect(() => { carregar() }, [carregar])

  const notify = (t: string, ok = true) => { setMsg({ t, ok }); setTimeout(() => setMsg(null), 9000) }

  async function handleArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    setBusy(true); setPreview([]); setErros([])
    try { const { linhas, erros } = await importarPlanilha13(f); setPreview(linhas); setErros(erros) }
    catch (err) { notify(err instanceof Error ? err.message : 'Falha ao ler a planilha.', false) }
    finally { setBusy(false); e.target.value = '' }
  }
  async function confirmar() {
    if (!preview.length) return
    setBusy(true)
    try {
      const { gravados, erro } = await processar13(preview, ano, 'parcela')
      if (erro) { notify(erro.includes('pagamento_13_va') ? 'Rode a migração supabase_pagamento_13_va.sql no Supabase.' : erro, false); return }
      notify(`${gravados} funcionário(s) importado(s) no 13º VA de ${ano}.`)
      setPreview([]); setErros([]); await carregar()
    } finally { setBusy(false) }
  }
  async function limpar() {
    if (!confirm(`Remover TODO o 13º VA de ${ano}${empresaId ? ' desta empresa' : ''}? Esta ação não pode ser desfeita.`)) return
    setBusy(true)
    try { const r = await limpar13(ano, empresaId || undefined); if (r.erro) { notify(r.erro, false); return } notify('13º VA removido.'); await carregar() } finally { setBusy(false) }
  }

  const totalParcela = useMemo(() => registros.reduce((s, r) => s + r.valor_parcela, 0), [registros])
  const totalGeral = totalParcela * 2
  const totalPreview = useMemo(() => preview.reduce((s, l) => s + l.valorLiquido, 0), [preview])

  return (
    <LayoutAdmin title="13º · Vale Alimentação" actions={
      <div className="flex items-center gap-2">
        <button className="btn-secondary text-sm" disabled={!registros.length || busy} onClick={() => baixarPlanilha13(registros, ano)}>Planilha</button>
        <button className="btn-primary text-sm" disabled={!registros.length || busy} onClick={() => gerarRecibos13(registros, ano)}>Gerar recibos (PDF)</button>
      </div>
    }>
      <div className="space-y-4">
        {msg && <div className={`rounded-lg border px-4 py-3 text-sm ${msg.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>{msg.t}</div>}

        <section className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
          13º Salário — <b>Vale Alimentação</b> em <b>2 parcelas (Novembro e Dezembro)</b>. Importa só o VA: <b>sem vale transporte e sem descontos</b>.
          Baixe o modelo (colunas <b>Apelido · Nome · Valor</b>), preencha o valor do VA e importe.
        </section>

        {/* Importação */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <div><label className="label-field">Ano</label><input type="number" min={2024} max={2100} className="input-field w-28" value={ano} onChange={e => setAno(Number(e.target.value) || anoAtual)} /></div>
            <div className="min-w-[200px] flex-1"><label className="label-field">Empresa</label><select className="input-field" value={empresaId} onChange={e => setEmpresaId(e.target.value)}><option value="">Todas as empresas</option>{empresas.map(e => <option key={e.id} value={e.id}>{e.apelido || e.razao_social}</option>)}</select></div>
            <button className="btn-secondary text-sm" disabled={busy} onClick={() => baixarModelo13(empresaId || undefined)}>Baixar modelo</button>
            <label className={`cursor-pointer rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 ${busy ? 'opacity-50' : ''}`}>{busy ? 'Lendo…' : 'Importar planilha'}<input type="file" accept=".xlsx,.xls" className="hidden" disabled={busy} onChange={handleArquivo} /></label>
          </div>
          <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">O valor da planilha é o <b>VA de cada parcela</b>: Novembro e Dezembro recebem esse mesmo valor.</p>
        </section>

        {/* Alertas da importação */}
        {erros.length > 0 && <section className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><b>Alertas ({erros.length}):</b><ul className="mt-1 max-h-40 list-disc overflow-auto pl-5">{erros.map((e, i) => <li key={i}>{e}</li>)}</ul></section>}

        {/* Prévia antes de confirmar */}
        {preview.length > 0 && <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
            <div className="text-sm font-semibold text-slate-800">Prévia · {preview.length} funcionário(s) · total por parcela {formatarMoeda(totalPreview)}</div>
            <div className="flex gap-2"><button className="btn-secondary text-sm" onClick={() => { setPreview([]); setErros([]) }}>Cancelar</button><button className="btn-primary text-sm" disabled={busy} onClick={confirmar}>Confirmar 13º de {ano}</button></div>
          </div>
          <div className="max-h-72 overflow-auto"><table className="w-full text-sm"><thead className="sticky top-0 bg-slate-50 text-left text-[11px] uppercase text-slate-500"><tr><th className="px-3 py-2">Funcionário</th><th className="px-3 py-2">Empresa</th><th className="px-3 py-2 text-right">VA nov</th><th className="px-3 py-2 text-right">VA dez</th><th className="px-3 py-2 text-right">Total</th></tr></thead><tbody className="divide-y divide-slate-100">{preview.map((l, i) => { const p = l.valorLiquido; return <tr key={i} className="hover:bg-slate-50"><td className="px-3 py-1.5 font-medium">{l.funcionarioNome}</td><td className="px-3 py-1.5 text-slate-500">{l.empresaNome}</td><td className="px-3 py-1.5 text-right tabular-nums">{formatarMoeda(p)}</td><td className="px-3 py-1.5 text-right tabular-nums">{formatarMoeda(p)}</td><td className="px-3 py-1.5 text-right font-semibold tabular-nums">{formatarMoeda(p * 2)}</td></tr> })}</tbody></table></div>
        </section>}

        {/* Placar */}
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Kpi label={`Funcionários (${ano})`} valor={registros.length} />
          <Kpi label="Por parcela" valor={formatarMoeda(totalParcela)} />
          <Kpi label="Total 13º VA" valor={formatarMoeda(totalGeral)} tom="emerald" />
          <Kpi label="Empresas" valor={new Set(registros.map(r => r.empresa_id)).size} />
        </section>

        {/* 13º já gravado */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
            <h2 className="font-semibold text-slate-800">13º VA gravado · {ano}</h2>
            {registros.length > 0 && <button className="text-xs font-medium text-red-600 hover:underline" disabled={busy} onClick={limpar}>Remover 13º de {ano}{empresaId ? ' (esta empresa)' : ''}</button>}
          </div>
          {registros.length === 0 ? <div className="px-4 py-12 text-center text-sm text-slate-400">Nenhum 13º VA gravado para {ano}. Importe uma planilha acima.</div>
            : <div className="max-h-[520px] overflow-auto"><table className="w-full text-sm"><thead className="sticky top-0 bg-slate-50 text-left text-[11px] uppercase text-slate-500"><tr><th className="px-3 py-2">Funcionário</th><th className="px-3 py-2">Função</th><th className="px-3 py-2">Empresa</th><th className="px-3 py-2 text-right">Nov</th><th className="px-3 py-2 text-right">Dez</th><th className="px-3 py-2 text-right">Total</th></tr></thead><tbody className="divide-y divide-slate-100">{registros.map(r => <tr key={r.id} className="hover:bg-slate-50"><td className="px-3 py-1.5 font-medium text-slate-900">{r.funcionarioNome}</td><td className="px-3 py-1.5 text-slate-500">{r.funcao || '—'}</td><td className="px-3 py-1.5 text-slate-500">{r.apelido || r.empresaNome}</td><td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{formatarMoeda(r.valor_parcela)}</td><td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{formatarMoeda(r.valor_parcela)}</td><td className="px-3 py-1.5 text-right font-semibold tabular-nums">{formatarMoeda(r.valor_parcela * 2)}</td></tr>)}</tbody></table></div>}
        </section>
      </div>
    </LayoutAdmin>
  )
}

function Kpi({ label, valor, tom = 'slate' }: { label: string; valor: number | string; tom?: 'slate' | 'emerald' }) {
  const cor = tom === 'emerald' ? 'text-emerald-700' : 'text-slate-900'
  return <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><span className="text-xs text-slate-500">{label}</span><b className={`block text-2xl ${cor}`}>{valor}</b></div>
}

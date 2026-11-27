'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase, type Empresa } from '../../../lib/supabase'
import { formatarMoeda } from '../../../utils/calculoVT'
import { type LinhaImportSalario } from '../../../lib/pagamentos'
import { importarPlanilha13, baixarModelo13, processar13, listar13, limpar13, gerarRecibos13, baixarPlanilha13, baixarCSV13, salvarDesconto13, parcela2_13, total13, type Registro13 } from '../../../lib/decimoVA'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

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
  const totalParcela2 = useMemo(() => registros.reduce((s, r) => s + parcela2_13(r), 0), [registros])
  const totalGeral = useMemo(() => registros.reduce((s, r) => s + total13(r), 0), [registros])
  const totalPreview = useMemo(() => preview.reduce((s, l) => s + l.valorLiquido, 0), [preview])

  function gerarCSV(parcela: 1 | 2) {
    if (!registros.length) return
    const { linhas, semPix } = baixarCSV13(registros, ano, parcela)
    notify(`CSV ${parcela}ª parcela (${parcela === 1 ? 'Novembro' : 'Dezembro'}) · ${linhas} pagamento(s)${semPix ? ` · ${semPix} sem chave Pix` : ''}.`, semPix === 0)
  }
  async function salvarDesc(reg: Registro13, valor: string) {
    const d = Math.max(0, Number(String(valor).replace(/\./g, '').replace(',', '.')) || 0)
    if (cent(d) === cent(reg.desconto2a)) return
    const r = await salvarDesconto13(reg.id, d)
    if (!r.ok) { notify(r.erro || 'Falha ao salvar o desconto.', false); return }
    setRegistros(rs => rs.map(x => x.id === reg.id ? { ...x, desconto2a: cent(d) } : x))
  }

  return (
    <LayoutAdmin title="13º · Vale Alimentação" actions={
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-secondary text-sm" disabled={!registros.length || busy} onClick={() => gerarCSV(1)} title="Arquivo CSV do banco — 1ª parcela (Novembro)">CSV banco · Nov</button>
        <button className="btn-secondary text-sm" disabled={!registros.length || busy} onClick={() => gerarCSV(2)} title="Arquivo CSV do banco — 2ª parcela (Dezembro, já com desconto)">CSV banco · Dez</button>
        <button className="btn-secondary text-sm" disabled={!registros.length || busy} onClick={() => baixarPlanilha13(registros, ano)}>Planilha</button>
        <button className="btn-primary text-sm" disabled={!registros.length || busy} onClick={() => gerarRecibos13(registros, ano)}>Gerar recibos (PDF)</button>
      </div>
    }>
      <div className="space-y-4">
        {msg && <div className={`rounded-lg border px-4 py-3 text-sm ${msg.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>{msg.t}</div>}

        <section className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
          13º Salário — <b>Vale Alimentação</b> em <b>2 parcelas (Novembro e Dezembro)</b>, <b>sem vale transporte</b>.
          Importe o VA (colunas <b>Apelido · Nome · Valor</b>): a 1ª parcela (Nov) recebe o valor cheio. O <b>desconto do 13º é lançado na 2ª parcela (Dez)</b> direto na tabela abaixo — por isso dezembro fica menor.
          Depois gere o <b>CSV do banco</b> de cada parcela (pela chave Pix do cadastro).
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
          <Kpi label="1ª parcela · Nov" valor={formatarMoeda(totalParcela)} />
          <Kpi label="2ª parcela · Dez" valor={formatarMoeda(totalParcela2)} />
          <Kpi label="Total 13º VA" valor={formatarMoeda(totalGeral)} tom="emerald" />
        </section>

        {/* 13º já gravado */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
            <h2 className="font-semibold text-slate-800">13º VA gravado · {ano}</h2>
            {registros.length > 0 && <button className="text-xs font-medium text-red-600 hover:underline" disabled={busy} onClick={limpar}>Remover 13º de {ano}{empresaId ? ' (esta empresa)' : ''}</button>}
          </div>
          {registros.length === 0 ? <div className="px-4 py-12 text-center text-sm text-slate-400">Nenhum 13º VA gravado para {ano}. Importe uma planilha acima.</div>
            : <div className="max-h-[520px] overflow-auto"><table className="w-full text-sm"><thead className="sticky top-0 bg-slate-50 text-left text-[11px] uppercase text-slate-500"><tr><th className="px-3 py-2">Funcionário</th><th className="px-3 py-2">Função</th><th className="px-3 py-2">Empresa</th><th className="px-3 py-2 text-right">Nov</th><th className="px-3 py-2 text-right">Desconto (Dez)</th><th className="px-3 py-2 text-right">Dez</th><th className="px-3 py-2 text-right">Total</th></tr></thead><tbody className="divide-y divide-slate-100">{registros.map(r => <tr key={r.id} className="hover:bg-slate-50"><td className="px-3 py-1.5 font-medium text-slate-900">{r.funcionarioNome}{!r.pix && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-700" title="Sem chave Pix no cadastro — não entra no CSV do banco">sem Pix</span>}</td><td className="px-3 py-1.5 text-slate-500">{r.funcao || '—'}</td><td className="px-3 py-1.5 text-slate-500">{r.apelido || r.empresaNome}</td><td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{formatarMoeda(r.valor_parcela)}</td><td className="px-3 py-1.5 text-right"><input key={`${r.id}:${r.desconto2a}`} type="text" inputMode="decimal" defaultValue={r.desconto2a ? r.desconto2a.toFixed(2).replace('.', ',') : ''} onBlur={e => salvarDesc(r, e.target.value)} placeholder="0,00" disabled={busy} className="w-24 rounded-md border border-slate-200 px-2 py-1 text-right text-sm tabular-nums focus:border-blue-400 focus:outline-none" title="Desconto lançado na 2ª parcela (Dezembro)" /></td><td className={`px-3 py-1.5 text-right tabular-nums ${cent(r.desconto2a) > 0 ? 'font-semibold text-amber-700' : 'text-slate-700'}`}>{formatarMoeda(parcela2_13(r))}</td><td className="px-3 py-1.5 text-right font-semibold tabular-nums">{formatarMoeda(total13(r))}</td></tr>)}</tbody></table></div>}
        </section>
      </div>
    </LayoutAdmin>
  )
}

function Kpi({ label, valor, tom = 'slate' }: { label: string; valor: number | string; tom?: 'slate' | 'emerald' }) {
  const cor = tom === 'emerald' ? 'text-emerald-700' : 'text-slate-900'
  return <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><span className="text-xs text-slate-500">{label}</span><b className={`block text-2xl ${cor}`}>{valor}</b></div>
}

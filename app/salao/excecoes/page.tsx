'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { SALAO_ENABLED } from '../../../lib/salao/config'
import { consultarConferencia, editarComissao, refazerConferencia, SITUACAO_LABEL, type LinhaConsulta, type Situacao } from '../../../lib/salao/conferencia'

const EXCECOES: { valor: Situacao; label: string }[] = [
  { valor: 'falta_cnpj', label: 'Sem CNPJ' },
  { valor: 'cnpj_invalido', label: 'CNPJ inválido' },
  { valor: 'sem_nota', label: 'Profissionais sem nota' },
  { valor: 'nota_sem_vinculo', label: 'Notas sem vínculo' },
  { valor: 'possivel_duplicidade', label: 'Possíveis duplicidades' },
  { valor: 'nota_outra_empresa', label: 'Conflito de empresa' },
  { valor: 'aguardando_confirmacao', label: 'Aguardando confirmação' },
  { valor: 'divergencia_valor', label: 'Valor divergente' },
]

function mesAtual() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

export default function ExcecoesPage() {
  const router = useRouter()
  const [competencia, setCompetencia] = useState(mesAtual())
  const [situacao, setSituacao] = useState<Situacao>('falta_cnpj')
  const [linhas, setLinhas] = useState<LinhaConsulta[]>([])
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [pagina, setPagina] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { if (!SALAO_ENABLED) router.replace('/dashboard') }, [router])
  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const r = await consultarConferencia({ competencia, situacao }, { campo: 'nome', dir: 'asc' }, pagina, 50)
      setLinhas(r.linhas); setTotal(r.total)
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Erro ao consultar exceções.') }
    finally { setLoading(false) }
  }, [competencia, situacao, pagina])
  useEffect(() => { if (SALAO_ENABLED) carregar() }, [carregar])

  function alternar(id: string) { setSelecionados(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  async function aplicarCompetencia() {
    const nova = window.prompt('Nova competência (AAAA-MM):', competencia)
    if (!nova) return
    const alvos = linhas.filter(l => selecionados.has(l.id) && l.tipo === 'comissao')
    for (const l of alvos) await editarComissao(l.id, { mes_ref: nova }, 'ação em lote')
    setSelecionados(new Set()); setMsg(`${alvos.length} registro(s) atualizado(s).`); carregar()
  }
  async function reprocessar() {
    await refazerConferencia(competencia)
    setMsg('Vínculos da competência reprocessados.'); setSelecionados(new Set()); carregar()
  }
  function exportar() {
    const rows = linhas.filter(l => selecionados.size === 0 || selecionados.has(l.id))
    const csv = [['Tipo','Nome','CPF/CNPJ','Empresa','Competência','Situação'], ...rows.map(l => [l.tipo,l.nome || '',l.documento || '',l.empresaNome,l.mes_ref,SITUACAO_LABEL[l.situacao]])]
      .map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(';')).join('\n')
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv'})); a.download=`excecoes_${competencia}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }

  if (!SALAO_ENABLED) return null
  return <LayoutAdmin title="Salão — Central de Exceções">
    <div className="space-y-4">
      {msg && <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{msg}</div>}
      <div className="card">
        <div className="flex flex-wrap items-end gap-3">
          <div><label className="label-field">Competência</label><input type="month" className="input-field" value={competencia} onChange={e=>{setCompetencia(e.target.value);setPagina(1)}} /></div>
          <div className="min-w-[240px]"><label className="label-field">Tipo de pendência</label><select className="input-field" value={situacao} onChange={e=>{setSituacao(e.target.value as Situacao);setPagina(1);setSelecionados(new Set())}}>{EXCECOES.map(x=><option key={x.valor} value={x.valor}>{x.label}</option>)}</select></div>
          <div className="flex-1" />
          <button className="btn-secondary text-sm" onClick={exportar}>Exportar pendências</button>
          <button className="btn-secondary text-sm" onClick={reprocessar}>Reprocessar vínculos</button>
          <button className="btn-primary text-sm" disabled={!selecionados.size} onClick={aplicarCompetencia}>Aplicar competência</button>
        </div>
      </div>
      <div className="card">
        <div className="mb-3 flex justify-between text-sm"><strong>{total} pendência(s)</strong><span>{selecionados.size} selecionada(s)</span></div>
        {loading ? <div className="py-10 text-center text-gray-400">Carregando...</div> : <div className="overflow-x-auto"><table className="w-full">
          <thead><tr className="border-b bg-gray-50"><th className="table-header"><input type="checkbox" aria-label="Selecionar página" checked={linhas.length>0&&linhas.every(l=>selecionados.has(l.id))} onChange={e=>setSelecionados(e.target.checked?new Set(linhas.map(l=>l.id)):new Set())}/></th><th className="table-header">Profissional/emitente</th><th className="table-header">CPF/CNPJ</th><th className="table-header">Empresa</th><th className="table-header">Competência</th><th className="table-header">Pendência</th></tr></thead>
          <tbody className="divide-y">{linhas.map(l=><tr key={l.tipo+l.id} className="hover:bg-gray-50"><td className="table-cell"><input type="checkbox" aria-label={`Selecionar ${l.nome||'registro'}`} checked={selecionados.has(l.id)} onChange={()=>alternar(l.id)}/></td><td className="table-cell font-medium">{l.nome||'—'}</td><td className="table-cell">{l.documento||'—'}</td><td className="table-cell">{l.empresaNome}</td><td className="table-cell">{l.mes_ref}</td><td className="table-cell"><span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800">{SITUACAO_LABEL[l.situacao]}</span></td></tr>)}</tbody>
        </table></div>}
        <div className="mt-4 flex justify-end gap-2"><button className="btn-secondary text-sm" disabled={pagina===1} onClick={()=>setPagina(p=>p-1)}>Anterior</button><span className="px-3 py-2 text-sm">Página {pagina}</span><button className="btn-secondary text-sm" disabled={pagina*50>=total} onClick={()=>setPagina(p=>p+1)}>Próxima</button></div>
      </div>
    </div>
  </LayoutAdmin>
}

'use client'

import { useCallback, useDeferredValue, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase,type Empresa } from '../../../lib/supabase'
import { SALAO_ENABLED } from '../../../lib/salao/config'
import { consultarConferencia, editarComissao, editarNota, excluirComissao, excluirNota, classificarNota, setAnaliseManual, refazerConferencia, SITUACAO_LABEL, type LinhaConsulta, type Situacao } from '../../../lib/salao/conferencia'

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
  const [empresaId,setEmpresaId]=useState('')
  const [empresas,setEmpresas]=useState<Empresa[]>([])
  const [busca,setBusca]=useState('');const buscaD=useDeferredValue(busca)
  const [novaCompetencia,setNovaCompetencia]=useState(mesAtual())
  const [situacao, setSituacao] = useState<Situacao>('falta_cnpj')
  const [linhas, setLinhas] = useState<LinhaConsulta[]>([])
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [pagina, setPagina] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [ocupado,setOcupado]=useState(false)
  const [usuario,setUsuario]=useState<string|undefined>()
  const [editando,setEditando]=useState<LinhaConsulta|null>(null)
  const [form,setForm]=useState<Record<string,string>>({})

  useEffect(() => { if (!SALAO_ENABLED) router.replace('/dashboard'); else {supabase.from('empresas').select('*').order('razao_social').then(({data})=>setEmpresas(data||[]));supabase.auth.getUser().then(({data})=>setUsuario(data.user?.email))} }, [router])
  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const r = await consultarConferencia({ competencia, situacao, empresaId:empresaId||undefined, busca:buscaD||undefined }, { campo: 'nome', dir: 'asc' }, pagina, 50)
      setLinhas(r.linhas); setTotal(r.total)
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Erro ao consultar exceções.') }
    finally { setLoading(false) }
  }, [competencia, situacao, empresaId, buscaD, pagina])
  useEffect(() => { if (SALAO_ENABLED) carregar() }, [carregar])

  function abrirEdicao(l:LinhaConsulta){setEditando(l);setForm(l.tipo==='nota'?{emitente_nome:l.nome||'',documento:l.documento||'',numero:l.nf_numero||'',data_emissao:l.nf_data||'',competencia:l.nota_competencia||l.mes_ref,valor:String(l.nf_valor||'')}:{nome:l.nome||'',documento:l.documento||'',mes_ref:l.mes_ref,valor_comissao:String(l.valor_comissao||''),observacao:l.observacao||''})}
  async function salvarEdicao(){if(!editando||ocupado)return;setOcupado(true);const r=editando.tipo==='nota'?await editarNota(editando.id,form,usuario):await editarComissao(editando.id,form,usuario);setOcupado(false);if(!r.ok){setMsg(r.erro||'Erro ao salvar.');return}setEditando(null);setMsg('Registro corrigido e reavaliado.');carregar()}
  async function analisar(l:LinhaConsulta){setLinhas(v=>v.filter(x=>x.id!==l.id));const r=await setAnaliseManual(l.tipo==='nota'?'nota':'comissao',l.id,true,'Separado na Central de Exceções',usuario);if(!r.ok){setMsg(r.erro||'Erro.');carregar();return}setMsg('Registro separado para análise.')}
  async function remover(l:LinhaConsulta){setLinhas(v=>v.filter(x=>x.id!==l.id));const r=l.tipo==='nota'?await excluirNota(l.id,'Exclusão pela Central de Exceções',usuario):await excluirComissao(l.id,usuario);if(!r.ok){setMsg(r.erro||'Erro ao excluir.');carregar();return}setMsg(l.tipo==='nota'?'Nota removida e enviada à auditoria.':'Profissional removido dos dados importados.')}
  async function outroServico(l:LinhaConsulta){if(l.tipo!=='nota')return;setLinhas(v=>v.filter(x=>x.id!==l.id));const r=await classificarNota(l.id,'outro_servico',{categoria:'Outro serviço',observacao:'Classificado pela Central de Exceções',usuario});if(!r.ok){setMsg(r.erro||'Erro.');carregar();return}setMsg('Nota movida para Outros Serviços.')}
  function alternar(id: string) { setSelecionados(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  async function aplicarCompetencia() {
    if(!novaCompetencia)return
    const alvos = linhas.filter(l => selecionados.has(l.id) && l.tipo === 'comissao')
    setOcupado(true);const resultados=await Promise.all(alvos.map(l=>editarComissao(l.id,{mes_ref:novaCompetencia},'ação em lote')));setOcupado(false);const falhas=resultados.filter(r=>!r.ok).length
    setSelecionados(new Set()); setMsg(`${alvos.length-falhas} registro(s) atualizado(s)${falhas?` · ${falhas} falha(s)`:''}.`); carregar()
  }
  async function reprocessar() {
    setOcupado(true);await refazerConferencia(competencia);setOcupado(false)
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
          <div><label className="label-field">Competência</label><input type="month" className="input-field" value={competencia} onChange={e=>{setCompetencia(e.target.value);setPagina(1)}} /></div><div className="min-w-[200px]"><label className="label-field">Empresa</label><select className="input-field" value={empresaId} onChange={e=>{setEmpresaId(e.target.value);setPagina(1)}}><option value="">Todas</option>{empresas.map(e=><option key={e.id} value={e.id}>{e.apelido||e.razao_social}</option>)}</select></div><div className="min-w-[220px] flex-1"><label className="label-field">Buscar</label><input type="search" className="input-field" placeholder="Nome, CNPJ ou nota" value={busca} onChange={e=>{setBusca(e.target.value);setPagina(1)}}/></div>
          <div className="min-w-[240px]"><label className="label-field">Tipo de pendência</label><select className="input-field" value={situacao} onChange={e=>{setSituacao(e.target.value as Situacao);setPagina(1);setSelecionados(new Set())}}>{EXCECOES.map(x=><option key={x.valor} value={x.valor}>{x.label}</option>)}</select></div>
          <div className="w-full border-t pt-3 md:w-auto md:border-0 md:pt-0"><label className="label-field">Mover selecionados para</label><input type="month" className="input-field" value={novaCompetencia} onChange={e=>setNovaCompetencia(e.target.value)}/></div>
          <button className="btn-secondary text-sm" onClick={exportar}>Exportar pendências</button>
          <button className="btn-secondary text-sm" disabled={ocupado} onClick={reprocessar}>{ocupado?'Processando…':'Reprocessar vínculos'}</button>
          <button className="btn-primary text-sm" disabled={!selecionados.size||ocupado} onClick={aplicarCompetencia}>Mover competência</button>
        </div>
      </div>
      {editando&&<section className="rounded-xl border border-blue-200 bg-blue-50/50 p-4"><div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold">Corrigir {editando.tipo==='nota'?'nota':'profissional importado'}</h2><p className="text-xs text-slate-500">O registro será reavaliado após salvar.</p></div><button onClick={()=>setEditando(null)}>×</button></div><div className="grid gap-3 md:grid-cols-4">{Object.entries(form).map(([k,v])=><div key={k}><label className="label-field">{k.replaceAll('_',' ')}</label><input className="input-field" type={k.includes('data')?'date':k.includes('mes_ref')||k==='competencia'?'month':'text'} value={v} onChange={e=>setForm({...form,[k]:e.target.value})}/></div>)}</div><div className="mt-3 flex justify-end gap-2"><button className="btn-secondary" onClick={()=>setEditando(null)}>Cancelar</button><button className="btn-primary" disabled={ocupado} onClick={salvarEdicao}>{ocupado?'Salvando…':'Salvar correção'}</button></div></section>}
      <div className="card">
        <div className="mb-3 flex justify-between text-sm"><strong>{total} pendência(s)</strong><span>{selecionados.size} selecionada(s)</span></div>
        {loading ? <div className="py-10 text-center text-gray-400">Carregando...</div> : linhas.length===0?<div className="py-14 text-center text-sm text-gray-500">Nenhuma pendência encontrada com estes filtros.</div>:<div className="overflow-x-auto"><table className="w-full">
          <thead><tr className="border-b bg-gray-50"><th className="table-header"><input type="checkbox" aria-label="Selecionar página" checked={linhas.length>0&&linhas.every(l=>selecionados.has(l.id))} onChange={e=>setSelecionados(e.target.checked?new Set(linhas.map(l=>l.id)):new Set())}/></th><th className="table-header">Profissional/emitente</th><th className="table-header">CPF/CNPJ</th><th className="table-header">Empresa</th><th className="table-header">Competência</th><th className="table-header">Pendência</th><th className="table-header text-right">Tratar</th></tr></thead>
          <tbody className="divide-y">{linhas.map(l=><tr key={l.tipo+l.id} className="hover:bg-gray-50"><td className="table-cell"><input type="checkbox" aria-label={`Selecionar ${l.nome||'registro'}`} checked={selecionados.has(l.id)} onChange={()=>alternar(l.id)}/></td><td className="table-cell font-medium">{l.nome||'—'}</td><td className="table-cell">{l.documento||'—'}</td><td className="table-cell">{l.empresaNome}</td><td className="table-cell">{l.mes_ref}</td><td className="table-cell"><span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800">{SITUACAO_LABEL[l.situacao]}</span></td><td className="table-cell text-right whitespace-nowrap"><button className="mr-3 text-xs font-semibold text-blue-700" onClick={()=>abrirEdicao(l)}>Editar</button><button className="mr-3 text-xs font-semibold text-slate-600" onClick={()=>analisar(l)}>Analisar</button>{l.tipo==='nota'&&<button className="mr-3 text-xs font-semibold text-amber-700" onClick={()=>outroServico(l)}>Outro serviço</button>}<button className="text-xs font-semibold text-red-600" onClick={()=>remover(l)}>Excluir</button></td></tr>)}</tbody>
        </table></div>}
        <div className="mt-4 flex justify-end gap-2"><button className="btn-secondary text-sm" disabled={pagina===1} onClick={()=>setPagina(p=>p-1)}>Anterior</button><span className="px-3 py-2 text-sm">Página {pagina}</span><button className="btn-secondary text-sm" disabled={pagina*50>=total} onClick={()=>setPagina(p=>p+1)}>Próxima</button></div>
      </div>
    </div>
  </LayoutAdmin>
}

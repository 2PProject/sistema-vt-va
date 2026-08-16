'use client'
import { useCallback,useEffect,useMemo,useRef,useState } from 'react'
import { useRouter } from 'next/navigation'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase,type Empresa } from '../../../lib/supabase'
import { SALAO_ENABLED } from '../../../lib/salao/config'
import { consultarConferencia,type LinhaConsulta } from '../../../lib/salao/conferencia'
import { exportarPDF,type Coluna } from '../../../lib/salao/relatorios'
import { formatarMoeda,MESES } from '../../../utils/calculoVT'

type Aba='todos'|'pendentes'|'conferidos'
function fmtMes(m:string){const[a,mm]=m.split('-').map(Number);return mm?`${MESES[mm-1]}/${a}`:''}
function fmtData(v:string|null){if(!v)return '—';const[a,m,d]=v.slice(0,10).split('-');return d?`${d}/${m}/${a}`:v}
function mesesEntre(a:string,b:string){if(!a||!b)return[];const out:string[]=[];let[y,m]=a.split('-').map(Number);const[fy,fm]=b.split('-').map(Number);while(y*12+m<=fy*12+fm&&out.length<24){out.push(`${y}-${String(m).padStart(2,'0')}`);m++;if(m>12){m=1;y++}}return out}
function periodoLabel(a:string,b:string){return a&&b?(a===b?fmtMes(a):`${fmtMes(a)} a ${fmtMes(b)}`):''}
function concluido(r:LinhaConsulta){return !!r.nota_id&&(r.situacao==='conferido'||r.situacao==='conferido_com_divergencia'||r.situacao==='corrigido_manual')}
function motivo(r:LinhaConsulta){
 if(concluido(r))return r.situacao==='conferido_com_divergencia'?(r.observacao||'Conferido com divergência registrada'):`Conferido${r.nf_numero?` com a NF ${r.nf_numero}`:''}`
 switch(r.situacao){
  case'falta_cnpj':return 'CPF/CNPJ não informado no dado importado'
  case'cnpj_invalido':return 'CPF/CNPJ inválido no dado importado'
  case'possivel_duplicidade':return 'Possível registro duplicado na importação'
  case'vinculo_sugerido':return 'Existe uma nota compatível aguardando confirmação'
  case'aguardando_confirmacao':return 'Existe uma possível nota para revisar'
  case'nota_outra_empresa':return 'Nota localizada em outra unidade'
  case'divergencia_valor':return 'Valor da nota diferente do valor importado'
  default:return 'Nota não localizada para este profissional no período'
 }
}
async function buscarTudo(competencia:string,empresaId:string){
 const filtros={competencia,empresaId:empresaId||undefined}
 const primeiro=await consultarConferencia(filtros,{campo:'nome',dir:'asc'},1,500)
 const paginas=Math.ceil(primeiro.total/500)
 if(paginas<=1)return primeiro.linhas
 const demais=await Promise.all(Array.from({length:paginas-1},(_,i)=>consultarConferencia(filtros,{campo:'nome',dir:'asc'},i+2,500)))
 return [...primeiro.linhas,...demais.flatMap(x=>x.linhas)]
}

export default function RelatoriosPage(){
 const router=useRouter();const[inicio,setInicio]=useState('');const[fim,setFim]=useState('');const[empresaId,setEmpresaId]=useState('');const[profissional,setProfissional]=useState('');const[empresas,setEmpresas]=useState<Empresa[]>([]);const[linhas,setLinhas]=useState<LinhaConsulta[]>([]);const[aba,setAba]=useState<Aba>('pendentes');const[busca,setBusca]=useState('');const[loading,setLoading]=useState(false);const[erro,setErro]=useState('');const req=useRef(0)
 useEffect(()=>{if(!SALAO_ENABLED){router.replace('/dashboard');return}supabase.from('empresas').select('*').order('razao_social').then(({data})=>setEmpresas(data||[]))},[router])
 const carregar=useCallback(async()=>{const id=++req.current;if(!inicio||!fim){setLinhas([]);setLoading(false);return}setLoading(true);setErro('');try{const meses=mesesEntre(inicio,fim);const dados=await Promise.all(meses.map(m=>buscarTudo(m,empresaId)));if(id===req.current)setLinhas(dados.flat())}catch(e){if(id===req.current)setErro(e instanceof Error?e.message:'Erro ao consultar o período.')}finally{if(id===req.current)setLoading(false)}},[inicio,fim,empresaId])
 useEffect(()=>{if(SALAO_ENABLED)carregar()},[carregar])
 const profissionais=useMemo(()=>linhas.filter(r=>r.tipo==='comissao'&&!r.analise_manual),[linhas])
 const profissionaisSituacao=useMemo(()=>profissionais.filter(r=>aba==='todos'||(aba==='pendentes'?!concluido(r):concluido(r))),[profissionais,aba])
 const nomes=useMemo(()=>Array.from(new Set(profissionaisSituacao.map(r=>r.nome||'').filter(Boolean))).sort((a,b)=>a.localeCompare(b,'pt-BR')),[profissionaisSituacao])
 useEffect(()=>{if(profissional&&!nomes.includes(profissional))setProfissional('')},[nomes,profissional])
 const notasLivres=useMemo(()=>{const m=new Map<string,LinhaConsulta>();for(const r of linhas){if(r.tipo!=='nota'||r.analise_manual||r.situacao!=='nota_sem_vinculo')continue;const k=r.nf_numero&&r.nf_data?`${r.empresa_id}|${r.nf_numero}|${r.nf_data}|${Number(r.nf_valor||0).toFixed(2)}`:r.id;if(!m.has(k))m.set(k,r)}return[...m.values()].sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR'))},[linhas])
 const conferidos=profissionais.filter(concluido).length,pendentes=profissionais.length-conferidos
 const exibidos=useMemo(()=>profissionaisSituacao.filter(r=>{if(profissional&&r.nome!==profissional)return false;if(busca&&!String(r.nome||'').toLocaleLowerCase('pt-BR').includes(busca.toLocaleLowerCase('pt-BR')))return false;return true}).sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR')),[profissionaisSituacao,profissional,busca])
 const notasExibidas=useMemo(()=>{if(aba==='conferidos')return[];if(!profissional)return notasLivres;const refs=profissionais.filter(r=>r.nome===profissional);const docs=new Set(refs.map(r=>String(r.documento||'').replace(/\D/g,'')).filter(Boolean));const nome=profissional.toLocaleLowerCase('pt-BR');return notasLivres.filter(r=>docs.has(String(r.documento||'').replace(/\D/g,''))||String(r.nome||'').toLocaleLowerCase('pt-BR').includes(nome))},[notasLivres,profissionais,profissional,aba])
 async function pdfPendencias(){const pro=profissionais.filter(r=>!concluido(r)&&(profissional?r.nome===profissional:true));const rows=[...pro.map(r=>({grupo:'Profissional pendente',nome:r.nome||'',unidade:r.empresaNome,competencia:r.mes_ref,motivo:motivo(r),valor:r.valor_comissao||0,nota:r.nf_numero||''})),...notasExibidas.map(r=>({grupo:'Nota sem vínculo',nome:r.nome||'',unidade:r.empresaNome,competencia:r.mes_ref,motivo:'Nenhum profissional importado vinculado',valor:r.nf_valor||0,nota:r.nf_numero||''}))];if(!rows.length)return;const cols:Coluna[]=[{header:'Tipo',get:r=>r.grupo},{header:'Profissional / emitente',get:r=>r.nome},{header:'Unidade',get:r=>r.unidade},{header:'Competência',get:r=>fmtMes(r.competencia)},{header:'Motivo da pendência',get:r=>r.motivo},{header:'Valor',get:r=>formatarMoeda(r.valor)},{header:'NF',get:r=>r.nota}];await exportarPDF(`Pendências de notas — ${periodoLabel(inicio,fim)}`,cols,rows,`pendencias_notas_${inicio}_${fim}`)}
 function limpar(){req.current++;setInicio('');setFim('');setEmpresaId('');setProfissional('');setBusca('');setAba('pendentes');setLinhas([]);setErro('');setLoading(false)}
 if(!SALAO_ENABLED)return null
 return <LayoutAdmin title="Salão — Relatório de conferência"><div className="space-y-3">
  {erro&&<div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erro}</div>}
  <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 bg-gradient-to-r from-slate-950 to-slate-800 px-4 py-4 text-white"><h1 className="text-base font-semibold">Relatório de conferência</h1><p className="mt-1 text-xs text-slate-300">Profissionais pendentes, conferidos e notas ainda sem vínculo.</p></div><div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-[150px_150px_1fr_1fr_190px_auto]"><div><label className="label-field">Mês inicial</label><input type="month" className="input-field" value={inicio} onChange={e=>{setInicio(e.target.value);if(fim&&e.target.value>fim)setFim(e.target.value)}}/></div><div><label className="label-field">Mês final</label><input type="month" className="input-field" min={inicio} value={fim} onChange={e=>setFim(e.target.value)}/></div><div><label className="label-field">Unidade</label><select className="input-field" value={empresaId} onChange={e=>setEmpresaId(e.target.value)}><option value="">Todas as unidades</option>{empresas.map(e=><option key={e.id} value={e.id}>{e.apelido||e.razao_social}</option>)}</select></div><div><label className="label-field">Profissional</label><select className="input-field" value={profissional} onChange={e=>setProfissional(e.target.value)}><option value="">Todos os profissionais</option>{nomes.map(n=><option key={n}>{n}</option>)}</select></div><div><label className="label-field">Situação</label><select className="input-field" value={aba} onChange={e=>setAba(e.target.value as Aba)}><option value="todos">Todos</option><option value="pendentes">Pendentes</option><option value="conferidos">Conferidos</option></select></div><div className="flex items-end gap-2"><button className="btn-secondary text-sm" onClick={limpar}>Limpar</button><button className="btn-primary whitespace-nowrap text-sm print:hidden" disabled={!inicio||!fim||pendentes+notasLivres.length===0} onClick={pdfPendencias}>PDF pendências</button></div></div>{loading&&linhas.length>0&&<div className="border-t border-blue-100 bg-blue-50 px-4 py-2 text-xs font-medium text-blue-700">Atualizando o período em segundo plano…</div>}</section>
  <section className="grid gap-2 sm:grid-cols-3"><Kpi label="Profissionais importados" valor={profissionais.length}/><Kpi label="Pendentes de providência" valor={pendentes} tom="amber"/><Kpi label="Conferidos" valor={conferidos} tom="green"/></section>
  {!inicio||!fim?<Vazio titulo="Informe o período" texto="Escolha o mês inicial e o mês final para montar o relatório."/>:<div className="grid gap-3 xl:grid-cols-2">
   <section className="overflow-hidden rounded-xl border bg-white shadow-sm"><div className="border-b p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Profissionais importados</h2><p className="text-xs text-slate-500">{periodoLabel(inicio,fim)} · {exibidos.length} registro(s)</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{aba==='todos'?'Todos':aba==='pendentes'?'Pendentes':'Conferidos'}</span></div><input className="input-field mt-3" placeholder="Buscar profissional" value={busca} onChange={e=>setBusca(e.target.value)}/></div>{loading&&linhas.length===0?<Carregando/>:exibidos.length===0?<Vazio titulo="Nenhum profissional nesta situação" texto="Altere a aba ou confira a unidade selecionada."/>:<div className="max-h-[560px] overflow-auto divide-y">{exibidos.map(r=><article key={r.id} className="p-3"><div className="flex items-start justify-between gap-3"><div><b className="text-sm text-slate-900">{r.nome||'Profissional não identificado'}</b><p className="text-xs text-slate-500">{r.documento||'Documento não informado'} · {r.empresaNome}</p></div><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${concluido(r)?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-800'}`}>{concluido(r)?'Conferido':'Pendente'}</span></div><div className="mt-2 grid gap-2 rounded-lg bg-slate-50 p-2 text-xs sm:grid-cols-3"><span><b>Importado:</b> {formatarMoeda(r.valor_comissao||0)}</span><span><b>Nota:</b> {r.nf_numero||'—'}</span><span><b>Valor NF:</b> {r.nf_valor!=null?formatarMoeda(r.nf_valor):'—'}</span></div><p className={`mt-2 text-xs ${concluido(r)?'text-emerald-700':'font-medium text-amber-800'}`}><b>{concluido(r)?'Resultado:':'Motivo:'}</b> {motivo(r)}</p></article>)}</div>}</section>
   <section className="overflow-hidden rounded-xl border bg-white shadow-sm"><div className="border-b p-3"><h2 className="font-semibold">Notas sem vínculo</h2><p className="text-xs text-slate-500">{periodoLabel(inicio,fim)} · {notasExibidas.length} nota(s)</p></div>{loading&&linhas.length===0?<Carregando/>:notasExibidas.length===0?<Vazio titulo="Nenhuma nota sem vínculo" texto="Todas as notas do recorte estão tratadas."/>:<div className="max-h-[620px] overflow-auto divide-y">{notasExibidas.map(r=><article key={r.id} className="p-3"><div className="flex justify-between gap-2"><b className="text-sm">{r.nome||'Emitente não identificado'}</b><b className="text-sm">{formatarMoeda(r.nf_valor||0)}</b></div><p className="mt-1 text-xs text-slate-500">{r.documento||'Documento não informado'} · NF {r.nf_numero||'—'}</p><p className="mt-2 text-xs text-amber-800"><b>Motivo:</b> nenhum profissional importado foi vinculado a esta nota.</p><p className="mt-1 text-[11px] text-slate-400">Emissão {fmtData(r.nf_data)} · {r.empresaNome}</p></article>)}</div>}</section>
  </div>}
 </div></LayoutAdmin>
}
function Kpi({label,valor,tom='slate'}:{label:string;valor:number;tom?:'slate'|'amber'|'green'}){const cor={slate:'text-slate-900',amber:'text-amber-700',green:'text-emerald-700'}[tom];return <div className="rounded-xl border bg-white p-3 shadow-sm"><span className="text-xs text-slate-500">{label}</span><b className={`block text-2xl ${cor}`}>{valor}</b></div>}
function Vazio({titulo,texto}:{titulo:string;texto:string}){return <div className="rounded-xl border border-dashed bg-white px-4 py-12 text-center"><p className="text-sm font-medium text-slate-600">{titulo}</p><p className="mt-1 text-xs text-slate-400">{texto}</p></div>}
function Carregando(){return <div className="py-14 text-center text-sm text-slate-400">Carregando período…</div>}

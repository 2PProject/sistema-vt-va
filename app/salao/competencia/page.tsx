'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase } from '../../../lib/supabase'
import { SALAO_ENABLED } from '../../../lib/salao/config'
import { consultarConferencia, getStatusCompetencia, setStatusCompetencia, type Indicadores } from '../../../lib/salao/conferencia'
import { formatarMoeda } from '../../../utils/calculoVT'

type Status = 'em_preparacao'|'importada'|'em_conferencia'|'com_pendencias'|'pronta'|'fechada'|'reaberta'
const LABEL: Record<Status,string>={em_preparacao:'Em preparação',importada:'Importada',em_conferencia:'Em conferência',com_pendencias:'Com pendências',pronta:'Pronta para fechamento',fechada:'Fechada',reaberta:'Reaberta'}
function mesAtual(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}

export default function CompetenciaSalaoPage(){
 const router=useRouter(); const [mes,setMes]=useState(mesAtual()); const [status,setStatus]=useState<Status>('em_preparacao')
 const [ind,setInd]=useState<Indicadores|null>(null); const [usuario,setUsuario]=useState(''); const [loading,setLoading]=useState(false); const [msg,setMsg]=useState('')
 useEffect(()=>{if(!SALAO_ENABLED)router.replace('/dashboard');supabase.auth.getUser().then(({data})=>setUsuario(data.user?.email||''))},[router])
 const carregar=useCallback(async()=>{setLoading(true);try{const [st,r]=await Promise.all([getStatusCompetencia(mes),consultarConferencia({competencia:mes},{campo:'nome',dir:'asc'},1,10)]);setStatus((st?.status as Status)||'em_preparacao');setInd(r.indicadores)}catch(e){setMsg(e instanceof Error?e.message:'Erro ao carregar competência.')}finally{setLoading(false)}},[mes])
 useEffect(()=>{if(SALAO_ENABLED)carregar()},[carregar])
 const pendencias=(ind?.semNota||0)+(ind?.notasSemVinculo||0)+(ind?.divergencias||0)+(ind?.semCnpj||0)+(ind?.outraEmpresa||0)+(ind?.duplicidades||0)
 async function alterar(novo:Status){
  let justificativa=''
  if(novo==='fechada'&&pendencias>0){setMsg(`Não é possível fechar: existem ${pendencias} pendência(s).`);return}
  if(novo==='reaberta'){justificativa=window.prompt('Justificativa obrigatória para reabertura:')||'';if(!justificativa.trim())return}
  const r=await setStatusCompetencia(mes,novo,{usuario,justificativa}); if(!r.ok){setMsg(r.erro||'Erro ao alterar status.');return}
  setStatus(novo);setMsg(`Competência alterada para ${LABEL[novo]}.`)
 }
 if(!SALAO_ENABLED)return null
 return <LayoutAdmin title="Salão — Controle da Competência"><div className="space-y-4">
  {msg&&<div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{msg}</div>}
  <div className="card flex flex-wrap items-end gap-4"><div><label className="label-field">Competência</label><input type="month" className="input-field" value={mes} onChange={e=>setMes(e.target.value)}/></div><div><p className="label-field">Situação atual</p><span className="inline-flex rounded-full bg-blue-100 px-3 py-2 text-sm font-semibold text-blue-800">{LABEL[status]}</span></div></div>
  {loading?<div className="card text-center text-gray-400">Carregando...</div>:ind&&<>
   <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><div className="card"><p className="text-xs text-gray-500">Profissionais</p><b className="text-2xl">{ind.esperados}</b></div><div className="card"><p className="text-xs text-gray-500">Conferidos</p><b className="text-2xl text-green-700">{ind.conferidos}</b></div><div className="card"><p className="text-xs text-gray-500">Pendências</p><b className="text-2xl text-amber-700">{pendencias}</b></div><div className="card"><p className="text-xs text-gray-500">Diferença financeira</p><b className="text-xl">{formatarMoeda(ind.diferenca)}</b></div></div>
   <div className="card"><h2 className="font-semibold text-gray-900">Pendências antes do fechamento</h2><div className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-3"><span>Sem nota: <b>{ind.semNota}</b></span><span>Notas sem vínculo: <b>{ind.notasSemVinculo}</b></span><span>Divergências: <b>{ind.divergencias}</b></span><span>Sem CNPJ: <b>{ind.semCnpj}</b></span><span>Outra empresa: <b>{ind.outraEmpresa}</b></span><span>Duplicidades: <b>{ind.duplicidades}</b></span></div></div>
  </>}
  <div className="card"><h2 className="font-semibold">Fluxo da competência</h2><p className="mt-1 text-xs text-gray-500">Após o fechamento, alterações comuns ficam bloqueadas. A reabertura exige justificativa e fica registrada no histórico.</p><div className="mt-4 flex flex-wrap gap-2">{(['em_preparacao','importada','em_conferencia','com_pendencias','pronta'] as Status[]).map(s=><button key={s} className="btn-secondary text-sm" disabled={status==='fechada'} onClick={()=>alterar(s)}>{LABEL[s]}</button>)}<button className="btn-primary text-sm" disabled={status==='fechada'||pendencias>0} onClick={()=>alterar('fechada')}>Fechar competência</button>{status==='fechada'&&<button className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white" onClick={()=>alterar('reaberta')}>Reabrir</button>}</div></div>
 </div></LayoutAdmin>
}

import { supabase } from '../supabase'
import type { CertificadoInfo } from './tipos'

/** Lista metadados de certificado + prazo por empresa (via API server-side). */
export async function listarCertificados(): Promise<CertificadoInfo[]> {
  const resp = await fetch('/api/salao/certificado', { cache: 'no-store' })
  const data = await resp.json().catch(() => null)
  if (!resp.ok || !data) throw new Error(data?.erro ?? 'Falha ao carregar certificados.')
  return data.certificados ?? []
}

export async function salvarCertificado(empresaId: string, arquivo: File, senha: string):
  Promise<{ ok: boolean; erro?: string; cert_nome?: string; cert_validade?: string }> {
  const form = new FormData()
  form.append('empresa_id', empresaId)
  form.append('senha', senha)
  form.append('arquivo', arquivo)
  const resp = await fetch('/api/salao/certificado', { method: 'POST', body: form })
  const data = await resp.json().catch(() => null)
  if (!resp.ok) return { ok: false, erro: data?.erro ?? `Falha (HTTP ${resp.status}).` }
  return { ok: true, cert_nome: data?.cert_nome, cert_validade: data?.cert_validade }
}

export async function removerCertificado(empresaId: string): Promise<void> {
  await fetch(`/api/salao/certificado?empresa_id=${encodeURIComponent(empresaId)}`, { method: 'DELETE' })
}

/** Prazo de emissão por empresa (tabela sem segredos — anon pode gravar). */
export async function salvarPrazo(empresaId: string, prazoDia: number): Promise<{ ok: boolean; erro?: string }> {
  const { error } = await supabase.from('salon_empresa_config')
    .upsert({ empresa_id: empresaId, prazo_dia: prazoDia, atualizado_em: new Date().toISOString() })
  if (error) return { ok: false, erro: error.message }
  return { ok: true }
}

export type ResumoSync = {
  ok?: boolean; erro?: string; ambiente?: string
  notasEncontradas: number; registrosAtualizados: number
  empresas?: { empresa_id: string; notas: number; atualizados: number; erro?: string }[]
}

/** Rótulo curto do ambiente ADN a partir da URL. */
export function rotuloAmbiente(url?: string): string {
  if (!url) return ''
  return url.includes('producaorestrita') ? 'ambiente de teste' : 'ambiente de produção'
}

export type ResultadoTeste = { ok: boolean; status?: number; mensagem: string; ambiente?: string; amostra?: string; erro?: string }

/** Testa a conexão mTLS real com o gov.br para UMA empresa (não grava nada). */
export async function testarConexao(empresaId: string): Promise<ResultadoTeste> {
  const resp = await fetch('/api/nfse/testar', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ empresa_id: empresaId }),
  })
  const data = await resp.json().catch(() => null)
  if (!data) return { ok: false, mensagem: `Falha (HTTP ${resp.status}).` }
  if (data.erro) return { ok: false, mensagem: data.erro }
  return data
}

export async function sincronizarNFSe(empresaId?: string): Promise<ResumoSync> {
  const resp = await fetch('/api/nfse/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(empresaId ? { empresa_id: empresaId } : {}),
  })
  const data = await resp.json().catch(() => null)
  if (!resp.ok || !data) return { erro: data?.erro ?? `Falha (HTTP ${resp.status}).`, notasEncontradas: 0, registrosAtualizados: 0 }
  return data
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { SALAO_ENABLED } from '../../../lib/salao/config'
import { listarCertificados, salvarCertificado, removerCertificado, testarConexao } from '../../../lib/salao/certificados'
import type { CertificadoInfo } from '../../../lib/salao/tipos'

function fmtData(iso: string | null) { if (!iso) return '—'; const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}` }
function venceu(iso: string | null) { if (!iso) return false; return new Date(iso) < new Date() }
function diasRestantes(iso: string | null): number | null {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
}
function fmtCnpj(s: string | null) {
  const d = (s ?? '').replace(/\D/g, '')
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return s || '—'
}

export default function SalaoCertificadosPage() {
  const router = useRouter()
  const [lista, setLista] = useState<CertificadoInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState(''); const [msgTipo, setMsgTipo] = useState<'ok' | 'erro'>('ok')

  const [alvo, setAlvo] = useState<string | null>(null)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [senha, setSenha] = useState(''); const [verSenha, setVerSenha] = useState(false); const [enviando, setEnviando] = useState(false)

  const [ocupado, setOcupado] = useState<string | null>(null)
  const [resultado, setResultado] = useState<Record<string, { ok: boolean; msg: string; amostra?: string }>>({})

  useEffect(() => { if (!SALAO_ENABLED) { router.replace('/dashboard'); return } }, [router])

  const carregar = useCallback(async () => {
    setLoading(true)
    try { setLista(await listarCertificados()) }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Falha'); setMsgTipo('erro') }
    setLoading(false)
  }, [])
  useEffect(() => { if (SALAO_ENABLED) carregar() }, [carregar])

  function notify(t: string, tipo: 'ok' | 'erro') { setMsg(t); setMsgTipo(tipo); setTimeout(() => setMsg(''), 8000) }
  function abrirForm(empresaId: string) { setAlvo(alvo === empresaId ? null : empresaId); setArquivo(null); setSenha(''); setVerSenha(false) }

  async function enviar(empresaId: string) {
    if (!arquivo) { notify('Selecione o arquivo .pfx do certificado A1.', 'erro'); return }
    if (!senha) { notify('Digite a senha do certificado.', 'erro'); return }
    setEnviando(true)
    const res = await salvarCertificado(empresaId, arquivo, senha)
    setEnviando(false)
    if (!res.ok) { notify(res.erro ?? 'Erro ao validar o certificado.', 'erro'); return }
    setAlvo(null); setArquivo(null); setSenha('')
    const detalhe = res.aviso ? ` ${res.aviso}` : ` Titular: ${res.cert_nome || '—'} · válido até ${fmtData(res.cert_validade ?? null)}.`
    notify(`Certificado validado e salvo.${detalhe}`, 'ok')
    carregar()
  }
  async function remover(empresaId: string) {
    if (!confirm('Remover o certificado desta empresa?')) return
    await removerCertificado(empresaId); notify('Certificado removido.', 'ok'); carregar()
  }
  async function testar(empresaId: string) {
    setOcupado(empresaId); setResultado(prev => ({ ...prev, [empresaId]: { ok: true, msg: 'Testando conexão com o gov.br...' } }))
    const r = await testarConexao(empresaId)
    setOcupado(null)
    setResultado(prev => ({ ...prev, [empresaId]: { ok: r.ok, msg: r.mensagem + (r.ambiente ? `  ·  ${r.ambiente}` : '') + (r.status ? `  (HTTP ${r.status})` : ''), amostra: r.amostra } }))
  }

  if (!SALAO_ENABLED) return null

  function badge(c: CertificadoInfo) {
    if (!c.temCertificado) return <span className="text-xs font-semibold px-2 py-0.5 rounded bg-gray-100 text-gray-500">Não configurado</span>
    if (venceu(c.cert_validade)) return <span className="text-xs font-semibold px-2 py-0.5 rounded bg-red-100 text-red-700">Vencido</span>
    const d = diasRestantes(c.cert_validade)
    if (d !== null && d <= 30) return <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-700">Vence em {d} dia(s)</span>
    return <span className="text-xs font-semibold px-2 py-0.5 rounded bg-green-100 text-green-700">Ativo</span>
  }

  return (
    <LayoutAdmin title="Salão — Certificado Digital">
      <div className="space-y-6">
        {msg && <div className={`px-4 py-3 rounded-lg text-sm ${msgTipo === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>{msg}</div>}

        <div className="bg-blue-50 border border-blue-200 text-blue-800 text-xs rounded-lg p-3">
          Envie o <strong>certificado A1 (.pfx / .p12)</strong> de cada empresa com a respectiva senha. A senha é validada pelo mesmo mecanismo usado na conexão com o gov.br (OpenSSL), criptografada e guardada no servidor — o arquivo nunca é exposto ao navegador. Use <strong>Testar conexão</strong> para validar de ponta a ponta.
        </div>

        {loading ? <div className="card text-center py-10 text-gray-400 text-sm">Carregando...</div> : (
          <div className="space-y-3">
            {lista.map(c => (
              <div key={c.empresa_id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-800">{c.empresaNome}</span>
                      {badge(c)}
                    </div>
                    {c.temCertificado ? (
                      <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-xs">
                        <dt className="text-gray-400">Titular</dt><dd className="text-gray-700">{c.cert_nome || '—'}</dd>
                        <dt className="text-gray-400">CNPJ</dt><dd className="text-gray-700">{fmtCnpj(c.cert_cnpj)}</dd>
                        <dt className="text-gray-400">Validade</dt>
                        <dd className={venceu(c.cert_validade) ? 'text-red-600 font-semibold' : 'text-gray-700'}>{fmtData(c.cert_validade)}</dd>
                      </dl>
                    ) : <div className="text-xs text-gray-400 mt-1">Nenhum certificado enviado para esta empresa.</div>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {c.temCertificado && (
                      <button onClick={() => testar(c.empresa_id)} disabled={!!ocupado} className="btn-secondary text-sm">
                        {ocupado === c.empresa_id ? 'Testando...' : 'Testar conexão'}
                      </button>
                    )}
                    <button onClick={() => abrirForm(c.empresa_id)} className="btn-primary text-sm">
                      {c.temCertificado ? 'Substituir / atualizar' : 'Enviar certificado'}
                    </button>
                    {c.temCertificado && <button onClick={() => remover(c.empresa_id)} className="text-red-500 text-xs font-medium">Remover</button>}
                  </div>
                </div>

                {resultado[c.empresa_id] && (
                  <div className={`mt-3 text-xs rounded-lg px-3 py-2 ${resultado[c.empresa_id].ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                    {resultado[c.empresa_id].msg}
                    {resultado[c.empresa_id].amostra && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-gray-500">ver resposta do gov.br (diagnóstico)</summary>
                        <pre className="mt-1 whitespace-pre-wrap break-all bg-gray-900 text-gray-100 rounded p-2 max-h-40 overflow-auto">{resultado[c.empresa_id].amostra}</pre>
                      </details>
                    )}
                  </div>
                )}

                {alvo === c.empresa_id && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                      <div>
                        <label className="label-field">Arquivo do certificado (.pfx / .p12)</label>
                        <input type="file" accept=".pfx,.p12" onChange={e => setArquivo(e.target.files?.[0] ?? null)} className="input-field" />
                      </div>
                      <div>
                        <label className="label-field">Senha do certificado</label>
                        <div className="relative">
                          <input type={verSenha ? 'text' : 'password'} className="input-field pr-16" value={senha} onChange={e => setSenha(e.target.value)} autoComplete="off" />
                          <button type="button" onClick={() => setVerSenha(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-blue-600">{verSenha ? 'ocultar' : 'ver'}</button>
                        </div>
                      </div>
                      <div><button className="btn-primary w-full" onClick={() => enviar(c.empresa_id)} disabled={enviando}>{enviando ? 'Validando...' : 'Validar e salvar'}</button></div>
                    </div>
                    <p className="text-xs text-gray-400 mt-2">Para trocar a senha ou renovar o certificado, basta enviar o arquivo novamente com a senha atual.</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </LayoutAdmin>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { SALAO_ENABLED } from '../../../lib/salao/config'
import { listarCertificados, salvarCertificado, removerCertificado, salvarPrazo, testarConexao } from '../../../lib/salao/certificados'
import type { CertificadoInfo } from '../../../lib/salao/tipos'

function fmtData(iso: string | null) { if (!iso) return '—'; const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}` }
function venceu(iso: string | null) { if (!iso) return false; return new Date(iso) < new Date() }

export default function SalaoCertificadosPage() {
  const router = useRouter()
  const [lista, setLista] = useState<CertificadoInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState(''); const [msgTipo, setMsgTipo] = useState<'ok' | 'erro'>('ok')

  // upload por empresa
  const [alvo, setAlvo] = useState<string | null>(null)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [senha, setSenha] = useState(''); const [enviando, setEnviando] = useState(false)
  // teste/sincronização por empresa
  const [ocupado, setOcupado] = useState<string | null>(null)  // `${empresaId}:${acao}`
  const [resultado, setResultado] = useState<Record<string, { ok: boolean; msg: string; amostra?: string }>>({})

  useEffect(() => { if (!SALAO_ENABLED) { router.replace('/dashboard'); return } }, [router])

  const carregar = useCallback(async () => {
    setLoading(true)
    try { setLista(await listarCertificados()) }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Falha'); setMsgTipo('erro') }
    setLoading(false)
  }, [])
  useEffect(() => { if (SALAO_ENABLED) carregar() }, [carregar])

  function notify(t: string, tipo: 'ok' | 'erro') { setMsg(t); setMsgTipo(tipo); setTimeout(() => setMsg(''), 7000) }

  async function enviar(empresaId: string) {
    if (!arquivo) { notify('Selecione o arquivo .pfx.', 'erro'); return }
    if (!senha) { notify('Digite a senha do certificado.', 'erro'); return }
    setEnviando(true)
    const res = await salvarCertificado(empresaId, arquivo, senha)
    setEnviando(false)
    if (!res.ok) { notify(res.erro ?? 'Erro.', 'erro'); return }
    setAlvo(null); setArquivo(null); setSenha('')
    notify(`Certificado salvo: ${res.cert_nome} (válido até ${fmtData(res.cert_validade ?? null)}).`, 'ok')
    carregar()
  }
  async function remover(empresaId: string) {
    if (!confirm('Remover o certificado desta empresa?')) return
    await removerCertificado(empresaId); notify('Certificado removido.', 'ok'); carregar()
  }
  async function mudarPrazo(empresaId: string, valor: number) {
    const res = await salvarPrazo(empresaId, valor)
    if (!res.ok) { notify(res.erro ?? 'Erro ao salvar prazo.', 'erro'); return }
    setLista(prev => prev.map(c => c.empresa_id === empresaId ? { ...c, prazo_dia: valor } : c))
  }
  async function testar(empresaId: string) {
    setOcupado(`${empresaId}:teste`); setResultado(prev => ({ ...prev, [empresaId]: { ok: true, msg: 'Testando conexão com o gov.br...' } }))
    const r = await testarConexao(empresaId)
    setOcupado(null)
    setResultado(prev => ({ ...prev, [empresaId]: { ok: r.ok, msg: r.mensagem + (r.ambiente ? `  ·  ${r.ambiente}` : '') + (r.status ? `  (HTTP ${r.status})` : ''), amostra: r.amostra } }))
  }
  if (!SALAO_ENABLED) return null

  return (
    <LayoutAdmin title="Salão — Certificados">
      <div className="space-y-6">
        {msg && <div className={`px-4 py-3 rounded-lg text-sm ${msgTipo === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>{msg}</div>}

        <div className="bg-blue-50 border border-blue-200 text-blue-800 text-xs rounded-lg p-3">
          O certificado A1 (.pfx) é validado na hora e guardado com segurança no servidor — a senha é criptografada e o arquivo nunca é exposto ao navegador. É usado apenas nas chamadas ao gov.br para sincronizar as NFS-e.
        </div>

        {loading ? <div className="card text-center py-10 text-gray-400 text-sm">Carregando...</div> : (
          <div className="space-y-3">
            {lista.map(c => (
              <div key={c.empresa_id} className="card">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-gray-800">{c.empresaNome}</div>
                    {c.temCertificado ? (
                      <div className="text-xs mt-0.5">
                        <span className="text-gray-500">{c.cert_nome} · CNPJ {c.cert_cnpj}</span>{' '}
                        <span className={venceu(c.cert_validade) ? 'text-red-600 font-semibold' : 'text-green-700'}>
                          {venceu(c.cert_validade) ? 'VENCIDO' : 'válido'} até {fmtData(c.cert_validade)}
                        </span>
                      </div>
                    ) : <div className="text-xs text-amber-600 mt-0.5">Sem certificado</div>}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-500">Prazo dia</span>
                      <input type="number" min={1} max={28} value={c.prazo_dia}
                        onChange={e => mudarPrazo(c.empresa_id, Math.min(28, Math.max(1, Number(e.target.value))))}
                        className="input-field w-16 text-center" style={{ padding: '4px' }} />
                    </div>
                    {c.temCertificado && (
                      <>
                        <button onClick={() => testar(c.empresa_id)} disabled={!!ocupado} className="btn-secondary text-sm">
                          {ocupado === `${c.empresa_id}:teste` ? 'Testando...' : 'Testar conexão'}
                        </button>
                        <button onClick={() => remover(c.empresa_id)} className="text-red-500 text-xs font-medium">Remover</button>
                      </>
                    )}
                    <button onClick={() => { setAlvo(alvo === c.empresa_id ? null : c.empresa_id); setArquivo(null); setSenha('') }} className="btn-secondary text-sm">
                      {c.temCertificado ? 'Substituir' : 'Enviar .pfx'}
                    </button>
                  </div>
                </div>

                {resultado[c.empresa_id] && (
                  <div className={`mt-3 text-xs rounded-lg px-3 py-2 ${resultado[c.empresa_id].ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                    {resultado[c.empresa_id].msg}
                    {resultado[c.empresa_id].amostra && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-gray-500">ver resposta do gov.br (para diagnóstico)</summary>
                        <pre className="mt-1 whitespace-pre-wrap break-all bg-gray-900 text-gray-100 rounded p-2 max-h-40 overflow-auto">{resultado[c.empresa_id].amostra}</pre>
                      </details>
                    )}
                  </div>
                )}

                {alvo === c.empresa_id && (
                  <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                    <div><label className="label-field">Arquivo .pfx (A1)</label><input type="file" accept=".pfx,.p12" onChange={e => setArquivo(e.target.files?.[0] ?? null)} className="input-field" /></div>
                    <div><label className="label-field">Senha do certificado</label><input type="password" className="input-field" value={senha} onChange={e => setSenha(e.target.value)} /></div>
                    <div><button className="btn-primary w-full" onClick={() => enviar(c.empresa_id)} disabled={enviando}>{enviando ? 'Validando...' : 'Salvar certificado'}</button></div>
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

'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import LayoutAdmin from '../../../components/LayoutAdmin'
import { supabase, Empresa } from '../../../lib/supabase'
import { SALAO_ENABLED } from '../../../lib/salao/config'
import {
  listarProfissionais, criarProfissional, atualizarProfissional, excluirProfissional,
  parseListaProfissionais, importarProfissionais,
} from '../../../lib/salao/profissionais'
import type { Profissional } from '../../../lib/salao/tipos'

export default function SalaoProfissionaisPage() {
  const router = useRouter()
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresaId, setEmpresaId] = useState('')
  const [profs, setProfs] = useState<Profissional[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState(''); const [msgTipo, setMsgTipo] = useState<'ok' | 'erro'>('ok')

  const [nome, setNome] = useState(''); const [doc, setDoc] = useState('')
  const [editId, setEditId] = useState<string | null>(null); const [editNome, setEditNome] = useState(''); const [editDoc, setEditDoc] = useState('')

  const [modalImport, setModalImport] = useState(false); const [texto, setTexto] = useState('')

  useEffect(() => {
    if (!SALAO_ENABLED) { router.replace('/dashboard'); return }
    supabase.from('empresas').select('*').order('razao_social').then(({ data }) => {
      setEmpresas(data ?? []); if (data && data[0]) setEmpresaId(data[0].id)
    })
  }, [router])

  const carregar = useCallback(async () => {
    if (!empresaId) return
    setLoading(true); setProfs(await listarProfissionais(empresaId)); setLoading(false)
  }, [empresaId])
  useEffect(() => { carregar() }, [carregar])

  function notify(t: string, tipo: 'ok' | 'erro') { setMsg(t); setMsgTipo(tipo); setTimeout(() => setMsg(''), 6000) }

  async function adicionar() {
    if (!empresaId) return
    const res = await criarProfissional({ empresa_id: empresaId, nome, documento: doc })
    if (!res.ok) { notify(res.erro ?? 'Erro.', 'erro'); return }
    setNome(''); setDoc(''); notify('Profissional adicionado.', 'ok'); carregar()
  }
  async function salvarEdicao(id: string) {
    const res = await atualizarProfissional(id, { nome: editNome, documento: editDoc })
    if (!res.ok) { notify(res.erro ?? 'Erro.', 'erro'); return }
    setEditId(null); notify('Atualizado.', 'ok'); carregar()
  }
  async function remover(p: Profissional) {
    if (!confirm(`Excluir ${p.nome}?`)) return
    await excluirProfissional(p.id); notify('Removido.', 'ok'); carregar()
  }
  async function importar() {
    const itens = parseListaProfissionais(texto)
    if (itens.length === 0) { notify('Nenhuma linha válida (use: nome;CPF).', 'erro'); return }
    const { inseridos, ignorados } = await importarProfissionais(empresaId, itens)
    setModalImport(false); setTexto('')
    notify(`${inseridos} adicionado(s)${ignorados ? `, ${ignorados} ignorado(s) (já existentes/inválidos)` : ''}.`, 'ok')
    carregar()
  }

  if (!SALAO_ENABLED) return null

  return (
    <LayoutAdmin
      title="Salão — Profissionais"
      actions={<button className="btn-secondary text-sm" onClick={() => setModalImport(true)}>Importar lista (CSV/colar)</button>}
    >
      <div className="space-y-6">
        {msg && <div className={`px-4 py-3 rounded-lg text-sm ${msgTipo === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>{msg}</div>}

        <div className="card">
          <label className="label-field">Empresa</label>
          <select className="input-field md:w-1/2" value={empresaId} onChange={e => setEmpresaId(e.target.value)}>
            {empresas.map(e => <option key={e.id} value={e.id}>{e.apelido || e.razao_social}</option>)}
          </select>
        </div>

        {/* Adicionar — 2 campos */}
        <div className="card">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div><label className="label-field">Nome do profissional</label><input className="input-field" value={nome} onChange={e => setNome(e.target.value)} /></div>
            <div><label className="label-field">CPF / CNPJ</label><input className="input-field" value={doc} onChange={e => setDoc(e.target.value)} placeholder="Só números" /></div>
            <div><button className="btn-primary w-full" onClick={adicionar} disabled={!nome || !doc}>Adicionar</button></div>
          </div>
        </div>

        <div className="card">
          <div className="mb-3 text-sm font-semibold text-gray-600">{loading ? 'Carregando...' : `${profs.length} profissional(is)`}</div>
          {profs.length === 0 && !loading ? (
            <div className="text-center py-8 text-gray-400 text-sm">Nenhum profissional nesta empresa.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead><tr className="bg-gray-50 border-b border-gray-200">
                  <th className="table-header">Nome</th><th className="table-header">CPF/CNPJ</th><th className="table-header text-right">Ações</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {profs.map(p => (
                    <tr key={p.id} className="hover:bg-gray-50">
                      {editId === p.id ? (
                        <>
                          <td className="table-cell"><input className="input-field" value={editNome} onChange={e => setEditNome(e.target.value)} /></td>
                          <td className="table-cell"><input className="input-field" value={editDoc} onChange={e => setEditDoc(e.target.value)} /></td>
                          <td className="table-cell text-right">
                            <button onClick={() => salvarEdicao(p.id)} className="text-green-700 text-xs font-medium mr-2">Salvar</button>
                            <button onClick={() => setEditId(null)} className="text-gray-500 text-xs">Cancelar</button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="table-cell font-medium text-gray-900">{p.nome}</td>
                          <td className="table-cell text-gray-600">{p.documento}</td>
                          <td className="table-cell text-right">
                            <button onClick={() => { setEditId(p.id); setEditNome(p.nome); setEditDoc(p.documento) }} className="text-blue-600 text-xs font-medium mr-2">Editar</button>
                            <button onClick={() => remover(p)} className="text-red-500 text-xs font-medium">Excluir</button>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {modalImport && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) setModalImport(false) }}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
              <h2 className="text-lg font-bold text-gray-800 mb-2">Importar profissionais</h2>
              <p className="text-xs text-gray-500 mb-3">Cole uma linha por profissional no formato <strong>nome;CPF</strong> (aceita vírgula ou tab). Duplicados são ignorados.</p>
              <textarea className="input-field h-48 font-mono text-xs" value={texto} onChange={e => setTexto(e.target.value)} placeholder={'Maria Silva;12345678901\nJoão Souza;98765432100'} />
              <div className="flex gap-3 pt-4">
                <button className="btn-primary flex-1" onClick={importar}>Importar</button>
                <button className="btn-secondary flex-1" onClick={() => setModalImport(false)}>Fechar</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </LayoutAdmin>
  )
}

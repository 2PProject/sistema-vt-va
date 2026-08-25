'use client'
import { useEffect, useRef, useState } from 'react'

// Combo de PROFISSIONAIS com seleção múltipla (checkbox + busca + chips).
// valor = lista de nomes selecionados; [] significa "todos".
export default function MultiSelectProfissionais({
  opcoes, valor, onChange, placeholder = 'Todos os profissionais', dark = false, className = '',
}: {
  opcoes: string[]
  valor: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  dark?: boolean
  className?: string
}) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function fora(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false) }
    document.addEventListener('mousedown', fora); return () => document.removeEventListener('mousedown', fora)
  }, [])
  const filtradas = busca ? opcoes.filter(o => o.toLowerCase().includes(busca.toLowerCase())) : opcoes
  const toggle = (n: string) => onChange(valor.includes(n) ? valor.filter(x => x !== n) : [...valor, n])
  const rotulo = valor.length === 0 ? placeholder : valor.length === 1 ? valor[0] : `${valor.length} selecionados`
  const btn = dark ? 'bg-slate-800 text-white border border-slate-700' : 'border border-slate-300 bg-white text-slate-800'
  const painel = dark ? 'border-slate-700 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-800'
  return (
    <div className={`relative ${className}`} ref={ref}>
      <button type="button" onClick={() => setAberto(a => !a)} className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${btn}`}>
        <span className={`truncate ${valor.length === 0 ? (dark ? 'text-slate-300' : 'text-slate-400') : ''}`}>{rotulo}</span>
        <span className="shrink-0 opacity-60">▾</span>
      </button>
      {aberto && (
        <div className={`absolute z-40 mt-1 w-full min-w-[240px] overflow-hidden rounded-lg border shadow-xl ${painel}`}>
          <div className="border-b border-black/10 p-2">
            <input autoFocus className={`w-full rounded-md px-2 py-1 text-sm outline-none ${dark ? 'bg-slate-900 text-white placeholder:text-slate-500' : 'border border-slate-200'}`} placeholder="Buscar profissional…" value={busca} onChange={e => setBusca(e.target.value)} />
          </div>
          <div className="flex items-center justify-between border-b border-black/10 px-3 py-1.5 text-xs">
            <button type="button" className="font-semibold text-blue-500 hover:underline" onClick={() => onChange(Array.from(new Set([...valor, ...filtradas])))}>Selecionar {busca ? 'filtrados' : 'todos'}</button>
            <span className="opacity-60">{valor.length} de {opcoes.length}</span>
            <button type="button" className="font-semibold text-slate-400 hover:underline" onClick={() => onChange([])}>Limpar</button>
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {filtradas.length === 0 ? <p className="px-2 py-3 text-center text-xs text-slate-400">Nenhum profissional.</p> : filtradas.map(n => (
              <label key={n} className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ${dark ? 'hover:bg-slate-700' : 'hover:bg-slate-100'}`}>
                <input type="checkbox" className="h-4 w-4 shrink-0" checked={valor.includes(n)} onChange={() => toggle(n)} />
                <span className="truncate">{n}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

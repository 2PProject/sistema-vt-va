'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
// #region MÓDULO SALÃO — remover este import ao desinstalar o módulo
import { SALAO_ENABLED } from '../lib/salao/config'
// #endregion MÓDULO SALÃO

type Item = { href: string; label: string; icon: React.ReactNode }

const ICON = {
  dashboard: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
  ),
  empresa: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
  ),
  func: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
  ),
  cargo: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
  ),
  desconto: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" /></svg>
  ),
  feriado: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
  ),
  valores: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
  ),
  competencia: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
  ),
  ajuste: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
  ),
  recibo: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
  ),
  fechamento: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
  ),
  pagamento: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
  ),
  vale: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
  ),
  salao: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
  ),
}

const dashboard: Item = { href: '/dashboard', label: 'Dashboard', icon: ICON.dashboard }

const sections: { title: string; items: Item[] }[] = [
  {
    title: 'Cadastros',
    items: [
      { href: '/empresas', label: 'Empresas', icon: ICON.empresa },
      { href: '/funcionarios', label: 'Funcionários', icon: ICON.func },
      { href: '/cargos', label: 'Cargos', icon: ICON.cargo },
      { href: '/tipos-desconto', label: 'Tipos de Desconto', icon: ICON.desconto },
      { href: '/feriados', label: 'Feriados', icon: ICON.feriado },
    ],
  },
  {
    title: 'VT / VA',
    items: [
      { href: '/valores-beneficios', label: 'Valores VT/VA', icon: ICON.valores },
      { href: '/descontos', label: 'Férias / Descontos', icon: ICON.ajuste },
      { href: '/recibos', label: 'Recibos VT/VA', icon: ICON.recibo },
    ],
  },
  {
    title: 'Pagamentos',
    items: [
      { href: '/pagamentos/fechamento', label: 'Fechamento do Mês', icon: ICON.fechamento },
      { href: '/pagamentos', label: 'Salários (importar)', icon: ICON.pagamento },
      { href: '/pagamentos/vales', label: 'Vales / Descontos', icon: ICON.vale },
      { href: '/pagamentos/recibos-vales', label: 'Recibos de Vales', icon: ICON.recibo },
    ],
  },
]

// #region MÓDULO SALÃO — bloco isolado; remover tudo entre estes marcadores
// para desinstalar o módulo do menu. (Ver docs/MODULO_SALAO.md)
const secoesSalao: { title: string; items: Item[] }[] = SALAO_ENABLED ? [
  {
    title: 'Salão (NFS-e)',
    items: [
      { href: '/salao', label: 'Painel', icon: ICON.salao },
      { href: '/salao/notas', label: 'Notas', icon: ICON.recibo },
      { href: '/salao/outros-servicos', label: 'Outros Serviços', icon: ICON.ajuste },
      { href: '/salao/conferencia', label: 'Conferência', icon: ICON.competencia },
      { href: '/salao/excecoes', label: 'Pendências', icon: ICON.ajuste },
      { href: '/salao/importar', label: 'Importar dados', icon: ICON.pagamento },
      { href: '/salao/dados-importados', label: 'Profissionais', icon: ICON.func },
      { href: '/salao/relatorios', label: 'Relatórios', icon: ICON.recibo },
      { href: '/salao/certificados', label: 'Configurações', icon: ICON.cargo },
    ],
  },
] : []
// #endregion MÓDULO SALÃO

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const secoes = [...sections, ...secoesSalao]

  // Acordeão: só o módulo selecionado fica aberto. Abre o que contém a rota atual.
  const secaoAtiva = secoes.find((s) => s.items.some((i) => pathname === i.href || pathname.startsWith(i.href + '/')))?.title ?? null
  const [aberta, setAberta] = useState<string | null>(secaoAtiva)
  useEffect(() => { if (secaoAtiva) setAberta(secaoAtiva) }, [secaoAtiva])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  function link(item: Item) {
    const isActive = pathname === item.href
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm font-medium ${
            isActive ? 'bg-blue-700 text-white shadow-sm' : 'text-blue-100 hover:bg-blue-800 hover:text-white'
          }`}
        >
          {item.icon}
          <span>{item.label}</span>
        </Link>
      </li>
    )
  }

  return (
    <aside className="w-64 min-h-screen bg-blue-900 text-white flex flex-col shrink-0">
      <div className="p-5 border-b border-blue-800">
        <h1 className="text-lg font-bold tracking-tight">VT / VA · Pagamentos</h1>
        <p className="text-blue-300 text-xs mt-0.5">Grupo Meire Reis</p>
      </div>

      <nav className="flex-1 p-3 overflow-y-auto">
        <ul className="space-y-1 mb-2">{link(dashboard)}</ul>

        {secoes.map((sec) => {
          const open = aberta === sec.title
          const temAtivo = sec.items.some((i) => pathname === i.href || pathname.startsWith(i.href + '/'))
          return (
            <div key={sec.title} className="mt-1">
              <button
                onClick={() => setAberta(open ? null : sec.title)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors ${
                  temAtivo ? 'text-white' : 'text-blue-300 hover:text-white hover:bg-blue-800'
                }`}
              >
                <span>{sec.title}</span>
                <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </button>
              {open && <ul className="space-y-1 mt-1 mb-2">{sec.items.map(link)}</ul>}
            </div>
          )
        })}
      </nav>

      <div className="p-4 border-t border-blue-800 space-y-2">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-blue-300 hover:bg-blue-800 hover:text-white transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
          Sair
        </button>
        <p className="text-blue-500 text-xs text-center">Sistema v1.0</p>
      </div>
    </aside>
  )
}

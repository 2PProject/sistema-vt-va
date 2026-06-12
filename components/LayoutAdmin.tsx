'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from './Sidebar'
import { supabase } from '../lib/supabase'

interface LayoutAdminProps {
  children: React.ReactNode
  title: string
  actions?: React.ReactNode
}

export default function LayoutAdmin({ children, title, actions }: LayoutAdminProps) {
  const router = useRouter()
  const [verificando, setVerificando] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace('/login')
      } else {
        setVerificando(false)
      }
    })
  }, [router])

  if (verificando) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          <span className="text-sm">Verificando sessão...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-4 shrink-0">
          <h1 className="text-xl font-bold text-slate-800 truncate">{title}</h1>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
        <div className="flex-1 p-6 overflow-auto">{children}</div>
      </main>
    </div>
  )
}

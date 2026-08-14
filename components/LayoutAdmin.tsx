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
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="min-w-0 flex-1 flex flex-col overflow-hidden">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-gray-200 bg-white/95 px-4 py-4 backdrop-blur md:px-8 md:py-5">
          <h1 className="truncate text-xl font-bold text-gray-800 md:text-2xl">{title}</h1>
          {actions && <div className="flex items-center gap-3">{actions}</div>}
        </header>
        <div className="flex-1 overflow-auto p-3 sm:p-5 md:p-8">{children}</div>
      </main>
    </div>
  )
}

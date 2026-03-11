'use client'

import { useEffect, useState } from 'react'
import LayoutAdmin from '../../components/LayoutAdmin'
import { supabase } from '../../lib/supabase'
import { formatarMoeda, MESES } from '../../utils/calculoVT'

type Stats = {
  totalEmpresas: number
  totalUnidades: number
  totalFuncionarios: number
  totalFuncionariosAtivos: number
  totalCompetencias: number
  valorTotalMes: number
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({
    totalEmpresas: 0,
    totalUnidades: 0,
    totalFuncionarios: 0,
    totalFuncionariosAtivos: 0,
    totalCompetencias: 0,
    valorTotalMes: 0,
  })
  const [loading, setLoading] = useState(true)
  const mesAtual = new Date().getMonth() + 1
  const anoAtual = new Date().getFullYear()

  useEffect(() => {
    async function carregarStats() {
      const [empresas, unidades, funcionarios, competencias, cfMes] = await Promise.all([
        supabase.from('empresas').select('id', { count: 'exact', head: true }),
        supabase.from('unidades').select('id', { count: 'exact', head: true }),
        supabase.from('funcionarios').select('id, ativo'),
        supabase.from('competencias').select('id', { count: 'exact', head: true }),
        supabase
          .from('competencias')
          .select('id, competencia_funcionario(valor_total)')
          .eq('mes', mesAtual)
          .eq('ano', anoAtual),
      ])

      let valorTotalMes = 0
      if (cfMes.data) {
        for (const comp of cfMes.data) {
          const cfs = comp.competencia_funcionario as { valor_total: number }[]
          for (const cf of cfs ?? []) {
            valorTotalMes += cf.valor_total ?? 0
          }
        }
      }

      const ativos = funcionarios.data?.filter((f) => f.ativo).length ?? 0

      setStats({
        totalEmpresas: empresas.count ?? 0,
        totalUnidades: unidades.count ?? 0,
        totalFuncionarios: funcionarios.data?.length ?? 0,
        totalFuncionariosAtivos: ativos,
        totalCompetencias: competencias.count ?? 0,
        valorTotalMes,
      })
      setLoading(false)
    }

    carregarStats()
  }, [mesAtual, anoAtual])

  const cards = [
    {
      title: 'Empresas',
      value: stats.totalEmpresas,
      color: 'bg-blue-500',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
      href: '/empresas',
    },
    {
      title: 'Unidades',
      value: stats.totalUnidades,
      color: 'bg-indigo-500',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
        </svg>
      ),
      href: '/unidades',
    },
    {
      title: 'Funcionários Ativos',
      value: stats.totalFuncionariosAtivos,
      subtitle: `de ${stats.totalFuncionarios} cadastrados`,
      color: 'bg-green-500',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      href: '/funcionarios',
    },
    {
      title: `Total VT/VA — ${MESES[mesAtual - 1]}/${anoAtual}`,
      value: formatarMoeda(stats.valorTotalMes),
      color: 'bg-orange-500',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      href: '/recibos',
    },
  ]

  return (
    <LayoutAdmin title="Dashboard">
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-gray-400 text-sm">Carregando...</div>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Cards de estatísticas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {cards.map((card) => (
              <a key={card.title} href={card.href} className="card hover:shadow-md transition-shadow cursor-pointer block">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {card.title}
                    </p>
                    <p className="text-3xl font-bold text-gray-800 mt-2">{card.value}</p>
                    {card.subtitle && (
                      <p className="text-xs text-gray-400 mt-1">{card.subtitle}</p>
                    )}
                  </div>
                  <div className={`${card.color} text-white p-3 rounded-xl opacity-90`}>
                    {card.icon}
                  </div>
                </div>
              </a>
            ))}
          </div>

          {/* Atalhos */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-700 mb-4">Acesso Rápido</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                { label: 'Nova Empresa', href: '/empresas' },
                { label: 'Nova Unidade', href: '/unidades' },
                { label: 'Novo Funcionário', href: '/funcionarios' },
                { label: 'Nova Competência', href: '/competencias' },
                { label: 'Gerar Recibo', href: '/recibos' },
              ].map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="flex items-center justify-center px-4 py-3 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-sm font-medium transition-colors text-center"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>

          {/* Info do sistema */}
          <div className="card bg-blue-50 border-blue-100">
            <div className="flex items-start gap-4">
              <div className="text-blue-500 mt-0.5">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-blue-800">Sistema de Gestão VT/VA — Grupo Meire Reis</p>
                <p className="text-xs text-blue-600 mt-1">
                  Gerencie empresas, unidades, funcionários e competências mensais. Gere recibos em PDF com duas vias diretamente pelo sistema.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </LayoutAdmin>
  )
}

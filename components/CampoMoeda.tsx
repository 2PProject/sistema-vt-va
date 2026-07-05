'use client'

import { useEffect, useState } from 'react'

function fmt(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Campo de valor em Real com máscara (digita da direita para a esquerda, em
 * centavos). Sem setas de incremento e sem o "0" fixo — padrão brasileiro.
 */
export default function CampoMoeda({
  value, onChange, className = '', placeholder = '0,00', disabled = false, autoFocus = false,
}: {
  value: number
  onChange: (v: number) => void
  className?: string
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
}) {
  const [texto, setTexto] = useState(value ? fmt(value) : '')

  useEffect(() => {
    setTexto(value ? fmt(value) : '')
  }, [value])

  function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 13)
    if (!digits) { setTexto(''); onChange(0); return }
    const num = parseInt(digits, 10) / 100
    setTexto(fmt(num))
    onChange(num)
  }

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">R$</span>
      <input
        type="text"
        inputMode="numeric"
        disabled={disabled}
        autoFocus={autoFocus}
        className={`input-field pl-9 text-right ${className}`}
        placeholder={placeholder}
        value={texto}
        onChange={handle}
      />
    </div>
  )
}

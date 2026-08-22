// ─── Módulo Salão (NFS-e) — configuração e flag de ativação ───────────────
// Para DESLIGAR o módulo (esconde do menu e das rotas de UI), defina a env
// NEXT_PUBLIC_SALAO_ENABLED=false. Padrão: ligado.

export const SALAO_ENABLED = process.env.NEXT_PUBLIC_SALAO_ENABLED !== 'false'

// Prazo padrão de emissão (dia do mês seguinte) quando a empresa não define.
export const PRAZO_DIA_PADRAO = 10

// Marco inicial oficial do controle operacional. Registros anteriores continuam
// preservados no banco/histórico, mas não geram pendência nem conferência.
export const SALAO_COMPETENCIA_INICIAL = '2026-01'
export function competenciaNoEscopo(competencia?: string | null): boolean {
  return !competencia || competencia >= SALAO_COMPETENCIA_INICIAL
}

// Status possíveis de uma comissão / NFS-e
export type StatusComissao = 'pendente' | 'recebida' | 'fora_prazo'

export const STATUS_LABEL: Record<StatusComissao, string> = {
  pendente: 'Pendente',
  recebida: 'NF recebida',
  fora_prazo: 'Fora do prazo',
}

// Cores (classes Tailwind) por status — verde/amarelo/vermelho
export const STATUS_CLASSE: Record<StatusComissao, string> = {
  recebida: 'bg-green-100 text-green-700',
  pendente: 'bg-amber-100 text-amber-700',
  fora_prazo: 'bg-red-100 text-red-700',
}

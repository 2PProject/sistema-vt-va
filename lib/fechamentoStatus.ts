import { supabase } from './supabase'

// Controle de fechamento do mês por empresa/competência. Quando fechado,
// a edição de competências/descontos daquela empresa/mês fica bloqueada até
// a reabertura.

/** Mapa empresa_id -> fechado (true) para a competência informada. */
export async function listarFechamentos(mes: number, ano: number): Promise<Map<string, boolean>> {
  const { data } = await supabase
    .from('pagamento_fechamentos')
    .select('empresa_id, fechado')
    .eq('mes', mes)
    .eq('ano', ano)
  const map = new Map<string, boolean>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(data ?? []).forEach((r: any) => map.set(r.empresa_id, !!r.fechado))
  return map
}

export async function isMesFechado(empresaId: string, mes: number, ano: number): Promise<boolean> {
  if (!empresaId) return false
  const { data } = await supabase
    .from('pagamento_fechamentos')
    .select('fechado')
    .eq('empresa_id', empresaId).eq('mes', mes).eq('ano', ano)
    .limit(1).maybeSingle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return !!(data as any)?.fechado
}

/** Fecha ou reabre a competência de uma empresa. Não depende de upsert. */
export async function definirFechamento(
  empresaId: string, mes: number, ano: number, fechado: boolean
): Promise<{ ok: boolean; erro?: string }> {
  const { data: existente } = await supabase
    .from('pagamento_fechamentos')
    .select('id')
    .eq('empresa_id', empresaId).eq('mes', mes).eq('ano', ano)
    .limit(1).maybeSingle()

  const agora = new Date().toISOString()
  if (existente) {
    const { error } = await supabase.from('pagamento_fechamentos')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ fechado, atualizado_em: agora, ...(fechado ? { fechado_em: agora } : {}) } as any)
      .eq('id', (existente as { id: string }).id)
    if (error) return { ok: false, erro: error.message }
  } else {
    const { error } = await supabase.from('pagamento_fechamentos')
      .insert({ empresa_id: empresaId, mes, ano, fechado, fechado_em: agora, atualizado_em: agora })
    if (error) return { ok: false, erro: error.message }
  }
  return { ok: true }
}

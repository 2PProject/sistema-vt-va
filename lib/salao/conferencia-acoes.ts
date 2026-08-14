// Ações de edição/histórico/ciclo de vida — SERVER-ONLY (service_role).
// Toda alteração registra o ANTES e o DEPOIS em salon_historico. Sem falha
// silenciosa: erros do Supabase são devolvidos.
import type { SupabaseClient } from '@supabase/supabase-js'
import { dig, notaComp } from './conferencia-core'

type OK = { ok: boolean; erro?: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any

export async function registrarHistorico(admin: SupabaseClient, h: {
  tipo: 'comissao' | 'nota' | 'competencia'; ref_id: string; empresa_id?: string | null; competencia?: string | null
  acao: string; valor_anterior?: unknown; valor_novo?: unknown; usuario?: string | null; justificativa?: string | null
}): Promise<void> {
  await admin.from('salon_historico').insert({
    tipo: h.tipo, ref_id: h.ref_id, empresa_id: h.empresa_id ?? null, competencia: h.competencia ?? null,
    acao: h.acao, valor_anterior: h.valor_anterior ?? null, valor_novo: h.valor_novo ?? null,
    usuario: h.usuario ?? null, justificativa: h.justificativa ?? null,
  })
}

const CAMPOS_COM = ['nome', 'documento', 'valor_comissao', 'empresa_id', 'mes_ref', 'observacao'] as const
type CampoCom = typeof CAMPOS_COM[number]

/** Edita uma linha da planilha (comissão). Reprocessa só ela: desfaz o vínculo se ficar incompatível. */
export async function editarComissao(admin: SupabaseClient, id: string, campos: Partial<Record<CampoCom, unknown>>, usuario?: string): Promise<OK & { desvinculou?: boolean }> {
  const { data: atual, error: e0 } = await admin.from('salon_comissoes').select('*').eq('id', id).maybeSingle()
  if (e0) return { ok: false, erro: e0.message }
  if (!atual) return { ok: false, erro: 'Registro não encontrado.' }

  const novo: Record<string, unknown> = {}
  for (const c of CAMPOS_COM) if (c in campos && campos[c] !== undefined) novo[c] = campos[c]
  if ('documento' in novo && novo.documento != null) {
    const d = dig(String(novo.documento)); novo.documento = d || null
    novo.pendencia = (d.length === 11 || d.length === 14) ? null : (atual.pendencia ?? 'CNPJ/CPF inválido')
  }
  if ('valor_comissao' in novo) novo.valor_comissao = Number(novo.valor_comissao) || 0
  if (Object.keys(novo).length === 0) return { ok: true }
  novo.corrigido_manual = true

  // vínculo fica incompatível se mudou CNPJ, empresa ou competência
  let desvinculou = false
  if (atual.nota_id && ('documento' in novo || 'empresa_id' in novo || 'mes_ref' in novo)) {
    const { data: n } = await admin.from('salon_notas').select('id, documento, empresa_id, competencia, competencia_conf, data_emissao').eq('id', atual.nota_id).maybeSingle()
    const docFinal = 'documento' in novo ? dig(String(novo.documento ?? '')) : dig(atual.documento)
    const empFinal = 'empresa_id' in novo ? novo.empresa_id : atual.empresa_id
    const compFinal = 'mes_ref' in novo ? novo.mes_ref : atual.mes_ref
    const incompat = !n || dig(n.documento) !== docFinal || (n.empresa_id !== empFinal) || (notaComp(n) !== compFinal)
    if (incompat) {
      Object.assign(novo, { nota_id: null, status: 'pendente', nf_numero: null, nf_data: null, nf_valor: null, nf_origem: null, confirmado_em: null })
      if (atual.nota_id) await admin.from('salon_notas').update({ conferida: false }).eq('id', atual.nota_id)
      desvinculou = true
    }
  }

  const { error } = await admin.from('salon_comissoes').update(novo).eq('id', id)
  if (error) return { ok: false, erro: error.message }
  await registrarHistorico(admin, {
    tipo: 'comissao', ref_id: id, empresa_id: atual.empresa_id, competencia: atual.mes_ref,
    acao: desvinculou ? 'edicao_com_desvinculo' : 'edicao',
    valor_anterior: pick(atual, [...CAMPOS_COM]), valor_novo: novo, usuario,
  })
  return { ok: true, desvinculou }
}

const CAMPOS_NOTA = ['emitente_nome', 'documento', 'numero', 'data_emissao', 'competencia', 'valor', 'observacao'] as const
type CampoNota = typeof CAMPOS_NOTA[number]

/** Edita uma nota. Desfaz vínculo incompatível (CNPJ/competência/valor). */
export async function editarNota(admin: SupabaseClient, id: string, campos: Partial<Record<CampoNota, unknown>>, usuario?: string): Promise<OK> {
  const { data: atual, error: e0 } = await admin.from('salon_notas').select('*').eq('id', id).maybeSingle()
  if (e0) return { ok: false, erro: e0.message }
  if (!atual) return { ok: false, erro: 'Nota não encontrada.' }
  const novo: Record<string, unknown> = {}
  for (const c of CAMPOS_NOTA) if (c in campos && campos[c] !== undefined) novo[c] = campos[c]
  if ('documento' in novo && novo.documento != null) novo.documento = dig(String(novo.documento)) || null
  if ('valor' in novo) novo.valor = Number(novo.valor) || 0
  if (Object.keys(novo).length === 0) return { ok: true }

  const { error } = await admin.from('salon_notas').update(novo).eq('id', id)
  if (error) return { ok: false, erro: error.message }

  // desfaz vínculo se CNPJ/competência mudaram
  if ('documento' in novo || 'competencia' in novo || 'valor' in novo) {
    const { data: coms } = await admin.from('salon_comissoes').select('id, documento, mes_ref, empresa_id').eq('nota_id', id)
    for (const c of coms ?? []) {
      const docFinal = 'documento' in novo ? String(novo.documento ?? '') : atual.documento
      const compFinal = 'competencia' in novo ? String(novo.competencia ?? '') : notaComp(atual)
      if (dig(c.documento) !== dig(docFinal) || c.mes_ref !== compFinal) {
        await admin.from('salon_comissoes').update({ nota_id: null, status: 'pendente', nf_numero: null, nf_data: null, nf_valor: null, nf_origem: null, confirmado_em: null }).eq('id', c.id)
      }
    }
  }
  await registrarHistorico(admin, { tipo: 'nota', ref_id: id, empresa_id: atual.empresa_id, competencia: notaComp(atual), acao: 'edicao', valor_anterior: pick(atual, [...CAMPOS_NOTA]), valor_novo: novo, usuario })
  return { ok: true }
}

/** Exclusão LÓGICA de nota (com motivo). Desfaz vínculos; some das conferências/totais. */
export async function excluirNota(admin: SupabaseClient, id: string, motivo: string, usuario?: string): Promise<OK> {
  if (!motivo?.trim()) return { ok: false, erro: 'Informe o motivo da exclusão.' }
  const { data: atual } = await admin.from('salon_notas').select('*').eq('id', id).maybeSingle()
  if (!atual) return { ok: false, erro: 'Nota não encontrada.' }
  await admin.from('salon_comissoes').update({ nota_id: null, status: 'pendente', nf_numero: null, nf_data: null, nf_valor: null, nf_origem: null, confirmado_em: null }).eq('nota_id', id)
  const { error } = await admin.from('salon_notas').update({ excluida: true, conferida: false, excluida_motivo: motivo.trim(), excluida_por: usuario ?? null, excluida_em: new Date().toISOString() }).eq('id', id)
  if (error) return { ok: false, erro: error.message }
  await registrarHistorico(admin, { tipo: 'nota', ref_id: id, empresa_id: atual.empresa_id, competencia: notaComp(atual), acao: 'exclusao', valor_anterior: { excluida: false }, valor_novo: { excluida: true }, usuario, justificativa: motivo.trim() })
  return { ok: true }
}

export async function restaurarNota(admin: SupabaseClient, id: string, usuario?: string): Promise<OK> {
  const { data: atual } = await admin.from('salon_notas').select('empresa_id, competencia, competencia_conf, data_emissao').eq('id', id).maybeSingle()
  const { error } = await admin.from('salon_notas').update({ excluida: false, excluida_motivo: null, excluida_por: null, excluida_em: null }).eq('id', id)
  if (error) return { ok: false, erro: error.message }
  await registrarHistorico(admin, { tipo: 'nota', ref_id: id, empresa_id: atual?.empresa_id, competencia: atual ? notaComp(atual) : null, acao: 'restauracao', usuario })
  return { ok: true }
}

export async function marcarDuplicada(admin: SupabaseClient, id: string, dup: boolean, usuario?: string): Promise<OK> {
  const { error } = await admin.from('salon_notas').update({ duplicada: dup }).eq('id', id)
  if (error) return { ok: false, erro: error.message }
  await registrarHistorico(admin, { tipo: 'nota', ref_id: id, acao: dup ? 'marcada_duplicada' : 'desmarcada_duplicada', usuario })
  return { ok: true }
}

export async function observacaoNota(admin: SupabaseClient, id: string, texto: string, usuario?: string): Promise<OK> {
  const { error } = await admin.from('salon_notas').update({ observacao: texto }).eq('id', id)
  if (error) return { ok: false, erro: error.message }
  await registrarHistorico(admin, { tipo: 'nota', ref_id: id, acao: 'observacao', valor_novo: { observacao: texto }, usuario })
  return { ok: true }
}

/** Classifica uma nota como profissional ou outro serviço. Outro serviço é retirado da conferência. */
export async function classificarNota(admin: SupabaseClient, id: string, classificacao: 'profissional' | 'outro_servico', opts: { categoria?: string; observacao?: string; usuario?: string }): Promise<OK> {
  if (classificacao === 'outro_servico' && !opts.categoria?.trim()) return { ok: false, erro: 'Informe a categoria do outro serviço.' }
  const { data: atual, error: e0 } = await admin.from('salon_notas').select('*').eq('id', id).maybeSingle()
  if (e0) return { ok: false, erro: e0.message }
  if (!atual) return { ok: false, erro: 'Nota não encontrada.' }
  if (classificacao === 'outro_servico') {
    await admin.from('salon_comissoes').update({ nota_id: null, status: 'pendente', nf_numero: null, nf_data: null, nf_valor: null, nf_origem: null, confirmado_em: null }).eq('nota_id', id)
  }
  const novo = {
    classificacao,
    categoria_outro_servico: classificacao === 'outro_servico' ? opts.categoria?.trim() : null,
    observacao: opts.observacao?.trim() || atual.observacao || null,
    analise_manual: false,
    analise_motivo: null,
    conferida: classificacao === 'outro_servico' ? false : atual.conferida,
  }
  const { error } = await admin.from('salon_notas').update(novo).eq('id', id)
  if (error) return { ok: false, erro: error.message }
  await registrarHistorico(admin, { tipo: 'nota', ref_id: id, empresa_id: atual.empresa_id, competencia: notaComp(atual), acao: classificacao === 'outro_servico' ? 'outro_servico' : 'retorno_conferencia', valor_anterior: { classificacao: atual.classificacao }, valor_novo: novo, usuario: opts.usuario, justificativa: opts.observacao })
  return { ok: true }
}

export async function setNotaConferida(admin: SupabaseClient, id: string, conferida: boolean, usuario?: string): Promise<OK> {
  const { data: atual, error: e0 } = await admin.from('salon_notas').select('id, empresa_id, competencia, competencia_conf, data_emissao, conferida').eq('id', id).maybeSingle()
  if (e0) return { ok: false, erro: e0.message }
  if (!atual) return { ok: false, erro: 'Nota não encontrada.' }
  const novo = { conferida, conferida_em: conferida ? new Date().toISOString() : null, conferida_por: conferida ? (usuario ?? null) : null }
  const { error } = await admin.from('salon_notas').update(novo).eq('id', id)
  if (error) return { ok: false, erro: error.message }
  await registrarHistorico(admin, { tipo: 'nota', ref_id: id, empresa_id: atual.empresa_id, competencia: notaComp(atual), acao: conferida ? 'conferencia_manual' : 'reabertura_nota', valor_anterior: { conferida: !!atual.conferida }, valor_novo: { conferida }, usuario })
  return { ok: true }
}

/** Envia nota ou comissão para análise posterior, sem perder o registro. */
export async function setAnaliseManual(admin: SupabaseClient, tipo: 'nota' | 'comissao', id: string, ativo: boolean, motivo?: string, usuario?: string): Promise<OK> {
  const tabela = tipo === 'nota' ? 'salon_notas' : 'salon_comissoes'
  const { data: atual, error: e0 } = await admin.from(tabela).select('*').eq('id', id).maybeSingle()
  if (e0) return { ok: false, erro: e0.message }
  if (!atual) return { ok: false, erro: 'Registro não encontrado.' }
  const { error } = await admin.from(tabela).update({ analise_manual: ativo, analise_motivo: ativo ? (motivo?.trim() || 'Analisar posteriormente') : null }).eq('id', id)
  if (error) return { ok: false, erro: error.message }
  await registrarHistorico(admin, { tipo, ref_id: id, empresa_id: atual.empresa_id, competencia: tipo === 'nota' ? notaComp(atual) : atual.mes_ref, acao: ativo ? 'enviado_analise' : 'retirado_analise', usuario, justificativa: motivo })
  return { ok: true }
}

/** Histórico unificado (por registro, competência, ou geral). */
export async function historico(admin: SupabaseClient, filtro: { tipo?: string; refId?: string; competencia?: string; limite?: number }): Promise<Row[]> {
  let q = admin.from('salon_historico').select('*').order('criado_em', { ascending: false }).limit(filtro.limite ?? 200)
  if (filtro.tipo) q = q.eq('tipo', filtro.tipo)
  if (filtro.refId) q = q.eq('ref_id', filtro.refId)
  if (filtro.competencia) q = q.eq('competencia', filtro.competencia)
  const { data } = await q
  return data ?? []
}

// ── Ciclo de vida da competência ───────────────────────────────────────────
export type StatusComp = 'em_preparacao' | 'importada' | 'em_conferencia' | 'com_pendencias' | 'pronta' | 'fechada' | 'reaberta'
const CHAVE_GERAL = '00000000-0000-0000-0000-000000000000'

export async function getStatusCompetencia(admin: SupabaseClient, competencia: string, empresaId?: string): Promise<Row | null> {
  const { data } = await admin.from('salon_competencia_status').select('*').eq('competencia', competencia).eq('empresa_id', empresaId ?? CHAVE_GERAL).maybeSingle()
  return data ?? null
}

export async function setStatusCompetencia(admin: SupabaseClient, competencia: string, status: StatusComp, opts: { empresaId?: string; usuario?: string; justificativa?: string; totais?: unknown }): Promise<OK> {
  if ((status === 'reaberta') && !opts.justificativa?.trim()) return { ok: false, erro: 'Informe a justificativa para reabrir a competência.' }
  const empresa_id = opts.empresaId ?? CHAVE_GERAL
  const anterior = await getStatusCompetencia(admin, competencia, opts.empresaId)
  const payload: Record<string, unknown> = { competencia, empresa_id, status, usuario: opts.usuario ?? null, justificativa: opts.justificativa ?? null, atualizado_em: new Date().toISOString() }
  if (status === 'fechada') { payload.fechado_em = new Date().toISOString(); if (opts.totais) payload.totais = opts.totais }
  if (status === 'reaberta') payload.reaberto_em = new Date().toISOString()
  const { error } = await admin.from('salon_competencia_status').upsert(payload, { onConflict: 'competencia,empresa_id' })
  if (error) return { ok: false, erro: error.message }
  await registrarHistorico(admin, { tipo: 'competencia', ref_id: competencia, empresa_id: opts.empresaId ?? null, competencia, acao: `status_${status}`, valor_anterior: anterior?.status ?? null, valor_novo: status, usuario: opts.usuario, justificativa: opts.justificativa })
  return { ok: true }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pick(obj: any, keys: string[]): Record<string, unknown> {
  const o: Record<string, unknown> = {}
  for (const k of keys) o[k] = obj?.[k]
  return o
}

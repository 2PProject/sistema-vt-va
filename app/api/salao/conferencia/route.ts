// Conferência do Salão — SERVER-ONLY (service_role, ignora RLS). Fonte única de
// verdade: toda leitura/gravação da reconciliação passa por aqui.
//   GET  ?competencia=YYYY-MM[&empresaId=]              → estado + diagnóstico
//   GET  ?acao=consultar&...filtros/ordenacao/pagina    → tabela + indicadores
//   GET  ?acao=notasDoCnpj&documento=...[&todos=1]      → notas do CNPJ
//   GET  ?acao=historico&refId=...|competencia=...      → histórico unificado
//   GET  ?acao=statusCompetencia&competencia=...        → status do ciclo de vida
//   POST { acao, ... }  → reconciliar/refazer/limpar/vincular/desvincular/
//                          corrigirCnpj/editarComissao/editarNota/excluirNota/
//                          restaurarNota/marcarDuplicada/observacaoNota/setStatus
import { getAdminClient } from '../../../../lib/salao/server'
import * as core from '../../../../lib/salao/conferencia-core'
import * as acoes from '../../../../lib/salao/conferencia-acoes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function erroConfig(e: unknown) {
  return Response.json({ ok: false, erro: e instanceof Error ? e.message : 'Configuração ausente (SUPABASE_SERVICE_ROLE_KEY).' }, { status: 503 })
}
function num(v: string | null): number | null { if (v == null || v === '') return null; const n = Number(v); return isNaN(n) ? null : n }

export async function GET(req: Request) {
  let admin
  try { admin = getAdminClient() } catch (e) { return erroConfig(e) }
  const u = new URL(req.url)
  const acao = u.searchParams.get('acao')
  const p = (k: string) => u.searchParams.get(k) || undefined

  try {
    if (acao === 'notasDoCnpj') {
      const notas = await core.notasDoCnpj(admin, p('documento') ?? null)
      return Response.json({ ok: true, notas })
    }
    if (acao === 'historico') {
      const h = await acoes.historico(admin, { tipo: p('tipo'), refId: p('refId'), competencia: p('competencia'), limite: num(p('limite') ?? null) ?? 200 })
      return Response.json({ ok: true, historico: h })
    }
    if (acao === 'statusCompetencia') {
      const s = await acoes.getStatusCompetencia(admin, p('competencia') ?? '', p('empresaId'))
      return Response.json({ ok: true, status: s })
    }
    if (acao === 'consultar') {
      const filtros: core.Filtros = {
        competencia: p('competencia') ?? '', empresaId: p('empresaId'),
        nome: p('nome'), documento: p('documento'),
        situacao: (p('situacao') as core.Situacao | 'todas') ?? 'todas',
        vinculo: (p('vinculo') as 'vinculado' | 'nao_vinculado' | 'todas') ?? 'todas',
        valorMin: num(p('valorMin') ?? null), valorMax: num(p('valorMax') ?? null),
        soDivergencia: p('soDivergencia') === '1',
        emissaoDe: p('emissaoDe') ?? null, emissaoAte: p('emissaoAte') ?? null,
        numeroNota: p('numeroNota'), busca: p('busca'),
      }
      const ord: core.Ordenacao = { campo: (p('ordCampo') as core.Ordenacao['campo']) ?? 'nome', dir: (p('ordDir') as 'asc' | 'desc') ?? 'asc' }
      const pagina = num(p('pagina') ?? null) ?? 1
      const tamanho = Math.min(500, num(p('tamanho') ?? null) ?? 50)
      if (!filtros.competencia) return Response.json({ ok: false, erro: 'Informe a competência.' }, { status: 400 })
      const r = await core.consultar(admin, filtros, ord, pagina, tamanho)
      return Response.json({ ok: true, ...r })
    }
    // default: estado + diagnóstico
    const competencia = p('competencia') ?? ''
    if (!competencia) return Response.json({ ok: false, erro: 'Informe a competência.' }, { status: 400 })
    const dados = await core.carregar(admin, competencia, p('empresaId'))
    return Response.json({ ok: true, ...dados })
  } catch (e) {
    return Response.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  let admin
  try { admin = getAdminClient() } catch (e) { return erroConfig(e) }
  const b = await req.json().catch(() => null)
  if (!b?.acao) return Response.json({ ok: false, erro: 'Ação ausente.' }, { status: 400 })
  const { acao, competencia, empresaId, comissaoId, notaId, documento, campos, motivo, usuario, status, justificativa, dup, texto, classificacao, categoria, tipo, ativo } = b

  try {
    switch (acao) {
      case 'reconciliar': return Response.json({ ok: true, ...(await core.reconciliar(admin, competencia, empresaId || undefined)) })
      case 'refazer': {
        const l = await core.limpar(admin, competencia, empresaId || undefined)
        const r = await core.reconciliar(admin, competencia, empresaId || undefined)
        return Response.json({ ok: true, limpos: l.limpos, ...r })
      }
      case 'limpar': return Response.json({ ok: true, ...(await core.limpar(admin, competencia || undefined, empresaId || undefined)) })
      case 'vincular': { const r = await core.vincular(admin, comissaoId, notaId); return Response.json(r, { status: r.ok ? 200 : 400 }) }
      case 'desvincular': { const r = await core.desvincular(admin, comissaoId); return Response.json(r, { status: r.ok ? 200 : 400 }) }
      case 'corrigirCnpj': { const r = await core.corrigirCnpj(admin, comissaoId, documento); return Response.json(r, { status: r.ok ? 200 : 400 }) }
      case 'editarComissao': { const r = await acoes.editarComissao(admin, comissaoId, campos ?? {}, usuario); return Response.json(r, { status: r.ok ? 200 : 400 }) }
      case 'editarNota': { const r = await acoes.editarNota(admin, notaId, campos ?? {}, usuario); return Response.json(r, { status: r.ok ? 200 : 400 }) }
      case 'excluirNota': { const r = await acoes.excluirNota(admin, notaId, motivo ?? '', usuario); return Response.json(r, { status: r.ok ? 200 : 400 }) }
      case 'restaurarNota': { const r = await acoes.restaurarNota(admin, notaId, usuario); return Response.json(r, { status: r.ok ? 200 : 400 }) }
      case 'marcarDuplicada': { const r = await acoes.marcarDuplicada(admin, notaId, !!dup, usuario); return Response.json(r, { status: r.ok ? 200 : 400 }) }
      case 'observacaoNota': { const r = await acoes.observacaoNota(admin, notaId, texto ?? '', usuario); return Response.json(r, { status: r.ok ? 200 : 400 }) }
      case 'classificarNota': { const r = await acoes.classificarNota(admin, notaId, classificacao, { categoria, observacao: texto, usuario }); return Response.json(r, { status: r.ok ? 200 : 400 }) }
      case 'setAnaliseManual': { const r = await acoes.setAnaliseManual(admin, tipo, tipo === 'nota' ? notaId : comissaoId, !!ativo, motivo, usuario); return Response.json(r, { status: r.ok ? 200 : 400 }) }
      case 'setStatus': { const r = await acoes.setStatusCompetencia(admin, competencia, status, { empresaId: empresaId || undefined, usuario, justificativa }); return Response.json(r, { status: r.ok ? 200 : 400 }) }
      default: return Response.json({ ok: false, erro: `Ação desconhecida: ${acao}` }, { status: 400 })
    }
  } catch (e) {
    return Response.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

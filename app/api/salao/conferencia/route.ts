// Conferência do Salão — SERVER-ONLY (service_role, ignora RLS). Fonte única de
// verdade: toda leitura/gravação da reconciliação passa por aqui.
//   GET  ?competencia=YYYY-MM[&empresaId=]         → estado + diagnóstico
//   GET  ?acao=notasDoCnpj&documento=...           → notas livres do CNPJ
//   POST { acao, competencia?, empresaId?, ... }   → reconciliar/refazer/limpar/
//                                                     vincular/desvincular/corrigirCnpj
import { getAdminClient } from '../../../../lib/salao/server'
import * as core from '../../../../lib/salao/conferencia-core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function erroConfig(e: unknown) {
  return Response.json({ ok: false, erro: e instanceof Error ? e.message : 'Configuração ausente (SUPABASE_SERVICE_ROLE_KEY).' }, { status: 503 })
}

export async function GET(req: Request) {
  let admin
  try { admin = getAdminClient() } catch (e) { return erroConfig(e) }
  const url = new URL(req.url)
  const acao = url.searchParams.get('acao')

  if (acao === 'notasDoCnpj') {
    const notas = await core.notasDoCnpj(admin, url.searchParams.get('documento'))
    return Response.json({ ok: true, notas })
  }

  const competencia = url.searchParams.get('competencia') || ''
  const empresaId = url.searchParams.get('empresaId') || undefined
  if (!competencia) return Response.json({ ok: false, erro: 'Informe a competência.' }, { status: 400 })
  const dados = await core.carregar(admin, competencia, empresaId)
  return Response.json({ ok: true, ...dados })
}

export async function POST(req: Request) {
  let admin
  try { admin = getAdminClient() } catch (e) { return erroConfig(e) }
  const body = await req.json().catch(() => null)
  if (!body?.acao) return Response.json({ ok: false, erro: 'Ação ausente.' }, { status: 400 })
  const { acao, competencia, empresaId, comissaoId, notaId, documento } = body

  try {
    switch (acao) {
      case 'reconciliar': {
        const r = await core.reconciliar(admin, competencia, empresaId || undefined)
        return Response.json({ ok: true, ...r })
      }
      case 'refazer': {
        const l = await core.limpar(admin, competencia, empresaId || undefined)
        const r = await core.reconciliar(admin, competencia, empresaId || undefined)
        return Response.json({ ok: true, limpos: l.limpos, ...r })
      }
      case 'limpar': {
        const l = await core.limpar(admin, competencia || undefined, empresaId || undefined)
        return Response.json({ ok: true, ...l })
      }
      case 'vincular': {
        const r = await core.vincular(admin, comissaoId, notaId)
        return Response.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'desvincular': {
        const r = await core.desvincular(admin, comissaoId)
        return Response.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'corrigirCnpj': {
        const r = await core.corrigirCnpj(admin, comissaoId, documento)
        return Response.json(r, { status: r.ok ? 200 : 400 })
      }
      default:
        return Response.json({ ok: false, erro: `Ação desconhecida: ${acao}` }, { status: 400 })
    }
  } catch (e) {
    return Response.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { computeConfidence, isPreselected } from '../../../../lib/salao/ia'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const items = Array.isArray(body.items) ? body.items : []

    const suggestions = items.map((it: any) => {
      const anchor = (it.anchor as any) || 'unknown'
      const dm = typeof it.dm === 'number' ? it.dm : (typeof it.mesesDiff === 'number' ? it.mesesDiff : 99)
      const tipo = it.tipo as ('aprox'|'soma'|'exata') | undefined
      const mesmaComp = !!it.mesmaComp
      const confianca = computeConfidence({ anchor, mesmaComp, dm, tipo })
      const preselecionada = isPreselected(confianca, mesmaComp)

      return {
        profissionalId: it.profissionalId || null,
        notaIds: Array.isArray(it.notaIds) ? it.notaIds : [],
        confianca,
        motivos: Array.isArray(it.motivos) ? it.motivos : [],
        regra_ancora: anchor,
        competencia_dist_meses: dm,
        preselecionada
      }
    })

    return NextResponse.json({ suggestions, meta: { model: 'mock-local', promptVersion: 'v1' } })
  } catch (err: any) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

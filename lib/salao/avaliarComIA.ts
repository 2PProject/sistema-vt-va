// small helper to call the mock IA endpoint and merge responses
export async function avaliarComIA(sugestoes: any[]) {
  try {
    const res = await fetch('/api/salao/avaliar-sugestoes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: sugestoes.map(s => ({
        profissionalId: s.profissional.id,
        notaIds: s.notas.map((n: any) => n.id),
        anchor: s.motivos?.includes('CNPJ/CPF idêntico') ? 'cnpj' : (s.motivos?.includes('nome idêntico') ? 'nome_id' : 'nome_parcial'),
        dm: s.notas.length ? Math.min(...s.notas.map((n: any) => Math.abs(Number(n.mes_ref?.split('-')[0] || 0) - Number(s.profissional.mes_ref?.split('-')[0] || 0)))) : 99,
        mesmaComp: s.notas.every((n: any) => n.mes_ref === s.profissional.mes_ref,
        ),
        motivos: s.motivos,
        tipo: s.notas.length>1?'soma':(s.motivos?.includes('valor aproximado')?'aprox':'exata')
      })) })
    })
    if(!res.ok) return null
    const body = await res.json()
    const map = new Map(body.suggestions.map((x: any) => [x.profissionalId, x]))
    return sugestoes.map(s => ({ ...s, ia: map.get(s.profissional.id) }))
  } catch (err) {
    console.error('IA call failed', err)
    return sugestoes.map(s => ({ ...s, ia: null }))
  }
}

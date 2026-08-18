export type Anchor = 'cnpj' | 'nome_id' | 'nome_parcial' | 'unknown'

export function computeConfidence({anchor, mesmaComp, dm, tipo}:{anchor:Anchor, mesmaComp:boolean, dm:number, tipo?: 'aprox'|'soma'|'exata'}){
  const base = anchor === 'cnpj' ? 85 : anchor === 'nome_id' ? 75 : anchor === 'nome_parcial' ? 62 : 62
  const periodoAdj = mesmaComp ? 10 : (dm <= 1 ? 0 : (dm <= 2 ? -10 : -20))
  const tipoAdj = (tipo === 'aprox' ? -8 : 0) + (tipo === 'soma' ? -4 : 0)
  let confianca = base + periodoAdj - tipoAdj
  confianca = Math.max(40, Math.min(100, confianca))
  return confianca
}

export function isPreselected(confianca:number, mesmaComp:boolean){
  return confianca >= 85 && mesmaComp
}

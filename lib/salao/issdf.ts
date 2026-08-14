// NFS-e RECEBIDAS (serviços tomados) do ISS-DF — SERVER-ONLY.
//
// POR QUE MUDOU: o DF migrou para a NFS-e NACIONAL. Nesse padrão, nota recebida
// NÃO se consulta por SOAP (ABRASF). Ela é DISTRIBUÍDA pelo ADN nacional
// (GET /contribuintes/DFe/{NSU}) ao titular do certificado sempre que ele é o
// TOMADOR. Enviar um `ConsultarNfseServicoTomado`/`<cabecalho versao=...>` ao
// endpoint nacional dá E183 (cabeçalho fora do padrão) e E160 (fora do XSD),
// porque essa operação/schema não existem no padrão nacional.
//
// Portanto, reutilizamos o MESMO mecanismo mTLS + ADN do sync nacional (adn.ts),
// filtrando as notas do DF (município 5300108) no período. Zero XML montado à mão.
import type { SupabaseClient } from '@supabase/supabase-js'
import { agenteMTLS, consultarADN } from './adn'

// Código IBGE do único município do Distrito Federal (Brasília).
export const MUNICIPIO_DF = '5300108'
export const municipioDaChave = (chave?: string | null) => (chave || '').replace(/\D/g, '').slice(0, 7)

export type NotaIssDf = {
  chave: string; documento: string; emitenteNome: string; numero: string
  dataEmissao: string; competencia: string; valor: number
}
export type ResultadoIssDf = {
  encontradas: number; gravadas: number; existentes: number; noPeriodoDf: number
  paginas: number; status: number; novoNsu: number; houveMais: boolean; mensagens: string[]
}

/**
 * Sincroniza as notas RECEBIDAS via ADN nacional (incremental por NSU, com o
 * mesmo cursor do sync nacional) e grava em salon_notas. Devolve um resumo e
 * quantas notas do DF existem no período. Chame de novo enquanto `houveMais`.
 */
export async function sincronizarRecebidasIssDf(admin: SupabaseClient, params: {
  empresaId: string; pfxBase64: string; senha: string; cnpj: string; inicio: string; fim: string; maxLotes?: number
}): Promise<ResultadoIssDf> {
  const agent = agenteMTLS(params.pfxBase64, params.senha)
  const cnpj = params.cnpj.replace(/\D/g, '')
  const raiz = cnpj.slice(0, 8)

  const { data: syncRow } = await admin.from('salon_nfse_sync').select('ultimo_nsu').eq('empresa_id', params.empresaId).maybeSingle()
  let nsu = syncRow?.ultimo_nsu ?? 0
  const maxLotes = params.maxLotes ?? 8
  let status = 0, paginas = 0, houveMais = false, gravadas = 0, encontradas = 0
  const mensagens: string[] = []

  for (let lote = 0; lote < maxLotes; lote++) {
    const r = await consultarADN({ agent, cnpj, ultimoNsu: nsu, maxPaginas: 6 })
    status = r.status; paginas += r.paginas; nsu = r.ultimoNsu
    encontradas += r.notas.length

    // recebidas e válidas: valor > 0 e não emitidas pela própria empresa (mesma raiz)
    const recebidas = r.notas.filter((n) => {
      if (!(Number(n.valor) > 0)) return false
      const emit = (n.prestadorDoc || '').replace(/\D/g, '')
      return !(raiz && emit.length === 14 && emit.slice(0, 8) === raiz)
    })
    if (recebidas.length) {
      const payload = recebidas.map((n) => ({
        empresa_id: params.empresaId, nsu: n.nsu, chave: n.chave || null,
        documento: n.prestadorDoc || null, emitente_nome: n.prestadorNome || null,
        numero: n.numero || null, valor: n.valor, data_emissao: n.dataEmissao || null,
        competencia: n.competencia || null,
      }))
      const { error, count } = await admin.from('salon_notas').upsert(payload, { onConflict: 'empresa_id,nsu', count: 'exact' })
      if (error) throw new Error(`Erro ao gravar notas: ${error.message}`)
      gravadas += count ?? payload.length
    }

    if (r.rateLimited) { mensagens.push('O gov.br limitou as requisições (429). Rode novamente para continuar de onde parou.'); houveMais = true; break }
    if (!r.houveMais) { houveMais = false; break }
    if (lote === maxLotes - 1) houveMais = true
  }

  await admin.from('salon_nfse_sync').upsert({ empresa_id: params.empresaId, ultimo_nsu: nsu, ultima_sync: new Date().toISOString() })

  // Quantas notas do DF (município 5300108) há no período — para a UI.
  const { count: noPeriodoDf } = await admin.from('salon_notas')
    .select('id', { count: 'exact', head: true })
    .eq('empresa_id', params.empresaId)
    .gte('data_emissao', params.inicio).lte('data_emissao', params.fim)
    .like('chave', `${MUNICIPIO_DF}%`)

  return { encontradas, gravadas, existentes: encontradas - gravadas, noPeriodoDf: noPeriodoDf ?? 0, paginas, status, novoNsu: nsu, houveMais, mensagens }
}

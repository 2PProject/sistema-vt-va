// Integração com a NFS-e Nacional — Ambiente de Dados Nacional (ADN) gov.br.
// SERVER-ONLY. mTLS com certificado A1 (.pfx). Contrato oficial:
//   GET /contribuintes/DFe/{NSU}?cnpj={cnpj}   (distribuição por NSU)
// Base produção restrita: https://adn.producaorestrita.nfse.gov.br
// Ref: Manual dos Contribuintes — Guia de utilização das APIs do ADN.
import https from 'https'
import zlib from 'zlib'

export type NotaADN = {
  nsu: number
  chave: string
  prestadorDoc: string   // CPF/CNPJ do emitente/prestador (só dígitos)
  prestadorNome: string  // xNome do emitente
  numero: string
  dataEmissao: string    // 'YYYY-MM-DD'
  valor: number
  competencia?: string   // 'YYYY-MM'
  xmlOriginal?: string    // XML descompactado original para DANFSe/auditoria
}
export type ResultadoADN = {
  notas: NotaADN[]
  ultimoNsu: number
  status: number      // HTTP status da última chamada relevante
  amostra: string     // trecho da 1ª resposta (diagnóstico)
  paginas: number     // quantas páginas foram lidas
  houveMais: boolean  // parou no limite do lote (há mais para buscar)
  rateLimited: boolean// gov.br respondeu 429 (excesso de requisições)
  cancelamentos: string[] // chaves de NFS-e CANCELADAS (eventos de cancelamento no lote)
  maxNsuDisponivel: number // maior NSU disponível na base do gov.br (0 se não informado)
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Base URL do ADN conforme o ambiente (padrão: produção restrita/homologação). */
export function baseADN(): string {
  if (process.env.SALON_ADN_BASE_URL) return process.env.SALON_ADN_BASE_URL.replace(/\/$/, '')
  const amb = (process.env.SALON_ADN_AMBIENTE || 'restrita').toLowerCase()
  return amb === 'producao'
    ? 'https://adn.nfse.gov.br'
    : 'https://adn.producaorestrita.nfse.gov.br'
}

export function agenteMTLS(pfxBase64: string, senha: string): https.Agent {
  return new https.Agent({ pfx: Buffer.from(pfxBase64, 'base64'), passphrase: senha, keepAlive: false })
}

// GET com mTLS; devolve { status, corpo }.
function httpsGet(url: URL, agent: https.Agent): Promise<{ status: number; corpo: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', agent, headers: { Accept: 'application/json' }, timeout: 20000 },
      (res) => {
        let buf = ''
        res.on('data', (c) => { buf += c })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, corpo: buf }))
      })
    req.on('timeout', () => { req.destroy(new Error('timeout')) })
    req.on('error', reject)
    req.end()
  })
}

// Busca uma chave em objeto ignorando maiúsculas/minúsculas.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pick(obj: any, ...nomes: string[]): any {
  if (!obj || typeof obj !== 'object') return undefined
  const map = new Map(Object.keys(obj).map(k => [k.toLowerCase(), k]))
  for (const n of nomes) { const k = map.get(n.toLowerCase()); if (k !== undefined) return obj[k] }
  return undefined
}

function tag(xml: string, ...nomes: string[]): string | undefined {
  for (const n of nomes) {
    const m = xml.match(new RegExp(`<[\\w:]*${n}[^>]*>([^<]+)</`, 'i'))
    if (m) return m[1].trim()
  }
  return undefined
}

/**
 * Descompacta (gzip+base64) e extrai os campos essenciais do XML da NFS-e
 * nacional. Caminhos oficiais (Anexo I — Leiaute DPS/NFS-e):
 *   emitente/prestador: NFSe/infNFSe/emit/{CNPJ|CPF}
 *   número:             NFSe/infNFSe/nNFSe
 *   data de emissão:    NFSe/infNFSe/dhProc
 *   competência:        NFSe/infNFSe/DPS/infDPS/dCompet
 *   valor líquido:      NFSe/infNFSe/valores/vLiq  (fallback: .../vServ)
 *   chave de acesso:    atributo Id de infNFSe
 */
/**
 * Normaliza para 'YYYY-MM' válido (mês 01–12, zero-padded) ou '' quando não dá.
 * Essencial: a coluna salon_notas.competencia tem CHECK '^[0-9]{4}-(0[1-9]|1[0-2])$';
 * uma competência fora do padrão (ex.: '2026-6') rejeita o UPSERT do LOTE INTEIRO
 * e trava o cursor NSU. Aqui garantimos que nunca sai um valor inválido.
 */
export function mesValido(s: string | null | undefined): string {
  const m = (s ?? '').match(/(\d{4})-(\d{1,2})/)
  if (!m) return ''
  const mm = Number(m[2]); if (mm < 1 || mm > 12) return ''
  return `${m[1]}-${String(mm).padStart(2, '0')}`
}

function parseArquivoXml(arquivo: string): { chave: string; prestadorDoc: string; prestadorNome: string; numero: string; data: string; competencia: string; valor: number; xml: string } | null {
  let xml = ''
  try { xml = zlib.gunzipSync(Buffer.from(arquivo, 'base64')).toString('utf8') }
  catch { try { xml = Buffer.from(arquivo, 'base64').toString('utf8') } catch { return null } }
  if (!xml.includes('<')) return null
  // Emitente da NFS-e (o profissional que emitiu a nota recebida pelo salão).
  const emit = xml.match(/<[\w:]*emit[^>]*>[\s\S]*?<\/[\w:]*emit>/i)?.[0]
    || xml.match(/<[\w:]*prest[^>]*>[\s\S]*?<\/[\w:]*prest>/i)?.[0] || xml
  const doc = (tag(emit, 'CNPJ', 'CPF') || tag(xml, 'CNPJ', 'CPF') || '').replace(/\D/g, '')
  const nome = tag(emit, 'xNome') || tag(xml, 'xNome') || ''
  const chave = (xml.match(/<[\w:]*infNFSe[^>]*\bId="([^"]+)"/i)?.[1] || tag(xml, 'chNFSe') || '').replace(/\s/g, '')
  const numero = tag(xml, 'nNFSe', 'nDFSe', 'numero', 'Numero') || ''
  const data = (tag(xml, 'dhProc', 'dhEmi') || '').slice(0, 10)
  const dCompet = (tag(xml, 'dCompet', 'competencia') || '').slice(0, 10)
  const competencia = mesValido(dCompet || data)
  const valor = parseFloat(tag(xml, 'vLiq', 'vServ', 'vServPrest') || '0') || 0
  return { chave, prestadorDoc: doc, prestadorNome: nome, numero, data, competencia, valor, xml }
}

/**
 * Detecta se o XML é um EVENTO DE CANCELAMENTO (ou uma nota já marcada como
 * cancelada) e devolve a CHAVE da NFS-e cancelada — null quando não é
 * cancelamento. No padrão nacional o cancelamento chega como um documento de
 * evento separado (tpEvento 1011xx/1051xx) que referencia a chave da nota; a
 * própria nota não vem com valor zerado, por isso o filtro de valor não pega.
 */
export function cancelamentoDoXml(xml: string): string | null {
  if (!xml) return null
  const norm = (s: string) => (s || '').replace(/\s/g, '')
  const tp = (tag(xml, 'tpEvento', 'cEvento') || '').replace(/\D/g, '')
  const ehEvento = /<[\w:]*(eventoNFSe|infEvento|pedRegEvento)\b/i.test(xml)
  const cancel =
    /^(1011|1051|1055)/.test(tp) ||                                                   // evento de cancelamento (nacional)
    /<[\w:]*(eCancelamento|NfseCancelamento|NFSeCanc|DataCancelamento|dhCanc)\b/i.test(xml) || // tags de cancelamento
    (ehEvento && /cancelad/i.test(tag(xml, 'xEvento', 'descEvento', 'xMotivo') || '')) ||        // evento textual
    tag(xml, 'cSitNFSe', 'situacaoNfse') === '2'                                       // situação 2 = cancelada
  if (!cancel) return null
  const ch = tag(xml, 'chNFSe', 'chaveAcesso', 'chaveNFSe', 'chSubstituida') ||
    xml.match(/<[\w:]*infNFSe[^>]*\bId="([^"]+)"/i)?.[1] || ''
  return norm(ch) || 'CANCELADA'
}

/** Converte um item do LoteDFe em NotaADN. */
/**
 * CNPJ/CPF do EMITENTE a partir da Chave de Acesso (50 dígitos). O campo
 * "Inscrição Federal" (14 posições, começando na 10ª) carrega o CNPJ do
 * emitente — ou o CPF com 3 zeros à esquerda. É a forma mais confiável de saber
 * quem emitiu (não depende de abrir o XML).
 */
export function docDaChave(chave: string): string {
  const c = (chave || '').replace(/\D/g, '')
  if (c.length < 23) return ''
  const d = c.slice(9, 23)                       // 14 dígitos da inscrição federal
  return d.startsWith('000') ? d.slice(3) : d    // CPF vem com 000 à esquerda
}

// Converte um item do LoteDFe em NotaADN. O documento do emitente vem da CHAVE
// (confiável); os demais campos, do XML (gzip+base64) quando disponível.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function itemParaNota(item: any): { nota?: NotaADN; cancelaChave?: string } {
  const nsu = Number(pick(item, 'NSU', 'nsu') ?? 0)
  const arquivo = pick(item, 'ArquivoXml', 'arquivoXml', 'DocumentoXml', 'documentoXmlGZipB64', 'xmlGZipB64')
  const chave = String(pick(item, 'ChaveAcesso', 'chaveAcesso') ?? '')
  const p = typeof arquivo === 'string' ? parseArquivoXml(arquivo) : null
  // Cancelamento: não vira nota; devolve a chave da NFS-e cancelada para expurgo.
  if (p?.xml) {
    const canc = cancelamentoDoXml(p.xml)
    if (canc) return { cancelaChave: canc === 'CANCELADA' ? (p.chave || chave).replace(/\s/g, '') : canc }
  }
  const chaveFinal = p?.chave || chave
  return {
    nota: {
      nsu,
      chave: chaveFinal,
      prestadorDoc: docDaChave(chaveFinal) || p?.prestadorDoc || '',
      prestadorNome: p?.prestadorNome ?? '', numero: p?.numero ?? '',
      dataEmissao: p?.data ?? '', valor: p?.valor ?? 0,
      competencia: p?.competencia || undefined,
      xmlOriginal: p?.xml,
    },
  }
}

/** "Sem documentos" no ADN é sinalizado por códigos E2xxx (não é erro real). */
export function semDocumentos(status: number, corpo: string): boolean {
  if (status === 404) return true
  return /E2(215|230|305|306|020|040|070)\b|Nenhum documento/i.test(corpo || '')
}

/**
 * Uma chamada crua GET /contribuintes/DFe/{nsu} — distribui os DF-e em que o
 * titular do certificado figura como ator (prestador/tomador/intermediário).
 * O `cnpj` só é enviado quando se deseja consultar OUTRO CNPJ da mesma raiz.
 */
export async function chamarDFe(agent: https.Agent, cnpj: string, nsu: number, cnpjDiferente = false): Promise<{ status: number; corpo: string; url: string }> {
  const url = new URL(`${baseADN()}/contribuintes/DFe/${Math.max(0, nsu)}`)
  if (cnpjDiferente && cnpj) url.searchParams.set('cnpj', cnpj)
  const { status, corpo } = await httpsGet(url, agent)
  return { status, corpo, url: url.toString() }
}

/**
 * Consulta incremental por NSU: parte do último NSU salvo e pagina (50 por vez)
 * até esgotar. Retorna as notas novas e o maior NSU visto.
 */
export async function consultarADN(params: { agent: https.Agent; cnpj: string; ultimoNsu: number; maxPaginas?: number }): Promise<ResultadoADN> {
  const maxPaginas = params.maxPaginas ?? 6   // lotes pequenos: respeita limite de tempo/rate do gov.br
  let nsu = params.ultimoNsu
  const notas: NotaADN[] = []
  const cancelamentos: string[] = []
  let status = 0, amostra = '', paginas = 0, houveMais = false, rateLimited = false, maxNsuDisponivel = 0

  for (let i = 0; i < maxPaginas; i++) {
    if (i > 0) await sleep(500)             // throttle: espaça as chamadas (evita 429)

    // Chamada com retentativa em caso de 429 (excesso de requisições)
    let r = await chamarDFe(params.agent, params.cnpj, nsu)
    for (let t = 0; r.status === 429 && t < 2; t++) { await sleep(2000 * (t + 1)); r = await chamarDFe(params.agent, params.cnpj, nsu) }

    if (i === 0) { status = r.status; amostra = (r.corpo || '').slice(0, 600) }
    paginas++

    if (r.status === 429) { status = 429; rateLimited = true; houveMais = true; break }
    if (semDocumentos(r.status, r.corpo)) { status = r.status; break }   // fim (E2215/E2230/404)
    if (r.status >= 400) throw new Error(`ADN respondeu HTTP ${r.status}. ${(r.corpo || '').slice(0, 200)}`)

    let data: unknown = null
    try { data = JSON.parse(r.corpo || 'null') } catch { throw new Error(`Resposta do ADN não é JSON. Início: ${(r.corpo || '').slice(0, 200)}`) }
    const lote: unknown[] = pick(data, 'LoteDFe', 'loteDFe', 'documentos', 'DFe') ?? []
    // Cursor autoritativo do gov.br, quando presente (mais confiável que a
    // heurística de página cheia). ultNSU = último NSU da resposta;
    // maxNSU = maior NSU disponível na base.
    const ultNSU = Number(pick(data, 'ultNSU', 'ultimoNSU', 'ultimoNsu') ?? 0)
    const maxNSU = Number(pick(data, 'maxNSU', 'maxNsu') ?? 0)
    if (maxNSU > maxNsuDisponivel) maxNsuDisponivel = maxNSU
    if (!Array.isArray(lote) || lote.length === 0) {
      if (ultNSU > nsu) nsu = ultNSU        // avança sobre páginas só de eventos/sem notas
      if (maxNSU > nsu) houveMais = true    // ainda há documentos além
      break
    }
    for (const item of lote) { const it = itemParaNota(item); if (it.nota) notas.push(it.nota); else if (it.cancelaChave) cancelamentos.push(it.cancelaChave) }
    const maxNsu = Math.max(ultNSU, lote.reduce((mx: number, it) => Math.max(mx, Number(pick(it, 'NSU', 'nsu') ?? 0)), nsu))
    if (maxNsu <= nsu) break                // não avançou → fim
    nsu = maxNsu
    // Ainda há mais? Prefere o maxNSU do gov.br; sem ele, heurística de página cheia (50).
    const temMais = maxNSU > 0 ? maxNSU > nsu : lote.length >= 50
    if (!temMais) break                     // último lote → acabou
    if (i === maxPaginas - 1) houveMais = true   // parou no limite do lote; ainda há mais
  }
  return { notas, ultimoNsu: nsu, status, amostra, paginas, houveMais, rateLimited, cancelamentos: Array.from(new Set(cancelamentos)), maxNsuDisponivel }
}

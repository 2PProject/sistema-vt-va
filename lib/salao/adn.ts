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
  numero: string
  dataEmissao: string    // 'YYYY-MM-DD'
  valor: number
  competencia?: string   // 'YYYY-MM'
}
export type ResultadoADN = { notas: NotaADN[]; ultimoNsu: number }

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
function parseArquivoXml(arquivo: string): { chave: string; prestadorDoc: string; numero: string; data: string; competencia: string; valor: number } | null {
  let xml = ''
  try { xml = zlib.gunzipSync(Buffer.from(arquivo, 'base64')).toString('utf8') }
  catch { try { xml = Buffer.from(arquivo, 'base64').toString('utf8') } catch { return null } }
  if (!xml.includes('<')) return null
  // Emitente da NFS-e (o profissional que emitiu a nota recebida pelo salão).
  const emit = xml.match(/<[\w:]*emit[^>]*>[\s\S]*?<\/[\w:]*emit>/i)?.[0]
    || xml.match(/<[\w:]*prest[^>]*>[\s\S]*?<\/[\w:]*prest>/i)?.[0] || xml
  const doc = (tag(emit, 'CNPJ', 'CPF') || tag(xml, 'CNPJ', 'CPF') || '').replace(/\D/g, '')
  const chave = (xml.match(/<[\w:]*infNFSe[^>]*\bId="([^"]+)"/i)?.[1] || tag(xml, 'chNFSe') || '').replace(/\s/g, '')
  const numero = tag(xml, 'nNFSe', 'nDFSe', 'numero', 'Numero') || ''
  const data = (tag(xml, 'dhProc', 'dhEmi') || '').slice(0, 10)
  const dCompet = (tag(xml, 'dCompet', 'competencia') || '').slice(0, 10)
  const competencia = (dCompet || data).slice(0, 7)
  const valor = parseFloat(tag(xml, 'vLiq', 'vServ', 'vServPrest') || '0') || 0
  return { chave, prestadorDoc: doc, numero, data, competencia, valor }
}

/** Converte um item do LoteDFe em NotaADN. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function itemParaNota(item: any): NotaADN | null {
  const nsu = Number(pick(item, 'NSU', 'nsu') ?? 0)
  const arquivo = pick(item, 'ArquivoXml', 'arquivoXml', 'DocumentoXml', 'documentoXmlGZipB64', 'xmlGZipB64')
  if (typeof arquivo !== 'string') return null
  const p = parseArquivoXml(arquivo)
  if (!p || !p.prestadorDoc) return null
  return {
    nsu,
    chave: p.chave || String(pick(item, 'ChaveAcesso', 'chaveAcesso') ?? ''),
    prestadorDoc: p.prestadorDoc, numero: p.numero,
    dataEmissao: p.data, valor: p.valor,
    competencia: p.competencia || undefined,
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
export async function consultarADN(params: { agent: https.Agent; cnpj: string; ultimoNsu: number }): Promise<ResultadoADN> {
  let nsu = params.ultimoNsu
  const notas: NotaADN[] = []
  for (let i = 0; i < 40; i++) {           // trava de segurança (até ~2000 docs)
    const { status, corpo } = await chamarDFe(params.agent, params.cnpj, nsu)
    if (semDocumentos(status, corpo)) break // sem novos documentos (E2215/E2230/404)
    if (status >= 400) throw new Error(`ADN HTTP ${status}`)
    const data = JSON.parse(corpo || 'null')
    const lote: unknown[] = pick(data, 'LoteDFe', 'loteDFe', 'documentos', 'DFe') ?? []
    if (!Array.isArray(lote) || lote.length === 0) break
    for (const item of lote) { const n = itemParaNota(item); if (n) notas.push(n) }
    const maxNsu = lote.reduce((mx: number, it) => Math.max(mx, Number(pick(it, 'NSU', 'nsu') ?? 0)), nsu)
    const ultimoInformado = Number(pick(data, 'UltimoNSU', 'ultimoNSU', 'MaximoNSU', 'maxNSU') ?? maxNsu)
    if (maxNsu <= nsu) break               // não avançou → fim
    nsu = maxNsu
    if (lote.length < 50 && maxNsu >= ultimoInformado) break
  }
  return { notas, ultimoNsu: nsu }
}

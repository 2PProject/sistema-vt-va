// Consulta de NFS-e RECEBIDAS (serviços tomados) no sistema MUNICIPAL do DF
// (ISSNet — padrão ABRASF 2.04). SERVER-ONLY. Usada para o HISTÓRICO anterior à
// migração nacional (jan–jul/2026), que o ADN nacional não distribui.
//
// Contrato (do manual oficial do DF, schema_v204.xsd):
//   endpoint produção : https://df.issnetonline.com.br/webservicenfse204/nfse.asmx
//   namespace mensagem: http://www.abrasf.org.br/nfse.xsd
//   cabeçalho         : <cabecalho versao="1.00"><versaoDados>2.04</versaoDados>
//   corpo             : ConsultarNfseServicoTomadoEnvio > Pedido(Consulente,
//                       PeriodoEmissao, Tomador, Pagina) + Signature (OBRIGATÓRIA)
//   assinatura        : XML-DSig enveloped, C14N inclusiva, RSA-SHA1, SHA1, X509
//
// Pontos que variam por implementação ISSNet (SOAPAction, namespace da operação,
// mensagens escapadas x embutidas) são AJUSTÁVEIS por variável de ambiente, para
// afinar em produção sem alterar código.
import https from 'https'
import forge from 'node-forge'
import { SignedXml } from 'xml-crypto'

export type NotaIssDfAbrasf = {
  numero: string; codigoVerificacao: string; documento: string; emitenteNome: string
  dataEmissao: string; competencia: string; valor: number
}
export type ResultadoAbrasf = { notas: NotaIssDfAbrasf[]; paginas: number; status: number; mensagens: string[] }

const NS_ABRASF = 'http://www.abrasf.org.br/nfse.xsd'
const endpoint = () => (process.env.SALON_ISSDF_URL || 'https://df.issnetonline.com.br/webservicenfse204/nfse.asmx').replace(/\/$/, '')
const opNs = () => (process.env.SALON_ISSDF_OP_NS || 'http://nfse.abrasf.org.br').replace(/\/$/, '')
const soapAction = () => process.env.SALON_ISSDF_SOAP_ACTION || `${opNs()}/ConsultarNfseServicoTomado`
const escaparMsg = () => process.env.SALON_ISSDF_ESCAPE_MSG === '1'   // padrão: XML embutido
const rejeitarTls = () => process.env.SALON_ISSDF_REJECT_UNAUTHORIZED === '1'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const tag = (xml: string, ...nomes: string[]) => { for (const n of nomes) { const m = xml.match(new RegExp(`<[\\w:]*${n}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/[\\w:]*${n}>`, 'i')); if (m) return m[1].trim() } return '' }
const blocos = (xml: string, nome: string) => [...xml.matchAll(new RegExp(`<[\\w:]*${nome}(?:\\s[^>]*)?>[\\s\\S]*?<\\/[\\w:]*${nome}>`, 'gi'))].map(m => m[0])

/** Extrai chave privada e certificado (PEM) do .pfx (A1). */
function pemDoPfx(pfxBase64: string, senha: string): { privateKeyPem: string; certPem: string } {
  const p12Asn1 = forge.asn1.fromDer(forge.util.decode64(pfxBase64))
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, senha)
  const shrouded = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]
  const plain = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]
  const keyObj = (shrouded && shrouded[0]?.key) || (plain && plain[0]?.key)
  if (!keyObj) throw new Error('Não foi possível ler a chave privada do certificado A1.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const privateKeyPem = forge.pki.privateKeyToPem(keyObj as any)
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || []
  // Escolhe o certificado FOLHA (não-CA), senão o primeiro.
  let certObj = certBags.find(b => { try { const bc = b.cert?.getExtension('basicConstraints') as { cA?: boolean } | undefined; return !bc || !bc.cA } catch { return true } })?.cert || certBags[0]?.cert
  if (!certObj) throw new Error('Não foi possível ler o certificado do arquivo A1.')
  return { privateKeyPem, certPem: forge.pki.certificateToPem(certObj) }
}

/** Monta e ASSINA o ConsultarNfseServicoTomadoEnvio (XML-DSig enveloped, ABRASF). */
function envioAssinado(privateKeyPem: string, certPem: string, cnpj: string, im: string, inicio: string, fim: string, pagina: number): string {
  const ident = `<CpfCnpj><Cnpj>${cnpj}</Cnpj></CpfCnpj><InscricaoMunicipal>${esc(im)}</InscricaoMunicipal>`
  const envio =
    `<ConsultarNfseServicoTomadoEnvio xmlns="${NS_ABRASF}">` +
      `<Pedido>` +
        `<Consulente>${ident}</Consulente>` +
        `<PeriodoEmissao><DataInicial>${inicio}</DataInicial><DataFinal>${fim}</DataFinal></PeriodoEmissao>` +
        `<Tomador>${ident}</Tomador>` +
        `<Pagina>${pagina}</Pagina>` +
      `</Pedido>` +
    `</ConsultarNfseServicoTomadoEnvio>`

  const sig = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certPem,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  })
  const alvo = "//*[local-name(.)='ConsultarNfseServicoTomadoEnvio']"
  sig.addReference({
    xpath: alvo,
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  })
  sig.computeSignature(envio, { location: { reference: alvo, action: 'append' } })
  return sig.getSignedXml()
}

function envelopeSoap(envioAssinadoXml: string): string {
  const cab = `<cabecalho versao="1.00" xmlns="${NS_ABRASF}"><versaoDados>2.04</versaoDados></cabecalho>`
  const cabMsg = escaparMsg() ? esc(cab) : cab
  const dadosMsg = escaparMsg() ? esc(envioAssinadoXml) : envioAssinadoXml
  return `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>` +
    `<ConsultarNfseServicoTomado xmlns="${opNs()}">` +
    `<nfseCabecMsg>${cabMsg}</nfseCabecMsg><nfseDadosMsg>${dadosMsg}</nfseDadosMsg>` +
    `</ConsultarNfseServicoTomado></soap:Body></soap:Envelope>`
}

function post(agent: https.Agent, corpo: string): Promise<{ status: number; corpo: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(endpoint())
    const req = https.request(u, { method: 'POST', agent, timeout: 40000, headers: {
      'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${soapAction()}"`, 'Content-Length': Buffer.byteLength(corpo),
    } }, res => {
      const partes: Buffer[] = []; res.on('data', p => partes.push(Buffer.from(p)))
      res.on('end', () => resolve({ status: res.statusCode || 0, corpo: Buffer.concat(partes).toString('utf8') }))
    })
    req.on('timeout', () => req.destroy(new Error('Tempo limite ao consultar o ISS-DF (ISSNet).')))
    req.on('error', reject); req.end(corpo)
  })
}

function interpretar(soap: string): { notas: NotaIssDfAbrasf[]; mensagens: string[]; proximaPagina: boolean } {
  const saida = unesc(tag(soap, 'ConsultarNfseServicoTomadoResult', 'outputXML') || soap)
  const mensagens = blocos(saida, 'MensagemRetorno').map(x => [tag(x, 'Codigo'), tag(x, 'Mensagem'), tag(x, 'Correcao')].filter(Boolean).join(' - ')).filter(Boolean)
  const proximaPagina = /<[\w:]*ProximaPagina[^>]*>\s*[1-9]/i.test(saida)
  const notas = blocos(saida, 'CompNfse').map(comp => {
    const inf = blocos(comp, 'InfNfse')[0] || comp
    const prest = blocos(inf, 'PrestadorServico')[0] || blocos(inf, 'Prestador')[0] || inf
    const numero = tag(inf, 'Numero')
    const dataEmissao = (tag(inf, 'DataEmissao') || '').slice(0, 10)
    const competencia = (tag(inf, 'Competencia') || dataEmissao).slice(0, 7)
    const valor = Number((tag(inf, 'ValorLiquidoNfse') || tag(inf, 'ValorServicos') || '0').replace(',', '.')) || 0
    const documento = (tag(prest, 'Cnpj') || tag(prest, 'Cpf')).replace(/\D/g, '')
    const emitenteNome = tag(prest, 'RazaoSocial') || tag(prest, 'NomeFantasia')
    const codigoVerificacao = tag(inf, 'CodigoVerificacao')
    return { numero, codigoVerificacao, documento, emitenteNome, dataEmissao, competencia, valor }
  }).filter(n => n.numero)
  return { notas, mensagens, proximaPagina }
}

function periodosMensais(inicio: string, fim: string) {
  const partes: { inicio: string; fim: string }[] = []
  let [ano, mes] = inicio.split('-').map(Number)
  const limite = new Date(`${fim}T12:00:00`)
  while (new Date(ano, mes - 1, 1) <= limite && partes.length < 24) {
    const primeiro = `${ano}-${String(mes).padStart(2, '0')}-01`
    const ult = new Date(ano, mes, 0)
    const ultStr = `${ult.getFullYear()}-${String(ult.getMonth() + 1).padStart(2, '0')}-${String(ult.getDate()).padStart(2, '0')}`
    partes.push({ inicio: primeiro < inicio ? inicio : primeiro, fim: ultStr > fim ? fim : ultStr })
    mes++; if (mes > 12) { mes = 1; ano++ }
  }
  return partes
}

/**
 * Consulta as notas recebidas (tomadas) no ISSNet-DF (ABRASF 2.04, assinado),
 * mês a mês e paginado. Devolve as notas e as mensagens de retorno do serviço.
 */
export async function consultarTomadasAbrasf(params: {
  pfxBase64: string; senha: string; cnpj: string; inscricaoMunicipal: string; inicio: string; fim: string; maxPaginas?: number
}): Promise<ResultadoAbrasf> {
  const { privateKeyPem, certPem } = pemDoPfx(params.pfxBase64, params.senha)
  const agent = new https.Agent({ pfx: Buffer.from(params.pfxBase64, 'base64'), passphrase: params.senha, keepAlive: true, rejectUnauthorized: rejeitarTls() })
  const cnpj = params.cnpj.replace(/\D/g, '')
  const im = params.inscricaoMunicipal.replace(/\D/g, '')
  const todas: NotaIssDfAbrasf[] = []; const mensagens: string[] = []; let status = 0, paginas = 0

  for (const periodo of periodosMensais(params.inicio, params.fim)) {
    for (let pagina = 1; pagina <= (params.maxPaginas || 50); pagina++) {
      const corpo = envelopeSoap(envioAssinado(privateKeyPem, certPem, cnpj, im, periodo.inicio, periodo.fim, pagina))
      const r = await post(agent, corpo)
      status = r.status; paginas++
      if (r.status >= 400) {
        const fault = tag(r.corpo, 'faultstring') || tag(r.corpo, 'Message') || r.corpo.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        throw new Error(`ISS-DF (ISSNet) respondeu HTTP ${r.status}: ${fault.slice(0, 1500)}`)
      }
      const x = interpretar(r.corpo)
      todas.push(...x.notas)
      for (const m of x.mensagens) if (!mensagens.includes(m)) mensagens.push(m)
      if (!x.proximaPagina || x.notas.length === 0) break
    }
  }
  return { notas: todas, paginas, status, mensagens }
}

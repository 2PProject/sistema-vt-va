// Consulta exclusiva de NFS-e RECEBIDAS (serviços tomados) no ISS-DF.
// Integração SOAP compatível com o cabeçalho 1.00 para consultas sem IBSCBS.
// SERVER-ONLY: SOAP + mTLS com o certificado A1 já cadastrado.
import https from 'https'

export type NotaIssDf = {
  chave: string; documento: string; emitenteNome: string; numero: string
  dataEmissao: string; competencia: string; valor: number
}
export type ResultadoIssDf = { notas: NotaIssDf[]; paginas: number; status: number; mensagens: string[] }

const endpoint = () => {
  const configurado = process.env.SALON_ISSDF_URL || 'https://df.issnetonline.com.br/webservicenfse204/nfse.asmx'
  return configurado
    .replace(/^https:\/\/(?:nfse|iss)\.fazenda\.df\.gov\.br\/wsnfsenacional\/nfse\.asmx$/i, 'https://df.issnetonline.com.br/webservicenfse204/nfse.asmx')
    .replace(/\/$/, '')
}
const wsdlNs = () => process.env.SALON_ISSDF_WSDL_NS || 'http://nfse.abrasf.org.br'
const soapAction = () => process.env.SALON_ISSDF_SOAP_ACTION || `${wsdlNs()}/ConsultarNfseServicoTomado`
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const tag = (xml: string, nome: string) => xml.match(new RegExp(`<[\\w:]*${nome}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/[\\w:]*${nome}>`, 'i'))?.[1]?.trim() || ''
const blocos = (xml: string, nome: string) => [...xml.matchAll(new RegExp(`<[\\w:]*${nome}(?:\\s[^>]*)?>[\\s\\S]*?<\\/[\\w:]*${nome}>`, 'gi'))].map(m => m[0])
const doc = (xml: string) => (tag(xml, 'CNPJ') || tag(xml, 'CPF')).replace(/\D/g, '')
const numero = (xml: string) => tag(xml, 'nNFSe') || tag(xml, 'nDFSe') || tag(xml, 'Numero')
const data = (xml: string) => (tag(xml, 'dhEmi') || tag(xml, 'dhProc') || tag(xml, 'DataEmissao')).slice(0, 10)
const valor = (xml: string) => Number((tag(xml, 'vLiq') || tag(xml, 'vServ') || tag(xml, 'ValorServicos') || '0').replace(',', '.')) || 0

type Assinador = (xmlSemAssinatura: string) => string

async function criarAssinador(pfxBase64: string, senha: string): Promise<Assinador> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modulo: any = await import('node-forge')
  const forge: any = modulo.default ?? modulo
  const pfx = Buffer.from(pfxBase64, 'base64')
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(pfx.toString('binary')), false, senha)
  const oids = forge.pki.oids
  const chave = p12.getBags({ bagType: oids.pkcs8ShroudedKeyBag })[oids.pkcs8ShroudedKeyBag]?.[0]?.key
    || p12.getBags({ bagType: oids.keyBag })[oids.keyBag]?.[0]?.key
  const certificados = (p12.getBags({ bagType: oids.certBag })[oids.certBag] || [])
    .map((b: any) => b.cert).filter(Boolean)
  const certificado = certificados.find((c: any) => c.publicKey?.n?.compareTo?.(chave?.n) === 0) || certificados[0]
  if (!chave || !certificado) throw new Error('O certificado A1 não contém chave privada e certificado utilizáveis para assinar a consulta.')
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(certificado)).getBytes()
  const certificadoB64 = Buffer.from(der, 'binary').toString('base64')

  return (xmlSemAssinatura: string) => {
    const mdDigest = forge.md.sha1.create()
    mdDigest.update(xmlSemAssinatura, 'utf8')
    const digestValue = forge.util.encode64(mdDigest.digest().getBytes())
    const signedInfo = `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod><Reference URI=""><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod><DigestValue>${digestValue}</DigestValue></Reference></SignedInfo>`
    const mdAssinatura = forge.md.sha1.create()
    mdAssinatura.update(signedInfo, 'utf8')
    const signatureValue = forge.util.encode64(chave.sign(mdAssinatura))
    const signature = `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">${signedInfo}<SignatureValue>${signatureValue}</SignatureValue><KeyInfo><X509Data><X509Certificate>${certificadoB64}</X509Certificate></X509Data></KeyInfo></Signature>`
    return xmlSemAssinatura.replace('</ConsultarNfseServicoTomadoEnvio>', `${signature}</ConsultarNfseServicoTomadoEnvio>`)
  }
}

function dados(cnpj: string, inscricao: string, inicio: string, fim: string, pagina: number, assinar: Assinador) {
  const ns = 'http://www.abrasf.org.br/nfse.xsd'
  const identificacao = `<CpfCnpj><Cnpj>${cnpj}</Cnpj></CpfCnpj><InscricaoMunicipal>${esc(inscricao)}</InscricaoMunicipal>`
  const pedido = `<Pedido><Consulente>${identificacao}</Consulente><PeriodoEmissao><DataInicial>${inicio}</DataInicial><DataFinal>${fim}</DataFinal></PeriodoEmissao><Tomador>${identificacao}</Tomador><Pagina>${pagina}</Pagina></Pedido>`
  return assinar(`<ConsultarNfseServicoTomadoEnvio xmlns="${ns}">${pedido}</ConsultarNfseServicoTomadoEnvio>`)
}
function envelope(cnpj: string, inscricao: string, inicio: string, fim: string, pagina: number, assinar: Assinador) {
  const cab = '<cabecalho versao="1.00" xmlns="http://www.abrasf.org.br/nfse.xsd"><versaoDados>2.04</versaoDados></cabecalho>'
  const xml = dados(cnpj, inscricao, inicio, fim, pagina, assinar)
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:nfse="${wsdlNs()}"><soap:Body><nfse:ConsultarNfseServicoTomado><nfseCabecMsg>${cab}</nfseCabecMsg><nfseDadosMsg>${xml}</nfseDadosMsg></nfse:ConsultarNfseServicoTomado></soap:Body></soap:Envelope>`
}
function post(agent: https.Agent, corpo: string): Promise<{ status: number; corpo: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(endpoint())
    const req = https.request(u, { method: 'POST', agent, timeout: 30000, headers: {
      'content-type': 'text/xml; charset=utf-8', SOAPAction: `"${soapAction()}"`, 'content-length': Buffer.byteLength(corpo),
    }}, res => {
      const partes: Buffer[] = []; res.on('data', p => partes.push(Buffer.from(p)))
      res.on('end', () => resolve({ status: res.statusCode || 0, corpo: Buffer.concat(partes).toString('utf8') }))
    })
    req.on('timeout', () => req.destroy(new Error('Tempo limite ao consultar o ISS-DF.')))
    req.on('error', reject); req.end(corpo)
  })
}
function interpretar(soap: string): { notas: NotaIssDf[]; mensagens: string[] } {
  const saida = unesc(tag(soap, 'ConsultarNfseServicoTomadoResult') || tag(soap, 'outputXML') || soap)
  const mensagens = blocos(saida, 'MensagemRetorno').map(x => [tag(x, 'Codigo'), tag(x, 'Mensagem'), tag(x, 'Correcao')].filter(Boolean).join(' - '))
  const itens = blocos(saida, 'CompNfse')
  const notas = itens.map(item => {
    const nf = blocos(item, 'NFSe')[0] || item
    const prest = blocos(nf, 'emit')[0] || blocos(nf, 'PrestadorServico')[0] || blocos(nf, 'Prestador')[0] || nf
    const emissao = data(nf)
    const compet = (tag(nf, 'dCompet') || tag(nf, 'Competencia') || emissao).slice(0, 7)
    const chave = (nf.match(/<[\w:]*infNFSe[^>]*\bId="([^"]+)"/i)?.[1] || tag(nf, 'chNFSe') || '').trim()
    return { chave, documento: doc(prest), emitenteNome: tag(prest, 'xNome') || tag(prest, 'RazaoSocial'), numero: numero(nf), dataEmissao: emissao, competencia: compet, valor: valor(nf) }
  }).filter(n => n.numero || n.chave)
  return { notas, mensagens }
}
function periodosMensais(inicio: string, fim: string) {
  const partes: { inicio: string; fim: string }[] = []
  let [ano, mes] = inicio.split('-').map(Number)
  const limite = new Date(`${fim}T12:00:00`)
  while (new Date(ano, mes - 1, 1) <= limite && partes.length < 120) {
    const primeiro = `${ano}-${String(mes).padStart(2, '0')}-01`
    const ultimo = new Date(ano, mes, 0)
    const ultimoStr = `${ultimo.getFullYear()}-${String(ultimo.getMonth() + 1).padStart(2, '0')}-${String(ultimo.getDate()).padStart(2, '0')}`
    partes.push({ inicio: primeiro < inicio ? inicio : primeiro, fim: ultimoStr > fim ? fim : ultimoStr })
    mes++; if (mes > 12) { mes = 1; ano++ }
  }
  return partes
}

export async function consultarRecebidasIssDf(params: { pfxBase64: string; senha: string; cnpj: string; inscricaoMunicipal: string; inicio: string; fim: string; maxPaginas?: number }): Promise<ResultadoIssDf> {
  const agent = new https.Agent({ pfx: Buffer.from(params.pfxBase64, 'base64'), passphrase: params.senha, keepAlive: true, /* ISSNet legado entrega cadeia TLS incompleta; limitar esta exceção a este cliente dedicado. */ rejectUnauthorized: process.env.SALON_ISSDF_REJECT_UNAUTHORIZED === '1' })
  const assinar = await criarAssinador(params.pfxBase64, params.senha)\n  const todas: NotaIssDf[] = []; const mensagens: string[] = []; let status = 0, paginas = 0
  for (const periodo of periodosMensais(params.inicio, params.fim)) {
    for (let pagina = 1; pagina <= (params.maxPaginas || 40); pagina++) {
      const corpo = envelope(params.cnpj.replace(/\D/g, ''), params.inscricaoMunicipal, periodo.inicio, periodo.fim, pagina, assinar)
      const r = await post(agent, corpo)
      status = r.status; paginas++
      if (r.status === 403) throw new Error(`O ISS-DF não autenticou o certificado A1 (HTTP 403). O arquivo foi aberto com a senha cadastrada, mas o servidor recusou a identidade apresentada para o CNPJ final ${params.cnpj.replace(/\\D/g, '').slice(-4)}. Confirme que esse mesmo e-CNPJ consegue entrar em “Logar com certificado digital” no portal ISS-DF. e-CNPJ não exige primeiro acesso. Se funcionar no portal, o bloqueio é do acesso do servidor/Vercel e deve ser liberado pelo suporte.df@notacontrol.com.br.`)
      if (r.status >= 400) {
        const fault = tag(r.corpo, 'faultstring') || tag(r.corpo, 'Message') || r.corpo.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        throw new Error(`ISS-DF respondeu HTTP ${r.status}: ${fault.slice(0, 1200)}`)
      }
      const x = interpretar(r.corpo)
      todas.push(...x.notas)
      mensagens.push(...x.mensagens.filter(m => !/^E212\b/i.test(m)))
      if (x.notas.length < 50 || x.mensagens.some(m => /^E212\b/i.test(m))) break
    }
  }
  const unicas = new Map(todas.map(n => [n.chave || `${n.documento}|${n.numero}|${n.dataEmissao}|${n.valor}`, n]))
  return { notas: [...unicas.values()], paginas, status, mensagens: [...new Set(mensagens)] }
}


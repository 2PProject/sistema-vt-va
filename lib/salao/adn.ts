// Integração com a NFS-e Nacional (ADN gov.br) — SERVER-ONLY.
// mTLS com certificado A1 (.pfx) via https.Agent. A chamada real fica isolada
// em `consultarADN`, o único ponto de acoplamento com o endpoint do gov.br.
import https from 'https'

export type NotaADN = {
  nsu: number
  prestadorDoc: string   // CPF/CNPJ do prestador (só dígitos)
  numero: string
  dataEmissao: string    // 'YYYY-MM-DD'
  valor: number
  competencia?: string   // 'YYYY-MM' se disponível
}

export type ResultadoADN = { notas: NotaADN[]; ultimoNsu: number }

/** Cria um agente HTTPS com o certificado A1 para mTLS. */
export function agenteMTLS(pfxBase64: string, senha: string): https.Agent {
  return new https.Agent({ pfx: Buffer.from(pfxBase64, 'base64'), passphrase: senha, keepAlive: false })
}

/**
 * Consulta as NFS-e emitidas contra o CNPJ desde o último NSU.
 *
 * Ponto de integração com o gov.br. Enquanto SALON_ADN_BASE_URL não estiver
 * configurada, retorna vazio (o botão Sincronizar funciona e reporta "0 novas"
 * sem quebrar). Ao configurar a URL do ADN do município/DF, esta função passa a
 * distribuir os DF-e reais — sem qualquer mudança no restante do módulo.
 */
export async function consultarADN(params: {
  agent: https.Agent
  cnpj: string
  ultimoNsu: number
}): Promise<ResultadoADN> {
  const base = process.env.SALON_ADN_BASE_URL
  if (!base) return { notas: [], ultimoNsu: params.ultimoNsu }

  // Distribuição incremental por NSU (padrão nacional ADN/DF-e). Usa
  // https.request (não fetch) porque o mTLS depende do agent com o .pfx.
  const url = new URL(`${base.replace(/\/$/, '')}/nfse/dfe/${params.cnpj}?nsu=${params.ultimoNsu}`)
  const corpo: string = await new Promise((resolve, reject) => {
    const r = https.request(url, { method: 'GET', agent: params.agent, headers: { Accept: 'application/json' } }, (res) => {
      let buf = ''
      res.on('data', (c) => { buf += c })
      res.on('end', () => {
        if ((res.statusCode ?? 500) >= 400) reject(new Error(`ADN HTTP ${res.statusCode}`))
        else resolve(buf)
      })
    })
    r.on('error', reject); r.end()
  })
  const data = JSON.parse(corpo || 'null')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lista: any[] = Array.isArray(data?.documentos) ? data.documentos : Array.isArray(data) ? data : []
  const notas: NotaADN[] = lista.map((d) => ({
    nsu: Number(d.nsu ?? 0),
    prestadorDoc: String(d.prestador?.documento ?? d.cpfCnpjPrestador ?? '').replace(/\D/g, ''),
    numero: String(d.numero ?? d.numeroNfse ?? ''),
    dataEmissao: String(d.dataEmissao ?? d.data ?? '').slice(0, 10),
    valor: Number(d.valor ?? d.valorServico ?? 0),
    competencia: d.competencia ? String(d.competencia).slice(0, 7) : undefined,
  })).filter((n) => n.prestadorDoc && n.numero)
  const ultimoNsu = notas.reduce((mx, n) => Math.max(mx, n.nsu), params.ultimoNsu)
  return { notas, ultimoNsu }
}

// Teste de conexão individual com o ADN gov.br — SERVER-ONLY, runtime Node.
// Faz UMA chamada mTLS real (GET /contribuintes/DFe/{ultimoNsu}) para a empresa
// escolhida e devolve um diagnóstico claro, sem gravar nada. Serve para o admin
// validar, na hora, se o certificado + senha estão corretos e o ambiente responde.
import { getAdminClient, decrypt } from '../../../../lib/salao/server'
import { agenteMTLS, chamarDFe, baseADN, semDocumentos } from '../../../../lib/salao/adn'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const empresaId = body?.empresa_id
  if (!empresaId) return Response.json({ erro: 'Empresa não informada.' }, { status: 400 })

  let admin
  try { admin = getAdminClient() }
  catch (e) { return Response.json({ erro: e instanceof Error ? e.message : 'Config ausente.' }, { status: 503 }) }

  const { data: cert } = await admin.from('salon_certificados')
    .select('cert_cnpj, cert_pfx_b64, cert_senha_enc, cert_validade')
    .eq('empresa_id', empresaId).maybeSingle()
  if (!cert) return Response.json({ erro: 'Esta empresa ainda não tem certificado cadastrado.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = cert as any
  if (c.cert_validade && new Date(c.cert_validade) < new Date()) {
    return Response.json({ ok: false, mensagem: `Certificado VENCIDO em ${c.cert_validade}. Envie um certificado válido.` })
  }

  const { data: syncRow } = await admin.from('salon_nfse_sync').select('ultimo_nsu').eq('empresa_id', empresaId).maybeSingle()
  const nsu = syncRow?.ultimo_nsu ?? 0

  let senha: string
  try { senha = decrypt(c.cert_senha_enc) }
  catch { return Response.json({ ok: false, mensagem: 'Falha ao ler a senha do certificado (SALON_ENC_KEY mudou?). Reenvie o .pfx.' }) }

  try {
    const agent = agenteMTLS(c.cert_pfx_b64, senha)
    const { status, corpo } = await chamarDFe(agent, c.cert_cnpj ?? '', nsu)
    const amostra = (corpo || '').slice(0, 300)
    if (status === 200) {
      let qtd = 0
      try { const d = JSON.parse(corpo || 'null'); const lote = d?.LoteDFe ?? d?.loteDFe ?? d?.documentos ?? []; qtd = Array.isArray(lote) ? lote.length : 0 } catch { /* */ }
      return Response.json({ ok: true, status, mensagem: `Conectado ao gov.br! Certificado aceito. ${qtd} documento(s) a partir do NSU ${nsu}.`, ambiente: baseADN(), amostra })
    }
    if (semDocumentos(status, corpo)) return Response.json({ ok: true, status, mensagem: `Conectado! Certificado aceito. Sem documentos novos (NSU ${nsu} em dia).`, ambiente: baseADN() })
    if (status === 403) return Response.json({ ok: false, status, mensagem: 'Conexão TLS OK, mas acesso negado (403). Verifique o credenciamento da empresa no ambiente e se o CNPJ do certificado tem a mesma raiz.', ambiente: baseADN(), amostra })
    return Response.json({ ok: false, status, mensagem: `Conectou, mas o ADN respondeu HTTP ${status}.`, ambiente: baseADN(), amostra })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Erros típicos de mTLS: senha errada / certificado inválido / host indisponível
    const amigavel =
      /mac verify|wrong (final block|tag)|bad decrypt|PKCS12|passphrase|unable to load/i.test(msg) ? 'Certificado ou senha inválidos — verifique o .pfx e a senha.'
      : /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|timeout|ETIMEDOUT/i.test(msg) ? `Não foi possível alcançar o ADN (${baseADN()}). Verifique a rede/ambiente.`
      : /alert|handshake|SSL|TLS|certificate/i.test(msg) ? 'Falha no handshake TLS — o gov.br não aceitou este certificado (verifique validade/tipo e-CNPJ e o ambiente).'
      : `Falha: ${msg}`
    return Response.json({ ok: false, mensagem: amigavel, ambiente: baseADN() })
  }
}

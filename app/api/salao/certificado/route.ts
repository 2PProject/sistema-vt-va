// Gestão de certificados A1 (.pfx) — SERVER-ONLY. Valida, armazena de forma
// segura (base64 + senha criptografada) e devolve apenas metadados ao frontend.
import { getAdminClient, encrypt } from '../../../../lib/salao/server'
import tls from 'tls'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function soDig(s: string) { return (s ?? '').replace(/\D/g, '') }

type Aberto =
  | { ok: true; nome: string; cnpj: string; validade: string; vencido: boolean; pfxSalvar: Buffer; convertido: boolean; aviso?: string }
  | { ok: false; motivo: 'SENHA' | 'ALGORITMO' | 'ARQUIVO' | 'DESCONHECIDO'; detalhe?: string }

function testaOpenSSL(pfx: Buffer, senha: string): boolean {
  try { tls.createSecureContext({ pfx, passphrase: senha }); return true } catch { return false }
}

/**
 * Abre e valida o certificado A1. Estratégia:
 *  1) Lê o .pfx com node-forge (suporta algoritmos legados de Soluti/Serpro).
 *  2) REEXPORTA para PKCS#12 moderno (AES-256) — o OpenSSL do servidor (mTLS)
 *     aceita esse formato, resolvendo o "não autentica" dos certificados legados.
 *  3) Valida a versão a ser salva pelo OpenSSL. Detalhes (titular/CNPJ/validade)
 *     vêm do forge. Erros são classificados com precisão.
 */
async function abrirCertificado(pfx: Buffer, senha: string): Promise<Aberto> {
  let nome = '', cnpj = '', validade = '', pfxSalvar = pfx, convertido = false
  let forgeLeu = false

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const forge: any = (await import('node-forge')).default ?? (await import('node-forge'))
    const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(pfx.toString('binary')), false, senha)
    forgeLeu = true

    const oids = forge.pki.oids
    const cert = p12.getBags({ bagType: oids.certBag })[oids.certBag]?.[0]?.cert
    if (cert) {
      const cn: string = cert.subject.getField('CN')?.value ?? ''
      const [nomeRaw, docRaw] = cn.split(':')
      nome = (nomeRaw || cn).trim(); cnpj = soDig(docRaw || '')
      validade = cert.validity.notAfter.toISOString().slice(0, 10)
    }

    // Reexporta em formato moderno (AES-256) para compatibilidade com OpenSSL 3
    const key = (p12.getBags({ bagType: oids.pkcs8ShroudedKeyBag })[oids.pkcs8ShroudedKeyBag]?.[0]?.key)
      || (p12.getBags({ bagType: oids.keyBag })[oids.keyBag]?.[0]?.key)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const certs = (p12.getBags({ bagType: oids.certBag })[oids.certBag] ?? []).map((b: any) => b.cert).filter(Boolean)
    if (key && certs.length) {
      try {
        const novoAsn1 = forge.pkcs12.toPkcs12Asn1(key, certs, senha, { algorithm: 'aes256' })
        const novoBuf = Buffer.from(forge.asn1.toDer(novoAsn1).getBytes(), 'binary')
        if (testaOpenSSL(novoBuf, senha)) { pfxSalvar = novoBuf; convertido = true }
      } catch { /* mantém original se a conversão falhar */ }
    }
  } catch (e) {
    // forge falhou: senha errada ou arquivo inválido
    const m = String((e as Error)?.message ?? e).toLowerCase()
    if (/mac|password|invalid|decrypt/.test(m)) return { ok: false, motivo: 'SENHA' }
    if (/asn1|der|pkcs12|expecting|tag|not enough|too long|decode/.test(m)) return { ok: false, motivo: 'ARQUIVO', detalhe: m.slice(0, 140) }
    return { ok: false, motivo: 'DESCONHECIDO', detalhe: m.slice(0, 160) }
  }

  // Garante que o que vamos salvar carrega no OpenSSL (o mTLS usa o mesmo)
  if (!testaOpenSSL(pfxSalvar, senha)) {
    if (!forgeLeu) return { ok: false, motivo: 'SENHA' }
    return { ok: false, motivo: 'ALGORITMO', detalhe: 'o .pfx não pôde ser carregado pelo OpenSSL nem após conversão' }
  }

  const vencido = !!validade && new Date(validade) < new Date()
  return {
    ok: true, nome, cnpj, validade, vencido, pfxSalvar, convertido,
    aviso: nome ? undefined : 'Certificado e senha válidos, mas não foi possível ler os detalhes (titular/validade).',
  }
}

function respostaErro(a: Extract<Aberto, { ok: false }>): Response {
  const map: Record<string, { msg: string; status: number }> = {
    SENHA: { msg: 'Senha do certificado incorreta.', status: 422 },
    ALGORITMO: { msg: 'O certificado usa um algoritmo não suportado pelo servidor. Exporte novamente o .pfx (formato compatível) ou contate o suporte.', status: 422 },
    ARQUIVO: { msg: 'Arquivo inválido — não parece um certificado .pfx/.p12.', status: 400 },
    DESCONHECIDO: { msg: `Não foi possível abrir o certificado.${a.detalhe ? ' Detalhe: ' + a.detalhe : ''}`, status: 422 },
  }
  const r = map[a.motivo]
  return Response.json({ erro: r.msg }, { status: r.status })
}

export async function POST(req: Request) {
  let empresaId = '', senha = ''; let pfx: Buffer | null = null
  try {
    const form = await req.formData()
    empresaId = String(form.get('empresa_id') ?? '')
    senha = String(form.get('senha') ?? '')
    const f = form.get('arquivo')
    if (f instanceof File) pfx = Buffer.from(await f.arrayBuffer())
  } catch {
    return Response.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }
  if (!empresaId) return Response.json({ erro: 'Empresa não informada.' }, { status: 400 })
  if (!pfx || pfx.length === 0) return Response.json({ erro: 'Envie o arquivo .pfx.' }, { status: 400 })
  if (!senha) return Response.json({ erro: 'Informe a senha do certificado.' }, { status: 400 })

  const info = await abrirCertificado(pfx, senha)
  if (!info.ok) return respostaErro(info)

  try {
    const admin = getAdminClient()
    const { error } = await admin.from('salon_certificados').upsert({
      empresa_id: empresaId,
      cert_nome: info.nome || null, cert_cnpj: info.cnpj || null, cert_validade: info.validade || null,
      cert_pfx_b64: info.pfxSalvar.toString('base64'), cert_senha_enc: encrypt(senha),
      atualizado_em: new Date().toISOString(),
    })
    if (error) return Response.json({ erro: error.message }, { status: 500 })
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao salvar.' }, { status: 500 })
  }
  // Nunca devolve pfx nem senha
  return Response.json({ ok: true, cert_nome: info.nome, cert_cnpj: info.cnpj, cert_validade: info.validade, vencido: info.vencido, convertido: info.convertido, aviso: info.aviso })
}

/** Metadados dos certificados por empresa (sem segredos). */
export async function GET() {
  try {
    const admin = getAdminClient()
    const [{ data: empresas }, { data: certs }, { data: configs }] = await Promise.all([
      admin.from('empresas').select('id, razao_social, apelido').order('razao_social'),
      admin.from('salon_certificados').select('empresa_id, cert_nome, cert_cnpj, cert_validade'),
      admin.from('salon_empresa_config').select('empresa_id, prazo_dia'),
    ])
    const certMap = new Map((certs ?? []).map((c: { empresa_id: string }) => [c.empresa_id, c]))
    const prazoMap = new Map((configs ?? []).map((c: { empresa_id: string; prazo_dia: number }) => [c.empresa_id, c.prazo_dia]))
    const lista = (empresas ?? []).map((e: { id: string; razao_social: string; apelido: string | null }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c: any = certMap.get(e.id)
      return {
        empresa_id: e.id, empresaNome: e.apelido || e.razao_social,
        prazo_dia: prazoMap.get(e.id) ?? 10,
        cert_nome: c?.cert_nome ?? null, cert_cnpj: c?.cert_cnpj ?? null, cert_validade: c?.cert_validade ?? null,
        temCertificado: !!c,
      }
    })
    return Response.json({ certificados: lista })
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao carregar.' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const empresaId = new URL(req.url).searchParams.get('empresa_id')
  if (!empresaId) return Response.json({ erro: 'Empresa não informada.' }, { status: 400 })
  try {
    const admin = getAdminClient()
    await admin.from('salon_certificados').delete().eq('empresa_id', empresaId)
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao remover.' }, { status: 500 })
  }
}

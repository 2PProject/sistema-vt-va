// Gestão de certificados A1 (.pfx) — SERVER-ONLY. Valida, armazena de forma
// segura (base64 + senha criptografada) e devolve apenas metadados ao frontend.
import { getAdminClient, encrypt } from '../../../../lib/salao/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function soDig(s: string) { return (s ?? '').replace(/\D/g, '') }

/** Valida o .pfx com a senha e extrai titular, CNPJ e validade. */
async function validarPfx(pfxBase64: string, senha: string):
  Promise<{ nome: string; cnpj: string; validade: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const forge: any = (await import('node-forge')).default ?? (await import('node-forge'))
  const der = forge.util.decode64(pfxBase64)
  const asn1 = forge.asn1.fromDer(der)
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, senha) // lança se a senha estiver errada
  const bags = p12.getBags({ bagType: forge.pki.oids.certBag })
  const cert = bags[forge.pki.oids.certBag]?.[0]?.cert
  if (!cert) throw new Error('Certificado não encontrado no arquivo.')
  const cn: string = cert.subject.getField('CN')?.value ?? ''
  const [nomeRaw, docRaw] = cn.split(':')
  const validade: Date = cert.validity.notAfter
  return {
    nome: (nomeRaw || cn).trim(),
    cnpj: soDig(docRaw || ''),
    validade: validade.toISOString().slice(0, 10),
  }
}

export async function POST(req: Request) {
  let empresaId = '', senha = '', pfxBase64 = ''
  try {
    const form = await req.formData()
    empresaId = String(form.get('empresa_id') ?? '')
    senha = String(form.get('senha') ?? '')
    const f = form.get('arquivo')
    if (f instanceof File) pfxBase64 = Buffer.from(await f.arrayBuffer()).toString('base64')
  } catch {
    return Response.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }
  if (!empresaId) return Response.json({ erro: 'Empresa não informada.' }, { status: 400 })
  if (!pfxBase64) return Response.json({ erro: 'Envie o arquivo .pfx.' }, { status: 400 })
  if (!senha) return Response.json({ erro: 'Informe a senha do certificado.' }, { status: 400 })

  let info: { nome: string; cnpj: string; validade: string }
  try {
    info = await validarPfx(pfxBase64, senha)
  } catch {
    return Response.json({ erro: 'Não foi possível abrir o certificado — verifique a senha e o arquivo .pfx.' }, { status: 422 })
  }

  try {
    const admin = getAdminClient()
    const { error } = await admin.from('salon_certificados').upsert({
      empresa_id: empresaId,
      cert_nome: info.nome, cert_cnpj: info.cnpj, cert_validade: info.validade,
      cert_pfx_b64: pfxBase64, cert_senha_enc: encrypt(senha),
      atualizado_em: new Date().toISOString(),
    })
    if (error) return Response.json({ erro: error.message }, { status: 500 })
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao salvar.' }, { status: 500 })
  }
  // Nunca devolve pfx nem senha
  return Response.json({ ok: true, cert_nome: info.nome, cert_cnpj: info.cnpj, cert_validade: info.validade })
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

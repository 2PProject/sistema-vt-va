// Sincroniza NFS-e RECEBIDAS (serviços tomados) do DF via ADN nacional.
// Observação de projeto: o ADN só distribui o que foi emitido no PADRÃO NACIONAL
// (pós-migração do DF). Notas anteriores à migração ficam no sistema municipal do
// DF e NÃO chegam por aqui — para essas é preciso o webservice municipal do DF.
import { getAdminClient, decrypt } from '../../../../lib/salao/server'
import { sincronizarRecebidasIssDf, MUNICIPIO_DF } from '../../../../lib/salao/issdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const empresaId = String(body.empresa_id || '')
  const inicio = String(body.inicio || '')
  const fim = String(body.fim || '')
  if (!empresaId) return Response.json({ erro: 'Selecione uma unidade.' }, { status: 400 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim) || inicio > fim)
    return Response.json({ erro: 'Informe um período válido.' }, { status: 400 })

  try {
    const admin = getAdminClient()
    const [{ data: cert }, { data: empresa }] = await Promise.all([
      admin.from('salon_certificados').select('cert_cnpj, cert_pfx_b64, cert_senha_enc, cert_validade').eq('empresa_id', empresaId).maybeSingle(),
      admin.from('empresas').select('razao_social, apelido').eq('id', empresaId).maybeSingle(),
    ])
    if (!empresa) return Response.json({ erro: 'Unidade não encontrada.' }, { status: 404 })
    if (!cert) return Response.json({ erro: 'A unidade não possui certificado A1 cadastrado.' }, { status: 400 })
    if (cert.cert_validade && cert.cert_validade < new Date().toISOString().slice(0, 10))
      return Response.json({ erro: `Certificado vencido em ${cert.cert_validade}.` }, { status: 400 })
    const cnpj = String(cert.cert_cnpj || '').replace(/\D/g, '')
    if (cnpj.length !== 14) return Response.json({ erro: 'O certificado não possui um CNPJ válido.' }, { status: 400 })

    const r = await sincronizarRecebidasIssDf(admin, {
      empresaId, pfxBase64: cert.cert_pfx_b64, senha: decrypt(cert.cert_senha_enc), cnpj, inicio, fim,
    })
    return Response.json({
      ok: true, empresa: empresa.apelido || empresa.razao_social || '',
      encontradas: r.encontradas, gravadas: r.gravadas, existentes: r.existentes,
      noPeriodoDf: r.noPeriodoDf, paginas: r.paginas, status: r.status,
      houveMais: r.houveMais, mensagens: r.mensagens,
    })
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    const amigavel = /certificate|SSL|TLS|handshake/i.test(m)
      ? 'O ambiente nacional não aceitou o certificado A1 desta unidade (validade/tipo e-CNPJ/primeiro acesso).' : m
    return Response.json({ erro: amigavel }, { status: 502 })
  }
}

export async function GET(req: Request) {
  const u = new URL(req.url)
  const empresaId = u.searchParams.get('empresa_id'); const inicio = u.searchParams.get('inicio'); const fim = u.searchParams.get('fim')
  if (!empresaId || !inicio || !fim) return Response.json({ notas: [] })
  try {
    const admin = getAdminClient()
    // Notas do DF (município 5300108) recebidas no período — já distribuídas pelo ADN.
    const { data, error } = await admin.from('salon_notas')
      .select('id, emitente_nome, documento, numero, data_emissao, competencia, valor, chave, observacao, criado_em')
      .eq('empresa_id', empresaId).gte('data_emissao', inicio).lte('data_emissao', fim)
      .like('chave', `${MUNICIPIO_DF}%`)
      .order('data_emissao', { ascending: false }).limit(5000)
    if (error) throw error
    return Response.json({ notas: data || [] })
  } catch (e) { return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao listar.' }, { status: 500 }) }
}

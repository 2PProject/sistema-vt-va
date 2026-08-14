// Sincroniza exclusivamente NFS-e RECEBIDAS (serviços tomados) do ISS-DF.
import { getAdminClient, decrypt } from '../../../../lib/salao/server'
import { consultarRecebidasIssDf } from '../../../../lib/salao/issdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const empresaId = String(body.empresa_id || '')
  const inicio = String(body.inicio || '')
  const fim = String(body.fim || '')
  const inscricaoMunicipal = String(body.inscricao_municipal || '').replace(/\D/g, '')
  if (!empresaId) return Response.json({ erro: 'Selecione uma unidade.' }, { status: 400 })
  if (!inscricaoMunicipal) return Response.json({ erro: 'Informe a inscrição municipal da unidade no ISS-DF.' }, { status: 400 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim) || inicio > fim)
    return Response.json({ erro: 'Informe um período válido.' }, { status: 400 })

  try {
    const admin = getAdminClient()
    const [{ data: cert }, { data: empresa }] = await Promise.all([
      admin.from('salon_certificados').select('cert_cnpj, cert_pfx_b64, cert_senha_enc, cert_validade').eq('empresa_id', empresaId).maybeSingle(),
      admin.from('empresas').select('razao_social, apelido').eq('id', empresaId).maybeSingle(),
    ])
    if (!cert) return Response.json({ erro: 'A unidade não possui certificado A1 cadastrado.' }, { status: 400 })
    if (cert.cert_validade && cert.cert_validade < new Date().toISOString().slice(0, 10))
      return Response.json({ erro: `Certificado vencido em ${cert.cert_validade}.` }, { status: 400 })
    const cnpj = String(cert.cert_cnpj || '').replace(/\D/g, '')
    if (cnpj.length !== 14) return Response.json({ erro: 'O certificado não possui um CNPJ válido.' }, { status: 400 })

    const resultado = await consultarRecebidasIssDf({
      pfxBase64: cert.cert_pfx_b64, senha: decrypt(cert.cert_senha_enc), cnpj, inscricaoMunicipal, inicio, fim,
    })
    const { data: atuais } = await admin.from('salon_notas')
      .select('chave, documento, numero, data_emissao, valor')
      .eq('empresa_id', empresaId).gte('data_emissao', inicio).lte('data_emissao', fim)
    const chaveDe = (n: { chave?: string | null; documento?: string | null; numero?: string | null; data_emissao?: string | null; dataEmissao?: string; valor?: number | null }) =>
      n.chave || `${n.documento || ''}|${n.numero || ''}|${n.data_emissao || n.dataEmissao || ''}|${Number(n.valor || 0).toFixed(2)}`
    const existentes = new Set((atuais || []).map(chaveDe))
    const novas = resultado.notas.filter(n => Number(n.valor) > 0 && !existentes.has(chaveDe(n)))
    let gravadas = 0
    for (let i = 0; i < novas.length; i += 500) {
      const payload = novas.slice(i, i + 500).map(n => ({
        empresa_id: empresaId, nsu: null, chave: n.chave || null, documento: n.documento || null,
        emitente_nome: n.emitenteNome || null, numero: n.numero || null, valor: n.valor,
        data_emissao: n.dataEmissao || null, competencia: n.competencia || null,
        observacao: 'Origem: ISS-DF', classificacao: 'profissional',
      }))
      const { error } = await admin.from('salon_notas').insert(payload)
      if (error) throw new Error(`Erro ao gravar notas: ${error.message}`)
      gravadas += payload.length
    }
    return Response.json({
      ok: true, empresa: empresa?.apelido || empresa?.razao_social || '',
      encontradas: resultado.notas.length, gravadas, existentes: resultado.notas.length - gravadas,
      paginas: resultado.paginas, status: resultado.status, mensagens: resultado.mensagens,
    })
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    const amigavel = /certificate|SSL|TLS|handshake/i.test(m) ? 'O ISS-DF não aceitou o certificado desta unidade.' : m
    return Response.json({ erro: amigavel }, { status: 502 })
  }
}

export async function GET(req: Request) {
  const u = new URL(req.url); const empresaId = u.searchParams.get('empresa_id'); const inicio = u.searchParams.get('inicio'); const fim = u.searchParams.get('fim')
  if (!empresaId || !inicio || !fim) return Response.json({ notas: [] })
  try {
    const admin = getAdminClient()
    const { data, error } = await admin.from('salon_notas').select('id, emitente_nome, documento, numero, data_emissao, competencia, valor, observacao, criado_em')
      .eq('empresa_id', empresaId).eq('observacao', 'Origem: ISS-DF').gte('data_emissao', inicio).lte('data_emissao', fim)
      .order('data_emissao', { ascending: false }).limit(5000)
    if (error) throw error
    return Response.json({ notas: data || [] })
  } catch (e) { return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao listar.' }, { status: 500 }) }
}

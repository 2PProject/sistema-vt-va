// Consulta o HISTÓRICO de NFS-e recebidas (tomadas) no sistema MUNICIPAL do DF
// (ISSNet, ABRASF 2.04 assinado) — para o período anterior à migração nacional.
import { getAdminClient, decrypt } from '../../../../lib/salao/server'
import { consultarTomadasAbrasf } from '../../../../lib/salao/issdf-abrasf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MARCADOR = 'ISS-DF (ABRASF 2.04)'
const chaveNatural = (n: { documento?: string | null; numero?: string | null; data_emissao?: string | null; dataEmissao?: string; valor?: number | null }) =>
  `${(n.documento || '').replace(/\D/g, '')}|${n.numero || ''}|${(n.data_emissao || n.dataEmissao || '').slice(0, 10)}|${Number(n.valor || 0).toFixed(2)}`

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
      admin.from('empresas').select('razao_social, apelido, inscricao_municipal').eq('id', empresaId).maybeSingle(),
    ])
    if (!empresa) return Response.json({ erro: 'Unidade não encontrada.' }, { status: 404 })
    const im = String(empresa.inscricao_municipal || '').replace(/\D/g, '')
    if (!im) return Response.json({ erro: 'Cadastre a inscrição municipal desta unidade em Cadastros → Empresas (obrigatória no ISSNet-DF).' }, { status: 400 })
    if (!cert) return Response.json({ erro: 'A unidade não possui certificado A1 cadastrado.' }, { status: 400 })
    if (cert.cert_validade && cert.cert_validade < new Date().toISOString().slice(0, 10))
      return Response.json({ erro: `Certificado vencido em ${cert.cert_validade}.` }, { status: 400 })
    const cnpj = String(cert.cert_cnpj || '').replace(/\D/g, '')
    if (cnpj.length !== 14) return Response.json({ erro: 'O certificado não possui um CNPJ válido.' }, { status: 400 })

    const r = await consultarTomadasAbrasf({
      pfxBase64: cert.cert_pfx_b64, senha: decrypt(cert.cert_senha_enc), cnpj, inscricaoMunicipal: im, inicio, fim,
    })

    // Grava novas (dedup por chave natural dentro do período).
    const { data: atuais } = await admin.from('salon_notas')
      .select('documento, numero, data_emissao, valor').eq('empresa_id', empresaId).gte('data_emissao', inicio).lte('data_emissao', fim)
    const existentes = new Set((atuais || []).map(chaveNatural))
    const novas = r.notas.filter(n => Number(n.valor) > 0 && !existentes.has(chaveNatural({ documento: n.documento, numero: n.numero, dataEmissao: n.dataEmissao, valor: n.valor })))
    let gravadas = 0
    for (let i = 0; i < novas.length; i += 500) {
      const payload = novas.slice(i, i + 500).map(n => ({
        empresa_id: empresaId, nsu: null, chave: n.codigoVerificacao || null,
        documento: n.documento || null, emitente_nome: n.emitenteNome || null, numero: n.numero || null,
        valor: n.valor, data_emissao: n.dataEmissao || null, competencia: n.competencia || null,
        observacao: MARCADOR,
      }))
      const { error } = await admin.from('salon_notas').insert(payload)
      if (error) throw new Error(`Erro ao gravar notas: ${error.message}`)
      gravadas += payload.length
    }

    return Response.json({
      ok: true, empresa: empresa.apelido || empresa.razao_social || '',
      encontradas: r.notas.length, gravadas, existentes: r.notas.length - gravadas,
      paginas: r.paginas, status: r.status, mensagens: r.mensagens,
    })
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    const amigavel = /certificate|SSL|TLS|handshake|mac verify|bad decrypt|PKCS12|passphrase/i.test(m)
      ? 'Falha no certificado A1 (mTLS/assinatura) ou senha — reenvie o .pfx com a senha correta.' : m
    return Response.json({ erro: amigavel }, { status: 502 })
  }
}

export async function GET(req: Request) {
  const u = new URL(req.url)
  const empresaId = u.searchParams.get('empresa_id'); const inicio = u.searchParams.get('inicio'); const fim = u.searchParams.get('fim')
  if (!empresaId || !inicio || !fim) return Response.json({ notas: [] })
  try {
    const admin = getAdminClient()
    const { data, error } = await admin.from('salon_notas')
      .select('id, emitente_nome, documento, numero, data_emissao, competencia, valor, chave, observacao, criado_em')
      .eq('empresa_id', empresaId).eq('observacao', MARCADOR).gte('data_emissao', inicio).lte('data_emissao', fim)
      .order('data_emissao', { ascending: false }).limit(5000)
    if (error) throw error
    return Response.json({ notas: data || [] })
  } catch (e) { return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao listar.' }, { status: 500 }) }
}

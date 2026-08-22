// Reprocessamento de CANCELAMENTOS do ADN (gov.br) — SERVER-ONLY, runtime Node.
// O cancelamento no padrão nacional chega como um EVENTO separado (tpEvento
// 1011xx) que referencia a chave da nota; ele não fica gravado dentro do XML da
// nota original, então cancelamentos antigos não são detectáveis pela página.
// Esta rota re-varre a distribuição a partir de um NSU (cursor próprio, NÃO
// mexe no cursor da sincronização normal), coleta as chaves canceladas na
// janela e, para cada nota gravada correspondente: desvincula (revertendo o
// profissional para pendente) e marca como excluída. Chamada em LOOP pela UI.
import { getAdminClient, decrypt } from '../../../../lib/salao/server'
import { agenteMTLS, consultarADN, baseADN } from '../../../../lib/salao/adn'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const empresaId: string | undefined = body?.empresa_id
  const nsu = Math.max(0, Number(body?.nsu ?? 0) || 0)
  if (!empresaId) return Response.json({ ok: false, erro: 'empresa_id é obrigatório.' }, { status: 400 })

  let admin
  try { admin = getAdminClient() } catch (e) {
    return Response.json({ ok: false, erro: e instanceof Error ? e.message : 'Configuração ausente.' }, { status: 503 })
  }

  const { data: cert, error: certErr } = await admin.from('salon_certificados')
    .select('empresa_id, cert_cnpj, cert_pfx_b64, cert_senha_enc, cert_validade').eq('empresa_id', empresaId).maybeSingle()
  if (certErr) return Response.json({ ok: false, erro: `Erro ao ler certificado: ${certErr.message}` }, { status: 500 })
  if (!cert) return Response.json({ ok: false, erro: 'Esta unidade não tem certificado cadastrado.' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = cert as any
  if (c.cert_validade && new Date(c.cert_validade) < new Date()) {
    return Response.json({ ok: false, erro: `Certificado VENCIDO em ${c.cert_validade}.` }, { status: 400 })
  }
  let senha: string
  try { senha = decrypt(c.cert_senha_enc) }
  catch { return Response.json({ ok: false, erro: 'Não foi possível ler a senha do certificado (reenvie o .pfx).' }, { status: 400 }) }

  try {
    const agent = agenteMTLS(c.cert_pfx_b64, senha)
    const { cancelamentos, ultimoNsu, houveMais, rateLimited, status } =
      await consultarADN({ agent, cnpj: c.cert_cnpj ?? '', ultimoNsu: nsu })

    const chaves = Array.from(new Set((cancelamentos ?? []).map((k) => k.replace(/\s/g, '')).filter(Boolean)))
    let marcadas = 0, desvinculadas = 0

    if (chaves.length) {
      const { data: alvo } = await admin.from('salon_notas')
        .select('id').eq('empresa_id', empresaId).in('chave', chaves).eq('excluida', false)
      const ids = (alvo ?? []).map((a: { id: string }) => a.id)
      if (ids.length) {
        // Desvincula (M:N) — o trigger reverte a comissão para pendente.
        const { data: rel } = await admin.from('salon_comissao_notas').select('nota_id').in('nota_id', ids)
        const vinc = Array.from(new Set((rel ?? []).map((r: { nota_id: string }) => r.nota_id)))
        if (vinc.length) { await admin.from('salon_comissao_notas').delete().in('nota_id', vinc); desvinculadas = vinc.length }
        // Limpa também o ponteiro legado em salon_comissoes.
        await admin.from('salon_comissoes').update({
          nota_id: null, status: 'pendente', nf_numero: null, nf_data: null, nf_valor: null, nf_origem: null, confirmado_em: null,
        }).in('nota_id', ids)
        // Marca as notas como excluídas (canceladas na origem).
        const { count } = await admin.from('salon_notas').update({
          excluida: true, excluida_motivo: 'Cancelada na origem (evento ADN, reprocessado)', excluida_em: new Date().toISOString(),
        }, { count: 'exact' }).in('id', ids).eq('excluida', false)
        marcadas = count ?? ids.length
      }
    }

    return Response.json({
      ok: !(rateLimited && chaves.length === 0),
      ambiente: baseADN(), status,
      proximoNsu: ultimoNsu,
      houveMais: houveMais || rateLimited,
      rateLimited,
      cancelamentosVistos: chaves.length,
      marcadas, desvinculadas,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const amigavel =
      /mac verify|wrong (final block|tag)|bad decrypt|PKCS12|passphrase|unable to load/i.test(msg) ? 'Certificado ou senha inválidos — reenvie o .pfx.'
      : /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|timeout|ETIMEDOUT/i.test(msg) ? `Não foi possível alcançar o ADN (${baseADN()}).`
      : msg
    return Response.json({ ok: false, erro: amigavel }, { status: 500 })
  }
}

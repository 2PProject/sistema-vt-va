import Anthropic from '@anthropic-ai/sdk'

// Roda no Node (usa a chave da IA no servidor — nunca no navegador).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 25 * 1024 * 1024 // 25 MB — bem abaixo do limite de 32 MB da API

// Schema de extração: a IA devolve exatamente esta forma.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    funcionarios: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          nome: { type: 'string', description: 'Nome completo do profissional, como aparece na folha.' },
          valorLiquido: { type: 'number', description: 'Valor LÍQUIDO a receber (líquido a pagar), em reais. Apenas o número.' },
          unidade: { type: 'string', description: 'Empresa/unidade/filial do profissional se aparecer na folha; senão string vazia.' },
        },
        required: ['nome', 'valorLiquido', 'unidade'],
      },
    },
  },
  required: ['funcionarios'],
} as const

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return Response.json(
      { erro: 'Leitura por IA indisponível: defina a variável de ambiente ANTHROPIC_API_KEY no servidor.' },
      { status: 503 },
    )
  }

  let arquivo: File | null = null
  try {
    const form = await req.formData()
    const f = form.get('arquivo')
    if (f instanceof File) arquivo = f
  } catch {
    return Response.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  if (!arquivo) return Response.json({ erro: 'Nenhum arquivo enviado.' }, { status: 400 })
  if (arquivo.type && arquivo.type !== 'application/pdf') {
    return Response.json({ erro: 'Envie um arquivo PDF.' }, { status: 400 })
  }
  const buffer = Buffer.from(await arquivo.arrayBuffer())
  if (buffer.length === 0) return Response.json({ erro: 'Arquivo vazio.' }, { status: 400 })
  if (buffer.length > MAX_BYTES) {
    return Response.json({ erro: 'PDF muito grande (máx. 25 MB).' }, { status: 413 })
  }
  const base64 = buffer.toString('base64')

  const client = new Anthropic({ apiKey })

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 16000,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64 },
            },
            {
              type: 'text',
              text:
                'Este PDF é uma folha de pagamento brasileira. Extraia, para CADA profissional listado, ' +
                'o nome completo e o VALOR LÍQUIDO a receber (o "líquido a pagar" / "valor líquido" / "total líquido" — ' +
                'NÃO o salário bruto, NÃO os proventos, NÃO os descontos). Valores no formato brasileiro ' +
                '(ex.: "1.234,56") devem virar o número 1234.56. Ignore linhas de totais/somatórios gerais e ' +
                'cabeçalhos. Se a empresa/unidade de um profissional estiver visível, informe-a em "unidade"; ' +
                'caso contrário deixe "unidade" como string vazia. Retorne apenas os dados no formato solicitado.',
            },
          ],
        },
      ],
    })

    if (response.stop_reason === 'refusal') {
      return Response.json({ erro: 'A IA recusou processar este documento.' }, { status: 422 })
    }

    const texto = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text
    if (!texto) {
      return Response.json({ erro: 'A IA não retornou dados legíveis.' }, { status: 502 })
    }

    let parsed: { funcionarios?: { nome: string; valorLiquido: number; unidade?: string }[] }
    try {
      parsed = JSON.parse(texto)
    } catch {
      return Response.json({ erro: 'Resposta da IA em formato inesperado.' }, { status: 502 })
    }

    const funcionarios = (parsed.funcionarios ?? [])
      .map((f) => ({
        nome: String(f?.nome ?? '').trim(),
        valorLiquido: Number(f?.valorLiquido) || 0,
        unidade: String(f?.unidade ?? '').trim(),
      }))
      .filter((f) => f.nome && f.valorLiquido > 0)

    return Response.json({ funcionarios })
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `Erro da IA (${e.status}).` : 'Falha ao processar o PDF.'
    return Response.json({ erro: msg }, { status: 502 })
  }
}

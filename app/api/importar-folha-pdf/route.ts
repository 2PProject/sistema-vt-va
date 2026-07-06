// Lê uma folha de pagamento em PDF e extrai (nome + valor líquido) de cada
// profissional usando IA. Prioriza o Google Gemini (plano GRATUITO — chave em
// https://aistudio.google.com/apikey) e, se preferir, cai para a Anthropic.
// A chave fica SÓ no servidor, nunca no navegador.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 12 * 1024 * 1024 // 12 MB (limite seguro para envio "inline" ao Gemini)

type FuncExtraido = { nome: string; valorLiquido: number; unidade: string }

const PROMPT =
  'Este PDF é uma folha de pagamento brasileira. Extraia, para CADA profissional listado, ' +
  'o nome completo e o VALOR LÍQUIDO a receber (o "líquido a pagar" / "valor líquido" / "total líquido" — ' +
  'NÃO o salário bruto, NÃO os proventos, NÃO os descontos). Valores no formato brasileiro ' +
  '(ex.: "1.234,56") devem virar o número 1234.56. Ignore linhas de totais/somatórios gerais e ' +
  'cabeçalhos. Se a empresa/unidade de um profissional estiver visível, informe-a em "unidade"; ' +
  'caso contrário deixe "unidade" como string vazia. Retorne apenas os dados no formato solicitado.'

function normalizar(brutos: unknown): FuncExtraido[] {
  const arr = Array.isArray(brutos) ? brutos : []
  return arr
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((f: any) => ({
      nome: String(f?.nome ?? '').trim(),
      valorLiquido: Number(f?.valorLiquido) || 0,
      unidade: String(f?.unidade ?? '').trim(),
    }))
    .filter((f) => f.nome && f.valorLiquido > 0)
}

// ── Google Gemini (gratuito) ─────────────────────────────────────────────
async function extrairComGemini(base64: string, apiKey: string): Promise<FuncExtraido[]> {
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  const body = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: 'application/pdf', data: base64 } },
          { text: PROMPT },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          funcionarios: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                nome: { type: 'STRING' },
                valorLiquido: { type: 'NUMBER' },
                unidade: { type: 'STRING' },
              },
              required: ['nome', 'valorLiquido', 'unidade'],
            },
          },
        },
        required: ['funcionarios'],
      },
    },
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const detalhe = await resp.text().catch(() => '')
    throw new Error(`Gemini HTTP ${resp.status}${detalhe ? ': ' + detalhe.slice(0, 180) : ''}`)
  }

  const data = await resp.json()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const texto: string | undefined = data?.candidates?.[0]?.content?.parts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ?.map((p: any) => p?.text ?? '')
    .join('')
  if (!texto) throw new Error('Gemini não retornou dados.')

  const parsed = JSON.parse(texto)
  return normalizar(parsed?.funcionarios)
}

// ── Anthropic (opcional / pago) ──────────────────────────────────────────
async function extrairComAnthropic(base64: string, apiKey: string): Promise<FuncExtraido[]> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 16000,
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            funcionarios: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  nome: { type: 'string' },
                  valorLiquido: { type: 'number' },
                  unidade: { type: 'string' },
                },
                required: ['nome', 'valorLiquido', 'unidade'],
              },
            },
          },
          required: ['funcionarios'],
        },
      },
    },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
  })
  if (response.stop_reason === 'refusal') throw new Error('A IA recusou processar este documento.')
  const bloco = response.content.find((b) => b.type === 'text')
  const texto = bloco && 'text' in bloco ? (bloco as { text: string }).text : undefined
  if (!texto) throw new Error('A IA não retornou dados legíveis.')
  return normalizar(JSON.parse(texto)?.funcionarios)
}

export async function POST(req: Request) {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!geminiKey && !anthropicKey) {
    return Response.json(
      {
        erro:
          'Leitura por IA indisponível. Configure uma chave GRATUITA do Google Gemini na variável de ambiente ' +
          'GEMINI_API_KEY (obtenha em https://aistudio.google.com/apikey). Alternativa paga: ANTHROPIC_API_KEY.',
      },
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
    return Response.json({ erro: 'PDF muito grande (máx. 12 MB).' }, { status: 413 })
  }
  const base64 = buffer.toString('base64')

  try {
    const funcionarios = geminiKey
      ? await extrairComGemini(base64, geminiKey)
      : await extrairComAnthropic(base64, anthropicKey as string)
    return Response.json({ funcionarios })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao processar o PDF.'
    return Response.json({ erro: msg }, { status: 502 })
  }
}

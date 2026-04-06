import { createClient } from '@supabase/supabase-js'

// ─── Tipos das entidades do banco ─────────────────────────────────────────────

export type Empresa = {
  id: string
  razao_social: string
  cnpj: string
  valor_va: number
}

export type Unidade = {
  id: string
  empresa_id: string
  codigo: string
  nome: string
  empresas?: Empresa
}

export type Cargo = {
  id: string
  nome: string
}

export type Funcionario = {
  id: string
  nome: string
  ctps: string
  serie: string
  funcao: string
  folga_semanal: string
  unidade_id: string
  ativo: boolean
  valor_vt: number
  valor_vt_sabado: number
  unidades?: Unidade & { empresas?: Empresa }
}

/**
 * Migrations necessárias — executar supabase_fix_duplicatas.sql no SQL Editor:
 *
 *   ALTER TABLE competencias ADD COLUMN IF NOT EXISTS valor_va NUMERIC DEFAULT 0;
 *   ALTER TABLE competencias ADD COLUMN IF NOT EXISTS feriados_mes INTEGER DEFAULT 0;
 *   ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS valor_vt NUMERIC DEFAULT 0;
 *   ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS valor_vt_sabado NUMERIC DEFAULT 0;
 *   ALTER TABLE competencia_funcionario ADD COLUMN IF NOT EXISTS valor_vt NUMERIC DEFAULT 0;
 *   ALTER TABLE competencia_funcionario ADD COLUMN IF NOT EXISTS valor_vt_sabado NUMERIC DEFAULT 0;
 */
export type Competencia = {
  id: string
  unidade_id: string
  mes: number
  ano: number
  dias_uteis: number
  feriados_mes: number
  valor_va: number
  unidades?: Unidade & { empresas?: Empresa }
}

export type Feriado = {
  id: string
  data: string   // 'YYYY-MM-DD'
  descricao: string
}

export type TipoDesconto = {
  id: string
  nome: string
}

export type CFDesconto = {
  id: string
  competencia_funcionario_id: string
  tipo_desconto_id: string
  dias: number
  data_inicio: string | null  // 'YYYY-MM-DD'
  data_fim: string | null     // 'YYYY-MM-DD'
  dias_proximo_mes: number    // dias que transbordam para o mês seguinte
  tipos_desconto?: TipoDesconto
}

export type CompetenciaFuncionario = {
  id: string
  competencia_id: string
  funcionario_id: string
  dias_feriado: number
  dias_sabado: number
  dias_desconto: number
  valor_vt: number
  valor_vt_sabado: number
  valor_total: number
  competencias?: Competencia
  funcionarios?: Funcionario
}

// ─── Supabase client ───────────────────────────────────────────────────────────

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Garante que os feriados nacionais do ano estão na tabela.
 * Se não houver nenhum feriado cadastrado para o ano, importa da BrasilAPI.
 */
export async function garantirFeriadosAno(ano: number): Promise<void> {
  const { count } = await supabase
    .from('feriados')
    .select('id', { count: 'exact', head: true })
    .gte('data', `${ano}-01-01`)
    .lte('data', `${ano}-12-31`)

  if ((count ?? 0) > 0) return

  try {
    const res = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`)
    if (!res.ok) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lista: any[] = await res.json()
    if (!Array.isArray(lista) || lista.length === 0) return
    await supabase.from('feriados').upsert(
      lista.map((f) => ({ data: f.date, descricao: f.name })),
      { onConflict: 'data' }
    )
  } catch {
    // Falha silenciosa — não bloqueia o carregamento da página
  }
}

/**
 * Retorna o id da unidade padrão de uma empresa.
 * Se não existir nenhuma unidade, cria automaticamente.
 */
export async function getOrCreateDefaultUnidade(empresaId: string): Promise<string | null> {
  const { data: unidade } = await supabase
    .from('unidades')
    .select('id')
    .eq('empresa_id', empresaId)
    .limit(1)
    .maybeSingle()

  if (unidade) return unidade.id

  const { data: empresa } = await supabase
    .from('empresas')
    .select('razao_social')
    .eq('id', empresaId)
    .single()

  const { data: nova } = await supabase
    .from('unidades')
    .insert({
      empresa_id: empresaId,
      codigo: 'PRINCIPAL',
      nome: empresa?.razao_social ?? 'Principal',
    })
    .select()
    .single()

  return (nova as { id: string } | null)?.id ?? null
}

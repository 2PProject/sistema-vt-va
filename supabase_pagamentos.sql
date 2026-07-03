-- ============================================================
-- MÓDULO DE PAGAMENTOS
-- Executar no SQL Editor do Supabase. Seguro e idempotente.
--
-- Integra-se ao cadastro de funcionários existente (por empresa).
-- Não cria cadastro novo de profissionais.
-- ============================================================

-- Apelido opcional da empresa — usado para casar linhas da planilha
-- (a planilha identifica a empresa por CNPJ OU apelido).
ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS apelido TEXT;

-- ── Salário líquido importado por competência (mês anterior) ──────────────────
CREATE TABLE IF NOT EXISTS pagamento_registros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id UUID REFERENCES funcionarios(id) ON DELETE CASCADE,
  empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
  mes_referencia TEXT NOT NULL,          -- 'YYYY-MM'
  valor_liquido NUMERIC(12,2) NOT NULL DEFAULT 0,
  criado_em TIMESTAMPTZ DEFAULT now(),
  atualizado_em TIMESTAMPTZ DEFAULT now(),
  UNIQUE (funcionario_id, mes_referencia)
);

-- ── Vales / descontos (com parcelamento opcional) ─────────────────────────────
CREATE TABLE IF NOT EXISTS pagamento_vales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id UUID REFERENCES funcionarios(id) ON DELETE CASCADE,
  empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
  data DATE NOT NULL,                     -- data do lançamento
  descricao TEXT NOT NULL,
  valor_total NUMERIC(12,2) NOT NULL,     -- valor total do vale/desconto
  parcelas INTEGER NOT NULL DEFAULT 1,    -- nº de parcelas (1 = à vista)
  mes_inicio TEXT NOT NULL,               -- 'YYYY-MM' — competência da 1ª parcela
  criado_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pagamento_registros_mes ON pagamento_registros (mes_referencia);
CREATE INDEX IF NOT EXISTS idx_pagamento_registros_emp ON pagamento_registros (empresa_id);
CREATE INDEX IF NOT EXISTS idx_pagamento_vales_func ON pagamento_vales (funcionario_id);
CREATE INDEX IF NOT EXISTS idx_pagamento_vales_emp ON pagamento_vales (empresa_id);

-- RLS desabilitado (app usa a anon key, igual às demais tabelas do sistema)
ALTER TABLE IF EXISTS pagamento_registros DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS pagamento_vales     DISABLE ROW LEVEL SECURITY;

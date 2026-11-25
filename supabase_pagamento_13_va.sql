-- ============================================================
-- 13º SALÁRIO — VALE ALIMENTAÇÃO (2 parcelas: novembro e dezembro)
-- Benefício de VA do 13º, importado por planilha, SEM vale transporte e
-- SEM descontos. Um registro por funcionário por ano; o valor é o VA de
-- CADA parcela (nov e dez recebem o mesmo valor).
-- Idempotente. Rode no SQL editor do Supabase.
-- ============================================================
CREATE TABLE IF NOT EXISTS pagamento_13_va (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id UUID REFERENCES funcionarios(id) ON DELETE CASCADE,
  empresa_id     UUID REFERENCES empresas(id) ON DELETE CASCADE,
  ano            INTEGER NOT NULL,
  valor_parcela  NUMERIC(12,2) NOT NULL DEFAULT 0,  -- VA de cada parcela (nov e dez)
  criado_em      TIMESTAMPTZ DEFAULT now(),
  atualizado_em  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (funcionario_id, ano)
);

CREATE INDEX IF NOT EXISTS idx_pag13_emp ON pagamento_13_va (empresa_id);
CREATE INDEX IF NOT EXISTS idx_pag13_ano ON pagamento_13_va (ano);

-- RLS desabilitado (o app usa a anon key, igual às demais tabelas de pagamento).
ALTER TABLE IF EXISTS pagamento_13_va DISABLE ROW LEVEL SECURITY;

SELECT 'pagamento_13_va pronta' AS status;

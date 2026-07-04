-- ============================================================
-- CONTROLE DE FECHAMENTO DO MÊS (trava de edição por empresa/competência)
-- Executar no SQL Editor do Supabase. Seguro e idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS pagamento_fechamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
  mes INTEGER NOT NULL,
  ano INTEGER NOT NULL,
  fechado BOOLEAN NOT NULL DEFAULT true,
  fechado_em TIMESTAMPTZ DEFAULT now(),
  atualizado_em TIMESTAMPTZ DEFAULT now(),
  UNIQUE (empresa_id, mes, ano)
);

ALTER TABLE IF EXISTS pagamento_fechamentos DISABLE ROW LEVEL SECURITY;

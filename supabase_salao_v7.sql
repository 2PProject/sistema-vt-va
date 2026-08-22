-- MÓDULO SALÃO — v7: classificação operacional das notas
-- Executar após supabase_salao_v6.sql. Migration incremental e idempotente.

ALTER TABLE salon_notas
  ADD COLUMN IF NOT EXISTS classificacao text NOT NULL DEFAULT 'profissional',
  ADD COLUMN IF NOT EXISTS categoria_outro_servico text,
  ADD COLUMN IF NOT EXISTS analise_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS analise_motivo text;

ALTER TABLE salon_comissoes
  ADD COLUMN IF NOT EXISTS analise_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS analise_motivo text;

CREATE INDEX IF NOT EXISTS idx_salon_notas_classificacao ON salon_notas(classificacao);
CREATE INDEX IF NOT EXISTS idx_salon_notas_analise ON salon_notas(analise_manual);
CREATE INDEX IF NOT EXISTS idx_salon_com_analise ON salon_comissoes(analise_manual);

COMMENT ON COLUMN salon_notas.classificacao IS 'profissional | outro_servico';

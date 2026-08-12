-- ============================================================
-- MÓDULO SALÃO — v3: CONFERÊNCIA das notas recebidas
-- Rode APÓS supabase_salao.sql e supabase_salao_v2.sql.
-- Adiciona controle de conferência às notas: competência ajustada,
-- observação e marcação de conferida (com data/usuário).
-- ============================================================
ALTER TABLE salon_notas ADD COLUMN IF NOT EXISTS competencia_conf text;     -- competência definida na conferência (sobrepõe a do XML)
ALTER TABLE salon_notas ADD COLUMN IF NOT EXISTS observacao       text;      -- anotação da análise
ALTER TABLE salon_notas ADD COLUMN IF NOT EXISTS conferida        boolean NOT NULL DEFAULT false;
ALTER TABLE salon_notas ADD COLUMN IF NOT EXISTS conferida_em     timestamptz;
ALTER TABLE salon_notas ADD COLUMN IF NOT EXISTS conferida_por    text;

CREATE INDEX IF NOT EXISTS idx_salon_notas_conferida ON salon_notas(conferida);
CREATE INDEX IF NOT EXISTS idx_salon_notas_competencia ON salon_notas(competencia);

SELECT 'salon_notas' AS tabela, count(*) FILTER (WHERE conferida) AS conferidas, count(*) AS total FROM salon_notas;

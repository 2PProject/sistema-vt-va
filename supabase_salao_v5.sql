-- ============================================================
-- MÓDULO SALÃO — v5: pendências de importação
-- Rode APÓS os anteriores. Guarda também os registros incompletos
-- (ex.: sem CNPJ) com o motivo, para tratar depois sem perder ninguém.
-- ============================================================
ALTER TABLE salon_comissoes ADD COLUMN IF NOT EXISTS pendencia text;   -- motivo quando o registro está incompleto (ex.: "Sem CNPJ")
CREATE INDEX IF NOT EXISTS idx_salon_com_pendencia ON salon_comissoes(pendencia);

SELECT 'salon_comissoes' AS tabela,
       count(*) FILTER (WHERE pendencia IS NOT NULL) AS pendencias,
       count(*) AS total
FROM salon_comissoes;

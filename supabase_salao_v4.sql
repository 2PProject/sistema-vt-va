-- ============================================================
-- MÓDULO SALÃO — v4: CONFERÊNCIA por competência (planilha × notas)
-- Rode APÓS supabase_salao.sql, _v2 e _v3.
-- A planilha de cada competência vira a "lista esperada" (por CNPJ + valor).
-- salon_comissoes passa a ser chaveada por (empresa, competência, documento)
-- e cada linha pode ser vinculada a uma nota recebida (salon_notas).
-- ============================================================

ALTER TABLE salon_comissoes ADD COLUMN IF NOT EXISTS documento  text;                 -- CNPJ/CPF do profissional (dígitos)
ALTER TABLE salon_comissoes ADD COLUMN IF NOT EXISTS nome       text;                 -- nome do profissional na planilha
ALTER TABLE salon_comissoes ADD COLUMN IF NOT EXISTS observacao text;
ALTER TABLE salon_comissoes ADD COLUMN IF NOT EXISTS nota_id    uuid REFERENCES salon_notas(id) ON DELETE SET NULL;

-- Não exige mais cadastro prévio de profissional
ALTER TABLE salon_comissoes ALTER COLUMN profissional_id DROP NOT NULL;

-- Unicidade agora por empresa + competência + documento (CNPJ)
ALTER TABLE salon_comissoes DROP CONSTRAINT IF EXISTS salon_comissoes_empresa_id_profissional_id_mes_ref_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_salon_com_emp_comp_doc ON salon_comissoes(empresa_id, mes_ref, documento);
CREATE INDEX IF NOT EXISTS idx_salon_com_doc ON salon_comissoes(documento);
CREATE INDEX IF NOT EXISTS idx_salon_com_nota ON salon_comissoes(nota_id);

SELECT 'salon_comissoes' AS tabela, count(*) FILTER (WHERE status='conferida') AS conferidas, count(*) AS total FROM salon_comissoes;

-- ============================================================
-- SCRIPT: Torna o número da NF opcional em salao_nf_confirmacoes
-- O controle não depende do número da nota — o importante é
-- saber se a NF foi emitida (data) e se o valor está correto.
-- Executar no SQL Editor do Supabase. Seguro e idempotente.
-- ============================================================

ALTER TABLE salao_nf_confirmacoes
  ALTER COLUMN numero_nf DROP NOT NULL;

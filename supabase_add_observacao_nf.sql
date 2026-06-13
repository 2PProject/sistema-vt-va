-- ============================================================
-- SCRIPT: Adiciona coluna observacao em salao_nf_registros
-- Executar no SQL Editor do Supabase ANTES de implantar o código.
-- Seguro e idempotente.
-- ============================================================

ALTER TABLE salao_nf_registros
  ADD COLUMN IF NOT EXISTS observacao TEXT;

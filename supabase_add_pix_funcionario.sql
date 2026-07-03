-- ============================================================
-- SCRIPT: Chave Pix no cadastro de funcionário
-- Armazena a chave Pix (email / CPF / telefone / aleatória) sem
-- formatação, para gerar o arquivo CSV de pagamento do banco.
-- Executar no SQL Editor do Supabase. Seguro e idempotente.
-- ============================================================

ALTER TABLE funcionarios
  ADD COLUMN IF NOT EXISTS pix TEXT;

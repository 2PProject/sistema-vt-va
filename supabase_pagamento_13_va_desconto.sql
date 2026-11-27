-- ============================================================
-- 13º VA — DESCONTO DA 2ª PARCELA (Dezembro)
-- A 1ª parcela (Novembro) recebe o VA cheio; a 2ª (Dezembro) recebe o VA
-- MENOS o desconto aqui lançado (ex.: descontos do 13º lançados à frente).
-- Idempotente. Rode no SQL editor do Supabase.
-- ============================================================
ALTER TABLE public.pagamento_13_va
  ADD COLUMN IF NOT EXISTS desconto_2a NUMERIC(12,2) NOT NULL DEFAULT 0;

SELECT 'pagamento_13_va.desconto_2a pronta' AS status;

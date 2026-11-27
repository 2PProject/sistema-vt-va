-- ============================================================
-- 13º VA — VALOR LÍQUIDO DA 2ª PARCELA (Dezembro)
-- A 1ª parcela (Novembro) usa valor_parcela (importado). A 2ª parcela
-- (Dezembro) pode ter um valor líquido próprio, lançado na tela — quando
-- NULL, repete o valor da 1ª. Guarda o líquido direto (sem cálculo de desconto).
-- Idempotente. Rode no SQL editor do Supabase.
-- ============================================================
ALTER TABLE public.pagamento_13_va
  ADD COLUMN IF NOT EXISTS valor_2a NUMERIC(12,2);

SELECT 'pagamento_13_va.valor_2a pronta' AS status;

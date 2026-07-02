-- ============================================================
-- SCRIPT: VA por funcionário (exceção)
-- Permite definir um valor de VA específico por funcionário,
-- usado apenas quando > 0. Caso contrário, usa o VA da
-- empresa/competência normalmente.
-- Executar no SQL Editor do Supabase. Seguro e idempotente.
-- ============================================================

ALTER TABLE funcionarios
  ADD COLUMN IF NOT EXISTS valor_va NUMERIC DEFAULT 0;

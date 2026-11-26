-- ============================================================
-- NOTAS CANCELADAS — rótulo próprio (visível), sem esconder a nota.
-- Antes, nota cancelada virava "excluída" (sumia). Agora ela fica VISÍVEL com
-- o rótulo "Cancelada" e é retirada do casamento (não vem como válida).
-- Idempotente. Rode no SQL editor do Supabase.
-- ============================================================
ALTER TABLE public.salon_notas
  ADD COLUMN IF NOT EXISTS cancelada BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_salon_notas_cancelada
  ON public.salon_notas (empresa_id, cancelada) WHERE cancelada = true;

SELECT 'salon_notas.cancelada pronta' AS status;

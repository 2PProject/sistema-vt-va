-- ============================================================
-- VT/VA — QUITAÇÃO MANUAL DE VALES
-- Permite quitar um vale/adiantamento antes do fim do parcelamento
-- (pagamento em dinheiro/pix, antecipação, acordo etc.), parando os
-- descontos automáticos a partir de uma competência.
-- Idempotente. Rode no SQL editor do Supabase.
-- ============================================================

alter table public.pagamento_vales
  add column if not exists quitado_em   text,   -- competência 'YYYY-MM' a partir da qual NÃO desconta mais (quitado)
  add column if not exists quitado_data date,    -- data em que a quitação foi registrada
  add column if not exists quitado_obs  text;    -- observação/forma da quitação (dinheiro, pix, acordo…)

select 'pagamento_vales: colunas de quitação aplicadas' as status;

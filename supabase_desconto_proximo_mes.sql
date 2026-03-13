-- Migration: adicionar dias_proximo_mes para carry-over de afastamentos
-- Executar no SQL Editor do Supabase

ALTER TABLE competencia_funcionario_desconto
  ADD COLUMN IF NOT EXISTS dias_proximo_mes INTEGER DEFAULT 0;

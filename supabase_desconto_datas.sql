-- Migration: adicionar campos de data nos descontos de competência
-- Executar no SQL Editor do Supabase

ALTER TABLE competencia_funcionario_desconto
  ADD COLUMN IF NOT EXISTS data_inicio DATE,
  ADD COLUMN IF NOT EXISTS data_fim DATE;

-- Adicionar "Férias" como tipo de desconto padrão (se ainda não existir)
INSERT INTO tipos_desconto (nome)
SELECT 'Férias'
WHERE NOT EXISTS (
  SELECT 1 FROM tipos_desconto WHERE nome = 'Férias'
);

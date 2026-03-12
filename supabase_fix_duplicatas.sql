-- ============================================================
-- CORREÇÕES — SISTEMA VT/VA — GRUPO MEIRE REIS
-- Executar no SQL Editor do Supabase caso o script de carga
-- tenha sido rodado mais de uma vez (dados duplicados)
-- ============================================================

-- ─── 1. REMOVER FUNCIONÁRIOS DUPLICADOS ──────────────────────────────────────
-- Mantém apenas o registro mais antigo (menor ctid) para cada ctps
DELETE FROM funcionarios
WHERE ctid NOT IN (
  SELECT MIN(ctid)
  FROM funcionarios
  GROUP BY ctps
);

-- ─── 2. REMOVER UNIDADES DUPLICADAS POR EMPRESA ──────────────────────────────
-- Mantém apenas a unidade mais antiga por empresa
DELETE FROM unidades
WHERE ctid NOT IN (
  SELECT MIN(ctid)
  FROM unidades
  GROUP BY empresa_id
);

-- ─── 3. REMOVER EMPRESAS DUPLICADAS ──────────────────────────────────────────
-- Antes de remover empresas duplicadas, reassocia as unidades que sobraram
-- para apontar para o ID mais antigo de cada razao_social
UPDATE unidades u
SET empresa_id = (
  SELECT e2.id
  FROM empresas e2
  WHERE e2.razao_social = (SELECT e.razao_social FROM empresas e WHERE e.id = u.empresa_id)
  ORDER BY e2.ctid
  LIMIT 1
);

-- Agora remove empresas duplicadas (mantém a mais antiga de cada razao_social)
DELETE FROM empresas
WHERE ctid NOT IN (
  SELECT MIN(ctid)
  FROM empresas
  GROUP BY razao_social
);

-- ─── 4. MIGRATIONS — VT POR FUNCIONÁRIO ──────────────────────────────────────
-- Valor VT individual por funcionário (base do cálculo)
ALTER TABLE funcionarios
  ADD COLUMN IF NOT EXISTS valor_vt        NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_vt_sabado NUMERIC DEFAULT 0;

-- VT por linha na competência (permite sobrescrever o valor padrão do funcionário)
ALTER TABLE competencia_funcionario
  ADD COLUMN IF NOT EXISTS valor_vt        NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_vt_sabado NUMERIC DEFAULT 0;

-- Feriados do mês (quantidade, compartilhado por empresa/mês)
ALTER TABLE competencias
  ADD COLUMN IF NOT EXISTS feriados_mes INTEGER DEFAULT 0;

-- ─── 5. NOVAS TABELAS E COLUNAS ──────────────────────────────────────────────

-- VA padrão por empresa (pré-cadastrado na página Valores VT/VA)
ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS valor_va NUMERIC DEFAULT 0;

-- Feriados com data específica
CREATE TABLE IF NOT EXISTS feriados (
  id        uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  data      date NOT NULL,
  descricao text NOT NULL
);

-- Tipos de desconto (Falta, Atestado, Suspensão, etc.)
CREATE TABLE IF NOT EXISTS tipos_desconto (
  id   uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL UNIQUE
);

-- Breakdown de descontos por funcionário na competência
CREATE TABLE IF NOT EXISTS competencia_funcionario_desconto (
  id                        uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  competencia_funcionario_id uuid NOT NULL,
  tipo_desconto_id           uuid NOT NULL REFERENCES tipos_desconto(id) ON DELETE CASCADE,
  dias                       integer NOT NULL DEFAULT 1
);

-- Dados iniciais de tipos de desconto
INSERT INTO tipos_desconto (nome) VALUES
  ('Falta Injustificada'),
  ('Atestado Médico'),
  ('Suspensão'),
  ('Licença')
ON CONFLICT (nome) DO NOTHING;

-- ─── 6. VERIFICAÇÃO FINAL ─────────────────────────────────────────────────────
SELECT
  e.razao_social AS empresa,
  COUNT(f.id)    AS total_funcionarios
FROM empresas e
JOIN unidades u    ON u.empresa_id = e.id
JOIN funcionarios f ON f.unidade_id = u.id
GROUP BY e.razao_social
ORDER BY e.razao_social;

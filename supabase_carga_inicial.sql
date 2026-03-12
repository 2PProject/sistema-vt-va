-- ============================================================
-- CARGA INICIAL — SISTEMA VT/VA — GRUPO MEIRE REIS
-- Executar no SQL Editor do Supabase (em ordem)
-- ============================================================

-- ─── 1. MIGRAÇÕES (colunas extras na tabela competencias) ────────────────────
ALTER TABLE competencias ADD COLUMN IF NOT EXISTS valor_vt        NUMERIC DEFAULT 0;
ALTER TABLE competencias ADD COLUMN IF NOT EXISTS valor_vt_sabado NUMERIC DEFAULT 0;
ALTER TABLE competencias ADD COLUMN IF NOT EXISTS valor_va        NUMERIC DEFAULT 0;

-- ─── 2. TABELA DE CARGOS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cargos (
  id   uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL UNIQUE
);

-- ─── 3. CARGOS ───────────────────────────────────────────────────────────────
INSERT INTO cargos (nome) VALUES
  ('AUXILIAR DE SERVIÇOS GERAIS'),
  ('RECEPCIONISTA'),
  ('COPEIRA'),
  ('AUXILIAR ADMINISTRATIVO')
ON CONFLICT (nome) DO NOTHING;

-- ─── 4. EMPRESAS ─────────────────────────────────────────────────────────────
-- Preencha o CNPJ de cada empresa antes de executar
INSERT INTO empresas (razao_social, cnpj) VALUES
  ('MEIRE REIS CENTRO DE BELEZA LTDA', ''),   -- preencher CNPJ
  ('TEODORA DOS REIS NETA LTDA',       ''),   -- preencher CNPJ
  ('STUDIO MEIRE REIS LTDA',           ''),   -- preencher CNPJ
  ('MEIRE REIS BEAUTY LTDA',           '');   -- preencher CNPJ

-- ─── 5. UNIDADES (uma por empresa, criadas automaticamente) ──────────────────
INSERT INTO unidades (empresa_id, codigo, nome)
SELECT e.id, 'PRINCIPAL', e.razao_social
FROM   empresas e
WHERE  NOT EXISTS (
  SELECT 1 FROM unidades u WHERE u.empresa_id = e.id
);

-- ─── 6. FUNCIONÁRIOS ─────────────────────────────────────────────────────────
DO $$
DECLARE
  u_beleza  uuid;
  u_teodora uuid;
  u_studio  uuid;
  u_beauty  uuid;
BEGIN
  -- Resolve unidade_id de cada empresa
  SELECT u.id INTO u_beleza
    FROM unidades u JOIN empresas e ON u.empresa_id = e.id
    WHERE e.razao_social = 'MEIRE REIS CENTRO DE BELEZA LTDA' LIMIT 1;

  SELECT u.id INTO u_teodora
    FROM unidades u JOIN empresas e ON u.empresa_id = e.id
    WHERE e.razao_social = 'TEODORA DOS REIS NETA LTDA' LIMIT 1;

  SELECT u.id INTO u_studio
    FROM unidades u JOIN empresas e ON u.empresa_id = e.id
    WHERE e.razao_social = 'STUDIO MEIRE REIS LTDA' LIMIT 1;

  SELECT u.id INTO u_beauty
    FROM unidades u JOIN empresas e ON u.empresa_id = e.id
    WHERE e.razao_social = 'MEIRE REIS BEAUTY LTDA' LIMIT 1;

  -- ── MEIRE REIS CENTRO DE BELEZA LTDA ────────────────────────────────────
  INSERT INTO funcionarios (nome, ctps, serie, funcao, folga_semanal, unidade_id, ativo) VALUES
    ('FRANCISCA NUNES MOTA',           '87673',   '00022/CE', 'AUXILIAR DE SERVIÇOS GERAIS', 'Terça-feira',   u_beleza, true),
    ('JESSIKA ARAUJO MANETE',          '871868',  '00160/DF', 'RECEPCIONISTA',               'Terça-feira',   u_beleza, true),
    ('KAROLINY KELEN CASTRO CARVALHO', '62347',   '00037/DF', 'RECEPCIONISTA',               'Quarta-feira',  u_beleza, true),
    ('MICHELLY SOUZA CUNHA',           '1659222', '04606/DF', 'RECEPCIONISTA',               'Quarta-feira',  u_beleza, true),
    ('ROSEANE ALVES SILVA',            '4498551', '00050/DF', 'COPEIRA',                     'Segunda-feira', u_beleza, true),
    ('SILENE DOS SANTOS SOARES',       '79234',   '00021/PI', 'RECEPCIONISTA',               'Quarta-feira',  u_beleza, true),
    ('THAISA SIRQUEIRA LOPES',         '6028332', '00050/DF', 'COPEIRA',                     'Segunda-feira', u_beleza, true),
    ('WILLIAN PEREIRA DE SOUSA',       '23973',   '00443/SP', 'AUXILIAR ADMINISTRATIVO',     'Segunda-feira', u_beleza, true);

  -- ── TEODORA DOS REIS NETA LTDA ──────────────────────────────────────────
  INSERT INTO funcionarios (nome, ctps, serie, funcao, folga_semanal, unidade_id, ativo) VALUES
    ('ALICE FERNANDES AMORIM',              '6037401', '05350/DF', 'AUXILIAR DE SERVIÇOS GERAIS', 'Segunda-feira', u_teodora, true),
    ('ALMIRIA THAIS MACIEL DA SILVA',       '548286',  '03107/DF', 'RECEPCIONISTA',               'Terça-feira',   u_teodora, true),
    ('JANAINA MOTA DE OLIVEIRA',            '691087',  '09112/DF', 'RECEPCIONISTA',               'Segunda-feira', u_teodora, true),
    ('JOAO VITOR LOPES HENRIQUE',           '563039',  '00198/DF', 'AUXILIAR ADMINISTRATIVO',     'Segunda-feira', u_teodora, true),
    ('MARIA AMELIA DA SILVA CAMPOS',        '79577',   '00030/DF', 'RECEPCIONISTA',               'Quarta-feira',  u_teodora, true),
    ('MARLENE TEIXEIRA DOS SANTOS PRATES',  '2488332', '00020/MS', 'AUXILIAR DE SERVIÇOS GERAIS', 'Terça-feira',   u_teodora, true);

  -- ── STUDIO MEIRE REIS LTDA ──────────────────────────────────────────────
  INSERT INTO funcionarios (nome, ctps, serie, funcao, folga_semanal, unidade_id, ativo) VALUES
    ('JESSICA MENDES DA SILVA',          '92030',  '00030/DF', 'AUXILIAR ADMINISTRATIVO',     'Segunda-feira', u_studio, true),
    ('LAURA DANIELLE GONÇALVES BRANDÃO', '875402', '07128/DF', 'RECEPCIONISTA',               'Terça-feira',   u_studio, true),
    ('TONILZA LIRA CENA',                '89960',  '00019/DF', 'AUXILIAR DE SERVIÇOS GERAIS', NULL,            u_studio, true);

  -- ── MEIRE REIS BEAUTY LTDA ──────────────────────────────────────────────
  INSERT INTO funcionarios (nome, ctps, serie, funcao, folga_semanal, unidade_id, ativo) VALUES
    ('ARITANA MAIA DA SILVA',        '765667', '04101/DF', 'RECEPCIONISTA',               'Terça-feira',   u_beauty, true),
    ('ISABEL CRISTINA DA SILVA MELO','47292',  '00023/DF', 'RECEPCIONISTA',               'Segunda-feira', u_beauty, true),
    ('JOSELINA ANDRADE ARAUJO',      '24326',  '00018/DF', 'AUXILIAR DE SERVIÇOS GERAIS', NULL,            u_beauty, true),
    ('LUCILENE DA SILVA MELO',       '49943',  '00015/DF', 'RECEPCIONISTA',               'Segunda-feira', u_beauty, true);

END $$;

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────────────────────
SELECT
  e.razao_social AS empresa,
  count(f.id)    AS total_funcionarios
FROM empresas e
JOIN unidades u ON u.empresa_id = e.id
JOIN funcionarios f ON f.unidade_id = u.id
GROUP BY e.razao_social
ORDER BY e.razao_social;

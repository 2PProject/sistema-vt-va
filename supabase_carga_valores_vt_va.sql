-- ============================================================
-- CARGA DE VALORES VT / VA — GRUPO MEIRE REIS
-- Atualiza valor_va nas empresas e valor_vt / valor_vt_sabado
-- nos funcionários conforme planilha.
-- Executar no SQL Editor do Supabase.
-- ============================================================

-- ─── 1. VALOR VA POR EMPRESA (R$ 32,00 — todos) ──────────────────────────────
UPDATE empresas SET valor_va = 32.00
WHERE razao_social IN (
  'MEIRE REIS CENTRO DE BELEZA LTDA',
  'TEODORA DOS REIS NETA LTDA',
  'STUDIO MEIRE REIS LTDA',
  'MEIRE REIS BEAUTY LTDA'
);

-- ─── 2. VALOR VT POR FUNCIONÁRIO ─────────────────────────────────────────────
-- Usa CTE para resolver unidade_id a partir da razão social da empresa,
-- depois faz UPDATE em funcionarios por nome + unidade.

WITH map AS (
  SELECT f.id AS fid, f.nome
  FROM funcionarios f
  JOIN unidades u ON u.id = f.unidade_id
  JOIN empresas  e ON e.id = u.empresa_id
  WHERE e.razao_social = 'MEIRE REIS CENTRO DE BELEZA LTDA'
    AND f.nome IN (
      'FRANCISCA NUNES MOTA',
      'JESSIKA ARAUJO MANETE',
      'KAROLINY KELEN CASTRO CARVALHO',
      'MICHELLY SOUZA CUNHA',
      'ROSEANE ALVES SILVA',
      'SILENE DOS SANTOS SOARES',
      'THAISA SIRQUEIRA LOPES',
      'WILLIAN PEREIRA DE SOUSA'
    )
)
UPDATE funcionarios f
SET valor_vt = 11.00, valor_vt_sabado = 0
FROM map WHERE f.id = map.fid;

-- ── TEODORA DOS REIS NETA LTDA ───────────────────────────────────────────────
-- Funcionários com VT próprio; JANAINA tem sábado diferente
UPDATE funcionarios f
SET valor_vt = v.vt, valor_vt_sabado = v.vt_sab
FROM (
  VALUES
    ('ALICE FERNANDES AMORIM',             22.30,  0.00),
    ('ALMIRIA THAIS MACIEL DA SILVA',      19.00,  0.00),
    ('JANAINA MOTA DE OLIVEIRA',           18.60, 20.60),
    ('JOAO VITOR LOPES HENRIQUE',          13.00,  0.00),
    ('MARIA AMELIA DA SILVA CAMPOS',       21.60,  0.00),
    ('MARLENE TEIXEIRA DOS SANTOS PRATES',  7.60,  0.00)
) AS v(nome, vt, vt_sab)
JOIN unidades u ON u.id = f.unidade_id
JOIN empresas  e ON e.id = u.empresa_id
WHERE f.nome = v.nome
  AND e.razao_social = 'TEODORA DOS REIS NETA LTDA';

-- ── STUDIO MEIRE REIS LTDA ───────────────────────────────────────────────────
UPDATE funcionarios f
SET valor_vt = v.vt, valor_vt_sabado = 0
FROM (
  VALUES
    ('JESSICA MENDES DA SILVA',          22.00),
    ('LAURA DANIELLE GONÇALVES BRANDÃO', 11.00),
    ('TONILZA LIRA CENA',                11.00)
) AS v(nome, vt)
JOIN unidades u ON u.id = f.unidade_id
JOIN empresas  e ON e.id = u.empresa_id
WHERE f.nome = v.nome
  AND e.razao_social = 'STUDIO MEIRE REIS LTDA';

-- ── MEIRE REIS BEAUTY LTDA ───────────────────────────────────────────────────
UPDATE funcionarios f
SET valor_vt = v.vt, valor_vt_sabado = 0
FROM (
  VALUES
    ('ARITANA MAIA DA SILVA',         11.00),
    ('ISABEL CRISTINA DA SILVA MELO', 11.00),
    ('JOSELINA ANDRADE ARAUJO',       20.50),
    ('LUCILENE DA SILVA MELO',        11.00)
) AS v(nome, vt)
JOIN unidades u ON u.id = f.unidade_id
JOIN empresas  e ON e.id = u.empresa_id
WHERE f.nome = v.nome
  AND e.razao_social = 'MEIRE REIS BEAUTY LTDA';

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────────────────────
SELECT
  e.razao_social  AS empresa,
  f.nome,
  f.valor_vt,
  f.valor_vt_sabado
FROM funcionarios f
JOIN unidades u ON u.id = f.unidade_id
JOIN empresas  e ON e.id = u.empresa_id
WHERE f.ativo = true
ORDER BY e.razao_social, f.nome;

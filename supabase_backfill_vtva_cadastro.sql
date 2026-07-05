-- ============================================================
-- BACKFILL DOS VALORES DE VT/VA NO CADASTRO
-- O cálculo de VT/VA agora usa o CADASTRO (funcionarios.valor_vt,
-- funcionarios.valor_vt_sabado e empresas.valor_va). Quem preenchia os
-- valores pela antiga "Apuração" (por competência) tem o cadastro zerado,
-- então meses sem competência (ex.: Julho) saem sem VT/VA.
--
-- Este script copia os valores da ÚLTIMA competência apurada para o cadastro,
-- apenas onde o cadastro está zerado. Seguro e idempotente.
-- Executar no SQL Editor do Supabase.
-- ============================================================

-- 1) VT e VT-sábado do funcionário ← competência mais recente com valor
UPDATE funcionarios f
SET valor_vt = sub.valor_vt,
    valor_vt_sabado = sub.valor_vt_sabado
FROM (
  SELECT DISTINCT ON (cf.funcionario_id)
         cf.funcionario_id, cf.valor_vt, cf.valor_vt_sabado
  FROM competencia_funcionario cf
  JOIN competencias c ON c.id = cf.competencia_id
  WHERE COALESCE(cf.valor_vt, 0) > 0 OR COALESCE(cf.valor_vt_sabado, 0) > 0
  ORDER BY cf.funcionario_id, c.ano DESC, c.mes DESC
) sub
WHERE f.id = sub.funcionario_id
  AND COALESCE(f.valor_vt, 0) = 0;   -- só onde o cadastro está zerado

-- 2) VA da empresa ← competência mais recente com valor
UPDATE empresas e
SET valor_va = sub.valor_va
FROM (
  SELECT DISTINCT ON (u.empresa_id)
         u.empresa_id, c.valor_va
  FROM competencias c
  JOIN unidades u ON u.id = c.unidade_id
  WHERE COALESCE(c.valor_va, 0) > 0
  ORDER BY u.empresa_id, c.ano DESC, c.mes DESC
) sub
WHERE e.id = sub.empresa_id
  AND COALESCE(e.valor_va, 0) = 0;

-- 3) Conferência
SELECT nome, valor_vt, valor_vt_sabado FROM funcionarios
WHERE ativo IS DISTINCT FROM false ORDER BY nome;

SELECT razao_social, valor_va FROM empresas ORDER BY razao_social;

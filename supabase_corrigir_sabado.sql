-- ============================================================
-- CORREÇÃO: zerar valor_vt_sabado de funcionários que NÃO
-- são exceção de sábado, e corrigir registros já salvos em
-- competencia_funcionario.
-- Executar no SQL Editor do Supabase.
-- ============================================================

-- ─── 1. Zerando valor_vt_sabado nos funcionários não-exceção ─────────────────
-- Apenas JANAINA MOTA DE OLIVEIRA (TEODORA) tem VT sábado diferente.
-- Todos os demais devem ter valor_vt_sabado = 0.

UPDATE funcionarios
SET valor_vt_sabado = 0
WHERE nome NOT IN ('JANAINA MOTA DE OLIVEIRA')
  AND valor_vt_sabado > 0;

-- Confirmação: JANAINA permanece com valor correto
UPDATE funcionarios
SET valor_vt_sabado = 20.60
WHERE nome = 'JANAINA MOTA DE OLIVEIRA'
  AND unidade_id IN (
    SELECT u.id FROM unidades u
    JOIN empresas e ON e.id = u.empresa_id
    WHERE e.razao_social = 'TEODORA DOS REIS NETA LTDA'
  );

-- ─── 2. Corrigindo competencia_funcionario já salvas ─────────────────────────
-- Zera dias_sabado e valor_vt_sabado para funcionários que não são exceção

UPDATE competencia_funcionario cf
SET dias_sabado       = 0,
    valor_vt_sabado   = 0,
    valor_total       = valor_total - (cf.dias_sabado * cf.valor_vt_sabado)
WHERE cf.valor_vt_sabado > 0
  AND cf.funcionario_id NOT IN (
    SELECT f.id FROM funcionarios f
    WHERE f.valor_vt_sabado > 0
  );

-- ─── VERIFICAÇÃO ─────────────────────────────────────────────────────────────
SELECT f.nome, f.valor_vt, f.valor_vt_sabado,
       e.razao_social AS empresa
FROM funcionarios f
JOIN unidades u ON u.id = f.unidade_id
JOIN empresas  e ON e.id = u.empresa_id
WHERE f.ativo = true
ORDER BY f.valor_vt_sabado DESC, f.nome;

-- ============================================================
-- SCRIPT: Unicidade em competências e competência_funcionário
-- Evita linhas duplicadas que quebram os .maybeSingle() (recibos somem,
-- competências/descontos duplicados). Rode BLOCO 1 para conferir; se
-- retornar 0 linhas, rode BLOCO 2 para criar os índices únicos.
-- ============================================================

-- ── BLOCO 1 — CONFERÊNCIA (rode antes) ───────────────────────────────────────
-- Deve retornar 0 linhas em ambas as consultas. Se retornar algo, há
-- duplicados que precisam ser consolidados manualmente antes do BLOCO 2.
SELECT unidade_id, mes, ano, COUNT(*) AS qtd
FROM competencias
GROUP BY unidade_id, mes, ano
HAVING COUNT(*) > 1;

SELECT competencia_id, funcionario_id, COUNT(*) AS qtd
FROM competencia_funcionario
GROUP BY competencia_id, funcionario_id
HAVING COUNT(*) > 1;


-- ── BLOCO 2 — CRIA OS ÍNDICES ÚNICOS (só se o BLOCO 1 veio vazio) ─────────────
CREATE UNIQUE INDEX IF NOT EXISTS competencias_unidade_mes_ano_uk
  ON competencias (unidade_id, mes, ano);

CREATE UNIQUE INDEX IF NOT EXISTS competencia_funcionario_comp_func_uk
  ON competencia_funcionario (competencia_id, funcionario_id);

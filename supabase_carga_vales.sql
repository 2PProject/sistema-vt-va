-- ============================================================
-- CARGA DE VALES / DESCONTOS
-- Requer: supabase_pagamentos.sql já executado (tabela pagamento_vales).
--
-- Contexto: hoje = 2026. "O último desconto foi no pagamento de maio"
--   => a parcela X (de "X de Y") corresponde à competência 2026-05.
--   => mes_inicio (1ª parcela) = 2026-05 recuado (X-1) meses, de modo que
--      as parcelas restantes (Y-X) sigam sendo descontadas de 2026-06 em diante.
--      Quem está "0 de Y" começa a descontar em 2026-06.
--
-- O funcionário é resolvido pelo NOME, ignorando MAIÚSCULAS e ACENTOS
-- (ex.: 'João Vitor' casa com 'JOAO VITOR LOPES HENRIQUE').
-- Janaina é filtrada pela empresa "Sudoeste".
-- ============================================================

-- Função auxiliar (sessão) para normalizar nome: minúsculo + sem acento
CREATE OR REPLACE FUNCTION pg_temp.norm(txt text) RETURNS text AS $$
  SELECT lower(translate(coalesce($1, ''),
    'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüý',
    'AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuy'));
$$ LANGUAGE sql IMMUTABLE;


-- ── BLOCO 1 — CONFERÊNCIA (rode ANTES da carga) ──────────────────────────────
-- Confira se cada nome casa com exatamente 1 funcionário (e Janaina em Sudoeste).
SELECT v.nome_busca, f.id AS funcionario_id, f.nome AS funcionario,
       e.razao_social AS empresa, e.apelido
FROM (VALUES ('João Vitor'), ('Janaina'), ('Aritana'), ('marlene')) AS v(nome_busca)
LEFT JOIN funcionarios f ON pg_temp.norm(f.nome) LIKE pg_temp.norm(v.nome_busca) || '%'
LEFT JOIN unidades u     ON u.id = f.unidade_id
LEFT JOIN empresas e     ON e.id = u.empresa_id
ORDER BY v.nome_busca, f.nome;


-- ── BLOCO 2 — CARGA (rode após conferir o BLOCO 1) ───────────────────────────
WITH dados(nome, empresa_hint, valor_total, parcelas, mes_inicio, data, descricao) AS (
  VALUES
    -- Janaina (Sudoeste): 5 de 10 -> 1ª parcela em 2026-01
    ('Janaina',    'Sudoeste', 1500.00::numeric, 10, '2026-01', DATE '2026-01-16', 'Vale'),
    -- João Vitor
    ('João Vitor', NULL,       1000.00::numeric,  5, '2026-05', DATE '2026-03-10', 'Vale'), -- 1 de 5
    ('João Vitor', NULL,        300.00::numeric,  3, '2026-04', DATE '2026-04-24', 'Vale'), -- 2 de 3
    ('João Vitor', NULL,       1100.00::numeric,  5, '2026-05', DATE '2026-05-08', 'Vale'), -- 1 de 5
    ('João Vitor', NULL,       1000.00::numeric,  5, '2026-06', DATE '2026-06-08', 'Vale'), -- 0 de 5
    ('João Vitor', NULL,        200.00::numeric,  1, '2026-06', DATE '2026-06-15', 'Vale'), -- 0 de 1
    -- Aritana: 3 de 4 -> 1ª parcela em 2026-03
    ('Aritana',    NULL,        800.00::numeric,  4, '2026-03', DATE '2026-02-10', 'Vale'), -- 3 de 4
    -- marlene: 0 de 1 -> desconta em 2026-06
    ('marlene',    NULL,        150.00::numeric,  1, '2026-06', DATE '2026-06-25', 'Vale')  -- 0 de 1
),
resolvidos AS (
  SELECT d.valor_total, d.parcelas, d.mes_inicio, d.data, d.descricao,
         f.id AS funcionario_id, u.empresa_id
  FROM dados d
  JOIN funcionarios f ON pg_temp.norm(f.nome) LIKE pg_temp.norm(d.nome) || '%'
  JOIN unidades u     ON u.id = f.unidade_id
  LEFT JOIN empresas e ON e.id = u.empresa_id
  WHERE d.empresa_hint IS NULL
     OR pg_temp.norm(e.razao_social) LIKE '%' || pg_temp.norm(d.empresa_hint) || '%'
     OR pg_temp.norm(e.apelido)      LIKE '%' || pg_temp.norm(d.empresa_hint) || '%'
)
INSERT INTO pagamento_vales (funcionario_id, empresa_id, data, descricao, valor_total, parcelas, mes_inicio)
SELECT r.funcionario_id, r.empresa_id, r.data, r.descricao, r.valor_total, r.parcelas, r.mes_inicio
FROM resolvidos r
WHERE NOT EXISTS (      -- evita duplicar caso o script rode mais de uma vez
  SELECT 1 FROM pagamento_vales pv
  WHERE pv.funcionario_id = r.funcionario_id
    AND pv.valor_total   = r.valor_total
    AND pv.mes_inicio    = r.mes_inicio
    AND pv.parcelas      = r.parcelas
);


-- ── BLOCO 3 — VERIFICAÇÃO ────────────────────────────────────────────────────
SELECT f.nome AS profissional, e.razao_social AS empresa, pv.descricao,
       pv.valor_total, pv.parcelas,
       ROUND(pv.valor_total / pv.parcelas, 2) AS valor_parcela,
       pv.mes_inicio, pv.data
FROM pagamento_vales pv
JOIN funcionarios f  ON f.id = pv.funcionario_id
LEFT JOIN empresas e ON e.id = pv.empresa_id
ORDER BY f.nome, pv.mes_inicio, pv.valor_total;

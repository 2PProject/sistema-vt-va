-- ============================================================
-- SCRIPT: Remoção de profissionais duplicados
-- Tabela: salao_profissionais
--
-- EXECUTAR NO SQL EDITOR DO SUPABASE (Dashboard → SQL Editor)
--
-- Estratégia:
--   1. Para cada grupo de CNPJ igual → manter o mais antigo (criado_em)
--   2. Para cada grupo de nome igual (case-insensitive) → manter o mais antigo
--   3. Redirecionar FKs em salao_nf_registros e salao_profissional_empresa
--   4. Deletar vínculos residuais e profissionais duplicados
--
-- ATENÇÃO: Execute o BLOCO DE PREVIEW primeiro (linhas 18-45)
--          antes de rodar o bloco principal (linhas 48+).
-- ============================================================

-- ── BLOCO 1: PREVIEW — execute ANTES para ver o que será afetado ─────────────
-- (Não modifica nada — apenas exibe as duplicatas encontradas)

SELECT
  'CNPJ duplicado' AS motivo,
  regexp_replace(cnpj, '\D', '', 'g') AS chave,
  count(*) AS qtd_registros,
  string_agg(nome || ' [criado: ' || criado_em::date::text || ']', ' | ' ORDER BY criado_em ASC) AS profissionais
FROM salao_profissionais
WHERE cnpj IS NOT NULL AND trim(cnpj) <> ''
  AND length(regexp_replace(cnpj, '\D', '', 'g')) >= 11
GROUP BY regexp_replace(cnpj, '\D', '', 'g')
HAVING count(*) > 1

UNION ALL

SELECT
  'Nome duplicado' AS motivo,
  lower(trim(nome)) AS chave,
  count(*) AS qtd_registros,
  string_agg(nome || ' [criado: ' || criado_em::date::text || ']', ' | ' ORDER BY criado_em ASC) AS profissionais
FROM salao_profissionais
GROUP BY lower(trim(nome))
HAVING count(*) > 1

ORDER BY motivo, chave;

-- ── BLOCO 2: LIMPEZA PRINCIPAL ───────────────────────────────────────────────
-- (Só execute após revisar o BLOCO 1 acima)

BEGIN;

-- Step 1: keeper por CNPJ (o registro mais antigo de cada CNPJ)
CREATE TEMP TABLE _keep_cnpj AS
SELECT DISTINCT ON (regexp_replace(cnpj, '\D', '', 'g'))
  id          AS keep_id,
  regexp_replace(cnpj, '\D', '', 'g') AS cnpj_digits
FROM salao_profissionais
WHERE cnpj IS NOT NULL AND trim(cnpj) <> ''
  AND length(regexp_replace(cnpj, '\D', '', 'g')) >= 11
ORDER BY regexp_replace(cnpj, '\D', '', 'g'), criado_em ASC, id ASC;

-- Step 2: duplicatas por CNPJ (todos que NÃO são o keeper)
CREATE TEMP TABLE _dups_cnpj AS
SELECT p.id AS dup_id, k.keep_id
FROM salao_profissionais p
JOIN _keep_cnpj k ON k.cnpj_digits = regexp_replace(p.cnpj, '\D', '', 'g')
WHERE p.id <> k.keep_id;

-- Step 3: keeper por nome (excluindo os que já serão deletados)
CREATE TEMP TABLE _keep_nome AS
SELECT DISTINCT ON (lower(trim(nome)))
  id          AS keep_id,
  lower(trim(nome)) AS nome_norm
FROM salao_profissionais
WHERE id NOT IN (SELECT dup_id FROM _dups_cnpj)
ORDER BY lower(trim(nome)), criado_em ASC, id ASC;

-- Step 4: duplicatas por nome (excluindo IDs já marcados por CNPJ)
CREATE TEMP TABLE _dups_nome AS
SELECT p.id AS dup_id, k.keep_id
FROM salao_profissionais p
JOIN _keep_nome k ON k.nome_norm = lower(trim(p.nome))
WHERE p.id <> k.keep_id
  AND p.id NOT IN (SELECT dup_id FROM _dups_cnpj);

-- Step 5: tabela unificada de todas as duplicatas
CREATE TEMP TABLE _todos_dups AS
SELECT dup_id, keep_id, 'cnpj' AS motivo FROM _dups_cnpj
UNION ALL
SELECT dup_id, keep_id, 'nome' AS motivo FROM _dups_nome;

-- Preview do que será removido (para log antes de deletar):
SELECT
  d.motivo,
  dup.nome   AS duplicata_nome,
  dup.cnpj   AS duplicata_cnpj,
  dup.criado_em AS duplicata_criado_em,
  keep.nome  AS mantido_nome,
  keep.cnpj  AS mantido_cnpj,
  keep.criado_em AS mantido_criado_em
FROM _todos_dups d
JOIN salao_profissionais dup  ON dup.id  = d.dup_id
JOIN salao_profissionais keep ON keep.id = d.keep_id
ORDER BY d.motivo, keep.nome;

-- Step 6: redirecionar FK em salao_nf_registros
UPDATE salao_nf_registros nf
SET profissional_id = d.keep_id
FROM _todos_dups d
WHERE nf.profissional_id = d.dup_id;

-- Step 7: mover vínculos de empresa sem conflito
UPDATE salao_profissional_empresa pe
SET profissional_id = d.keep_id
FROM _todos_dups d
WHERE pe.profissional_id = d.dup_id
  AND NOT EXISTS (
    SELECT 1 FROM salao_profissional_empresa pe2
    WHERE pe2.profissional_id = d.keep_id
      AND pe2.empresa_id = pe.empresa_id
  );

-- Step 8: deletar vínculos residuais que colidem (já existem no keep)
DELETE FROM salao_profissional_empresa pe
USING _todos_dups d
WHERE pe.profissional_id = d.dup_id;

-- Step 9: deletar profissionais duplicados
DELETE FROM salao_profissionais
WHERE id IN (SELECT dup_id FROM _todos_dups);

-- Limpeza das tabelas temporárias
DROP TABLE _todos_dups;
DROP TABLE _dups_nome;
DROP TABLE _keep_nome;
DROP TABLE _dups_cnpj;
DROP TABLE _keep_cnpj;

COMMIT;

-- ── BLOCO 3: VERIFICAÇÃO PÓS-LIMPEZA ────────────────────────────────────────
-- Execute após o BLOCO 2 para confirmar que não restam duplicatas.
-- Ambas as queries devem retornar 0 linhas.

SELECT 'Duplicatas restantes por CNPJ' AS verificacao, count(*) AS qtd
FROM (
  SELECT regexp_replace(cnpj, '\D', '', 'g') AS chave
  FROM salao_profissionais
  WHERE cnpj IS NOT NULL AND trim(cnpj) <> ''
  GROUP BY 1 HAVING count(*) > 1
) s

UNION ALL

SELECT 'Duplicatas restantes por nome' AS verificacao, count(*) AS qtd
FROM (
  SELECT lower(trim(nome)) AS chave
  FROM salao_profissionais
  GROUP BY 1 HAVING count(*) > 1
) s;

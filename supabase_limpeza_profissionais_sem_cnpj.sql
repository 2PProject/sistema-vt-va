-- ============================================================
-- SCRIPT: Limpeza de profissionais sem CNPJ + coluna especialidade
-- Tabela: salao_profissionais
--
-- EXECUTAR NO SQL EDITOR DO SUPABASE (Dashboard → SQL Editor)
--
-- Objetivo:
--   A) Adicionar coluna `especialidade` (usada pela tela de Profissionais)
--   B) Remover profissionais SEM CNPJ (registros inválidos gerados pela
--      importação antiga), preservando apenas os válidos e vinculados.
--
-- ORDEM RECOMENDADA:
--   1. Rode o BLOCO A (coluna especialidade) — seguro, idempotente.
--   2. Rode o BLOCO B (PREVIEW) para ver o que será removido.
--   3. Só então rode o BLOCO C (limpeza), dentro de transação.
--   4. Rode o BLOCO D para verificar.
-- ============================================================


-- ── BLOCO A: Coluna especialidade (idempotente) ─────────────────────────────
ALTER TABLE salao_profissionais
  ADD COLUMN IF NOT EXISTS especialidade TEXT;


-- ── BLOCO B: PREVIEW — profissionais SEM CNPJ (não remove nada) ─────────────
-- Critério de "sem CNPJ": cnpj nulo, vazio ou com menos de 14 dígitos.
SELECT
  p.id,
  p.nome,
  p.cnpj,
  p.cpf,
  p.criado_em::date AS cadastrado_em,
  (SELECT count(*) FROM salao_profissional_empresa pe WHERE pe.profissional_id = p.id) AS vinculos,
  (SELECT count(*) FROM salao_nf_registros nf WHERE nf.profissional_id = p.id)         AS registros_nf
FROM salao_profissionais p
WHERE p.cnpj IS NULL
   OR trim(p.cnpj) = ''
   OR length(regexp_replace(p.cnpj, '\D', '', 'g')) < 14
ORDER BY p.nome;

-- (Informativo) Profissionais COM CNPJ porém SEM nenhum vínculo de empresa.
-- Não serão removidos pelo bloco C — revise manualmente se desejar.
SELECT p.id, p.nome, p.cnpj, p.criado_em::date AS cadastrado_em
FROM salao_profissionais p
WHERE coalesce(trim(p.cnpj), '') <> ''
  AND length(regexp_replace(p.cnpj, '\D', '', 'g')) >= 14
  AND NOT EXISTS (
    SELECT 1 FROM salao_profissional_empresa pe
    WHERE pe.profissional_id = p.id AND coalesce(pe.ativo, true) = true
  )
ORDER BY p.nome;


-- ── BLOCO C: LIMPEZA — remove profissionais sem CNPJ e seus dependentes ─────
-- ATENÇÃO: remove também os registros de NF e confirmações desses profissionais
-- (são dados inválidos gerados pela importação antiga). Revise o BLOCO B antes.

BEGIN;

-- IDs alvo (sem CNPJ válido)
CREATE TEMP TABLE _alvo AS
SELECT id
FROM salao_profissionais
WHERE cnpj IS NULL
   OR trim(cnpj) = ''
   OR length(regexp_replace(cnpj, '\D', '', 'g')) < 14;

-- Registros NF desses profissionais
CREATE TEMP TABLE _alvo_registros AS
SELECT id FROM salao_nf_registros WHERE profissional_id IN (SELECT id FROM _alvo);

-- 1. Histórico das NFs alvo
DELETE FROM salao_nf_historico
WHERE registro_id IN (SELECT id FROM _alvo_registros);

-- 2. Confirmações das NFs alvo
DELETE FROM salao_nf_confirmacoes
WHERE registro_id IN (SELECT id FROM _alvo_registros);

-- 3. Registros de NF
DELETE FROM salao_nf_registros
WHERE id IN (SELECT id FROM _alvo_registros);

-- 4. Vínculos profissional–empresa
DELETE FROM salao_profissional_empresa
WHERE profissional_id IN (SELECT id FROM _alvo);

-- 5. Profissionais sem CNPJ
DELETE FROM salao_profissionais
WHERE id IN (SELECT id FROM _alvo);

DROP TABLE _alvo_registros;
DROP TABLE _alvo;

COMMIT;


-- ── BLOCO D: VERIFICAÇÃO PÓS-LIMPEZA ────────────────────────────────────────
-- Deve retornar 0.
SELECT count(*) AS profissionais_sem_cnpj_restantes
FROM salao_profissionais
WHERE cnpj IS NULL
   OR trim(cnpj) = ''
   OR length(regexp_replace(cnpj, '\D', '', 'g')) < 14;

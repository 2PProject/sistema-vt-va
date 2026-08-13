-- ============================================================
-- MÓDULO SALÃO — v6: exceções, exclusão lógica de notas, histórico
-- unificado e ciclo de vida da competência.
-- Rode APÓS supabase_salao.sql, _v2, _v3, _v4 e _v5. Idempotente.
-- Mantém compatibilidade total com os dados atuais (só adiciona).
-- ============================================================

-- ── Notas: exclusão lógica + marcação de duplicidade ───────────────────────
ALTER TABLE salon_notas ADD COLUMN IF NOT EXISTS excluida       boolean NOT NULL DEFAULT false;
ALTER TABLE salon_notas ADD COLUMN IF NOT EXISTS excluida_motivo text;
ALTER TABLE salon_notas ADD COLUMN IF NOT EXISTS excluida_por    text;
ALTER TABLE salon_notas ADD COLUMN IF NOT EXISTS excluida_em     timestamptz;
ALTER TABLE salon_notas ADD COLUMN IF NOT EXISTS duplicada       boolean NOT NULL DEFAULT false;
ALTER TABLE salon_notas ADD COLUMN IF NOT EXISTS observacao      text;

CREATE INDEX IF NOT EXISTS idx_salon_notas_competencia ON salon_notas(competencia);
CREATE INDEX IF NOT EXISTS idx_salon_notas_documento   ON salon_notas(documento);
CREATE INDEX IF NOT EXISTS idx_salon_notas_excluida    ON salon_notas(excluida);

-- ── Comissões: marca correção manual (classificação "Corrigido manualmente") ─
ALTER TABLE salon_comissoes ADD COLUMN IF NOT EXISTS corrigido_manual boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_salon_com_mesref  ON salon_comissoes(mes_ref);
CREATE INDEX IF NOT EXISTS idx_salon_com_empresa ON salon_comissoes(empresa_id);

-- ── Histórico UNIFICADO (edições, vínculos, exclusões, fechamento, etc.) ────
CREATE TABLE IF NOT EXISTS salon_historico (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo           text NOT NULL,                 -- 'comissao' | 'nota' | 'competencia'
  ref_id         text,                          -- id do registro (uuid) ou competência (YYYY-MM)
  empresa_id     uuid,
  competencia    text,
  acao           text NOT NULL,                 -- edicao, exclusao, restauracao, vinculo, desvinculo, correcao_competencia, reprocessamento, fechamento, reabertura...
  valor_anterior jsonb,
  valor_novo     jsonb,
  usuario        text,
  justificativa  text,
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_salon_hist_tipo_ref ON salon_historico(tipo, ref_id);
CREATE INDEX IF NOT EXISTS idx_salon_hist_comp     ON salon_historico(competencia);
CREATE INDEX IF NOT EXISTS idx_salon_hist_criado   ON salon_historico(criado_em DESC);

-- ── Ciclo de vida da competência (por empresa; empresa_id NULL = geral) ─────
CREATE TABLE IF NOT EXISTS salon_competencia_status (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competencia   text NOT NULL,
  empresa_id    uuid,                            -- NULL = status geral da competência
  status        text NOT NULL DEFAULT 'em_preparacao',
    -- em_preparacao | importada | em_conferencia | com_pendencias | pronta | fechada | reaberta
  totais        jsonb,                           -- congela os números no fechamento
  usuario       text,
  justificativa text,
  fechado_em    timestamptz,
  reaberto_em   timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_salon_comp_status ON salon_competencia_status(competencia, COALESCE(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid));

SELECT 'v6 aplicada' AS status,
  (SELECT count(*) FROM salon_notas)      AS notas,
  (SELECT count(*) FROM salon_comissoes)  AS comissoes;

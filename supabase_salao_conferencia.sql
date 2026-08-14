-- Módulo Salão — evolução incremental da conferência de NFS-e
-- Executar após supabase_salao.sql e supabase_salao_v2.sql.

ALTER TABLE salon_comissoes
  ADD COLUMN IF NOT EXISTS profissional_nome text,
  ADD COLUMN IF NOT EXISTS profissional_documento text,
  ADD COLUMN IF NOT EXISTS observacao text,
  ADD COLUMN IF NOT EXISTS classificacao text NOT NULL DEFAULT 'sem_nota',
  ADD COLUMN IF NOT EXISTS confianca_vinculo integer,
  ADD COLUMN IF NOT EXISTS justificativa_vinculo text,
  ADD COLUMN IF NOT EXISTS nota_id uuid REFERENCES salon_notas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS atualizado_em timestamptz NOT NULL DEFAULT now();

UPDATE salon_comissoes c
SET profissional_nome = COALESCE(c.profissional_nome, p.nome),
    profissional_documento = COALESCE(c.profissional_documento, p.documento)
FROM salon_professionals p
WHERE c.profissional_id = p.id
  AND (c.profissional_nome IS NULL OR c.profissional_documento IS NULL);

ALTER TABLE salon_comissoes ALTER COLUMN profissional_id DROP NOT NULL;

ALTER TABLE salon_notas
  ADD COLUMN IF NOT EXISTS observacao text,
  ADD COLUMN IF NOT EXISTS excluida_em timestamptz,
  ADD COLUMN IF NOT EXISTS excluida_por text,
  ADD COLUMN IF NOT EXISTS exclusao_motivo text,
  ADD COLUMN IF NOT EXISTS duplicada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS atualizado_em timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS salon_competencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mes_ref text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'em_preparacao'
    CHECK (status IN ('em_preparacao','importada','em_conferencia','com_pendencias','pronta_fechamento','fechada','reaberta')),
  totais_fechamento jsonb,
  fechada_em timestamptz,
  fechada_por text,
  reaberta_em timestamptz,
  reaberta_por text,
  justificativa_reabertura text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS salon_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entidade text NOT NULL,
  registro_id uuid,
  acao text NOT NULL,
  valor_anterior jsonb,
  valor_novo jsonb,
  usuario text,
  justificativa text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salon_com_mes_class ON salon_comissoes(mes_ref, classificacao);
CREATE INDEX IF NOT EXISTS idx_salon_com_doc ON salon_comissoes(profissional_documento);
CREATE INDEX IF NOT EXISTS idx_salon_com_nota ON salon_comissoes(nota_id);
CREATE INDEX IF NOT EXISTS idx_salon_notas_comp_ativa ON salon_notas(competencia, empresa_id) WHERE excluida_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_salon_notas_doc_ativa ON salon_notas(documento) WHERE excluida_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_salon_auditoria_registro ON salon_auditoria(entidade, registro_id, criado_em DESC);

CREATE OR REPLACE FUNCTION salon_validar_documento(documento text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT length(regexp_replace(coalesce(documento,''), '\D', '', 'g')) IN (11,14);
$$;

COMMENT ON COLUMN salon_comissoes.profissional_nome IS 'Nome importado da planilha mensal; não depende de cadastro separado.';
COMMENT ON COLUMN salon_comissoes.profissional_documento IS 'CPF/CNPJ importado da planilha mensal.';
COMMENT ON TABLE salon_auditoria IS 'Histórico unificado de alterações do módulo Salão.';

-- ============================================================
-- MÓDULO SALÃO — v2: armazenamento das NOTAS RECEBIDAS do gov.br (ADN)
-- Rode APÓS o supabase_salao.sql. Guarda as NFS-e recebidas trazidas pela
-- sincronização, para consulta por período. Sem segredos (legível pelo app).
-- ============================================================
CREATE TABLE IF NOT EXISTS salon_notas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nsu            bigint,
  chave          text,
  documento      text,                    -- emitente (prestador): CNPJ/CPF (dígitos)
  emitente_nome  text,                     -- xNome do emitente
  numero         text,
  valor          numeric,
  data_emissao   date,                     -- dhProc
  competencia    text,                     -- 'YYYY-MM' (dCompet)
  criado_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, nsu)
);
CREATE INDEX IF NOT EXISTS idx_salon_notas_emp ON salon_notas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_salon_notas_data ON salon_notas(data_emissao);
CREATE INDEX IF NOT EXISTS idx_salon_notas_doc ON salon_notas(documento);

SELECT 'salon_notas' AS tabela, count(*) FROM salon_notas;

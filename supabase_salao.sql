-- ============================================================
-- MÓDULO SALÃO — Controle de NFS-e (isolado / reversível)
-- Todas as tabelas usam o prefixo salon_ e referenciam a tabela
-- existente `empresas`. Para remover o módulo por completo, rode
-- supabase_salao_rollback.sql.
-- Executar no SQL Editor do Supabase.
-- ============================================================

-- Config por empresa (SEM segredos): prazo de emissão. Legível pelo frontend.
CREATE TABLE IF NOT EXISTS salon_empresa_config (
  empresa_id    uuid PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  prazo_dia     int NOT NULL DEFAULT 10,          -- dia do mês seguinte (limite)
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- Certificado A1 por empresa — CONTÉM SEGREDOS (pfx/senha). Protegido por RLS
-- SEM policy: só a service_role (rotas de servidor) acessa. O frontend recebe
-- apenas metadados (nome/validade) via API, nunca o pfx nem a senha.
CREATE TABLE IF NOT EXISTS salon_certificados (
  empresa_id     uuid PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  cert_nome      text,                            -- titular do certificado
  cert_cnpj      text,                            -- CNPJ do certificado (dígitos)
  cert_validade  date,                            -- validade do A1
  cert_pfx_b64   text,                            -- .pfx em base64 (server-only)
  cert_senha_enc text,                            -- senha criptografada (AES-GCM)
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE salon_certificados ENABLE ROW LEVEL SECURITY;  -- sem policy = só service_role

-- Profissionais (autônomos) por empresa. Reaproveita `empresas` do sistema.
CREATE TABLE IF NOT EXISTS salon_professionals (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  documento  text NOT NULL,                       -- CPF/CNPJ (só dígitos)
  ativo      boolean NOT NULL DEFAULT true,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, documento)
);
CREATE INDEX IF NOT EXISTS idx_salon_prof_empresa ON salon_professionals(empresa_id);

-- Comissões importadas por mês + status da NFS-e do profissional.
CREATE TABLE IF NOT EXISTS salon_comissoes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  profissional_id uuid NOT NULL REFERENCES salon_professionals(id) ON DELETE CASCADE,
  mes_ref         text NOT NULL,                  -- 'YYYY-MM' (imutável após importar)
  valor_comissao  numeric NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'pendente', -- pendente | recebida | fora_prazo
  nf_numero       text,
  nf_data         date,
  nf_valor        numeric,
  nf_origem       text,                            -- 'adn' | 'manual'
  confirmado_em   timestamptz,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, profissional_id, mes_ref)
);
CREATE INDEX IF NOT EXISTS idx_salon_com_empresa_mes ON salon_comissoes(empresa_id, mes_ref);
CREATE INDEX IF NOT EXISTS idx_salon_com_status ON salon_comissoes(status);

-- Log de ações (confirmações, substituições, sync).
CREATE TABLE IF NOT EXISTS salon_comissoes_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comissao_id uuid REFERENCES salon_comissoes(id) ON DELETE CASCADE,
  acao        text NOT NULL,
  detalhe     text,
  usuario     text,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_salon_log_comissao ON salon_comissoes_log(comissao_id);

-- Ponto de sincronização (NSU) por empresa. Server-only (RLS sem policy).
CREATE TABLE IF NOT EXISTS salon_nfse_sync (
  empresa_id  uuid PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  ultimo_nsu  bigint NOT NULL DEFAULT 0,
  ultima_sync timestamptz
);
ALTER TABLE salon_nfse_sync ENABLE ROW LEVEL SECURITY;  -- sem policy = só service_role

-- Conferência
SELECT 'salon_empresa_config' AS tabela, count(*) FROM salon_empresa_config
UNION ALL SELECT 'salon_certificados', count(*) FROM salon_certificados
UNION ALL SELECT 'salon_professionals', count(*) FROM salon_professionals
UNION ALL SELECT 'salon_comissoes', count(*) FROM salon_comissoes
UNION ALL SELECT 'salon_comissoes_log', count(*) FROM salon_comissoes_log
UNION ALL SELECT 'salon_nfse_sync', count(*) FROM salon_nfse_sync;

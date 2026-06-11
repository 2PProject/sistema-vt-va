-- ============================================================
-- Sistema VT/VA – Migração Completa
-- Execute este script no Supabase SQL Editor
-- ============================================================

-- EMPRESAS
CREATE TABLE IF NOT EXISTS empresas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  razao_social TEXT NOT NULL,
  cnpj TEXT,
  criado_em TIMESTAMPTZ DEFAULT now()
);

-- UNIDADES
CREATE TABLE IF NOT EXISTS unidades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  codigo TEXT,
  criado_em TIMESTAMPTZ DEFAULT now()
);

-- FUNCIONÁRIOS
CREATE TABLE IF NOT EXISTS funcionarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  ctps TEXT,
  serie TEXT,
  funcao TEXT,
  unidade_id UUID REFERENCES unidades(id),
  folga_semanal TEXT DEFAULT 'so_domingo',
  valor_vt NUMERIC(10,2),
  valor_vt_sabado NUMERIC(10,2),
  valor_va NUMERIC(10,2),
  data_admissao DATE,
  em_aviso_previo BOOLEAN DEFAULT FALSE,
  data_inicio_aviso DATE,
  data_fim_aviso DATE,
  criado_em TIMESTAMPTZ DEFAULT now()
);

-- COMPETÊNCIAS
CREATE TABLE IF NOT EXISTS competencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade_id UUID REFERENCES unidades(id) ON DELETE CASCADE,
  mes INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  ano INTEGER NOT NULL,
  dias_uteis INTEGER,
  sabados_trabalhados INTEGER DEFAULT 0,
  feriados_datas TEXT[] DEFAULT '{}',
  valor_va_dia NUMERIC(10,2),
  criado_em TIMESTAMPTZ DEFAULT now(),
  UNIQUE (unidade_id, mes, ano)
);

-- COMPETÊNCIA_FUNCIONÁRIO
CREATE TABLE IF NOT EXISTS competencia_funcionario (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competencia_id UUID REFERENCES competencias(id) ON DELETE CASCADE,
  funcionario_id UUID REFERENCES funcionarios(id) ON DELETE CASCADE,
  faltas INTEGER DEFAULT 0,
  descontos JSONB DEFAULT '[]',
  valor_vt_total NUMERIC(10,2) DEFAULT 0,
  valor_va_total NUMERIC(10,2) DEFAULT 0,
  UNIQUE (competencia_id, funcionario_id)
);

-- ============================================================
-- MÓDULO SALÃO – Controle de Notas Fiscais de Profissionais
-- ============================================================

-- PROFISSIONAIS (autônomos do salão)
CREATE TABLE IF NOT EXISTS salao_profissionais (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  cpf TEXT,
  email TEXT,
  telefone TEXT,
  ativo BOOLEAN DEFAULT TRUE,
  criado_em TIMESTAMPTZ DEFAULT now()
);

-- VÍNCULO PROFISSIONAL <-> EMPRESA
CREATE TABLE IF NOT EXISTS salao_profissional_empresa (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profissional_id UUID REFERENCES salao_profissionais(id) ON DELETE CASCADE,
  empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
  ativo BOOLEAN DEFAULT TRUE,
  UNIQUE (profissional_id, empresa_id)
);

-- REGISTROS DE NF (um por profissional/empresa/mês)
CREATE TABLE IF NOT EXISTS salao_nf_registros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profissional_id UUID REFERENCES salao_profissionais(id) ON DELETE CASCADE,
  empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
  mes_referencia TEXT NOT NULL,  -- 'YYYY-MM'
  valor_comissao NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'nf_recebida', 'fora_do_prazo')),
  criado_em TIMESTAMPTZ DEFAULT now(),
  atualizado_em TIMESTAMPTZ DEFAULT now(),
  UNIQUE (profissional_id, empresa_id, mes_referencia)
);

-- CONFIRMAÇÕES DE NF
CREATE TABLE IF NOT EXISTS salao_nf_confirmacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registro_id UUID REFERENCES salao_nf_registros(id) ON DELETE CASCADE,
  numero_nf TEXT NOT NULL,
  data_nf DATE NOT NULL,
  valor_nf NUMERIC(10,2) NOT NULL,
  confirmado_por TEXT,
  confirmado_em TIMESTAMPTZ DEFAULT now(),
  UNIQUE (registro_id)
);

-- HISTÓRICO / AUDITORIA
CREATE TABLE IF NOT EXISTS salao_nf_historico (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registro_id UUID REFERENCES salao_nf_registros(id) ON DELETE CASCADE,
  acao TEXT NOT NULL,
  descricao TEXT,
  dados_anteriores JSONB,
  dados_novos JSONB,
  usuario TEXT,
  criado_em TIMESTAMPTZ DEFAULT now()
);

-- CONFIGURAÇÃO POR EMPRESA (prazo e tolerância)
CREATE TABLE IF NOT EXISTS salao_config_empresa (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
  dia_prazo INTEGER NOT NULL DEFAULT 10 CHECK (dia_prazo BETWEEN 1 AND 31),
  tolerancia_valor NUMERIC(10,2) NOT NULL DEFAULT 0.01,
  UNIQUE (empresa_id)
);

-- ============================================================
-- Adicionar colunas se já existem as tabelas (migração incremental)
-- ============================================================
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS data_admissao DATE;
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS em_aviso_previo BOOLEAN DEFAULT FALSE;
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS data_inicio_aviso DATE;
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS data_fim_aviso DATE;
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS valor_vt_sabado NUMERIC(10,2);

-- ============================================================
-- Índices para performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_competencias_mes_ano ON competencias(mes, ano);
CREATE INDEX IF NOT EXISTS idx_cf_competencia ON competencia_funcionario(competencia_id);
CREATE INDEX IF NOT EXISTS idx_nf_registros_mes ON salao_nf_registros(mes_referencia);
CREATE INDEX IF NOT EXISTS idx_nf_registros_status ON salao_nf_registros(status);
CREATE INDEX IF NOT EXISTS idx_nf_historico_registro ON salao_nf_historico(registro_id);

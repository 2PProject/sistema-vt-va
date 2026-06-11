-- ============================================================
-- FIX: Desabilitar RLS nas tabelas do sistema VT/VA
--
-- Problema: tabelas criadas pelo Table Editor do Supabase têm
-- Row Level Security (RLS) ativada por padrão, sem nenhuma
-- policy de leitura — o resultado é [] sem erro, como se não
-- houvesse dados.
--
-- Executar no SQL Editor do Supabase uma única vez.
-- ============================================================

ALTER TABLE empresas              DISABLE ROW LEVEL SECURITY;
ALTER TABLE unidades              DISABLE ROW LEVEL SECURITY;
ALTER TABLE funcionarios          DISABLE ROW LEVEL SECURITY;
ALTER TABLE competencias          DISABLE ROW LEVEL SECURITY;
ALTER TABLE feriados              DISABLE ROW LEVEL SECURITY;
ALTER TABLE tipos_desconto        DISABLE ROW LEVEL SECURITY;

-- tabelas de desconto (nome pode variar — ajuste se necessário)
ALTER TABLE IF EXISTS competencia_funcionario              DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS competencia_funcionario_desconto     DISABLE ROW LEVEL SECURITY;

-- módulo salão
ALTER TABLE IF EXISTS salao_profissionais                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS salao_profissional_empresa           DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS salao_nf_registros                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS salao_nf_confirmacoes                DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS salao_nf_historico                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS salao_config_empresa                 DISABLE ROW LEVEL SECURITY;

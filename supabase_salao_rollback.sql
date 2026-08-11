-- ============================================================
-- ROLLBACK DO MÓDULO SALÃO — remove TODAS as tabelas do módulo.
-- Não afeta nenhuma tabela do sistema de VT/VA (empresas, funcionarios, etc).
-- ============================================================
DROP TABLE IF EXISTS salon_notas         CASCADE;
DROP TABLE IF EXISTS salon_comissoes_log CASCADE;
DROP TABLE IF EXISTS salon_comissoes     CASCADE;
DROP TABLE IF EXISTS salon_professionals CASCADE;
DROP TABLE IF EXISTS salon_nfse_sync     CASCADE;
DROP TABLE IF EXISTS salon_certificados  CASCADE;
DROP TABLE IF EXISTS salon_empresa_config CASCADE;

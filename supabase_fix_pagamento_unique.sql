-- ============================================================
-- SCRIPT: Índice único em pagamento_registros (funcionario_id, mes_referencia)
-- A tabela foi criada em versão anterior sem essa unicidade. O app já
-- funciona sem ela (importa apagando e reinserindo o mês), mas o índice
-- evita registros duplicados por profissional/competência.
-- Executar no SQL Editor do Supabase. Seguro e idempotente.
-- ============================================================

-- 1) Remove eventuais duplicados, mantendo o mais recente
DELETE FROM pagamento_registros a
USING pagamento_registros b
WHERE a.funcionario_id = b.funcionario_id
  AND a.mes_referencia = b.mes_referencia
  AND a.ctid < b.ctid;

-- 2) Cria o índice único (idempotente)
CREATE UNIQUE INDEX IF NOT EXISTS pagamento_registros_func_mes_uk
  ON pagamento_registros (funcionario_id, mes_referencia);

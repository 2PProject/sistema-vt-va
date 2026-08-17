-- ============================================================
-- MÓDULO SALÃO — v16: índices de performance (pente-fino)
-- Rode após os anteriores. Idempotente. Só cria índices (não altera dados).
-- ============================================================

-- Filtro por competência de conferência (o ramo competencia_conf do OR em
-- notasDaCompetencia fazia seq scan — competencia já tinha índice, conf não).
CREATE INDEX IF NOT EXISTS idx_salon_notas_competencia_conf ON salon_notas(competencia_conf);

-- Reconciliação e consulta filtram muito "mes_ref = X AND nota_id IS NULL".
-- Índice PARCIAL acelera a varredura de pendentes.
CREATE INDEX IF NOT EXISTS idx_salon_com_pendentes ON salon_comissoes(mes_ref, empresa_id) WHERE nota_id IS NULL;

-- Junção M:N consultada por nota (notasUsadas) e por comissão (vínculos da linha).
CREATE INDEX IF NOT EXISTS idx_salon_comissao_notas_nota ON salon_comissao_notas(nota_id);
CREATE INDEX IF NOT EXISTS idx_salon_comissao_notas_comissao ON salon_comissao_notas(comissao_id);

-- Notas por documento + competência (candidatas de casamento por CNPJ no mês).
CREATE INDEX IF NOT EXISTS idx_salon_notas_doc_comp ON salon_notas(documento, competencia);

SELECT 'v16 índices aplicados' AS status;

-- ─── Aviso Prévio: colunas na tabela funcionarios ────────────────────────────
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS em_aviso_previo  BOOLEAN DEFAULT FALSE;
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS data_inicio_aviso DATE;
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS data_fim_aviso    DATE;

COMMENT ON COLUMN funcionarios.em_aviso_previo    IS 'Indica que o funcionário está cumprindo aviso prévio.';
COMMENT ON COLUMN funcionarios.data_inicio_aviso  IS 'Data de início do aviso prévio.';
COMMENT ON COLUMN funcionarios.data_fim_aviso     IS 'Último dia de trabalho (aviso prévio). VT/VA calculado proporcionalmente até esta data.';

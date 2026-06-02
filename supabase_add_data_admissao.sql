-- Adiciona coluna data_admissao na tabela funcionarios
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS data_admissao DATE;

-- Comentário explicativo
COMMENT ON COLUMN funcionarios.data_admissao IS 'Data de admissão do funcionário. Usada para calcular dias proporcionais no mês de contratação.';

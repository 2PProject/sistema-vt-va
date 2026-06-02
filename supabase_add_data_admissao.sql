-- ─── 1. Adiciona coluna data_admissao ────────────────────────────────────────
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS data_admissao DATE;

COMMENT ON COLUMN funcionarios.data_admissao IS
  'Data de admissão do funcionário. Usada para calcular dias proporcionais no mês de contratação.';

-- ─── 2. Preenche funcionários sem data_admissao ───────────────────────────────
-- Usa created_at (coluna padrão do Supabase) se existir, caso contrário usa hoje.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'funcionarios'
      AND column_name  = 'created_at'
  ) THEN
    -- Usa a data em que o registro foi inserido no banco
    UPDATE funcionarios
    SET    data_admissao = created_at::date
    WHERE  data_admissao IS NULL;
  ELSE
    -- Coluna created_at não existe: usa a data de hoje como fallback
    UPDATE funcionarios
    SET    data_admissao = CURRENT_DATE
    WHERE  data_admissao IS NULL;
  END IF;
END $$;

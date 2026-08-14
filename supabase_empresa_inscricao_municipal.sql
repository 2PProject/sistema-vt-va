-- Cadastro fiscal da empresa para integrações municipais.
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS inscricao_municipal text;

UPDATE empresas SET inscricao_municipal = CASE regexp_replace(cnpj, '\D', '', 'g')
  WHEN '47837512000170' THEN '0816355100107'
  WHEN '17707344000138' THEN '0763624900153'
  WHEN '45161922000119' THEN '0811368300109'
  ELSE inscricao_municipal
END
WHERE regexp_replace(cnpj, '\D', '', 'g') IN ('47837512000170','17707344000138','45161922000119');

COMMENT ON COLUMN empresas.inscricao_municipal IS 'Inscrição municipal/CF-DF usada nas integrações de NFS-e';

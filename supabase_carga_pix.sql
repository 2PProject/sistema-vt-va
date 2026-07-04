-- ============================================================
-- CARGA DE CHAVE PIX NO CADASTRO (funcionarios.pix)
-- Requer: coluna pix em funcionarios (supabase_add_pix_funcionario.sql).
-- CPF e telefone entram SEM formatacao (apenas digitos); e-mail e chave
-- aleatoria (UUID) sao mantidos como estao.
-- O funcionario e casado pelo NOME (ignorando maiusculas/acentos/espacos).
-- ============================================================

CREATE OR REPLACE FUNCTION pg_temp.norm(txt text) RETURNS text AS $$
  SELECT btrim(lower(translate(coalesce($1,''),
    'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüý',
    'AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuy')));
$$ LANGUAGE sql IMMUTABLE;

-- ── BLOCO 1 — CONFERENCIA (rode antes): confirme 1 funcionario por nome ──────
SELECT d.nome AS nome_planilha, d.apelido AS unidade, d.pix,
       f.id AS funcionario_id, f.nome AS funcionario, e.apelido AS empresa_apelido
FROM (VALUES
    ('FRANCISCA NUNES MOTA', '11', '30265878349'),
    ('ISABELE LOUISE DOS SANTOS NASCIMENTO', '11', '07714263300'),
    ('KAROLINY KELEN CASTRO CARVALHO', '11', '05528446163'),
    ('ROSEANE ALVES SILVA', '11', '06211175361'),
    ('SILENE DOS SANTOS SOARES', '11', '06762420303'),
    ('WILLIAN PEREIRA DE SOUSA', '11', '10870637444'),
    ('CRISTIANE TEIXEIRA DA SILVA', '304', '94008035168'),
    ('JANAINA MOTA DE OLIVEIRA', '304', '06910879112'),
    ('JOAO VITOR LOPES HENRIQUE', '304', '61982361758'),
    ('MARIA AMELIA DA SILVA CAMPOS', '304', '61981663972'),
    ('MARLENE TEIXEIRA DOS SANTOS PRATES', '304', '01955100110'),
    ('PALOMA DUARTE GOMES', '304', 'p-duartegomes@hotmail.com'),
    ('JESSICA MENDES DA SILVA', '23', '61993758280'),
    ('LAURA DANIELLE GONÇALVES BRANDÃO', '23', '61999172554'),
    ('TONILZA LIRA CENA', '23', '72286385149'),
    ('ARITANA MAIA DA SILVA', '403-SUL', '61999551101'),
    ('GABRIELA RODRIGUES DE MELO', '403-SUL', '07588967196'),
    ('JOSELINA ANDRADE ARAUJO', '403-SUL', '71531300120'),
    ('LUCILENE DA SILVA MELO', '403-SUL', '61985954142'),
    ('ANA KAROLINE DE SOUSA LIMA', '403-NORTE', '9da02cad-38f6-4d09-8e34-679f0ec30cf2'),
    ('MIRIA DE SOUZA MOURA', '403-NORTE', '09164683133'),
    ('CONCEICAO ALAIDE GONCALVES BRANDAO', '210', '61991415342')
) AS d(nome, apelido, pix)
LEFT JOIN funcionarios f ON pg_temp.norm(f.nome) = pg_temp.norm(d.nome)
LEFT JOIN unidades u ON u.id = f.unidade_id
LEFT JOIN empresas e ON e.id = u.empresa_id
ORDER BY d.apelido, d.nome;

-- ── BLOCO 2 — CARGA (rode apos conferir o BLOCO 1) ──────────────────────────
UPDATE funcionarios f
SET pix = d.pix
FROM (VALUES
    ('FRANCISCA NUNES MOTA', '11', '30265878349'),
    ('ISABELE LOUISE DOS SANTOS NASCIMENTO', '11', '07714263300'),
    ('KAROLINY KELEN CASTRO CARVALHO', '11', '05528446163'),
    ('ROSEANE ALVES SILVA', '11', '06211175361'),
    ('SILENE DOS SANTOS SOARES', '11', '06762420303'),
    ('WILLIAN PEREIRA DE SOUSA', '11', '10870637444'),
    ('CRISTIANE TEIXEIRA DA SILVA', '304', '94008035168'),
    ('JANAINA MOTA DE OLIVEIRA', '304', '06910879112'),
    ('JOAO VITOR LOPES HENRIQUE', '304', '61982361758'),
    ('MARIA AMELIA DA SILVA CAMPOS', '304', '61981663972'),
    ('MARLENE TEIXEIRA DOS SANTOS PRATES', '304', '01955100110'),
    ('PALOMA DUARTE GOMES', '304', 'p-duartegomes@hotmail.com'),
    ('JESSICA MENDES DA SILVA', '23', '61993758280'),
    ('LAURA DANIELLE GONÇALVES BRANDÃO', '23', '61999172554'),
    ('TONILZA LIRA CENA', '23', '72286385149'),
    ('ARITANA MAIA DA SILVA', '403-SUL', '61999551101'),
    ('GABRIELA RODRIGUES DE MELO', '403-SUL', '07588967196'),
    ('JOSELINA ANDRADE ARAUJO', '403-SUL', '71531300120'),
    ('LUCILENE DA SILVA MELO', '403-SUL', '61985954142'),
    ('ANA KAROLINE DE SOUSA LIMA', '403-NORTE', '9da02cad-38f6-4d09-8e34-679f0ec30cf2'),
    ('MIRIA DE SOUZA MOURA', '403-NORTE', '09164683133'),
    ('CONCEICAO ALAIDE GONCALVES BRANDAO', '210', '61991415342')
) AS d(nome, apelido, pix)
WHERE pg_temp.norm(f.nome) = pg_temp.norm(d.nome);

-- ── BLOCO 3 — VERIFICACAO ────────────────────────────────────────────────────
SELECT nome, pix FROM funcionarios WHERE pix IS NOT NULL ORDER BY nome;

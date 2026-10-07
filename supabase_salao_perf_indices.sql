-- ============================================================
-- Performance — índices para a conferência / relatórios / notas.
-- Só acelera consultas; NÃO altera dados nem comportamento. Idempotente.
-- Rode no SQL editor do Supabase.
-- ============================================================

-- A conferência busca notas por competência com:
--   where (competencia = X or competencia_conf = X)
-- O índice por coalesce(competencia_conf, competencia) NÃO atende esse OR.
-- Índices separados (parciais, só notas vivas) resolvem o scan.
create index if not exists idx_salon_notas_competencia
  on public.salon_notas (competencia) where excluida = false;
create index if not exists idx_salon_notas_competencia_conf
  on public.salon_notas (competencia_conf) where excluida = false;

-- "Notas usadas": varre vínculos. Índices nas colunas de junção/condição.
create index if not exists idx_salon_comissoes_nota_id
  on public.salon_comissoes (nota_id) where nota_id is not null;
create index if not exists idx_salon_comissao_notas_nota
  on public.salon_comissao_notas (nota_id);

-- Busca de notas livres por documento (cruzamento por CNPJ/CPF).
create index if not exists idx_salon_notas_documento
  on public.salon_notas (documento) where excluida = false;

-- Atualiza as estatísticas para o planejador usar os índices novos.
analyze public.salon_notas;
analyze public.salon_comissoes;
analyze public.salon_comissao_notas;

select 'índices de performance aplicados' as status;

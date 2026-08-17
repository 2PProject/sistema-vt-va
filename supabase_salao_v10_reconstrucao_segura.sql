-- Reconstrução segura do núcleo de conferência do Módulo Salão.
-- Não remove tabelas, colunas nem dados e não altera os módulos VT/VA/Pagamentos.
-- Fonte oficial de vínculo: public.salon_comissao_notas.

begin;

-- 1. Reparar relações legadas ainda existentes apenas em salon_comissoes.nota_id.
insert into public.salon_comissao_notas (comissao_id, nota_id, criado_por)
select c.id, c.nota_id, 'migracao_v10'
from public.salon_comissoes c
where c.nota_id is not null
on conflict (nota_id) do nothing;

-- 2. Reparar a coluna de compatibilidade quando a relação oficial já existe.
update public.salon_comissoes c
set nota_id = r.nota_id
from (
  select distinct on (comissao_id) comissao_id, nota_id
  from public.salon_comissao_notas
  order by comissao_id, criado_em, id
) r
where c.id = r.comissao_id
  and c.nota_id is distinct from r.nota_id;

-- 3. Toda nota ligada pela relação oficial precisa estar conferida.
update public.salon_notas n
set conferida = true,
    conferida_em = coalesce(n.conferida_em, now())
where exists (
  select 1 from public.salon_comissao_notas r where r.nota_id = n.id
);

-- 4. Índices direcionados às consultas reais do módulo.
create index if not exists idx_salon_comissoes_periodo_empresa
  on public.salon_comissoes (mes_ref, empresa_id);
create index if not exists idx_salon_comissoes_documento_periodo
  on public.salon_comissoes (documento, mes_ref);
create index if not exists idx_salon_comissoes_nota
  on public.salon_comissoes (nota_id) where nota_id is not null;
create index if not exists idx_salon_comissoes_status_periodo
  on public.salon_comissoes (status, mes_ref);
create index if not exists idx_salon_comissao_notas_comissao
  on public.salon_comissao_notas (comissao_id);
create index if not exists idx_salon_notas_empresa_competencia
  on public.salon_notas (empresa_id, coalesce(competencia_conf, competencia));
create index if not exists idx_salon_notas_documento_competencia
  on public.salon_notas (documento, coalesce(competencia_conf, competencia));
create index if not exists idx_salon_notas_operacionais
  on public.salon_notas (empresa_id, conferida, classificacao)
  where excluida = false;
create index if not exists idx_salon_historico_referencia
  on public.salon_historico (tipo, ref_id, criado_em desc);

-- 5. Regras novas entram como NOT VALID para não interromper a implantação
-- caso exista sujeira histórica. Novas gravações já ficam protegidas.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'salon_comissoes_mes_ref_formato') then
    alter table public.salon_comissoes
      add constraint salon_comissoes_mes_ref_formato
      check (mes_ref ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'salon_notas_competencia_formato') then
    alter table public.salon_notas
      add constraint salon_notas_competencia_formato
      check (competencia is null or competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'salon_notas_competencia_conf_formato') then
    alter table public.salon_notas
      add constraint salon_notas_competencia_conf_formato
      check (competencia_conf is null or competencia_conf ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') not valid;
  end if;
end $$;

-- 6. Visão canônica: uma linha por profissional/competência, com todas as notas.
-- Telas novas podem ler esta visão sem reconstruir vínculo em vários lugares.
create or replace view public.salon_conferencia_v2 as
select
  c.id as comissao_id,
  c.empresa_id,
  c.profissional_id,
  c.mes_ref as competencia_oficial,
  c.nome,
  c.documento,
  c.valor_comissao,
  c.analise_manual,
  c.analise_motivo,
  c.observacao,
  coalesce(v.quantidade_notas, 0)::integer as quantidade_notas,
  coalesce(v.valor_notas, 0)::numeric as valor_notas,
  round((coalesce(v.valor_notas, 0) - c.valor_comissao)::numeric, 2) as diferenca,
  case
    when c.analise_manual then 'analise'
    when coalesce(v.quantidade_notas, 0) = 0 then 'pendente'
    when abs(coalesce(v.valor_notas, 0) - c.valor_comissao) < 0.01 then 'conferido'
    else 'conferido_com_divergencia'
  end as situacao,
  coalesce(v.notas, '[]'::jsonb) as notas
from public.salon_comissoes c
left join lateral (
  select
    count(*) as quantidade_notas,
    sum(coalesce(n.valor, 0)) as valor_notas,
    jsonb_agg(jsonb_build_object(
      'id', n.id,
      'numero', n.numero,
      'valor', n.valor,
      'data_emissao', n.data_emissao,
      'competencia_informada', coalesce(n.competencia_conf, n.competencia),
      'emitente_nome', n.emitente_nome,
      'documento', n.documento
    ) order by n.data_emissao, n.numero) as notas
  from public.salon_comissao_notas r
  join public.salon_notas n on n.id = r.nota_id
  where r.comissao_id = c.id
) v on true;

comment on view public.salon_conferencia_v2 is
  'Fonte canônica do Módulo Salão v2. Vínculos vêm exclusivamente de salon_comissao_notas.';

commit;

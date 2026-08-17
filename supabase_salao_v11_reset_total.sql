-- ATENÇÃO: MIGRAÇÃO DESTRUTIVA AUTORIZADA PELO PROPRIETÁRIO.
-- Zera SOMENTE o Módulo Salão/NFS-e. Não toca em empresas, unidades,
-- funcionários, competências VT/VA, pagamentos, vales ou fechamentos.
begin;

drop view if exists public.salon_conferencia_v2;
drop function if exists public.salon_sync_vinculo() cascade;

drop table if exists public.salon_comissao_notas cascade;
drop table if exists public.salon_conciliacao_log cascade;
drop table if exists public.salon_competencia_status cascade;
drop table if exists public.salon_historico cascade;
drop table if exists public.salon_comissoes_log cascade;
drop table if exists public.salon_notas cascade;
drop table if exists public.salon_comissoes cascade;
drop table if exists public.salon_professionals cascade;
drop table if exists public.salon_nfse_sync cascade;
drop table if exists public.salon_certificados cascade;
drop table if exists public.salon_empresa_config cascade;
drop table if exists public.salao_nf_historico cascade;
drop table if exists public.salao_nf_confirmacoes cascade;
drop table if exists public.salao_nf_registros cascade;
drop table if exists public.salao_config_empresa cascade;
drop table if exists public.salao_profissional_empresa cascade;
drop table if exists public.salao_profissionais cascade;

create table public.salon_empresa_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  prazo_dia integer not null default 10 check (prazo_dia between 1 and 31),
  tolerancia_valor numeric(14,2) not null default 0.01 check (tolerancia_valor >= 0),
  atualizado_em timestamptz not null default now()
);

create table public.salon_certificados (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  cert_nome text,
  cert_cnpj text,
  cert_validade date,
  cert_pfx_b64 text,
  cert_senha_enc text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.salon_nfse_sync (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  ultimo_nsu bigint not null default 0 check (ultimo_nsu >= 0),
  ultima_sync timestamptz
);

create table public.salon_professionals (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,
  documento text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (empresa_id, documento)
);

create table public.salon_comissoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  profissional_id uuid references public.salon_professionals(id) on delete set null,
  mes_ref text not null check (mes_ref ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  documento text,
  nome text,
  valor_comissao numeric(14,2) not null default 0 check (valor_comissao >= 0),
  status text not null default 'pendente' check (status in ('pendente','conferida')),
  nota_id uuid,
  nf_numero text,
  nf_data date,
  nf_valor numeric(14,2),
  nf_origem text,
  confirmado_em timestamptz,
  pendencia text,
  observacao text,
  corrigido_manual boolean not null default false,
  analise_manual boolean not null default false,
  analise_motivo text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.salon_notas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  nsu bigint,
  chave text,
  documento text,
  emitente_nome text,
  numero text,
  valor numeric(14,2) check (valor is null or valor >= 0),
  data_emissao date,
  competencia text check (competencia is null or competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  competencia_conf text check (competencia_conf is null or competencia_conf ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  observacao text,
  conferida boolean not null default false,
  conferida_em timestamptz,
  conferida_por text,
  classificacao text not null default 'profissional' check (classificacao in ('profissional','outro_servico')),
  categoria_outro_servico text,
  analise_manual boolean not null default false,
  analise_motivo text,
  excluida boolean not null default false,
  excluida_motivo text,
  excluida_por text,
  excluida_em timestamptz,
  duplicada boolean not null default false,
  comissao_id uuid,
  classificacao_categoria text,
  classificacao_motivo text,
  classificacao_observacao text,
  classificado_em timestamptz,
  adiado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, chave)
);

alter table public.salon_comissoes
  add constraint salon_comissoes_nota_id_fkey foreign key (nota_id)
  references public.salon_notas(id) on delete set null;
alter table public.salon_notas
  add constraint salon_notas_comissao_id_fkey foreign key (comissao_id)
  references public.salon_comissoes(id) on delete set null;

create table public.salon_comissao_notas (
  id uuid primary key default gen_random_uuid(),
  comissao_id uuid not null references public.salon_comissoes(id) on delete cascade,
  nota_id uuid not null references public.salon_notas(id) on delete cascade,
  criado_em timestamptz not null default now(),
  criado_por text,
  unique (comissao_id, nota_id),
  unique (nota_id)
);

create table public.salon_historico (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('comissao','nota','competencia')),
  ref_id text,
  empresa_id uuid references public.empresas(id) on delete set null,
  competencia text,
  acao text not null,
  valor_anterior jsonb,
  valor_novo jsonb,
  usuario text,
  justificativa text,
  criado_em timestamptz not null default now()
);

create table public.salon_comissoes_log (
  id uuid primary key default gen_random_uuid(),
  comissao_id uuid references public.salon_comissoes(id) on delete cascade,
  acao text not null,
  detalhe text,
  usuario text,
  criado_em timestamptz not null default now()
);

create table public.salon_conciliacao_log (
  id uuid primary key default gen_random_uuid(),
  nota_id uuid references public.salon_notas(id) on delete set null,
  comissao_id uuid references public.salon_comissoes(id) on delete set null,
  acao text not null,
  detalhe text,
  usuario text,
  valor_anterior jsonb,
  valor_posterior jsonb,
  criado_em timestamptz not null default now()
);

create table public.salon_competencia_status (
  id uuid primary key default gen_random_uuid(),
  competencia text not null check (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  empresa_id uuid references public.empresas(id) on delete cascade,
  status text not null default 'em_preparacao',
  totais jsonb,
  usuario text,
  justificativa text,
  fechado_em timestamptz,
  reaberto_em timestamptz,
  atualizado_em timestamptz not null default now()
);
create unique index salon_competencia_status_unica
  on public.salon_competencia_status (competencia, coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index salon_comissoes_periodo_empresa on public.salon_comissoes (mes_ref, empresa_id);
create index salon_comissoes_documento_periodo on public.salon_comissoes (documento, mes_ref);
create index salon_comissoes_status_periodo on public.salon_comissoes (status, mes_ref);
create index salon_notas_empresa_competencia on public.salon_notas (empresa_id, coalesce(competencia_conf, competencia));
create index salon_notas_documento_competencia on public.salon_notas (documento, coalesce(competencia_conf, competencia));
create index salon_notas_operacionais on public.salon_notas (empresa_id, conferida, classificacao) where excluida = false;
create index salon_historico_ref on public.salon_historico (tipo, ref_id, criado_em desc);

-- Uma única fonte de verdade: qualquer alteração na relação recompõe os campos
-- de compatibilidade usados pelas telas antigas.
create or replace function public.salon_sync_vinculo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comissao uuid := coalesce(new.comissao_id, old.comissao_id);
  v_nota uuid := coalesce(new.nota_id, old.nota_id);
  v_primeira record;
  v_total numeric;
  v_numeros text;
  v_qtd integer;
begin
  select n.id, n.numero, n.data_emissao
    into v_primeira
  from salon_comissao_notas r
  join salon_notas n on n.id = r.nota_id
  where r.comissao_id = v_comissao
  order by r.criado_em, r.id
  limit 1;

  select count(*), coalesce(sum(coalesce(n.valor,0)),0), string_agg(coalesce(n.numero,'s/n'), ', ' order by r.criado_em, r.id)
    into v_qtd, v_total, v_numeros
  from salon_comissao_notas r
  join salon_notas n on n.id = r.nota_id
  where r.comissao_id = v_comissao;

  if v_qtd = 0 then
    update salon_comissoes set nota_id=null,status='pendente',nf_numero=null,nf_data=null,nf_valor=null,nf_origem=null,confirmado_em=null,atualizado_em=now()
    where id=v_comissao;
  else
    update salon_comissoes set nota_id=v_primeira.id,status='conferida',nf_numero=v_numeros,nf_data=v_primeira.data_emissao,
      nf_valor=v_total,nf_origem=case when v_qtd>1 then 'manual_multiplo' else coalesce(nf_origem,'manual') end,
      confirmado_em=coalesce(confirmado_em,now()),atualizado_em=now()
    where id=v_comissao;
  end if;

  update salon_notas n set
    conferida=exists(select 1 from salon_comissao_notas r where r.nota_id=n.id),
    conferida_em=case when exists(select 1 from salon_comissao_notas r where r.nota_id=n.id) then coalesce(n.conferida_em,now()) else null end,
    conferida_por=case when exists(select 1 from salon_comissao_notas r where r.nota_id=n.id) then n.conferida_por else null end,
    atualizado_em=now()
  where n.id=v_nota;
  if TG_OP = 'DELETE' then return old; end if;
  return new;
end $;

create trigger salon_comissao_notas_sync
after insert or update or delete on public.salon_comissao_notas
for each row execute function public.salon_sync_vinculo();

create or replace view public.salon_conferencia_v2 as
select c.id as comissao_id,c.empresa_id,c.mes_ref as competencia_oficial,c.nome,c.documento,c.valor_comissao,
  count(r.id)::integer as quantidade_notas,coalesce(sum(n.valor),0)::numeric as valor_notas,
  round((coalesce(sum(n.valor),0)-c.valor_comissao)::numeric,2) as diferenca,
  case when c.analise_manual then 'analise' when count(r.id)=0 then 'pendente'
       when abs(coalesce(sum(n.valor),0)-c.valor_comissao)<0.01 then 'conferido'
       else 'conferido_com_divergencia' end as situacao,
  coalesce(jsonb_agg(jsonb_build_object('id',n.id,'numero',n.numero,'valor',n.valor,'emissao',n.data_emissao,
    'competencia_informada',coalesce(n.competencia_conf,n.competencia))) filter(where n.id is not null),'[]'::jsonb) as notas
from public.salon_comissoes c
left join public.salon_comissao_notas r on r.comissao_id=c.id
left join public.salon_notas n on n.id=r.nota_id
group by c.id;

-- Acesso das telas autenticadas. Certificados permanecem somente no servidor.
alter table public.salon_empresa_config enable row level security;
alter table public.salon_professionals enable row level security;
alter table public.salon_comissoes enable row level security;
alter table public.salon_notas enable row level security;
alter table public.salon_comissao_notas enable row level security;
alter table public.salon_historico enable row level security;
alter table public.salon_competencia_status enable row level security;

create policy salon_config_auth on public.salon_empresa_config for all to authenticated using (true) with check (true);
create policy salon_prof_auth on public.salon_professionals for all to authenticated using (true) with check (true);
create policy salon_com_auth on public.salon_comissoes for all to authenticated using (true) with check (true);
create policy salon_notas_auth on public.salon_notas for all to authenticated using (true) with check (true);
create policy salon_rel_auth on public.salon_comissao_notas for all to authenticated using (true) with check (true);
create policy salon_hist_auth on public.salon_historico for all to authenticated using (true) with check (true);
create policy salon_comp_status_auth on public.salon_competencia_status for all to authenticated using (true) with check (true);

grant select,insert,update,delete on public.salon_empresa_config,public.salon_professionals,public.salon_comissoes,
  public.salon_notas,public.salon_comissao_notas,public.salon_historico,public.salon_competencia_status to authenticated;
grant select on public.salon_conferencia_v2 to authenticated;

commit;

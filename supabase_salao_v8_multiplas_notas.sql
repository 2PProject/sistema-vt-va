-- Salão v8 — vínculo de várias NFS-e para um único profissional/competência.
create table if not exists public.salon_comissao_notas (
  id uuid primary key default gen_random_uuid(),
  comissao_id uuid not null references public.salon_comissoes(id) on delete cascade,
  nota_id uuid not null references public.salon_notas(id) on delete cascade,
  criado_em timestamptz not null default now(),
  criado_por text,
  unique (comissao_id, nota_id),
  unique (nota_id)
);
create index if not exists idx_salon_comissao_notas_comissao on public.salon_comissao_notas(comissao_id);
create index if not exists idx_salon_comissao_notas_nota on public.salon_comissao_notas(nota_id);
alter table public.salon_comissao_notas enable row level security;
drop policy if exists salon_comissao_notas_auth on public.salon_comissao_notas;
create policy salon_comissao_notas_auth on public.salon_comissao_notas for all to authenticated using (true) with check (true);
-- Preserva os vínculos simples existentes.
insert into public.salon_comissao_notas (comissao_id, nota_id)
select id, nota_id from public.salon_comissoes where nota_id is not null
on conflict do nothing;

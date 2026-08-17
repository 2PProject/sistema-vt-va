-- Recupera o cadastro de profissionais a partir das competências já importadas.
-- Restrito ao Módulo Salão/NFS-e.
begin;

insert into public.salon_professionals (empresa_id, documento, nome, ativo)
select
  c.empresa_id,
  c.documento,
  max(coalesce(nullif(trim(c.nome), ''), c.documento)) as nome,
  true
from public.salon_comissoes c
where c.documento is not null
  and length(regexp_replace(c.documento, '\\D', '', 'g')) in (11, 14)
group by c.empresa_id, c.documento
on conflict (empresa_id, documento) do update
set nome = excluded.nome,
    ativo = true;

update public.salon_comissoes c
set profissional_id = p.id
from public.salon_professionals p
where p.empresa_id = c.empresa_id
  and p.documento = c.documento
  and c.profissional_id is distinct from p.id;

notify pgrst, 'reload schema';
commit;

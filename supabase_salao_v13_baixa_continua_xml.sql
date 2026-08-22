-- Suporte à baixa contínua por NSU e armazenamento do XML original.
-- Restrito ao Módulo Salão/NFS-e.
begin;

alter table public.salon_notas
  add column if not exists xml_original text,
  add column if not exists xml_nome text;

create unique index if not exists salon_notas_empresa_nsu_unique
  on public.salon_notas (empresa_id, nsu);

-- Força o PostgREST/Supabase a recarregar imediatamente o novo esquema.
notify pgrst, 'reload schema';

commit;

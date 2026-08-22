-- Habilita a DANFSe visual preservando o XML original de cada NFS-e.
-- Migração aditiva e restrita ao Módulo Salão/Notas.
begin;

alter table public.salon_notas
  add column if not exists xml_original text,
  add column if not exists xml_nome text;

comment on column public.salon_notas.xml_original is 'XML original da NFS-e usado para exibição da DANFSe e auditoria.';
comment on column public.salon_notas.xml_nome is 'Nome do arquivo XML recebido na importação manual.';

commit;

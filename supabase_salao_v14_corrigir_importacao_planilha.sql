-- Corrige o upsert da importação de planilhas do Módulo Salão.
begin;

create unique index if not exists salon_comissoes_empresa_mes_documento_unique
  on public.salon_comissoes (empresa_id, mes_ref, documento);

commit;

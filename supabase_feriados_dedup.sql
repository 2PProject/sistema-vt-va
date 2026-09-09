-- ============================================================
-- Feriados — remove DUPLICADOS (mesma data) e impede novos.
-- A tabela feriados não tinha UNIQUE em `data`; datas repetidas (ex.: 07/09
-- gravado 2x) faziam o feriado ser descontado 2x no cálculo de dias úteis.
-- Idempotente. Rode no SQL editor do Supabase.
-- ============================================================

-- 1) Apaga as repetições, mantendo o registro mais antigo de cada data.
delete from public.feriados
where id in (
  select id from (
    select id, row_number() over (partition by data order by id) as rn
    from public.feriados
  ) t
  where t.rn > 1
);

-- 2) Impede novas duplicatas.
create unique index if not exists feriados_data_unica on public.feriados (data);

select 'feriados deduplicados' as status, count(*) as total from public.feriados;

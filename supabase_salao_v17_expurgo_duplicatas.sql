-- ============================================================
-- MÓDULO SALÃO — v17: consolidação SEGURA de NOTAS DUPLICADAS
-- ------------------------------------------------------------
-- Uma nota podia existir em mais de uma linha (ex.: baixada pelo ADN e
-- reimportada por XML). Tratar uma (excluir / outro serviço / conferir)
-- marcava só aquela linha e a gêmea reaparecia como pendente.
--
-- Esta migração escolhe UMA linha "sobrevivente" por identidade
-- (unidade | documento | nº | emissão | valor), move o VÍNCULO e funde os
-- TRATAMENTOS nela, e marca as gêmeas como excluídas.
--
-- SEGURA e REVERSÍVEL:
--  • NÃO apaga fisicamente (nenhum DELETE em salon_notas) — as gêmeas ficam
--    com excluida=true e excluida_motivo='Duplicata consolidada (v17)';
--  • preserva o vínculo de conferência (nunca dispara ON DELETE / cascata);
--  • idempotente — rodar de novo não faz nada além do já consolidado;
--  • roda em transação: ou aplica tudo, ou nada.
--
-- Para desfazer (se necessário), reabrir as consolidadas:
--   update salon_notas set excluida=false, excluida_motivo=null, excluida_em=null
--   where excluida_motivo='Duplicata consolidada (v17)';
-- ============================================================

-- PRÉVIA (opcional) — rode isolado ANTES para ver o volume:
--   select count(*) filter (where qtd>1)          as grupos_com_duplicata,
--          coalesce(sum(qtd-1) filter (where qtd>1),0) as linhas_a_consolidar
--   from (
--     select count(*) as qtd
--     from salon_notas
--     where numero is not null and data_emissao is not null
--     group by empresa_id, regexp_replace(coalesce(documento,''),'\D','','g'),
--              numero, data_emissao, round(coalesce(valor,0)::numeric,2)
--   ) t;

begin;

-- 1) Mapa loser -> survivor por IDENTIDADE. Sobrevive a melhor linha:
--    primeiro a VINCULADA (validada), depois a TRATADA, depois a que tem XML,
--    e por fim a mais antiga (id) como desempate estável.
create temp table _dup on commit drop as
with base as (
  select n.id, n.empresa_id,
    regexp_replace(coalesce(n.documento,''),'\D','','g') as doc,
    n.numero, n.data_emissao, round(coalesce(n.valor,0)::numeric,2) as val,
    exists (select 1 from salon_comissao_notas r where r.nota_id = n.id) as linkada,
    (n.excluida or n.classificacao = 'outro_servico'
       or coalesce(n.analise_manual,false) or n.conferida) as tratada,
    (n.xml_original is not null) as tem_xml,
    n.id::text as tie
  from salon_notas n
  where n.numero is not null and n.data_emissao is not null
),
ranqueado as (
  select *,
    first_value(id) over (
      partition by empresa_id, doc, numero, data_emissao, val
      order by linkada desc, tratada desc, tem_xml desc, tie asc
    ) as survivor_id,
    count(*) over (partition by empresa_id, doc, numero, data_emissao, val) as qtd
  from base
)
select id as loser_id, survivor_id
from ranqueado
where qtd > 1 and id <> survivor_id;

-- 2) Move os vínculos M:N do loser para o survivor (quando o survivor ainda
--    não estiver vinculado — respeita o unique(nota_id)). O trigger de sync
--    reajusta a comissão e o flag conferida automaticamente.
update salon_comissao_notas r
   set nota_id = d.survivor_id
  from _dup d
 where r.nota_id = d.loser_id
   and not exists (select 1 from salon_comissao_notas s where s.nota_id = d.survivor_id);

-- Sobra de vínculo do loser (caso raro de dupla-vinculação) — remove; o
-- survivor já cobre a nota. A comissão afetada volta a pendente via trigger.
delete from salon_comissao_notas r
 using _dup d
 where r.nota_id = d.loser_id;

-- 3) Higiene: referências denormalizadas do loser passam ao survivor (a nota
--    survivor é a visível). O trigger já acerta as vinculadas; aqui cobrimos
--    ponteiros legados sem M:N.
update salon_comissoes c set nota_id = d.survivor_id
  from _dup d where c.nota_id = d.loser_id;

-- 4) Funde os TRATAMENTOS das gêmeas no survivor. Quando o survivor está
--    VINCULADO (validado), a validação prevalece: não herda exclusão/outro/
--    análise das gêmeas (só completa dados faltantes).
with agg as (
  select d.survivor_id,
    -- só propaga exclusão GENUÍNA do usuário; ignora a marca desta própria
    -- migração (senão, no 2º run, a gêmea já consolidada re-excluiria o survivor).
    bool_or(l.excluida and coalesce(l.excluida_motivo,'') <> 'Duplicata consolidada (v17)') as any_excl,
    bool_or(l.classificacao = 'outro_servico')  as any_outro,
    bool_or(coalesce(l.analise_manual,false))   as any_anal,
    max(l.analise_motivo)    filter (where l.analise_motivo    is not null) as motivo,
    max(l.competencia_conf)  filter (where l.competencia_conf  is not null) as comp_conf,
    max(l.observacao)        filter (where l.observacao        is not null) as obs,
    max(l.xml_original)      filter (where l.xml_original      is not null) as xmlo,
    max(l.xml_nome)          filter (where l.xml_nome          is not null) as xmln
  from _dup d
  join salon_notas l on l.id = d.loser_id
  group by d.survivor_id
)
update salon_notas s set
  excluida = case when exists (select 1 from salon_comissao_notas r where r.nota_id = s.id)
                  then s.excluida else s.excluida or a.any_excl end,
  classificacao = case
      when exists (select 1 from salon_comissao_notas r where r.nota_id = s.id) then s.classificacao
      when a.any_outro or s.classificacao = 'outro_servico' then 'outro_servico'
      else s.classificacao end,
  analise_manual = case when exists (select 1 from salon_comissao_notas r where r.nota_id = s.id)
                        then s.analise_manual else coalesce(s.analise_manual,false) or a.any_anal end,
  analise_motivo   = coalesce(s.analise_motivo, a.motivo),
  competencia_conf = coalesce(s.competencia_conf, a.comp_conf),
  observacao       = coalesce(s.observacao, a.obs),
  xml_original     = coalesce(s.xml_original, a.xmlo),
  xml_nome         = coalesce(s.xml_nome, a.xmln)
from agg a
where s.id = a.survivor_id;

-- 5) Marca as gêmeas como excluídas (REVERSÍVEL). Já estão sem vínculo.
update salon_notas l set
  excluida        = true,
  excluida_motivo = 'Duplicata consolidada (v17)',
  excluida_em     = coalesce(l.excluida_em, now())
from _dup d
where l.id = d.loser_id;

commit;

-- Conferência pós-execução:
select count(*) as gemeas_consolidadas
from salon_notas
where excluida_motivo = 'Duplicata consolidada (v17)';

-- ============================================================
-- NOTAS — competência EFETIVA = competência do lançamento vinculado.
-- Uma nota emitida com dCompet errado (ex.: "junho" mas paga em julho) ficava
-- exibida no mês errado, dando a impressão de duas notas no mesmo mês. A partir
-- de agora, ao casar/vincular, a nota assume a competência do lançamento
-- (salon_comissoes.mes_ref) em competencia_conf. Este script corrige o histórico
-- que já estava vinculado antes da correção. Idempotente. Rode no SQL editor.
-- ============================================================

-- 1) Vínculo simples (coluna nota_id na comissão).
update public.salon_notas n
set competencia_conf = c.mes_ref
from public.salon_comissoes c
where c.nota_id = n.id
  and c.mes_ref is not null
  and n.competencia_conf is distinct from c.mes_ref;

-- 2) Vínculos múltiplos (M:N em salon_comissao_notas).
update public.salon_notas n
set competencia_conf = c.mes_ref
from public.salon_comissao_notas cn
join public.salon_comissoes c on c.id = cn.comissao_id
where cn.nota_id = n.id
  and c.mes_ref is not null
  and n.competencia_conf is distinct from c.mes_ref;

select 'notas: competência efetiva alinhada ao lançamento' as status,
       count(*) as notas_conferidas
from public.salon_notas
where conferida = true;

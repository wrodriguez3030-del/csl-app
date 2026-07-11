-- Comisión de Ventas · INCENTIVO LÁSER modo EQUITATIVO (cuadro oficial) +
-- tarifa de producto POR COLABORADOR.
--
-- Análisis del cuadro real "SISTEMA INCENTIVOS .xlsx" (Junio):
--  1) El reparto real NO es 50/50: cuota per cápita = fondo/N elegibles; los de
--     0 pacientes cobran EXACTAMENTE su cuota; el RESTO del fondo se reparte
--     por pacientes entre quienes sí atendieron. → nueva regla `laser_split_mode`
--     (fixed_amount 1 = equitativo DEFAULT, 0 = pesos 50/50 configurables).
--  2) Algunas personas cobran productos a RD$50/unidad (no RD$100): columna
--     `product_unit_amount` en el roster (null = regla general).
-- Solo aditiva.

alter table public.sales_commission_collaborators
  add column if not exists product_unit_amount numeric(16,2);

insert into public.sales_commission_rules
  (business_id, name, rule_type, fixed_amount, priority, active, effective_from, created_by)
select r.business_id, 'Láser: reparto equitativo por persona (modo cuadro)', 'laser_split_mode', 1, 100, true, '2000-01-01', 'seed'
from (select distinct business_id from public.sales_commission_rules) r
where not exists (
  select 1 from public.sales_commission_rules x
  where x.business_id = r.business_id and x.rule_type = 'laser_split_mode'
);

notify pgrst, 'reload schema';

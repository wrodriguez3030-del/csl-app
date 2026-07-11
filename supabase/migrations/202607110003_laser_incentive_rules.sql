-- Comisión de Ventas · INCENTIVO LÁSER — reglas de reparto configurables.
-- Corrige/completa la lógica del incentivo de depilación láser:
--   1) Descontar % de tarjeta ANTES de aplicar la escala (base neta).
--   2) Repartir el fondo en parte por CANTIDAD DE PERSONAS + parte por PACIENTES,
--      con pesos editables (default 50/50, deben sumar 100%).
--   3) Bandera: empleado con 0 pacientes recibe (o no) la parte fija por persona.
-- Solo aditiva: INSERT de reglas por defecto para los negocios que YA tienen
-- reglas de comisión pero aún no estas. NO toca la escala ni datos existentes.
-- (La regla legacy `laser_split` queda intacta; el motor prefiere los pesos.)

insert into public.sales_commission_rules
  (business_id, name, rule_type, percentage, fixed_amount, priority, active, effective_from, created_by)
select r.business_id, v.name, v.rule_type, v.percentage, v.fixed_amount, 100, true, '2000-01-01', 'seed'
from (select distinct business_id from public.sales_commission_rules) r
cross join (values
  ('Reparto láser: % por cantidad de personas', 'laser_weight_personas',            0.5::numeric,  null::numeric),
  ('Reparto láser: % por pacientes atendidos',  'laser_weight_pacientes',            0.5::numeric,  null::numeric),
  ('Láser: empleado con 0 pacientes recibe parte fija',    'laser_zero_patients_fixed',        null::numeric, 1::numeric),
  ('Láser: descontar tarjeta antes de la escala',          'laser_card_discount_before_scale', null::numeric, 1::numeric)
) as v(name, rule_type, percentage, fixed_amount)
where not exists (
  select 1 from public.sales_commission_rules x
  where x.business_id = r.business_id and x.rule_type = v.rule_type
);

notify pgrst, 'reload schema';

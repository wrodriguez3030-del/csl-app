-- Configuración de Incentivos de Ventas para DEPICENTER (sucursal LA VEGA):
-- roster + porcentaje de tarjeta, replicando Cibao Spa Laser.
--
-- Replica la configuración vigente de Cibao Spa Laser: los 25 de los 26
-- colaboradores de CSL comparten exactamente estos valores
--   participation_type   = 'mixto'
--   fixed_percentage     = null      (no hay porcentaje fijo por persona)
--   linear_participation = true      (entra en el reparto lineal del fondo)
--   patient_participation= true      (entra en el reparto por pacientes)
--   cleaning_contribution= 400.00    (aporte de limpieza)
--   bonus_extra          = 0.00
--   evaluation_pct       = 100.00
--   services             = {DEPILACION_LASER}
--
-- Las 5 personas salen de los datos reales de julio 2026: son las mismas en el
-- archivo de ventas y en el de reservas, sin variantes de escritura.
--
-- Idempotente: si ya existe el par (business_id, branch, name) no lo duplica.
--
-- Ejecutar:  node scripts/db-query.js --file docs/2026-08-03-depicenter-roster-incentivos.sql

begin;

insert into sales_commission_collaborators
  (business_id, branch, name, services, participation_type, fixed_percentage,
   linear_participation, patient_participation, cleaning_contribution,
   bonus_extra, evaluation_pct, active, created_by)
select
  '03b96698-c5df-4b4b-84df-1160a7ad56b9'::uuid,
  'LA VEGA',
  v.name,
  '{DEPILACION_LASER}'::text[],
  'mixto',
  null,
  true,
  true,
  400.00,
  0.00,
  100.00,
  true,
  'claude:replica-config-csl'
from (values ('SELENIA'), ('NOELIA'), ('CLARIBEL'), ('EVELINA'), ('WANDA')) as v(name)
where not exists (
  select 1 from sales_commission_collaborators c
   where c.business_id = '03b96698-c5df-4b4b-84df-1160a7ad56b9'
     and c.branch = 'LA VEGA'
     and c.name = v.name
     and c.deleted_at is null
);

-- ── Porcentaje de tarjeta: 27 % → 31 %, igual que CSL ────────────────────────
-- Confirmado por el usuario el 2026-08-03: Depicenter también está al 31 %.
-- Este porcentaje netea las ventas con tarjeta ANTES de la escala láser, así
-- que subirlo reduce el fondo láser y, con él, lo que cobra el personal.
update sales_commission_rules
   set percentage = 0.31000,
       updated_at = now()
 where business_id = '03b96698-c5df-4b4b-84df-1160a7ad56b9'
   and rule_type = 'card_percentage'
   and percentage = 0.27000;

-- Verificación
select 'roster' AS que, name, branch, participation_type,
       linear_participation::text, patient_participation::text,
       cleaning_contribution::text, evaluation_pct::text, services::text,
       active::text
  from sales_commission_collaborators
 where business_id = '03b96698-c5df-4b4b-84df-1160a7ad56b9'
   and deleted_at is null
 order by name;

select 'tarjeta' AS que, b.slug, r.percentage::text, r.active::text
  from sales_commission_rules r
  join businesses b on b.id = r.business_id
 where r.rule_type = 'card_percentage'
 order by b.slug;

commit;

-- Revertir:
--   delete from sales_commission_collaborators
--    where business_id = '03b96698-c5df-4b4b-84df-1160a7ad56b9'
--      and created_by = 'claude:replica-config-csl';
--   update sales_commission_rules set percentage = 0.27000
--    where business_id = '03b96698-c5df-4b4b-84df-1160a7ad56b9'
--      and rule_type = 'card_percentage';

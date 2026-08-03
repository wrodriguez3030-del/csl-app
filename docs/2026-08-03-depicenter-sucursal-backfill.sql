-- Backfill: sucursal de Depicenter «DEPICENTER SKIN LASER» → «LA VEGA»
--
-- Por qué: el motor de incentivos itera las sucursales de `csl_sucursales`
-- (Depicenter = «La Vega») y filtra ventas/reservas por ese valor exacto. Antes
-- de v0.86.5 faltaba el alias en CIBAO_BRANCH_SYNONYMS, así que las filas se
-- guardaron con el nombre comercial que exporta AgendaPro y el motor no las
-- encontraba: los incentivos de Depicenter salían en cero.
--
-- Desde v0.86.5 las importaciones NUEVAS ya entran como «LA VEGA». Este script
-- corrige solo lo que se importó ANTES.
--
-- Alcance medido el 2026-08-03: 277 filas en sales, 5 en calculations.
-- Filtrado por business_id Y por el valor viejo: no toca CSL ni ninguna otra
-- sucursal. Reversible (ver el bloque final).
--
-- Ejecutar:  node scripts/db-query.js --file docs/2026-08-03-depicenter-sucursal-backfill.sql

begin;

-- Antes (para dejar constancia en la salida)
select 'ANTES' AS momento, 'sales' AS tabla, branch, count(*) AS filas
  from sales_commission_sales
 where business_id = '03b96698-c5df-4b4b-84df-1160a7ad56b9'
 group by 1, 2, 3
union all
select 'ANTES', 'calculations', branch, count(*)
  from sales_commission_calculations
 where business_id = '03b96698-c5df-4b4b-84df-1160a7ad56b9'
 group by 1, 2, 3;

update sales_commission_sales
   set branch = 'LA VEGA'
 where business_id = '03b96698-c5df-4b4b-84df-1160a7ad56b9'
   and branch = 'DEPICENTER SKIN LASER';

update sales_commission_calculations
   set branch = 'LA VEGA'
 where business_id = '03b96698-c5df-4b4b-84df-1160a7ad56b9'
   and branch = 'DEPICENTER SKIN LASER';

-- Por si alguna reserva se importó antes del despliegue de v0.86.5.
update sales_commission_reservations
   set branch_normalized = 'LA VEGA'
 where business_id = '03b96698-c5df-4b4b-84df-1160a7ad56b9'
   and branch_normalized = 'DEPICENTER SKIN LASER';

update sales_commission_patient_counts
   set branch = 'LA VEGA'
 where business_id = '03b96698-c5df-4b4b-84df-1160a7ad56b9'
   and branch = 'DEPICENTER SKIN LASER';

-- Después
select 'DESPUES' AS momento, 'sales' AS tabla, branch, count(*) AS filas
  from sales_commission_sales
 where business_id = '03b96698-c5df-4b4b-84df-1160a7ad56b9'
 group by 1, 2, 3
union all
select 'DESPUES', 'calculations', branch, count(*)
  from sales_commission_calculations
 where business_id = '03b96698-c5df-4b4b-84df-1160a7ad56b9'
 group by 1, 2, 3
union all
select 'DESPUES', 'csl (no debe cambiar)', branch, count(*)
  from sales_commission_sales
 where business_id = '66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6'
 group by 1, 2, 3;

commit;

-- Revertir (si hiciera falta):
--   update sales_commission_sales        set branch = 'DEPICENTER SKIN LASER'
--    where business_id = '03b96698-c5df-4b4b-84df-1160a7ad56b9' and branch = 'LA VEGA';
--   update sales_commission_calculations set branch = 'DEPICENTER SKIN LASER'
--    where business_id = '03b96698-c5df-4b4b-84df-1160a7ad56b9' and branch = 'LA VEGA';

-- EVELINA y WANDA fuera del reparto del fondo láser (Depicenter, LA VEGA)
--
-- Por qué: en julio 2026 ninguna de las dos tiene una sola cita de depilación
-- láser. EVELINA: 29/29 ventas son PRODUCTO y sus 10 reservas son faciales
-- (limpieza profunda, peeling, casmara). WANDA: 11 producto + 3 faciales, y sus
-- 3 reservas son limpieza facial. Las que hacen láser son SELENIA, NOELIA y
-- CLARIBEL.
--
-- Al replicar la configuración de CSL se les puso `{DEPILACION_LASER}` a las 5
-- por igual, lo que las metía en el reparto del fondo láser (RD$406 de julio
-- que salían de las tres que sí lo hacen).
--
-- `services = {}` es el mismo patrón que ya usa CSL para 6 de sus 26
-- colaboradoras (BENITA, JOHELY, ISAURY, DAYHANA, EIDYLEE, LUISA): siguen
-- cobrando producto y servicios, solo quedan fuera del fondo láser.
--
-- Decidido por el usuario el 2026-08-03.
--
-- Ejecutar:  node scripts/db-query.js --file docs/2026-08-03-depicenter-excluir-laser-evelina-wanda.sql

begin;

update sales_commission_collaborators
   set services = '{}'::text[],
       updated_at = now(),
       updated_by = 'claude:excluir-laser-no-operadoras'
 where business_id = '03b96698-c5df-4b4b-84df-1160a7ad56b9'
   and branch = 'LA VEGA'
   and name in ('EVELINA', 'WANDA')
   and deleted_at is null;

select name, branch, services::text, linear_participation::text,
       patient_participation::text, active::text
  from sales_commission_collaborators
 where business_id = '03b96698-c5df-4b4b-84df-1160a7ad56b9'
   and deleted_at is null
 order by name;

commit;

-- Revertir:
--   update sales_commission_collaborators set services = '{DEPILACION_LASER}'::text[]
--    where business_id = '03b96698-c5df-4b4b-84df-1160a7ad56b9'
--      and branch = 'LA VEGA' and name in ('EVELINA','WANDA');

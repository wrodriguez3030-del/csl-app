-- Depicenter: solo WANDA queda fuera del incentivo láser; las demás sí cobran.
--
-- Decidido por el usuario el 2026-08-03, corrigiendo la exclusión anterior
-- (2026-08-03-depicenter-excluir-laser-evelina-wanda.sql) que sacaba a las dos.
--
-- Equivale a poner el interruptor «Aplica láser» en:
--   Incentivos de Ventas → Reglas de comisión → Personal que aplica incentivo
--   láser  (componente LaserPersonnelEditor)
-- Se hace por SQL porque el cambio va acompañado del recálculo de julio.
--
-- Ejecutar:  node scripts/db-query.js --file docs/2026-08-03-depicenter-laser-solo-wanda-fuera.sql

begin;

-- EVELINA vuelve a aplicar láser.
update sales_commission_collaborators
   set services = '{DEPILACION_LASER}'::text[],
       updated_at = now(),
       updated_by = 'claude:laser-solo-wanda-fuera'
 where business_id = '03b96698-c5df-4b4b-84df-1160a7ad56b9'
   and branch = 'LA VEGA'
   and name = 'EVELINA'
   and deleted_at is null;

-- WANDA se mantiene fuera (idempotente: ya está en '{}').
update sales_commission_collaborators
   set services = '{}'::text[],
       updated_at = now(),
       updated_by = 'claude:laser-solo-wanda-fuera'
 where business_id = '03b96698-c5df-4b4b-84df-1160a7ad56b9'
   and branch = 'LA VEGA'
   and name = 'WANDA'
   and deleted_at is null;

select name,
       case when 'DEPILACION_LASER' = any(services) then 'SI aplica laser'
            else 'NO aplica laser' end AS laser,
       services::text, active::text
  from sales_commission_collaborators
 where business_id = '03b96698-c5df-4b4b-84df-1160a7ad56b9'
   and deleted_at is null
 order by name;

commit;

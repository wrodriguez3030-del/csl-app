-- 202605290002_restore_csl_e2_e3.sql
--
-- Restaura CSL Equipos 2 y 3 que fueron sobrescritos por la PK collision
-- de Depicenter (ver migración 202605290001).
--
-- Datos extraídos del histórico real en csl_reportes (17 reportes 2022-2026
-- referenciando esos equipos):
--   Equipo 2: Rafael Vidal · Serial 9914-0950-3101 · CANDELA GENTLEYAG
--   Equipo 3: Rafael Vidal · Serial 9914-0950-673  · CANDELA GENTLEYAG
--
-- Cabina y Operadora NO se encontraron en histórico — quedan vacíos con
-- una observación de "pendiente de confirmar" para que el usuario los
-- complete desde el módulo de Equipos.
--
-- Idempotente: usa WHERE NOT EXISTS. Requiere PK composite ya aplicada
-- (migración 202605290001).

-- CSL Equipo 2
INSERT INTO public.csl_equipos
  (equipo_id, business_id, sucursal, empresa, modelo, serie, numero,
   p_cabeza, p_totales, max_cabeza, estado, observaciones,
   cabina, operadora, operadora_id)
SELECT
  '2', '66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6',
  'Rafael Vidal', 'CIBAO SPA LASER, CSL, S.R.L.',
  'CANDELA GENTLEYAG', '9914-0950-3101', '',
  0, 0, 6000000, 'Activo',
  'Restaurado tras PK collision 2026-05-29. Datos de Sucursal/Serial/Modelo confirmados por 7 reportes históricos (RPT-HIST-026..072). Cabina y Operadora pendientes de confirmar — completar desde módulo Equipos.',
  '', '', ''
WHERE NOT EXISTS (
  SELECT 1 FROM public.csl_equipos
  WHERE business_id = '66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6'
    AND equipo_id = '2'
);

-- CSL Equipo 3
INSERT INTO public.csl_equipos
  (equipo_id, business_id, sucursal, empresa, modelo, serie, numero,
   p_cabeza, p_totales, max_cabeza, estado, observaciones,
   cabina, operadora, operadora_id)
SELECT
  '3', '66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6',
  'Rafael Vidal', 'CIBAO SPA LASER, CSL, S.R.L.',
  'CANDELA GENTLEYAG', '9914-0950-673', '',
  0, 0, 6000000, 'Activo',
  'Restaurado tras PK collision 2026-05-29. Datos de Sucursal/Serial/Modelo confirmados por 10 reportes históricos (RPT-HIST-005..079). Cabina y Operadora pendientes de confirmar — completar desde módulo Equipos.',
  '', '', ''
WHERE NOT EXISTS (
  SELECT 1 FROM public.csl_equipos
  WHERE business_id = '66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6'
    AND equipo_id = '3'
);

-- Verificación: 6 filas esperadas (CSL 1+2+3 + Depi 1+2+3)
SELECT business_id, equipo_id, sucursal, cabina, operadora, serie, modelo, estado
FROM public.csl_equipos
WHERE equipo_id IN ('1','2','3')
ORDER BY business_id, equipo_id;

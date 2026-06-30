-- 202606300001_equipos_source_number.sql
--
-- Añade la columna `source_number` a csl_equipos: el "Número de fuente" (fuente
-- de poder) de cada equipo láser. Antes solo existía a nivel de reporte como
-- power_source_number, capturado a mano por el técnico en cada visita; ahora el
-- maestro de equipos guarda su valor canónico para prellenarlo automáticamente
-- en los reportes y mostrarlo en listados/PDF.
--
-- Valores típicos: texto libre alfanumérico — "Fuente 1", "F-01", "PS-001".
--
-- Aditiva e idempotente: ADD COLUMN IF NOT EXISTS no rompe si se aplica dos
-- veces y NO toca datos existentes.

alter table if exists public.csl_equipos
  add column if not exists source_number text;

comment on column public.csl_equipos.source_number is
  'Número de fuente (fuente de poder) del equipo. Texto libre alfanumérico ("Fuente 1", "F-01", "PS-001"). Se usa para prellenar power_source_number en los reportes.';

-- Forzar reload del schema cache de PostgREST para que la API vea la nueva
-- columna inmediatamente.
notify pgrst, 'reload schema';

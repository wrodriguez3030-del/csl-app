-- 202605280002_equipos_pulsos_audit.sql
--
-- Añade columnas de auditoría sobre cuándo y con qué semana se
-- actualizaron por última vez los pulsos totales del equipo.
--
-- La columna p_totales ya existe — esto solo agrega metadata. Idempotente.

alter table if exists public.csl_equipos
  add column if not exists ultima_actualizacion_pulsos timestamptz,
  add column if not exists ultima_semana_pulsos date;

comment on column public.csl_equipos.ultima_actualizacion_pulsos is
  'Timestamp del último guardado del cuadre semanal que alimentó p_totales.';

comment on column public.csl_equipos.ultima_semana_pulsos is
  'Lunes ISO de la última semana cuyo cuadre actualizó p_totales — útil para detectar saltos.';

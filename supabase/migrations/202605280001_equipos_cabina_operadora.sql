-- 202605280001_equipos_cabina_operadora.sql
--
-- Añade columnas estructuradas a csl_equipos para separar cabina y operadora,
-- que antes vivían mezcladas dentro de "observaciones" (texto libre tipo
-- "CABINA 1 - YAMILKA"). Las nuevas columnas son opcionales — los datos
-- legacy permanecen intactos en `observaciones` hasta que el usuario los
-- migre manualmente al editar cada equipo.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS no rompe si la migración se aplica
-- dos veces.

alter table if exists public.csl_equipos
  add column if not exists cabina text,
  add column if not exists operadora text,
  add column if not exists operadora_id text;

comment on column public.csl_equipos.cabina is
  'Cabina asignada al equipo. Valores típicos: "Cabina 1".."Cabina 10", "Backup", "Taller", "Sin asignar".';

comment on column public.csl_equipos.operadora is
  'Nombre legible de la operadora asignada al equipo. Snapshot — se rellena al guardar para sobrevivir si el row de csl_operadoras cambia.';

comment on column public.csl_equipos.operadora_id is
  'FK textual a csl_operadoras.operadora_id. Opcional — null si el equipo está sin asignar o en backup/taller.';

-- Índices opcionales.
create index if not exists csl_equipos_operadora_id_idx
  on public.csl_equipos (operadora_id)
  where operadora_id is not null;

create index if not exists csl_equipos_sucursal_cabina_idx
  on public.csl_equipos (sucursal, cabina)
  where cabina is not null;

-- Forzar reload del schema cache de PostgREST para que la API vea las
-- nuevas columnas inmediatamente.
notify pgrst, 'reload schema';

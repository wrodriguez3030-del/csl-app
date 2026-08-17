-- ─────────────────────────────────────────────────────────────────────────────
-- 202608170002 — Borrado suave de reportes de mantenimiento
-- ─────────────────────────────────────────────────────────────────────────────
-- Un reporte borrado desde el módulo desaparecía de la base para siempre. Ahora
-- se marca como eliminado y se puede restaurar desde la propia aplicación
-- (Lista de reportes → «Ver eliminados», solo administradores).
--
-- Las lecturas del módulo filtran `deleted_at is null`, así que el reporte
-- desaparece de la vista igual que antes: para el usuario no cambia nada.
--
-- Aditiva. No modifica ninguna fila existente (todas quedan con deleted_at NULL,
-- es decir, vigentes).
--
-- Rollback: alter table public.csl_reportes drop column deleted_at, drop column
--   deleted_by, drop column deleted_reason;
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.csl_reportes add column if not exists deleted_at     timestamptz;
alter table public.csl_reportes add column if not exists deleted_by     uuid;
alter table public.csl_reportes add column if not exists deleted_by_name text;
alter table public.csl_reportes add column if not exists deleted_reason text;

-- Los listados piden siempre los vigentes: índice parcial para que no cueste.
create index if not exists csl_reportes_vigentes_idx
  on public.csl_reportes (business_id, fecha desc)
  where deleted_at is null;

comment on column public.csl_reportes.deleted_at is
  'Marca de borrado suave. NULL = reporte vigente. Los listados filtran por esta columna; el reporte se puede restaurar desde el módulo.';

notify pgrst, 'reload schema';

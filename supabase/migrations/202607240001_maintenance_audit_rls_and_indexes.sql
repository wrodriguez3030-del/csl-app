-- 202607240001 — Auditoría de seguridad: RLS faltante + índices compuestos
--
-- Aditivo y NO destructivo. Seguro de aplicar en caliente.
--
-- Aplicar a db-cls:
--   ssh cibaocloud@apps-01 'docker exec -i supabase-db psql -U supabase_admin -d postgres' < este_archivo.sql
--   (o pegarlo en el SQL Editor de Studio de db-cls). Termina con NOTIFY pgrst.
--
-- Contexto (auditoría 2026-07-24):
--  1. csl_maintenance_audit era la ÚNICA tabla multi-tenant con business_id SIN
--     RLS habilitado → un authenticated podía leer/insertar/borrar la bitácora
--     de auditoría de CUALQUIER tenant vía PostgREST directo (integridad del
--     trail comprometida).
--  2. csl_sesiones_cliente (~24.6k filas) solo tenía índice single-column
--     business_id; sus patrones reales de consulta (rango de fechas, dedupe por
--     import_hash) hacían scan en heap.

-- ── 1. RLS en csl_maintenance_audit ───────────────────────────────────────
-- SELECT scopeado por tenant; las escrituras quedan SOLO para service_role
-- (que bypassa RLS): la bitácora es append-only desde el servidor. No se crean
-- políticas de insert/update/delete para authenticated → no puede escribirla.
alter table public.csl_maintenance_audit enable row level security;

drop policy if exists tenant_select on public.csl_maintenance_audit;
create policy tenant_select on public.csl_maintenance_audit
  for select using (business_id = public.current_business_id() or public.is_superadmin());

comment on table public.csl_maintenance_audit is
  'Bitácora de mantenimiento (append-only, escrita por service_role). RLS: SELECT por tenant; sin escritura para authenticated.';

-- ── 2. Índices compuestos en csl_sesiones_cliente ─────────────────────────
-- (business_id, fecha): sirve filtro+rango de recalculateDispOperador y getRows
-- con sinceColumn='fecha'. (business_id, import_hash): dedupe del import.
create index if not exists idx_csl_sesiones_business_fecha
  on public.csl_sesiones_cliente (business_id, fecha);

create index if not exists idx_csl_sesiones_business_import_hash
  on public.csl_sesiones_cliente (business_id, import_hash);

-- ── 3. Índice compuesto en csl_pulse_readings ─────────────────────────────
-- Sirve el filtro por tenant + order/gte por period_start de getPulseReadings
-- y de los recálculos de PulseControl (hoy solo cubierto por la constraint
-- UNIQUE, cuya columna líder business_id no ordena por period_start).
create index if not exists idx_csl_pulse_readings_business_period
  on public.csl_pulse_readings (business_id, period_start desc);

-- Refrescar el schema cache de PostgREST.
notify pgrst, 'reload schema';

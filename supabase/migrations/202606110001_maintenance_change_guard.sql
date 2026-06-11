-- 202606110001_maintenance_change_guard.sql
--
-- Blindaje del módulo MANTENIMIENTO: estos datos solo pueden ser modificados
-- manualmente por un técnico o admin autorizado DENTRO del módulo. Ningún
-- proceso automático (seed, sync, import, PulseControl, AgendaPro, scripts de
-- normalización/reparación, cambios de tenant/sucursal, carga de maestros)
-- debe crear/editar/reemplazar/borrar estas filas.
--
-- Esta migración es ESTRICTAMENTE ADITIVA:
--   - NO hace DELETE / TRUNCATE / DROP.
--   - NO reemplaza datos existentes.
--   - Solo agrega columnas de auditoría (idempotente) y la tabla de bitácora.
--
-- La lógica de bloqueo vive en la app (lib/server/maintenance-guard.ts); estas
-- columnas son para persistir el ORIGEN del cambio y la bitácora de auditoría.

-- ── 1. Columnas de auditoría en las tablas protegidas ──────────────────────
-- change_source: manual_tecnico | manual_admin (lo que la app permite escribir).
-- created_by / updated_by: user_id (uuid) responsable del cambio manual.
-- created_at / updated_at: timestamps (varios ya existen; IF NOT EXISTS es no-op).

do $$
declare
  t text;
  tablas text[] := array[
    'csl_equipos',
    'csl_reportes',
    'csl_piezas',
    'csl_tecnicos',
    'csl_inventario',
    'csl_piezas_poliza_lista'
  ];
begin
  foreach t in array tablas loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists change_source text', t);
      execute format('alter table public.%I add column if not exists created_by uuid', t);
      execute format('alter table public.%I add column if not exists updated_by uuid', t);
      execute format('alter table public.%I add column if not exists created_at timestamptz default now()', t);
      execute format('alter table public.%I add column if not exists updated_at timestamptz default now()', t);
    end if;
  end loop;
end $$;

-- ── 2. Bitácora de auditoría de mantenimiento ──────────────────────────────
-- Registra TODO cambio manual permitido y TODO intento automático bloqueado
-- (change_source = 'auto_change_blocked').

create table if not exists public.csl_maintenance_audit (
  id uuid primary key default gen_random_uuid(),
  business_id   uuid,
  entity        text,
  table_name    text,
  record_key    text,
  op            text,          -- upsert | update | delete
  change_source text,          -- manual_tecnico | manual_admin | auto_change_blocked
  user_id       uuid,
  user_email    text,
  details       jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists idx_csl_maint_audit_business_created
  on public.csl_maintenance_audit (business_id, created_at desc);

create index if not exists idx_csl_maint_audit_source
  on public.csl_maintenance_audit (change_source, created_at desc);

comment on table public.csl_maintenance_audit is
  'Bitácora de mantenimiento: cambios manuales (manual_tecnico/manual_admin) e intentos automáticos bloqueados (auto_change_blocked).';

-- Recargar el cache de esquema de PostgREST para que las columnas nuevas sean visibles.
notify pgrst, 'reload schema';

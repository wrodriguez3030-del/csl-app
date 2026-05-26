-- ─────────────────────────────────────────────────────────────────────────────
-- 011 — Soporte para integración AgendaPro (solo clientes)
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Columnas en csl_cosmiatria_clientes para trazar origen AgendaPro.
-- 2. Tabla csl_agendapro_sync_logs (un row por sync ejecutado).
-- 3. RLS de tenant (mismo patrón que tablas csl_*).
--
-- Solo aplica a CSL — Depicenter queda fuera por ahora (cuenta AgendaPro
-- separada, futuro).
--
-- Idempotente. No destructivo. No borra ni cambia datos existentes.
-- ─────────────────────────────────────────────────────────────────────────────

-- 11a. Columnas en csl_cosmiatria_clientes
alter table public.csl_cosmiatria_clientes
  add column if not exists agendapro_client_id text,
  add column if not exists agendapro_synced_at timestamptz,
  add column if not exists origen text;

create unique index if not exists csl_cosmiatria_clientes_agendapro_uq
  on public.csl_cosmiatria_clientes(business_id, agendapro_client_id)
  where agendapro_client_id is not null;

create index if not exists csl_cosmiatria_clientes_origen_idx
  on public.csl_cosmiatria_clientes(origen)
  where origen is not null;

comment on column public.csl_cosmiatria_clientes.agendapro_client_id is
  'ID del cliente en AgendaPro (string). NULL = no vino de AgendaPro.';
comment on column public.csl_cosmiatria_clientes.agendapro_synced_at is
  'Última fecha en que el cliente fue actualizado desde AgendaPro.';
comment on column public.csl_cosmiatria_clientes.origen is
  'Origen del registro: AgendaPro / Manual / Import / etc.';

-- 11b. Tabla de logs de sincronización
create table if not exists public.csl_agendapro_sync_logs (
  sync_id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  source text not null default 'manual',
  triggered_by uuid references auth.users(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  total integer not null default 0,
  created integer not null default 0,
  updated integer not null default 0,
  skipped integer not null default 0,
  duplicates integer not null default 0,
  errors integer not null default 0,
  error_details jsonb,
  status text not null default 'running'
);

create index if not exists csl_agendapro_sync_logs_business_idx
  on public.csl_agendapro_sync_logs(business_id);
create index if not exists csl_agendapro_sync_logs_started_idx
  on public.csl_agendapro_sync_logs(started_at desc);

comment on table public.csl_agendapro_sync_logs is
  'Auditoría de sincronizaciones AgendaPro → csl_cosmiatria_clientes.';

-- 11c. RLS
alter table public.csl_agendapro_sync_logs enable row level security;

drop policy if exists tenant_select on public.csl_agendapro_sync_logs;
drop policy if exists tenant_insert on public.csl_agendapro_sync_logs;
drop policy if exists tenant_update on public.csl_agendapro_sync_logs;
drop policy if exists tenant_delete on public.csl_agendapro_sync_logs;

create policy tenant_select on public.csl_agendapro_sync_logs
  for select using (business_id = public.current_business_id() or public.is_superadmin());
create policy tenant_insert on public.csl_agendapro_sync_logs
  for insert with check (business_id = public.current_business_id() or public.is_superadmin());
create policy tenant_update on public.csl_agendapro_sync_logs
  for update using (public.is_superadmin()) with check (public.is_superadmin());
create policy tenant_delete on public.csl_agendapro_sync_logs
  for delete using (public.is_superadmin());

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback:
--   drop table if exists public.csl_agendapro_sync_logs;
--   alter table public.csl_cosmiatria_clientes
--     drop column if exists origen,
--     drop column if exists agendapro_synced_at,
--     drop column if exists agendapro_client_id;
-- ─────────────────────────────────────────────────────────────────────────────

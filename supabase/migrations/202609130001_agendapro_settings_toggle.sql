-- ─────────────────────────────────────────────────────────────────────────────
-- 202609130001 — Interruptor de AgendaPro controlado desde la app (sin Vercel)
-- ─────────────────────────────────────────────────────────────────────────────
-- Hasta hoy, encender/apagar la integración de AgendaPro (webhook de clientes,
-- cron de clientes, webhook de pagos, cron de pagos) requería cambiar variables
-- de entorno en Vercel (AGENDAPRO_SYNC_ENABLED / AGENDAPRO_WEBHOOK_ENABLED) y
-- redesplegar. Esta tabla singleton agrega un interruptor operable desde la
-- pantalla Administración → Integración AgendaPro (botón encender/apagar),
-- sin tocar Vercel. Es un AND con las env vars: ambas deben estar en "true"
-- (o sin fila = default true) para que la integración funcione.
--
-- Global (no por business_id): hoy toda la integración de webhook/cron de
-- AgendaPro es siempre-CSL (ver app/api/integrations/agendapro/{webhook,cron,
-- payments,payments-cron}). Si en el futuro se vuelve multi-tenant, esta tabla
-- se extiende con business_id.
--
-- Idempotente. Aditivo. No borra ni cambia datos existentes.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.csl_agendapro_settings (
  id text primary key default 'global',
  sync_enabled boolean not null default true,
  webhook_enabled boolean not null default true,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint csl_agendapro_settings_singleton check (id = 'global')
);

comment on table public.csl_agendapro_settings is
  'Interruptor global de la integración AgendaPro (sync de clientes / webhook de pagos), operable desde la UI. AND con las env vars AGENDAPRO_SYNC_ENABLED/AGENDAPRO_WEBHOOK_ENABLED.';

alter table public.csl_agendapro_settings enable row level security;

drop policy if exists superadmin_select on public.csl_agendapro_settings;
drop policy if exists superadmin_update on public.csl_agendapro_settings;
drop policy if exists superadmin_insert on public.csl_agendapro_settings;

create policy superadmin_select on public.csl_agendapro_settings
  for select using (public.is_superadmin());
create policy superadmin_insert on public.csl_agendapro_settings
  for insert with check (public.is_superadmin());
create policy superadmin_update on public.csl_agendapro_settings
  for update using (public.is_superadmin()) with check (public.is_superadmin());

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback:  drop table if exists public.csl_agendapro_settings;
-- ─────────────────────────────────────────────────────────────────────────────

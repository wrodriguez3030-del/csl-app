-- ─────────────────────────────────────────────────────────────────────────────
-- 202607220001 — Configuración de correo (Gmail) por negocio (multi-tenant)
-- ─────────────────────────────────────────────────────────────────────────────
-- Permite configurar la cuenta de Gmail remitente + "contraseña de aplicación"
-- POR business_id (Cibao y Depicenter usan cuentas de correo SEPARADAS). Los
-- correos cara al cliente (Ficha Dermatológica + Consentimientos) salen desde el
-- Gmail del negocio. La app password se guarda CIFRADA (AES-256-GCM en el
-- backend); aquí solo persistimos el ciphertext (encrypted_password) y los
-- últimos 4 caracteres para mostrar `••••1234`. Nunca en texto plano.
--
-- Separación total por tenant: UNIQUE(business_id). El backend resuelve SIEMPRE
-- por el business activo. Si un negocio no tiene fila, el envío cae al respaldo
-- Resend (retrocompatibilidad, cero interrupción).
--
-- Idempotente. Aditivo. No borra ni cambia datos existentes.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.csl_email_settings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  gmail_user text,
  encrypted_password text,
  key_last4 text,
  from_name text,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id)
);

create index if not exists csl_email_settings_business_idx
  on public.csl_email_settings(business_id);

comment on table public.csl_email_settings is
  'Configuración de correo (Gmail) por negocio. La app password va cifrada (AES-256-GCM) en encrypted_password; key_last4 es solo para mostrar ••••1234. Nunca texto plano. Un registro por business_id.';

-- RLS (defense-in-depth; el backend usa service_role y scopea por business_id).
alter table public.csl_email_settings enable row level security;

drop policy if exists tenant_select on public.csl_email_settings;
drop policy if exists tenant_insert on public.csl_email_settings;
drop policy if exists tenant_update on public.csl_email_settings;
drop policy if exists tenant_delete on public.csl_email_settings;

create policy tenant_select on public.csl_email_settings
  for select using (business_id = public.current_business_id() or public.is_superadmin());
create policy tenant_insert on public.csl_email_settings
  for insert with check (business_id = public.current_business_id() or public.is_superadmin());
create policy tenant_update on public.csl_email_settings
  for update using (business_id = public.current_business_id() or public.is_superadmin())
  with check (business_id = public.current_business_id() or public.is_superadmin());
create policy tenant_delete on public.csl_email_settings
  for delete using (public.is_superadmin());

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback:  drop table if exists public.csl_email_settings;
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 202607200001 — Credenciales AgendaPro por negocio (multi-tenant)
-- ─────────────────────────────────────────────────────────────────────────────
-- Permite configurar usuario/clave de la API Pública de AgendaPro POR business_id
-- (Cibao y Depicenter tienen cuentas AgendaPro separadas). La clave se guarda
-- CIFRADA (AES-256-GCM en el backend); aquí solo persistimos el ciphertext y los
-- últimos 4 caracteres para mostrar `****1234`. Nunca en texto plano.
--
-- Separación total por tenant: UNIQUE(business_id, provider). El backend resuelve
-- SIEMPRE por el business activo. Cae a las env vars (AGENDAPRO_*) si un negocio
-- no tiene credenciales en esta tabla (retrocompatibilidad con CSL).
--
-- Idempotente. Aditivo. No borra ni cambia datos existentes.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.csl_agendapro_credentials (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  provider text not null default 'agendapro',
  api_user text,
  encrypted_api_key text,
  key_last4 text,
  base_url text,
  clients_path text,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, provider)
);

create index if not exists csl_agendapro_credentials_business_idx
  on public.csl_agendapro_credentials(business_id);

comment on table public.csl_agendapro_credentials is
  'Credenciales de la API Pública de AgendaPro por negocio. La clave va cifrada (AES-256-GCM) en encrypted_api_key; key_last4 es solo para mostrar ****1234. Nunca texto plano.';

-- RLS (defense-in-depth; el backend usa service_role y scopea por business_id).
alter table public.csl_agendapro_credentials enable row level security;

drop policy if exists tenant_select on public.csl_agendapro_credentials;
drop policy if exists tenant_insert on public.csl_agendapro_credentials;
drop policy if exists tenant_update on public.csl_agendapro_credentials;
drop policy if exists tenant_delete on public.csl_agendapro_credentials;

create policy tenant_select on public.csl_agendapro_credentials
  for select using (business_id = public.current_business_id() or public.is_superadmin());
create policy tenant_insert on public.csl_agendapro_credentials
  for insert with check (business_id = public.current_business_id() or public.is_superadmin());
create policy tenant_update on public.csl_agendapro_credentials
  for update using (business_id = public.current_business_id() or public.is_superadmin())
  with check (business_id = public.current_business_id() or public.is_superadmin());
create policy tenant_delete on public.csl_agendapro_credentials
  for delete using (public.is_superadmin());

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback:  drop table if exists public.csl_agendapro_credentials;
-- ─────────────────────────────────────────────────────────────────────────────

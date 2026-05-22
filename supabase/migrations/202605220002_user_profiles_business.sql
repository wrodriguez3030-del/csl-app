-- ─────────────────────────────────────────────────────────────────────────────
-- 002 — csl_user_profiles: agregar business_id + is_superadmin
-- ─────────────────────────────────────────────────────────────────────────────
-- Extiende la tabla de perfiles para soportar multi-tenant.
--
-- Pasos:
--   2a. Agregar columnas nullable (no rompe inserts existentes)
--   2b. Backfill: todos los usuarios actuales → CSL
--   2c. Forzar business_id NOT NULL (después del backfill)
--
-- Pre-condición: 001_businesses_table.sql ya ejecutado con CSL+Depicenter.
-- Rollback: alter table drop column business_id; drop column is_superadmin;
-- ─────────────────────────────────────────────────────────────────────────────

-- 2a. Agregar columnas
alter table public.csl_user_profiles
  add column if not exists business_id   uuid references public.businesses(id),
  add column if not exists is_superadmin boolean not null default false;

-- 2b. Backfill: todos los users existentes son de CSL
update public.csl_user_profiles
  set business_id = (select id from public.businesses where slug = 'csl')
  where business_id is null;

-- 2c. Forzar NOT NULL ahora que el backfill ya corrió
alter table public.csl_user_profiles
  alter column business_id set not null;

-- Índice para joins frecuentes (current_business_id() en RLS)
create index if not exists csl_user_profiles_business_idx
  on public.csl_user_profiles(business_id);

create index if not exists csl_user_profiles_user_id_idx
  on public.csl_user_profiles(user_id);

comment on column public.csl_user_profiles.business_id is
  'Tenant del usuario. Determina qué filas puede ver via RLS. Backfill 2026-05-22 asignó todos a CSL.';

comment on column public.csl_user_profiles.is_superadmin is
  'Cuando true, RLS no aplica filtro por business_id — el usuario ve todos los tenants. Distinto a is_admin (que solo otorga acceso a todos los menús dentro del mismo tenant).';

-- Verificación
-- select business_id, count(*) from public.csl_user_profiles group by business_id;

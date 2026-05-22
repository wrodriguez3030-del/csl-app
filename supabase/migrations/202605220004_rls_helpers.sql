-- ─────────────────────────────────────────────────────────────────────────────
-- 004 — Helpers RLS: current_business_id() + is_superadmin()
-- ─────────────────────────────────────────────────────────────────────────────
-- Funciones reutilizables por todas las policies. SECURITY DEFINER para
-- que el lookup a csl_user_profiles no requiera permisos del caller.
--
-- Search_path fijado a public + auth para prevenir search_path injection.
--
-- Rollback: drop function public.current_business_id; drop function public.is_superadmin;
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.current_business_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select business_id
  from public.csl_user_profiles
  where user_id = auth.uid()
    and active = true
  limit 1
$$;

create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce((
    select is_superadmin
    from public.csl_user_profiles
    where user_id = auth.uid()
      and active = true
    limit 1
  ), false)
$$;

-- Garantizar que solo authenticated puedan ejecutarlas (no anon)
revoke all on function public.current_business_id() from public;
revoke all on function public.is_superadmin() from public;
grant execute on function public.current_business_id() to authenticated;
grant execute on function public.is_superadmin() to authenticated;

comment on function public.current_business_id() is
  'Devuelve el business_id del usuario JWT actual (auth.uid()). NULL si no logueado o usuario inactivo. Usado por todas las políticas RLS de tablas csl_*.';

comment on function public.is_superadmin() is
  'true si el usuario JWT actual tiene is_superadmin = true. Los superadmins ignoran filtros de business_id en RLS.';

-- Verificación (logueado como superadmin debería devolver true; usuario CSL devuelve uuid de CSL)
-- select public.current_business_id(), public.is_superadmin();

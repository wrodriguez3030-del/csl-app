-- ─────────────────────────────────────────────────────────────────────────────
-- 202607020001_user_profile_permissions.sql
--
-- Permisos GRANULARES por usuario, independientes de:
--   · menus (visibilidad de tabs en el sidebar)
--   · is_admin / is_superadmin (roles amplios)
--
-- Caso que lo motiva: CARLOS (Carlos Arias, rol compras, no admin) debe poder
-- ELIMINAR requisiciones de materiales sin que se le eleve a admin. El permiso
-- se guarda como string tipo "material_requisitions.delete" en un text[].
--
-- Migración ADITIVA y segura: no toca filas existentes (default '{}').
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.csl_user_profiles
  add column if not exists permissions text[] not null default '{}';

comment on column public.csl_user_profiles.permissions is
  'Permisos granulares por usuario, p.ej. "material_requisitions.delete". Independiente de menus (visibilidad) y de is_admin/is_superadmin (roles).';

-- Grant inicial: Carlos Arias (CSL) puede eliminar requisiciones de materiales.
update public.csl_user_profiles
set permissions = (
      select array(
        select distinct p from unnest(coalesce(permissions, '{}') || array['material_requisitions.delete']) as p
      )
    ),
    updated_at = now()
where user_id = '170c49bc-0c8a-4ea6-a952-4319d858268b';

notify pgrst, 'reload schema';

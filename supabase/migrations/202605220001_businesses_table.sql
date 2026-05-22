-- ─────────────────────────────────────────────────────────────────────────────
-- 001 — Tabla businesses (multi-tenant)
-- ─────────────────────────────────────────────────────────────────────────────
-- Crea la tabla central de negocios para el modelo multi-tenant.
-- Inserta CSL (Cibao Spa Laser) y Depicenter (Depicenter Skin Laser) como
-- los dos primeros tenants.
--
-- Idempotente:
--   - `create table if not exists` permite re-ejecutar sin error
--   - `on conflict (slug) do nothing` evita duplicar seeds
--
-- Rollback: drop table public.businesses cascade
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.businesses (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name          text not null,
  display_name  text,
  logo_url      text,
  primary_color text default '#14B7B0',
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

comment on table public.businesses is
  'Tenants del sistema CSL. Cada usuario pertenece a un business via csl_user_profiles.business_id. Las tablas operativas csl_* tienen business_id que apunta acá.';

insert into public.businesses (slug, name, display_name, logo_url, primary_color)
values
  (
    'csl',
    'Cibao Spa Laser',
    'Cibao Spa Laser · CSL',
    '/cibao-spa-laser-logo.jpeg',
    '#14B7B0'
  ),
  (
    'depicenter',
    'Depicenter Skin Laser',
    'Depicenter Skin Laser',
    '/brands/depicenter-logo.jpg',
    '#FF6B9D'
  )
on conflict (slug) do nothing;

-- Verificación (debería retornar 2 filas: csl + depicenter)
-- select slug, name from public.businesses order by slug;

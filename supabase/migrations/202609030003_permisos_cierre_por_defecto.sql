-- ─────────────────────────────────────────────────────────────────────────────
-- 202609030003 — Cierre por defecto de permisos: registro y auditoría
-- ─────────────────────────────────────────────────────────────────────────────
-- MOTIVO
-- Hasta ahora los menús decidían lo que se VEÍA, pero la API no comprobaba
-- nada: los 21 usuarios autenticados podían invocar cualquiera de las 360
-- acciones del despachador —nómina, cuentas bancarias, TXT del banco,
-- préstamos, prestaciones, PIN de ponche— tuvieran o no el menú.
--
-- El modelo nuevo declara el permiso de cada acción en
-- `lib/permissions/action-map.ts` y lo exige en un solo punto. Se enciende en
-- dos tiempos con `PERMISOS_ESTRICTOS`:
--   · sin definir → SOMBRA: no bloquea, anota en `csl_permission_denials`.
--   · "on"        → ESTRICTO: rechaza con 403 y anota igual.
--
-- Esta migración solo crea las dos tablas del registro. No cambia permisos de
-- nadie: eso lo hace `scripts/migrar-permisos-desde-menus.mjs`, que primero
-- imprime la tabla completa para que el dueño la mire.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. Lo que se habría negado (o se negó) ══════════════════════════════════
create table if not exists public.csl_permission_denials (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid,
  user_id     uuid,
  user_email  text,
  accion      text not null,
  permiso     text not null,
  ruta        text,
  -- 'sombra' = solo se anotó; 'estricto' = además se rechazó.
  modo        text not null default 'sombra',
  ip_address  text,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_permission_denials_created  on public.csl_permission_denials (created_at desc);
create index if not exists idx_permission_denials_business on public.csl_permission_denials (business_id, created_at desc);
create index if not exists idx_permission_denials_user     on public.csl_permission_denials (user_email, created_at desc);

comment on table public.csl_permission_denials is
  'Rechazos de permiso. En modo sombra es la lista de lo que faltaría por conceder antes de cerrar de verdad.';

-- ═══ 2. Quién dio o quitó qué permiso, a quién ═══════════════════════════════
create table if not exists public.csl_permission_changes (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid,
  target_user_id    uuid not null,
  target_username   text,
  actor_user_id     uuid,
  actor_email       text,
  permisos_antes    text[] not null default '{}',
  permisos_despues  text[] not null default '{}',
  created_at        timestamptz not null default now()
);

create index if not exists idx_permission_changes_target on public.csl_permission_changes (target_user_id, created_at desc);
create index if not exists idx_permission_changes_actor  on public.csl_permission_changes (actor_user_id, created_at desc);

comment on table public.csl_permission_changes is
  'Auditoría de concesión/retirada de permisos. Es también el respaldo para deshacer la migración inicial.';

-- ═══ 3. Solo el servidor las toca ════════════════════════════════════════════
-- Coherente con 202609030002: `anon`/`authenticated` no escriben en la base.
alter table public.csl_permission_denials enable row level security;
alter table public.csl_permission_changes enable row level security;

revoke all on table public.csl_permission_denials from anon, authenticated;
revoke all on table public.csl_permission_changes from anon, authenticated;
grant all on table public.csl_permission_denials to service_role;
grant all on table public.csl_permission_changes to service_role;

notify pgrst, 'reload schema';

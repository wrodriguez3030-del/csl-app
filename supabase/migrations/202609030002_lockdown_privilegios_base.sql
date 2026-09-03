-- ─────────────────────────────────────────────────────────────────────────────
-- 202609030002 — Cierre de privilegios directos sobre la base
-- ─────────────────────────────────────────────────────────────────────────────
-- MOTIVO
-- El rol `authenticated` tenía INSERT/UPDATE/DELETE/TRUNCATE sobre 114 tablas de
-- `public`, y `anon` sobre 29. Las políticas RLS separan SOLO por negocio, nunca
-- por rol ni por permiso: la de `hr_payroll_items`, por ejemplo, es
-- `business_id = (el negocio del usuario)` y nada más.
--
-- Como `NEXT_PUBLIC_SUPABASE_ANON_KEY` viaja en el navegador por diseño,
-- cualquiera de los 17 usuarios normales podía —con su sesión y esa clave—
-- leer o BORRAR todo lo de su clínica hablando directo con PostgREST: nómina,
-- cuentas bancarias, la bóveda de credenciales y los 19.456 pacientes con su
-- cédula, teléfono y dirección. Sin pasar por la app, sin permisos y sin dejar
-- rastro en la auditoría.
--
-- Esto ya se descubrió en agosto y se cerró SOLO para Mantenimiento
-- (202608150002_maintenance_lockdown.sql). Aquí se generaliza a todo el esquema.
--
-- POR QUÉ ES SEGURO
-- Verificado antes de escribir esta migración:
--   · El navegador NO escribe en la base: cero `insert/update/delete/upsert`
--     desde el cliente. Todas las escrituras van por `/api/csl` con service_role.
--   · La única lectura directa del navegador es `csl_user_profiles`
--     (`lib/security.ts:151` y `:223`), con el join a `businesses`.
--   · No hay suscripciones realtime (0 tablas en `supabase_realtime`).
-- Por eso se conserva SELECT en esas dos tablas y se retira el resto.
--
-- CÓMO REVERTIR (si algo dejara de funcionar)
--   grant select, insert, update, delete on all tables in schema public to authenticated;
-- Y volver a poner los DEFAULT PRIVILEGES del bloque 3.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. Retirar TODO a `anon` y `authenticated` ══════════════════════════════
-- `public` incluido: es el rol del que heredan todos los demás.
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
revoke insert, update, delete, truncate on all tables in schema public from public;

-- ═══ 2. Devolver SOLO lo que el navegador necesita ═══════════════════════════
-- Con RLS encima: un usuario ve únicamente su propia fila / su propio negocio.
grant select on table public.csl_user_profiles to authenticated;
grant select on table public.businesses       to authenticated;

-- ═══ 3. Que las tablas FUTURAS no hereden permisos ═══════════════════════════
-- El origen del problema: 202606020012_hr_grants_fix.sql:24-26 dejó
-- `ALTER DEFAULT PRIVILEGES … GRANT SELECT, INSERT, UPDATE, DELETE … TO
-- authenticated`, así que toda tabla creada desde junio 2026 nacía abierta.
alter default privileges for role supabase_admin in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;

-- ═══ 4. El servidor conserva todo ════════════════════════════════════════════
-- `service_role` es la única vía que pasa por las guardias de la aplicación,
-- los permisos granulares y la auditoría.
grant all on all tables in schema public to service_role;
grant usage on schema public to anon, authenticated, service_role;

notify pgrst, 'reload schema';

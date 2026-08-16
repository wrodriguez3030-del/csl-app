-- ─────────────────────────────────────────────────────────────────────────────
-- 202608150002 — Aislamiento del módulo MANTENIMIENTO
-- ─────────────────────────────────────────────────────────────────────────────
-- Motivo: se reportó pérdida de datos en Mantenimiento. La guardia de aplicación
-- (`lib/server/maintenance-guard.ts`) sí contiene: desde el 2026-06-11 no hay un
-- solo intento automático bloqueado y solo 2 borrados manuales. Pero el rol
-- `authenticated` tenía INSERT/UPDATE/DELETE/TRUNCATE sobre las tablas del
-- módulo, y las políticas RLS permiten tocar las filas del propio negocio: con
-- una sesión iniciada, cualquier usuario podía borrar todos los reportes de su
-- empresa vía PostgREST **sin pasar por el módulo, sin ser técnico y sin dejar
-- rastro en la auditoría**.
--
-- Qué hace esta migración:
--   1. Deja las 6 tablas de mantenimiento en SOLO LECTURA para `authenticated`
--      y `anon`. Escribir queda reservado a `service_role`, que es la
--      credencial del servidor — el único camino que pasa por la guardia.
--   2. Convierte `csl_maintenance_audit` en un registro de SOLO AÑADIR: RLS
--      activo con lectura por tenant, y sin permiso de escribir, editar ni
--      borrar para los usuarios. El registro con el que se investiga ya no lo
--      puede borrar quien causó el problema.
--
-- Seguro para la aplicación: NINGUNA escritura a estas tablas sale del
-- navegador (verificado archivo por archivo); todas ocurren en el servidor con
-- `service_role`, que conserva todos los permisos. Tampoco toca
-- `csl_user_profiles` ni `businesses`, que son las que el navegador lee para
-- iniciar sesión.
--
-- Rollback: volver a conceder los permisos con
--   grant insert, update, delete on table public.<tabla> to authenticated;
--   alter table public.csl_maintenance_audit disable row level security;
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. Tablas del módulo: solo lectura para los usuarios ════════════════════
do $$
declare
  t text;
begin
  foreach t in array array[
    'csl_equipos',
    'csl_reportes',
    'csl_piezas',
    'csl_tecnicos',
    'csl_inventario',
    'csl_piezas_poliza_lista'
  ] loop
    execute format('revoke insert, update, delete, truncate on table public.%I from authenticated', t);
    execute format('revoke insert, update, delete, truncate on table public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on table public.%I from public', t);
    -- La lectura se conserva: la app y los reportes la necesitan.
    execute format('grant select on table public.%I to authenticated', t);
    -- El servidor (la única vía que pasa por la guardia) mantiene todo.
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

-- ═══ 2. Auditoría de mantenimiento: solo añadir ══════════════════════════════
alter table public.csl_maintenance_audit enable row level security;

drop policy if exists tenant_select on public.csl_maintenance_audit;
create policy tenant_select on public.csl_maintenance_audit
  for select using (business_id = public.current_business_id() or public.is_superadmin());

-- Sin políticas de insert/update/delete: para los usuarios queda denegado por
-- defecto. El servidor escribe con service_role, que ignora RLS.
revoke insert, update, delete, truncate on table public.csl_maintenance_audit from authenticated;
revoke insert, update, delete, truncate on table public.csl_maintenance_audit from anon;
revoke insert, update, delete, truncate on table public.csl_maintenance_audit from public;
grant select on table public.csl_maintenance_audit to authenticated;
grant all on table public.csl_maintenance_audit to service_role;

comment on table public.csl_maintenance_audit is
  'Registro de solo-añadir de los cambios del módulo Mantenimiento. Los usuarios solo pueden leer su tenant; escribe únicamente el servidor.';

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────────
-- 005 — RLS policies en las 19 tablas operativas + businesses + user_profiles
-- ─────────────────────────────────────────────────────────────────────────────
-- Política uniforme tenant_select/insert/update/delete:
--   - Usuario normal: business_id debe coincidir con su profile
--   - Superadmin: bypass total
--
-- ATENCIÓN CRÍTICA:
--   Después de esta migración, el backend que usa SUPABASE_SERVICE_ROLE_KEY
--   sigue bypaseando RLS (esa es la definición de service_role). Por eso esta
--   migración SOLA no es suficiente — hay que migrar el backend (csl-crud.ts)
--   a un cliente con JWT del usuario (Fase 5 del plan).
--
--   Si solo aplicás esta migration sin tocar el backend:
--     - Requests del backend (con service_role) siguen funcionando igual
--     - Requests directos a Supabase API con anon key + JWT respetan RLS
--     - El sistema actual sigue operando, pero ahora si alguien hackea anon
--       key + JWT solo puede ver su tenant
--
-- Pre-condición: 001-004 ejecutados.
-- Rollback: drop policy ... on cada tabla; alter table disable row level security;
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array[
    'csl_sucursales',
    'csl_equipos',
    'csl_reportes',
    'csl_piezas',
    'csl_tecnicos',
    'csl_inventario',
    'csl_credenciales',
    'csl_solicitudes_empleo',
    'csl_empleados',
    'csl_cosmiatria_clientes',
    'csl_ficha_dermatologica',
    'csl_consent_masajes',
    'csl_consent_tatuajes_cejas',
    'csl_certificados_regalo',
    'csl_certificados_depicenter',
    'csl_operadoras',
    'csl_lecturas_semanales',
    'csl_sesiones_cliente',
    'csl_auditorias_semanales'
  ] loop
    -- Habilitar RLS
    execute format('alter table public.%I enable row level security', t);

    -- Borrar policies previas (idempotente)
    execute format('drop policy if exists tenant_select on public.%I', t);
    execute format('drop policy if exists tenant_insert on public.%I', t);
    execute format('drop policy if exists tenant_update on public.%I', t);
    execute format('drop policy if exists tenant_delete on public.%I', t);

    -- SELECT
    execute format(
      'create policy tenant_select on public.%I for select using (business_id = public.current_business_id() or public.is_superadmin())',
      t
    );

    -- INSERT
    execute format(
      'create policy tenant_insert on public.%I for insert with check (business_id = public.current_business_id() or public.is_superadmin())',
      t
    );

    -- UPDATE (using = visibility, with check = post-update value)
    execute format(
      'create policy tenant_update on public.%I for update using (business_id = public.current_business_id() or public.is_superadmin()) with check (business_id = public.current_business_id() or public.is_superadmin())',
      t
    );

    -- DELETE
    execute format(
      'create policy tenant_delete on public.%I for delete using (business_id = public.current_business_id() or public.is_superadmin())',
      t
    );

    raise notice 'RLS aplicado a %', t;
  end loop;
end $$;

-- ─── Tablas especiales (businesses + user_profiles) ─────────────────────────

-- businesses: cualquier authenticated puede leer (necesario para que el
-- frontend cargue el branding al login). Solo superadmin puede modificar.
alter table public.businesses enable row level security;
drop policy if exists businesses_all_read on public.businesses;
create policy businesses_all_read on public.businesses for select
  using (auth.uid() is not null);

drop policy if exists businesses_superadmin_write on public.businesses;
create policy businesses_superadmin_write on public.businesses for all
  using (public.is_superadmin())
  with check (public.is_superadmin());

-- csl_user_profiles: el usuario solo puede leer su propia fila;
-- superadmin puede leer/escribir todo.
alter table public.csl_user_profiles enable row level security;
drop policy if exists own_profile_read on public.csl_user_profiles;
create policy own_profile_read on public.csl_user_profiles for select
  using (user_id = auth.uid() or public.is_superadmin());

drop policy if exists superadmin_profile_write on public.csl_user_profiles;
create policy superadmin_profile_write on public.csl_user_profiles for all
  using (public.is_superadmin())
  with check (public.is_superadmin());

-- Verificación: contar policies por tabla
-- select schemaname, tablename, policyname
-- from pg_policies
-- where schemaname = 'public' and tablename like 'csl_%' or tablename = 'businesses'
-- order by tablename, policyname;

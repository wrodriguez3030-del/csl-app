-- ─────────────────────────────────────────────────────────────────────────────
-- 202606280001 — Consentimiento de DEPILACIÓN LÁSER (eliminación del vello)
-- ─────────────────────────────────────────────────────────────────────────────
-- Nueva tabla csl_consent_depilacion_laser, clon estructural de
-- csl_consent_peeling. Multi-tenant por business_id (default CSL),
-- RLS tenant_select/insert/update/delete, grants a service_role, índices,
-- FKs a cliente / ficha. Aditiva, NO destructiva, idempotente.
--
-- Pre-condición: 001-005 ejecutados (businesses + RLS helpers
-- public.current_business_id() / public.is_superadmin()).
-- Rollback: drop table public.csl_consent_depilacion_laser;  (NO ejecutar en prod)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.csl_consent_depilacion_laser (
  id                                 uuid primary key default gen_random_uuid(),
  consent_id                         text unique,
  cliente_id                         text,
  ficha_id                           text,
  fecha                              date,
  sucursal                           text,
  estado                             text default 'Pendiente',
  nombre_cliente                     text,
  cliente_nombre                     text,
  documento                          text,
  telefono                           text,
  correo                             text,
  fecha_nacimiento                   date,
  edad                               integer,
  direccion                          text,
  -- Datos específicos del procedimiento de depilación láser
  tipo_depilacion                    text,
  zona_tratar                        text,
  zona_tratar_otro                   text,
  fototipo                           text,
  tipo_vello                         text,
  especialista                       text,
  especialista_nombre                text,
  -- Checklists oficiales (viajan también en payload_json)
  contraindicaciones                 jsonb default '[]'::jsonb,
  cuidados_antes                     jsonb default '[]'::jsonb,
  cuidados_despues                   jsonb default '[]'::jsonb,
  riesgos_aceptados                  jsonb default '[]'::jsonb,
  politicas                          jsonb default '[]'::jsonb,
  -- Aceptaciones del cliente
  acepta_procedimiento               boolean default false,
  acepta_riesgos                     boolean default false,
  acepta_politicas                   boolean default false,
  acepta_proteccion_datos            boolean default false,
  observaciones_medicas              text,
  observaciones                      text,
  texto_consentimiento               text,
  firma_cliente                      text,
  firma_especialista                 text,
  pdf_url                            text,
  fecha_registro                     timestamptz default now(),
  created_by                         text,
  updated_by                         text,
  payload_json                       jsonb default '{}'::jsonb,
  created_at                         timestamptz default now(),
  updated_at                         timestamptz default now()
);

-- ─── business_id (multi-tenant) ─────────────────────────────────────────────
do $$
declare
  csl_id uuid := (select id from public.businesses where slug = 'csl');
begin
  if csl_id is null then
    raise exception 'Falta business csl. Ejecuta 001 primero.';
  end if;

  alter table public.csl_consent_depilacion_laser
    add column if not exists business_id uuid references public.businesses(id);

  update public.csl_consent_depilacion_laser set business_id = csl_id where business_id is null;

  execute format('alter table public.csl_consent_depilacion_laser alter column business_id set default %L', csl_id);
  alter table public.csl_consent_depilacion_laser alter column business_id set not null;
end $$;

-- ─── FKs a cliente / ficha ──────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'csl_consent_depilacion_laser_cliente_fk'
  ) then
    alter table public.csl_consent_depilacion_laser
      add constraint csl_consent_depilacion_laser_cliente_fk
      foreign key (cliente_id) references public.csl_cosmiatria_clientes(cliente_id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'csl_consent_depilacion_laser_ficha_fk'
  ) then
    alter table public.csl_consent_depilacion_laser
      add constraint csl_consent_depilacion_laser_ficha_fk
      foreign key (ficha_id) references public.csl_ficha_dermatologica(ficha_id)
      on delete set null;
  end if;
end $$;

-- ─── Índices ────────────────────────────────────────────────────────────────
create unique index if not exists csl_consent_depilacion_laser_consent_id_uidx on public.csl_consent_depilacion_laser (consent_id);
create index if not exists csl_consent_depilacion_laser_business_idx on public.csl_consent_depilacion_laser (business_id);
create index if not exists csl_consent_depilacion_laser_cliente_idx  on public.csl_consent_depilacion_laser (cliente_id);
create index if not exists csl_consent_depilacion_laser_ficha_idx    on public.csl_consent_depilacion_laser (ficha_id);
create index if not exists csl_consent_depilacion_laser_fecha_idx    on public.csl_consent_depilacion_laser (fecha desc);
create index if not exists csl_consent_depilacion_laser_sucursal_idx on public.csl_consent_depilacion_laser (sucursal);
create index if not exists csl_consent_depilacion_laser_created_idx  on public.csl_consent_depilacion_laser (created_at desc);

-- ─── RLS (tenant) ───────────────────────────────────────────────────────────
alter table public.csl_consent_depilacion_laser enable row level security;

drop policy if exists tenant_select on public.csl_consent_depilacion_laser;
drop policy if exists tenant_insert on public.csl_consent_depilacion_laser;
drop policy if exists tenant_update on public.csl_consent_depilacion_laser;
drop policy if exists tenant_delete on public.csl_consent_depilacion_laser;

create policy tenant_select on public.csl_consent_depilacion_laser for select
  using (business_id = public.current_business_id() or public.is_superadmin());
create policy tenant_insert on public.csl_consent_depilacion_laser for insert
  with check (business_id = public.current_business_id() or public.is_superadmin());
create policy tenant_update on public.csl_consent_depilacion_laser for update
  using (business_id = public.current_business_id() or public.is_superadmin())
  with check (business_id = public.current_business_id() or public.is_superadmin());
create policy tenant_delete on public.csl_consent_depilacion_laser for delete
  using (business_id = public.current_business_id() or public.is_superadmin());

-- ─── Grants ─────────────────────────────────────────────────────────────────
grant all on table public.csl_consent_depilacion_laser to service_role;

-- ─── Reload PostgREST schema cache ──────────────────────────────────────────
notify pgrst, 'reload schema';

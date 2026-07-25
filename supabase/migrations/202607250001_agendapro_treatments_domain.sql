-- ─────────────────────────────────────────────────────────────────────────────
-- 202607250001 — Dominio "Control Digital de Tratamientos" + ingesta AgendaPro
-- ─────────────────────────────────────────────────────────────────────────────
-- Crea el modelo de datos que hoy NO existe en csl-app:
--   • csl_agendapro_location_map     — mapea location_id de AgendaPro → sucursal interna (+ tenant)
--   • csl_agendapro_service_map      — mapea nombre de servicio AgendaPro → servicio/categoría/consentimiento interno
--   • csl_agendapro_webhook_events   — bitácora idempotente de eventos del webhook de pagos
--   • csl_paquetes                   — ledger de compras/paquetes (sesiones adquiridas/disponibles)
--   • csl_cesiones                   — cesión de sesiones entre clientes
-- Y añade a csl_consent_depilacion_laser las columnas de enlace a compra/AgendaPro.
--
-- Todo multi-tenant por business_id (default CSL), RLS tenant_select/insert/update/delete,
-- grants a service_role, índices y UNIQUE de idempotencia. Aditiva, NO destructiva, idempotente.
--
-- Pre-condición: 001-005 ejecutados (businesses + RLS helpers
--   public.current_business_id() / public.is_superadmin()) y csl_cosmiatria_clientes
--   / csl_consent_depilacion_laser existentes.
-- Aplicar: node scripts/db-query.js --file supabase/migrations/202607250001_agendapro_treatments_domain.sql
--   (o) ssh cibaocloud@apps-01 'docker exec -i supabase-db psql -U supabase_admin -d postgres' < <file>
-- Rollback (NO ejecutar en prod):
--   drop table if exists public.csl_cesiones, public.csl_paquetes,
--     public.csl_agendapro_webhook_events, public.csl_agendapro_service_map,
--     public.csl_agendapro_location_map;
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. MAPA DE SUCURSALES (location_id → sucursal interna) ═══════════════════
create table if not exists public.csl_agendapro_location_map (
  id                        uuid primary key default gen_random_uuid(),
  business_id               uuid not null references public.businesses(id),
  agendapro_location_id     bigint not null,
  agendapro_location_name   text,
  internal_sucursal         text not null,
  active                    boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- ═══ 2. MAPA DE SERVICIOS (servicio AgendaPro → servicio/categoría/consentimiento) ══
create table if not exists public.csl_agendapro_service_map (
  id                        uuid primary key default gen_random_uuid(),
  business_id               uuid not null references public.businesses(id),
  agendapro_service_name    text not null,
  normalized_service_name   text not null,
  internal_service_name     text,
  categoria                 text,
  consent_type              text,          -- kind del consentimiento: 'depilacion-laser', 'masajes', ...
  sessions_quantity         integer not null default 1,
  active                    boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- ═══ 3. BITÁCORA DE EVENTOS DEL WEBHOOK (idempotencia) ════════════════════════
create table if not exists public.csl_agendapro_webhook_events (
  id                        uuid primary key default gen_random_uuid(),
  business_id               uuid not null references public.businesses(id),
  agendapro_payment_id      bigint,
  event_type                text not null default 'payment',
  status                    text not null default 'received',  -- received/processing/processed/duplicate/requires_mapping/failed/ignored
  attempts                  integer not null default 0,
  agendapro_location_id     bigint,
  agendapro_client_id       bigint,
  payload_hash              text,
  payload_json              jsonb,             -- payload completo protegido (solo service_role / superadmin)
  result_summary            jsonb,             -- { paquete_id, consent_id, cliente_id, ... }
  error_code                text,
  error_message             text,              -- saneado (sin PII completa)
  received_at               timestamptz not null default now(),
  processed_at              timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- ═══ 4. LEDGER DE PAQUETES / COMPRAS (sesiones adquiridas/disponibles) ════════
create table if not exists public.csl_paquetes (
  id                        uuid primary key default gen_random_uuid(),
  paquete_id                text unique,
  business_id               uuid not null references public.businesses(id),
  cliente_id                text,
  sucursal                  text,
  categoria                 text,
  servicio                  text,
  sesiones_adquiridas       integer not null default 0,
  sesiones_disponibles      integer not null default 0,
  monto                     numeric(12,2),
  monto_pagado              numeric(12,2),
  descuento                 numeric(12,2) default 0,
  metodo_pago               text,
  numero_transaccion        text,
  numero_factura            text,
  tipo_comprobante          text,
  proveedor                 text,
  fecha_compra              date,
  fecha_compra_utc          timestamptz,       -- timestamp original UTC de AgendaPro (auditoría)
  origen                    text not null default 'manual',      -- agendapro_webhook / manual / migracion
  estado                    text not null default 'disponible',  -- disponible/parcial/agotado/cedido_parcial/cedido_total/anulado
  requiere_revision         boolean not null default false,
  -- Enlace AgendaPro
  agendapro_payment_id      bigint,
  agendapro_receipt_id      bigint,
  agendapro_location_id     bigint,
  agendapro_client_id       bigint,
  service_identifier        text,              -- clave normalizada del servicio (idempotencia por pago+servicio)
  payload_json              jsonb,
  created_by                text,
  updated_by                text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- ═══ 5. CESIONES DE SESIONES ENTRE CLIENTES ══════════════════════════════════
create table if not exists public.csl_cesiones (
  id                        uuid primary key default gen_random_uuid(),
  cesion_id                 text unique,
  business_id               uuid not null references public.businesses(id),
  paquete_id                text,
  cliente_cede_id           text,
  cliente_recibe_id         text,
  cliente_cede_nombre       text,
  cliente_recibe_nombre     text,
  sesiones_cedidas          integer not null default 0,
  servicio                  text,
  categoria                 text,
  procesado_por             text,
  documento_relacionado     text,
  fecha                     date,
  notas                     text,
  payload_json              jsonb,
  created_by                text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- ─── business_id (multi-tenant): default = CSL, not null ─────────────────────
do $$
declare
  csl_id uuid := (select id from public.businesses where slug = 'csl');
  t text;
begin
  if csl_id is null then
    raise exception 'Falta business csl. Ejecuta 001 primero.';
  end if;

  foreach t in array array[
    'csl_agendapro_location_map',
    'csl_agendapro_service_map',
    'csl_agendapro_webhook_events',
    'csl_paquetes',
    'csl_cesiones'
  ] loop
    execute format('alter table public.%I alter column business_id set default %L', t, csl_id);
  end loop;
end $$;

-- ─── FKs a cliente / paquete ────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'csl_paquetes_cliente_fk') then
    alter table public.csl_paquetes add constraint csl_paquetes_cliente_fk
      foreign key (cliente_id) references public.csl_cosmiatria_clientes(cliente_id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'csl_cesiones_paquete_fk') then
    alter table public.csl_cesiones add constraint csl_cesiones_paquete_fk
      foreign key (paquete_id) references public.csl_paquetes(paquete_id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'csl_cesiones_cede_fk') then
    alter table public.csl_cesiones add constraint csl_cesiones_cede_fk
      foreign key (cliente_cede_id) references public.csl_cosmiatria_clientes(cliente_id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'csl_cesiones_recibe_fk') then
    alter table public.csl_cesiones add constraint csl_cesiones_recibe_fk
      foreign key (cliente_recibe_id) references public.csl_cosmiatria_clientes(cliente_id) on delete set null;
  end if;
end $$;

-- ─── Índices y UNIQUE de idempotencia ───────────────────────────────────────
-- location_map: una location física de AgendaPro mapea a UNA sucursal interna.
create unique index if not exists csl_agendapro_location_map_locid_uidx
  on public.csl_agendapro_location_map (agendapro_location_id);
create index if not exists csl_agendapro_location_map_business_idx
  on public.csl_agendapro_location_map (business_id);

-- service_map: un servicio normalizado por tenant.
create unique index if not exists csl_agendapro_service_map_norm_uidx
  on public.csl_agendapro_service_map (business_id, normalized_service_name);
create index if not exists csl_agendapro_service_map_business_idx
  on public.csl_agendapro_service_map (business_id);

-- webhook_events: idempotencia por (tenant, payment_id).
create unique index if not exists csl_agendapro_webhook_events_pay_uidx
  on public.csl_agendapro_webhook_events (business_id, agendapro_payment_id)
  where agendapro_payment_id is not null;
create index if not exists csl_agendapro_webhook_events_business_idx
  on public.csl_agendapro_webhook_events (business_id);
create index if not exists csl_agendapro_webhook_events_status_idx
  on public.csl_agendapro_webhook_events (business_id, status);
create index if not exists csl_agendapro_webhook_events_received_idx
  on public.csl_agendapro_webhook_events (received_at desc);

-- paquetes: idempotencia por (tenant, payment_id, servicio) solo para origen AgendaPro.
create unique index if not exists csl_paquetes_agendapro_uidx
  on public.csl_paquetes (business_id, agendapro_payment_id, service_identifier)
  where agendapro_payment_id is not null;
create index if not exists csl_paquetes_business_idx   on public.csl_paquetes (business_id);
create index if not exists csl_paquetes_cliente_idx    on public.csl_paquetes (business_id, cliente_id);
create index if not exists csl_paquetes_fecha_idx      on public.csl_paquetes (business_id, fecha_compra desc);
create index if not exists csl_paquetes_estado_idx     on public.csl_paquetes (business_id, estado);
create index if not exists csl_paquetes_origen_idx     on public.csl_paquetes (business_id, origen);
create index if not exists csl_paquetes_payment_idx    on public.csl_paquetes (agendapro_payment_id);

-- cesiones
create index if not exists csl_cesiones_business_idx   on public.csl_cesiones (business_id);
create index if not exists csl_cesiones_cede_idx       on public.csl_cesiones (business_id, cliente_cede_id);
create index if not exists csl_cesiones_recibe_idx     on public.csl_cesiones (business_id, cliente_recibe_id);
create index if not exists csl_cesiones_fecha_idx      on public.csl_cesiones (business_id, fecha desc);

-- ─── RLS (tenant) para las 5 tablas nuevas ──────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'csl_agendapro_location_map',
    'csl_agendapro_service_map',
    'csl_agendapro_webhook_events',
    'csl_paquetes',
    'csl_cesiones'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_select on public.%I', t);
    execute format('drop policy if exists tenant_insert on public.%I', t);
    execute format('drop policy if exists tenant_update on public.%I', t);
    execute format('drop policy if exists tenant_delete on public.%I', t);
    execute format('create policy tenant_select on public.%I for select using (business_id = public.current_business_id() or public.is_superadmin())', t);
    execute format('create policy tenant_insert on public.%I for insert with check (business_id = public.current_business_id() or public.is_superadmin())', t);
    execute format('create policy tenant_update on public.%I for update using (business_id = public.current_business_id() or public.is_superadmin()) with check (business_id = public.current_business_id() or public.is_superadmin())', t);
    execute format('create policy tenant_delete on public.%I for delete using (business_id = public.current_business_id() or public.is_superadmin())', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

-- ═══ 6. ENLACE DE CONSENTIMIENTO PENDIENTE ↔ COMPRA / AGENDAPRO ═══════════════
-- Añade a csl_consent_depilacion_laser las columnas para vincular un consentimiento
-- pendiente creado automáticamente por el webhook, con idempotencia por pago+servicio.
alter table public.csl_consent_depilacion_laser add column if not exists origen               text;
alter table public.csl_consent_depilacion_laser add column if not exists paquete_id           text;
alter table public.csl_consent_depilacion_laser add column if not exists agendapro_payment_id bigint;
alter table public.csl_consent_depilacion_laser add column if not exists service_identifier   text;

create unique index if not exists csl_consent_depilacion_laser_agendapro_uidx
  on public.csl_consent_depilacion_laser (business_id, agendapro_payment_id, service_identifier)
  where agendapro_payment_id is not null;
create index if not exists csl_consent_depilacion_laser_paquete_idx
  on public.csl_consent_depilacion_laser (paquete_id);

-- ═══ 7. SEEDS INICIALES (idempotentes) — solo tenant CSL ══════════════════════
do $$
declare
  csl_id uuid := (select id from public.businesses where slug = 'csl');
begin
  if csl_id is null then
    raise exception 'Falta business csl.';
  end if;

  -- Sucursal: AgendaPro 3586 "Cibao Spa Laser  Av. Rafael Vidal " → interna "Rafael Vidal"
  insert into public.csl_agendapro_location_map
    (business_id, agendapro_location_id, agendapro_location_name, internal_sucursal, active)
  values
    (csl_id, 3586, 'Cibao Spa Laser  Av. Rafael Vidal ', 'Rafael Vidal', true)
  on conflict (agendapro_location_id) do nothing;

  -- Servicio: "Depilación Láser  1 sesión" → Depilación láser / Depilación / consent depilacion-laser / 1 sesión
  insert into public.csl_agendapro_service_map
    (business_id, agendapro_service_name, normalized_service_name, internal_service_name, categoria, consent_type, sessions_quantity, active)
  values
    (csl_id, 'Depilación Láser  1 sesión', 'depilacion laser 1 sesion', 'Depilación láser', 'Depilación', 'depilacion-laser', 1, true)
  on conflict (business_id, normalized_service_name) do nothing;
end $$;

-- ─── Reload PostgREST schema cache ──────────────────────────────────────────
notify pgrst, 'reload schema';

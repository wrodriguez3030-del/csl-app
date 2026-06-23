-- ============================================================================
-- Módulo: Requisición de Materiales por Sucursal.
--
-- Aditivo y NO destructivo. Crea 4 tablas (catálogo, requisiciones, ítems,
-- auditoría) con business_id multi-tenant, RLS por tenant, grants a
-- service_role e índices. Siembra el catálogo inicial de CSL (BRAVO y
-- PRICES MART) sin duplicar.
--
-- Flujo: la encargada de una sucursal crea una requisición marcando materiales
-- y cantidades; compras/admin consolida por sucursal, aprueba/ajusta/rechaza,
-- marca comprado y registra la recepción (parcial/completa).
-- ============================================================================

-- ─── 1. Catálogo de materiales ──────────────────────────────────────────────
create table if not exists public.material_catalog (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid references public.businesses(id),
  name           text not null,
  category       text,
  supplier_group text,
  unit           text default 'unidad',
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ─── 2. Requisiciones (cabecera por sucursal) ────────────────────────────────
create table if not exists public.material_requisitions (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid references public.businesses(id),
  branch           text not null,
  requested_by     uuid,
  requested_at     timestamptz,
  status           text not null default 'borrador',  -- borrador|enviada|en_revision|aprobada|rechazada|comprada|recibida_parcial|recibida_completa
  notes            text,
  approved_by      uuid,
  approved_at      timestamptz,
  rejected_by      uuid,
  rejected_at      timestamptz,
  rejection_reason text,
  purchased_by     uuid,
  purchased_at     timestamptz,
  received_by      uuid,
  received_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ─── 3. Ítems de cada requisición ────────────────────────────────────────────
create table if not exists public.material_requisition_items (
  id                     uuid primary key default gen_random_uuid(),
  business_id            uuid references public.businesses(id),
  requisition_id         uuid references public.material_requisitions(id) on delete cascade,
  material_id            uuid references public.material_catalog(id),
  material_name_snapshot text,
  supplier_group_snapshot text,
  requested_qty          numeric(12,2) not null default 0,
  approved_qty           numeric(12,2),
  purchased_qty          numeric(12,2),
  received_qty           numeric(12,2),
  unit                   text default 'unidad',
  status                 text not null default 'enviada',  -- enviada|aprobada|rechazada|comprada|recibida_parcial|recibida_completa
  note                   text,
  approval_note          text,
  reception_note         text,
  purchased_supplier     text,
  purchased_cost         numeric(12,2),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ─── 4. Auditoría del módulo ─────────────────────────────────────────────────
create table if not exists public.material_requisition_audit_logs (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid references public.businesses(id),
  requisition_id uuid,
  item_id        uuid,
  action         text not null,
  old_values     jsonb,
  new_values     jsonb,
  user_id        uuid,
  created_at     timestamptz not null default now()
);

-- ─── Índices ──────────────────────────────────────────────────────────────
create unique index if not exists material_catalog_biz_name_uidx on public.material_catalog (business_id, name);
create index if not exists material_catalog_business_idx on public.material_catalog (business_id);
create index if not exists material_catalog_supplier_idx on public.material_catalog (supplier_group);

create index if not exists material_req_business_idx on public.material_requisitions (business_id);
create index if not exists material_req_branch_idx   on public.material_requisitions (branch);
create index if not exists material_req_status_idx   on public.material_requisitions (status);
create index if not exists material_req_reqat_idx    on public.material_requisitions (requested_at desc);

create index if not exists material_items_business_idx on public.material_requisition_items (business_id);
create index if not exists material_items_req_idx      on public.material_requisition_items (requisition_id);
create index if not exists material_items_status_idx   on public.material_requisition_items (status);

create index if not exists material_audit_business_idx on public.material_requisition_audit_logs (business_id);
create index if not exists material_audit_req_idx      on public.material_requisition_audit_logs (requisition_id);
create index if not exists material_audit_created_idx  on public.material_requisition_audit_logs (created_at desc);

-- ─── business_id por defecto + RLS (tenant) ─────────────────────────────────
do $$
declare
  csl_id uuid := (select id from public.businesses where slug = 'csl');
begin
  if csl_id is null then
    raise exception 'Falta business csl. Ejecuta la migración base de businesses primero.';
  end if;
  execute format('alter table public.material_catalog alter column business_id set default %L', csl_id);
  execute format('alter table public.material_requisitions alter column business_id set default %L', csl_id);
  execute format('alter table public.material_requisition_items alter column business_id set default %L', csl_id);
  execute format('alter table public.material_requisition_audit_logs alter column business_id set default %L', csl_id);
end $$;

alter table public.material_catalog                enable row level security;
alter table public.material_requisitions           enable row level security;
alter table public.material_requisition_items      enable row level security;
alter table public.material_requisition_audit_logs enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'material_catalog',
    'material_requisitions',
    'material_requisition_items',
    'material_requisition_audit_logs'
  ] loop
    execute format('drop policy if exists tenant_select on public.%I', t);
    execute format('drop policy if exists tenant_insert on public.%I', t);
    execute format('drop policy if exists tenant_update on public.%I', t);
    execute format('drop policy if exists tenant_delete on public.%I', t);
    execute format($f$create policy tenant_select on public.%I for select
      using (business_id = public.current_business_id() or public.is_superadmin())$f$, t);
    execute format($f$create policy tenant_insert on public.%I for insert
      with check (business_id = public.current_business_id() or public.is_superadmin())$f$, t);
    execute format($f$create policy tenant_update on public.%I for update
      using (business_id = public.current_business_id() or public.is_superadmin())
      with check (business_id = public.current_business_id() or public.is_superadmin())$f$, t);
    execute format($f$create policy tenant_delete on public.%I for delete
      using (business_id = public.current_business_id() or public.is_superadmin())$f$, t);
  end loop;
end $$;

-- ─── Grants ─────────────────────────────────────────────────────────────────
grant all on table public.material_catalog                to service_role;
grant all on table public.material_requisitions           to service_role;
grant all on table public.material_requisition_items      to service_role;
grant all on table public.material_requisition_audit_logs to service_role;

-- ─── Catálogo inicial CSL (BRAVO + PRICES MART), sin duplicar ────────────────
do $$
declare
  csl_id uuid := (select id from public.businesses where slug = 'csl');
  bravo  text[] := array[
    'ACE','CLORO','MISTOLIN','DESGRASANTE','SERVILLETAS','PAPEL DE BAÑO',
    'JABON DE FREGAR','JABON DE CUABA','VINAGRE','TE','NUEZ MOSCADA','SAL'
  ];
  prices text[] := array[
    'WIPERS','PAPEL TOALLA','LYSOL','AMBIENTADOR SPRAY','AMBIENTADOR ACEITE',
    'BRILLOS VERDES','ESPONJA DE FREGAR','AZUCAR','CAFE'
  ];
  m text;
begin
  if csl_id is null then return; end if;
  foreach m in array bravo loop
    insert into public.material_catalog (business_id, name, category, supplier_group, unit, active)
    values (csl_id, upper(m), 'BRAVO', 'BRAVO', 'unidad', true)
    on conflict (business_id, name) do nothing;
  end loop;
  foreach m in array prices loop
    insert into public.material_catalog (business_id, name, category, supplier_group, unit, active)
    values (csl_id, upper(m), 'PRICES MART', 'PRICES MART', 'unidad', true)
    on conflict (business_id, name) do nothing;
  end loop;
end $$;

notify pgrst, 'reload schema';

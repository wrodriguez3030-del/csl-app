-- ============================================================================
-- Módulo: Inventario de Materiales por Sucursal (conteo físico histórico).
--
-- Aditivo y NO destructivo. Crea 3 tablas (cabecera, ítems, auditoría) con
-- business_id multi-tenant, RLS por tenant, grants a service_role e índices.
-- REUTILIZA el catálogo maestro existente (public.material_catalog) — NO crea
-- ningún catálogo nuevo. Un inventario es un conteo físico e histórico
-- independiente: NO toca requisiciones, compras, aprobaciones ni el catálogo.
--
-- Flujo: la encargada de una sucursal selecciona sucursal + fecha, ve la MISMA
-- lista de materiales (agrupada por proveedor) y registra la cantidad física.
-- Guarda borrador (editable) o finaliza (histórico inmutable). Un inventario
-- finalizado queda bloqueado; solo admin/superadmin puede corregirlo con
-- auditoría (usuario, fecha, valor anterior, valor nuevo, motivo). Soft delete.
-- ============================================================================

-- ─── 1. Inventarios (cabecera por sucursal + fecha) ──────────────────────────
create table if not exists public.material_inventories (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid references public.businesses(id),
  branch         text not null,                         -- sucursal
  inventory_date date not null,                         -- fecha del conteo
  status         text not null default 'borrador',      -- borrador|finalizado
  notes          text,
  created_by     uuid,
  created_by_name    text,   -- snapshot del nombre (evita depender de getUsers)
  finalized_by   uuid,
  finalized_by_name  text,
  created_at     timestamptz not null default now(),
  finalized_at   timestamptz,
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,                           -- soft delete
  deleted_by     uuid,
  deleted_reason text
);

-- Idempotente para instalaciones donde la tabla ya existía sin estas columnas.
alter table public.material_inventories add column if not exists created_by_name   text;
alter table public.material_inventories add column if not exists finalized_by_name text;

-- ─── 2. Ítems del inventario (cantidad física por material) ──────────────────
create table if not exists public.material_inventory_items (
  id                      uuid primary key default gen_random_uuid(),
  business_id             uuid references public.businesses(id),
  inventory_id            uuid references public.material_inventories(id) on delete cascade,
  material_id             uuid references public.material_catalog(id),
  material_name_snapshot  text,     -- snapshot: conserva el histórico aunque el catálogo cambie
  supplier_group_snapshot text,
  quantity                numeric(12,2) not null default 0,  -- acepta decimales
  unit                    text default 'unidad',
  observation             text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ─── 3. Auditoría de correcciones sobre inventarios finalizados ──────────────
create table if not exists public.material_inventory_audit_logs (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid references public.businesses(id),
  inventory_id uuid,
  item_id      uuid,
  action       text not null,
  old_values   jsonb,
  new_values   jsonb,
  reason       text,
  user_id      uuid,
  created_at   timestamptz not null default now()
);

-- ─── Índices ─────────────────────────────────────────────────────────────────
-- Un solo BORRADOR vivo por (negocio, sucursal, fecha): permite reanudar el
-- borrador (autoguardado) y evita duplicados por doble clic. Los FINALIZADOS no
-- se restringen (se puede tener histórico finalizado + un nuevo conteo).
create unique index if not exists material_inv_draft_uidx
  on public.material_inventories (business_id, branch, inventory_date)
  where status = 'borrador' and deleted_at is null;

create index if not exists material_inv_business_idx on public.material_inventories (business_id) where deleted_at is null;
create index if not exists material_inv_branch_idx   on public.material_inventories (branch);
create index if not exists material_inv_date_idx     on public.material_inventories (inventory_date desc);
create index if not exists material_inv_status_idx   on public.material_inventories (status);

create index if not exists material_inv_items_inv_idx on public.material_inventory_items (inventory_id);
create index if not exists material_inv_items_biz_idx on public.material_inventory_items (business_id);
create unique index if not exists material_inv_items_uidx on public.material_inventory_items (inventory_id, material_id);

create index if not exists material_inv_audit_biz_idx on public.material_inventory_audit_logs (business_id);
create index if not exists material_inv_audit_inv_idx on public.material_inventory_audit_logs (inventory_id);
create index if not exists material_inv_audit_created_idx on public.material_inventory_audit_logs (created_at desc);

-- ─── business_id por defecto (business 'csl') + RLS por tenant ───────────────
do $$
declare
  csl_id uuid := (select id from public.businesses where slug = 'csl');
begin
  if csl_id is null then
    raise exception 'Falta business csl. Ejecuta la migración base de businesses primero.';
  end if;
  execute format('alter table public.material_inventories alter column business_id set default %L', csl_id);
  execute format('alter table public.material_inventory_items alter column business_id set default %L', csl_id);
  execute format('alter table public.material_inventory_audit_logs alter column business_id set default %L', csl_id);
end $$;

alter table public.material_inventories           enable row level security;
alter table public.material_inventory_items       enable row level security;
alter table public.material_inventory_audit_logs  enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'material_inventories',
    'material_inventory_items',
    'material_inventory_audit_logs'
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
grant all on table public.material_inventories           to service_role;
grant all on table public.material_inventory_items       to service_role;
grant all on table public.material_inventory_audit_logs  to service_role;

notify pgrst, 'reload schema';

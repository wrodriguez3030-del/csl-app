-- ─────────────────────────────────────────────────────────────────────────────
-- 202608150001 — Módulo «Inventario de Productos»
-- ─────────────────────────────────────────────────────────────────────────────
-- Cinco tablas nuevas, todas aisladas por tenant (business_id) con RLS
-- deny-by-default, siguiendo el patrón de 202607250001_agendapro_treatments_domain.
--
--   csl_productos               catálogo importado del archivo de productos
--   csl_producto_stock          existencia por producto × sucursal
--   csl_producto_importaciones  bitácora de cada importación (auditoría)
--   csl_conteos_productos       cabecera del conteo físico
--   csl_conteos_productos_items detalle del conteo (sistema vs contado)
--
-- Aditiva e idempotente. No toca ninguna tabla existente.
-- Rollback: drop table de las 5 (cascade) — no hay datos previos que preservar.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. CATÁLOGO ══════════════════════════════════════════════════════════════
create table if not exists public.csl_productos (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null,
  -- Identidad estable entre importaciones: SKU si viene, si no el nombre
  -- normalizado. Permite reimportar sin duplicar y sostiene los productos
  -- de la hoja "Inactivos", que vienen SIN SKU.
  clave          text not null,
  sku            text,
  nombre         text not null,
  nombre_norm    text not null,
  categoria      text,
  marca          text,
  formato        text,
  descripcion    text,
  costo          numeric(12,2),
  precio_externo numeric(12,2),
  precio_interno numeric(12,2),
  comision       numeric(12,2),
  comision_tipo  smallint,      -- 0 = porcentaje, 1 = monto
  precio_con_iva boolean,
  iva_pct        numeric(6,2),
  activo         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists csl_productos_clave_uidx
  on public.csl_productos (business_id, clave);
create index if not exists csl_productos_business_idx
  on public.csl_productos (business_id);
create index if not exists csl_productos_nombre_idx
  on public.csl_productos (business_id, nombre_norm);
create index if not exists csl_productos_activo_idx
  on public.csl_productos (business_id, activo);

-- ═══ 2. EXISTENCIA POR SUCURSAL ═══════════════════════════════════════════════
create table if not exists public.csl_producto_stock (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null,
  producto_id    uuid not null references public.csl_productos(id) on delete cascade,
  sucursal       text not null,   -- nombre canónico (normalizeSucursal)
  cantidad       numeric(12,2) not null default 0,
  origen         text not null default 'importacion',  -- 'importacion' | 'conteo'
  -- Importación que tocó esta fila por última vez. Al cerrar una importación,
  -- toda existencia de las sucursales importadas que NO lleve este id se pone
  -- en cero: si un producto dejó de venir en el archivo, no puede conservar
  -- existencia fantasma.
  import_id      uuid,
  actualizado_en timestamptz not null default now()
);

create unique index if not exists csl_producto_stock_uidx
  on public.csl_producto_stock (business_id, producto_id, sucursal);
create index if not exists csl_producto_stock_suc_idx
  on public.csl_producto_stock (business_id, sucursal);

-- ═══ 3. BITÁCORA DE IMPORTACIONES ═════════════════════════════════════════════
create table if not exists public.csl_producto_importaciones (
  id                     uuid primary key default gen_random_uuid(),
  business_id            uuid not null,
  archivo                text,
  filas_leidas           int default 0,
  productos_creados      int default 0,
  productos_actualizados int default 0,
  descartados            int default 0,
  sucursales             jsonb,   -- [{columna, sucursal, unidades}]
  unidades_total         numeric(12,2) default 0,
  usuario_id             uuid,
  usuario_nombre         text,
  created_at             timestamptz not null default now()
);

create index if not exists csl_producto_importaciones_idx
  on public.csl_producto_importaciones (business_id, created_at desc);

-- ═══ 4. CONTEO FÍSICO — CABECERA ══════════════════════════════════════════════
create table if not exists public.csl_conteos_productos (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null,
  sucursal           text not null,
  fecha              date not null,
  estado             text not null default 'borrador',  -- borrador|enviado|aprobado|rechazado
  notas              text,
  responsable        text,
  creado_por         uuid,
  creado_por_nombre  text,
  aprobado_por       uuid,
  aprobado_por_nombre text,
  aprobado_en        timestamptz,
  motivo_rechazo     text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Un solo BORRADOR vivo por sucursal+fecha (evita duplicados por doble clic).
create unique index if not exists csl_conteos_productos_borrador_uidx
  on public.csl_conteos_productos (business_id, sucursal, fecha)
  where estado = 'borrador';
create index if not exists csl_conteos_productos_idx
  on public.csl_conteos_productos (business_id, fecha desc);
create index if not exists csl_conteos_productos_estado_idx
  on public.csl_conteos_productos (business_id, estado);

-- ═══ 5. CONTEO FÍSICO — DETALLE ═══════════════════════════════════════════════
-- La diferencia NO se almacena: se deriva (contada − sistema) para que no haya
-- dos verdades. cantidad_sistema SÍ se congela: es lo que había al contar.
create table if not exists public.csl_conteos_productos_items (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null,
  conteo_id        uuid not null references public.csl_conteos_productos(id) on delete cascade,
  producto_id      uuid,
  nombre_snapshot  text not null,
  sku_snapshot     text,
  cantidad_sistema numeric(12,2) not null default 0,
  cantidad_contada numeric(12,2) not null default 0,
  observacion      text
);

create index if not exists csl_conteos_productos_items_idx
  on public.csl_conteos_productos_items (conteo_id);
create index if not exists csl_conteos_productos_items_biz_idx
  on public.csl_conteos_productos_items (business_id);

-- ═══ 6. RLS (tenant) para las 5 tablas nuevas ═════════════════════════════════
do $$
declare
  t text;
begin
  foreach t in array array[
    'csl_productos',
    'csl_producto_stock',
    'csl_producto_importaciones',
    'csl_conteos_productos',
    'csl_conteos_productos_items'
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

comment on table public.csl_productos is
  'Catálogo de productos de venta importado del archivo de productos. Identidad estable por (business_id, clave).';
comment on table public.csl_producto_stock is
  'Existencia por producto y sucursal. La importación la sobrescribe; el conteo físico aprobado también.';
comment on table public.csl_conteos_productos is
  'Conteo físico de productos por sucursal. Al aprobarse, csl_producto_stock pasa a ser lo contado.';

notify pgrst, 'reload schema';

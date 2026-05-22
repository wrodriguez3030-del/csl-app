-- ─────────────────────────────────────────────────────────────────────────────
-- 006 — Tabla csl_piezas_poliza_lista (lista de piezas pendientes/recibidas
--       por suplidor, en cobertura de póliza).
-- ─────────────────────────────────────────────────────────────────────────────
-- Permite que el usuario lleve un checklist de piezas pendientes de recibir
-- por suplidor. Al marcar una como "recibida" se guarda fecha_recibida y se
-- mueve visualmente a la sección "Recibidas" en el frontend.
--
-- Snapshot del nombre/categoría de la pieza:
--   Guardamos pieza_nombre_snapshot + categoria_snapshot copiados desde el
--   catálogo (csl_piezas) en el momento del alta, para que el historial
--   sobreviva si la pieza se renombra o se borra del catálogo.
--
-- Multi-tenant:
--   business_id NOT NULL + DEFAULT al CSL uuid (idéntico patrón que la
--   migración 003). RLS abajo replica las 4 policies tenant_*.
--
-- Pre-condición: 001-005 ejecutados (necesita businesses + helpers RLS).
-- Rollback: drop table public.csl_piezas_poliza_lista;
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.csl_piezas_poliza_lista (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),

  -- Referencia al catálogo csl_piezas. Conservamos el nombre como FK lógica
  -- (no enforced) porque csl_piezas.pieza es la PK (texto) y queremos tolerar
  -- que la pieza desaparezca del catálogo sin perder el ítem.
  pieza_nombre text not null,
  categoria_snapshot text,

  cantidad integer not null default 1 check (cantidad > 0),
  suplidor text,
  prioridad text not null default 'Media' check (prioridad in ('Baja','Media','Alta')),
  estado text not null default 'pendiente' check (estado in ('pendiente','recibida')),

  sucursal text,
  fecha_solicitada date not null default current_date,
  fecha_recibida date,
  nota text,

  creado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Default business_id = CSL (sigue el patrón 003): si el backend olvida
-- setearlo, el insert no falla y queda en CSL.
do $$
declare
  csl_id uuid := (select id from public.businesses where slug = 'csl');
begin
  if csl_id is null then
    raise exception 'No existe el business csl. Aplicar 001 primero.';
  end if;
  execute format(
    'alter table public.csl_piezas_poliza_lista alter column business_id set default %L',
    csl_id
  );
end $$;

-- Índices: business_id (todas las queries filtran por tenant), estado
-- (lista pendientes vs recibidas), fecha (orden cronológico).
create index if not exists csl_piezas_poliza_lista_business_idx
  on public.csl_piezas_poliza_lista(business_id);
create index if not exists csl_piezas_poliza_lista_estado_idx
  on public.csl_piezas_poliza_lista(business_id, estado);
create index if not exists csl_piezas_poliza_lista_fecha_idx
  on public.csl_piezas_poliza_lista(fecha_solicitada desc);

-- ─── RLS (mismo patrón que migración 005) ───────────────────────────────────

alter table public.csl_piezas_poliza_lista enable row level security;

drop policy if exists tenant_select on public.csl_piezas_poliza_lista;
create policy tenant_select on public.csl_piezas_poliza_lista for select
  using (business_id = public.current_business_id() or public.is_superadmin());

drop policy if exists tenant_insert on public.csl_piezas_poliza_lista;
create policy tenant_insert on public.csl_piezas_poliza_lista for insert
  with check (business_id = public.current_business_id() or public.is_superadmin());

drop policy if exists tenant_update on public.csl_piezas_poliza_lista;
create policy tenant_update on public.csl_piezas_poliza_lista for update
  using (business_id = public.current_business_id() or public.is_superadmin())
  with check (business_id = public.current_business_id() or public.is_superadmin());

drop policy if exists tenant_delete on public.csl_piezas_poliza_lista;
create policy tenant_delete on public.csl_piezas_poliza_lista for delete
  using (business_id = public.current_business_id() or public.is_superadmin());

comment on table public.csl_piezas_poliza_lista is
  'Checklist multi-tenant de piezas pendientes/recibidas por suplidor (cobertura de póliza). Snapshot del nombre/categoría de catálogo. RLS por business_id.';

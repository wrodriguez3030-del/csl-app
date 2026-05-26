-- ─────────────────────────────────────────────────────────────────────────────
-- 009 — Soporte para unificación de clientes duplicados
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Columnas merged_* en csl_cosmiatria_clientes (cliente fusionado se marca
--    en lugar de borrarse — preserva historial).
-- 2. Tabla csl_cliente_merge_audit (un row por merge ejecutado).
-- 3. RLS de tenant (mismo patrón que tablas csl_*).
--
-- Pre-condición: 001-008 ejecutados.
-- Rollback al final del archivo.
-- ─────────────────────────────────────────────────────────────────────────────

-- 9a. Columnas merged_* en csl_cosmiatria_clientes
alter table public.csl_cosmiatria_clientes
  add column if not exists merged_into_cliente_id text,
  add column if not exists merged_at timestamptz,
  add column if not exists merged_by uuid references auth.users(id),
  add column if not exists merge_note text;

-- FK self-reference (cliente_id PK existente). Permitimos NULL (no fusionado).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'csl_cosmiatria_clientes_merged_into_fk'
  ) then
    alter table public.csl_cosmiatria_clientes
      add constraint csl_cosmiatria_clientes_merged_into_fk
      foreign key (merged_into_cliente_id)
      references public.csl_cosmiatria_clientes(cliente_id)
      on delete set null;
  end if;
end $$;

create index if not exists csl_cosmiatria_clientes_merged_into_idx
  on public.csl_cosmiatria_clientes(merged_into_cliente_id)
  where merged_into_cliente_id is not null;

comment on column public.csl_cosmiatria_clientes.merged_into_cliente_id is
  'Si el cliente fue fusionado, apunta al cliente_id principal. NULL = activo.';
comment on column public.csl_cosmiatria_clientes.merged_at is
  'Timestamp de la fusión. NULL = cliente activo.';
comment on column public.csl_cosmiatria_clientes.merged_by is
  'Usuario que ejecutó la fusión (auth.users.id).';

-- 9b. Tabla de auditoría de merges
create table if not exists public.csl_cliente_merge_audit (
  merge_id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  primary_cliente_id text not null,
  duplicate_cliente_id text not null,
  primary_snapshot jsonb,
  duplicate_snapshot jsonb,
  final_snapshot jsonb,
  affected_counts jsonb not null default '{}'::jsonb,
  merged_by uuid references auth.users(id),
  merged_at timestamptz not null default now(),
  note text
);

create index if not exists csl_cliente_merge_audit_business_idx
  on public.csl_cliente_merge_audit(business_id);
create index if not exists csl_cliente_merge_audit_primary_idx
  on public.csl_cliente_merge_audit(primary_cliente_id);
create index if not exists csl_cliente_merge_audit_duplicate_idx
  on public.csl_cliente_merge_audit(duplicate_cliente_id);

comment on table public.csl_cliente_merge_audit is
  'Auditoría de unificaciones de clientes. Una fila por merge ejecutado.';

-- 9c. RLS en la tabla de auditoría — mismo patrón que csl_* operativas
alter table public.csl_cliente_merge_audit enable row level security;

drop policy if exists tenant_select on public.csl_cliente_merge_audit;
drop policy if exists tenant_insert on public.csl_cliente_merge_audit;
drop policy if exists tenant_update on public.csl_cliente_merge_audit;
drop policy if exists tenant_delete on public.csl_cliente_merge_audit;

create policy tenant_select on public.csl_cliente_merge_audit
  for select
  using (business_id = public.current_business_id() or public.is_superadmin());

create policy tenant_insert on public.csl_cliente_merge_audit
  for insert
  with check (business_id = public.current_business_id() or public.is_superadmin());

-- Audit es append-only: solo superadmin puede mutar/borrar via JWT.
-- (Service role del backend bypassea igual — comportamiento intencional.)
create policy tenant_update on public.csl_cliente_merge_audit
  for update
  using (public.is_superadmin())
  with check (public.is_superadmin());

create policy tenant_delete on public.csl_cliente_merge_audit
  for delete
  using (public.is_superadmin());

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (no ejecutar a menos que sea necesario revertir):
--   drop table if exists public.csl_cliente_merge_audit;
--   alter table public.csl_cosmiatria_clientes
--     drop column if exists merge_note,
--     drop column if exists merged_by,
--     drop column if exists merged_at,
--     drop column if exists merged_into_cliente_id;
-- ─────────────────────────────────────────────────────────────────────────────

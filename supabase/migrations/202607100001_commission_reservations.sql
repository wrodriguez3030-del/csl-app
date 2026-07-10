-- ============================================================================
-- COMISIÓN DE VENTAS · Importador dual (Ventas + Reservas).
-- Aditivo/idempotente. Extiende sales_commission_imports (tipo + períodos
-- detectados + resumen crudo), crea sales_commission_reservations (hoja
-- "Reservas" del export real, 29 columnas) y amplía patient_counts para
-- registrar atenciones (métrica principal) y clientes únicos por prestador.
-- Sin DELETE/TRUNCATE/DROP TABLE. RLS y grants como el resto del módulo.
-- ============================================================================

-- ─── imports: tipo de archivo + período real detectado + resumen para conciliación ───
alter table public.sales_commission_imports add column if not exists import_type text not null default 'SALES';
alter table public.sales_commission_imports add column if not exists detected_period_start date;
alter table public.sales_commission_imports add column if not exists detected_period_end date;
alter table public.sales_commission_imports add column if not exists raw_summary jsonb;

-- Índice único ACTIVO ahora por (negocio, tipo, hash): permite importar el
-- mismo mes de Ventas y de Reservas por separado. Reemplaza el índice viejo
-- solo-hash (drop de índice = no destructivo para datos).
drop index if exists sc_imports_hash_uq;
create unique index if not exists sc_imports_type_hash_uq
  on public.sales_commission_imports (business_id, import_type, file_hash)
  where status <> 'anulado';

-- ─── Reservas (hoja "Reservas" del export: una fila = una reserva/atención) ──
create table if not exists public.sales_commission_reservations (
  id                      uuid primary key default gen_random_uuid(),
  business_id             uuid references public.businesses(id),
  import_id               uuid references public.sales_commission_imports(id),
  appointment_date        date,
  appointment_time        text,
  reservation_created_at  date,
  branch_original         text,
  branch_normalized       text,
  external_client_id      text,
  first_name              text,
  last_name               text,
  email                   text,
  phone                   text,
  document                text,
  service_name            text,
  list_price              numeric(16,2) default 0,
  real_price              numeric(16,2) default 0,
  session_number          text,
  total_sessions          text,
  employee_id             uuid,
  provider_original       text,
  provider_normalized     text,
  attendance_status       text,          -- ASISTE|NO_ASISTE|CANCELADO|CONFIRMADO|RESERVADO|EN_ESPERA|OTRO
  payment_status          text,
  payment_date            date,
  external_payment_id     text,
  source                  text,
  assigned_to             text,
  billing_type            text,
  row_hash                text,
  raw_data                jsonb,
  created_at              timestamptz default now()
);

create index if not exists sc_resv_biz_idx     on public.sales_commission_reservations (business_id);
create index if not exists sc_resv_import_idx  on public.sales_commission_reservations (import_id);
create index if not exists sc_resv_date_idx    on public.sales_commission_reservations (business_id, appointment_date);
create index if not exists sc_resv_emp_idx     on public.sales_commission_reservations (business_id, employee_id);
create index if not exists sc_resv_status_idx  on public.sales_commission_reservations (business_id, attendance_status);
create index if not exists sc_resv_branch_idx  on public.sales_commission_reservations (business_id, branch_normalized);
create unique index if not exists sc_resv_rowhash_uq
  on public.sales_commission_reservations (business_id, row_hash) where row_hash is not null;

-- ─── patient_counts: atenciones (métrica principal) + clientes únicos ────────
alter table public.sales_commission_patient_counts add column if not exists provider_name text;
alter table public.sales_commission_patient_counts add column if not exists unique_patients int default 0;

-- ─── RLS + grants para la tabla nueva (mismo patrón del módulo) ─────────────
do $$
declare
  csl_id uuid := (select id from public.businesses where slug = 'csl');
begin
  if csl_id is null then
    raise exception 'Falta business csl.';
  end if;
  execute format('alter table public.sales_commission_reservations alter column business_id set default %L', csl_id);
  alter table public.sales_commission_reservations enable row level security;
  drop policy if exists tenant_select on public.sales_commission_reservations;
  drop policy if exists tenant_insert on public.sales_commission_reservations;
  drop policy if exists tenant_update on public.sales_commission_reservations;
  drop policy if exists tenant_delete on public.sales_commission_reservations;
  create policy tenant_select on public.sales_commission_reservations for select
    using (business_id = public.current_business_id() or public.is_superadmin());
  create policy tenant_insert on public.sales_commission_reservations for insert
    with check (business_id = public.current_business_id() or public.is_superadmin());
  create policy tenant_update on public.sales_commission_reservations for update
    using (business_id = public.current_business_id() or public.is_superadmin())
    with check (business_id = public.current_business_id() or public.is_superadmin());
  create policy tenant_delete on public.sales_commission_reservations for delete
    using (business_id = public.current_business_id() or public.is_superadmin());
  grant all on table public.sales_commission_reservations to service_role;
end $$;

notify pgrst, 'reload schema';

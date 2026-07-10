-- ============================================================================
-- Módulo: COMISIÓN DE VENTAS (importación mensual de ventas, reglas versionadas,
-- cálculo de incentivos, liquidación, pacientes atendidos, alias de prestadores
-- y auditoría).
--
-- Aditivo y NO destructivo. Crea 8 tablas con business_id multi-tenant, RLS por
-- tenant (public.current_business_id() / public.is_superadmin()), grants a
-- service_role e índices. Deduplicación en dos niveles: único activo por
-- (business_id, file_hash) en imports y único por (business_id, row_hash) en
-- sales. NO contiene DELETE/TRUNCATE/DROP TABLE. Aplicar en db-cls self-hosted.
-- ============================================================================

-- ─── 1. Importaciones (un archivo por período) ──────────────────────────────
create table if not exists public.sales_commission_imports (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid references public.businesses(id),
  period_month  int  not null,
  period_year   int  not null,
  filename      text,
  file_hash     text not null,
  rows_count    int          default 0,
  gross_total   numeric(16,2) default 0,
  status        text         default 'borrador',   -- borrador|importado|calculado|en_revision|aprobado|pagado|cerrado|anulado
  imported_by   text,
  imported_at   timestamptz,
  committed_at  timestamptz,
  created_at    timestamptz  default now(),
  updated_at    timestamptz  default now()
);

-- ─── 2. Ventas (transacciones normalizadas) ─────────────────────────────────
create table if not exists public.sales_commission_sales (
  id                     uuid primary key default gen_random_uuid(),
  business_id            uuid references public.businesses(id),
  import_id              uuid references public.sales_commission_imports(id),
  original_row_number    int,
  original_transaction_id text,
  sale_date              date,
  branch                 text,
  customer_name          text,
  employee_id            uuid,                       -- resuelto por alias (sin FK dura)
  provider_original      text,
  provider_normalized    text,
  service_name           text,
  category               text,
  product_name           text,
  quantity               numeric(14,3) default 0,
  unit_price             numeric(16,2) default 0,
  gross_amount           numeric(16,2) default 0,
  discount_amount        numeric(16,2) default 0,
  net_amount             numeric(16,2) default 0,
  payment_method         text,
  row_hash               text,
  raw_data               jsonb,
  created_at             timestamptz default now(),
  updated_at             timestamptz default now()
);

-- ─── 3. Reglas de comisión (versionadas por fecha efectiva) ─────────────────
create table if not exists public.sales_commission_rules (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid references public.businesses(id),
  name          text not null,
  rule_type     text not null,                       -- card_percentage|product_unit_incentive|category_commission|laser_scale|cleaning_contribution|fixed_incentive
  category      text,
  employee_id   uuid,
  branch        text,
  min_amount    numeric(16,2),
  max_amount    numeric(16,2),
  percentage    numeric(9,5),                         -- fracción (0.27 = 27%)
  fixed_amount  numeric(16,2),
  priority      int          default 100,
  active        boolean      default true,
  effective_from date        not null default '2000-01-01',
  effective_to   date,
  created_by    text,
  updated_by    text,
  created_at    timestamptz  default now(),
  updated_at    timestamptz  default now()
);

-- ─── 4. Detalle de incentivos de servicios (trazabilidad por origen) ────────
create table if not exists public.sales_commission_service_details (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid references public.businesses(id),
  period_month     int,
  period_year      int,
  employee_id      uuid,
  incentive_type   text,                              -- FACIALES|HOLLYWOOD_AQUA_PEEL|TATUAJES|HIFU|MASAJES|DEPILACION_LASER|INCENTIVO_FIJO|AJUSTE_MANUAL
  base_amount      numeric(16,2) default 0,
  percentage       numeric(9,5),
  incentive_amount numeric(16,2) default 0,
  rule_id          uuid references public.sales_commission_rules(id),
  source           text,
  note             text,
  created_at       timestamptz default now()
);

-- ─── 5. Cálculos / liquidación por empleado (con snapshot de reglas) ────────
create table if not exists public.sales_commission_calculations (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid references public.businesses(id),
  import_id             uuid references public.sales_commission_imports(id),
  period_month          int,
  period_year           int,
  employee_id           uuid,
  provider_name_snapshot text,
  branch                text,
  products_count        numeric(14,3) default 0,
  product_incentive     numeric(16,2) default 0,
  service_commission    numeric(16,2) default 0,
  laser_incentive       numeric(16,2) default 0,
  fixed_incentive       numeric(16,2) default 0,
  manual_adjustment     numeric(16,2) default 0,
  bonus_extra           numeric(16,2) default 0,
  gross_total           numeric(16,2) default 0,
  cleaning_contribution numeric(16,2) default 0,
  net_total             numeric(16,2) default 0,
  rule_snapshot         jsonb,
  status                text default 'calculado',
  calculated_by         text,
  approved_by           text,
  approved_at           timestamptz,
  paid_by               text,
  paid_at               timestamptz,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

-- ─── 6. Pacientes / clientes atendidos por prestador ────────────────────────
create table if not exists public.sales_commission_patient_counts (
  id                       uuid primary key default gen_random_uuid(),
  business_id              uuid references public.businesses(id),
  period_month             int,
  period_year              int,
  employee_id              uuid,
  branch                   text,
  patient_count            int           default 0,
  total_period_patients    int           default 0,
  participation_percentage numeric(9,4)  default 0,
  incentive_amount         numeric(16,2) default 0,
  source                   text,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);

-- ─── 7. Alias de prestadores (texto → employee_id) ──────────────────────────
create table if not exists public.sales_commission_employee_aliases (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid references public.businesses(id),
  alias        text not null,
  employee_id  uuid,
  active       boolean default true,
  created_by   text,
  created_at   timestamptz default now()
);

-- ─── 8. Auditoría del módulo ────────────────────────────────────────────────
create table if not exists public.sales_commission_audit_logs (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid references public.businesses(id),
  period_month int,
  period_year  int,
  action       text,
  entity_type  text,
  entity_id    text,
  old_values   jsonb,
  new_values   jsonb,
  reason       text,
  user_id      text,
  created_at   timestamptz default now()
);

-- ─── Índices ────────────────────────────────────────────────────────────────
create index if not exists sc_imports_biz_idx        on public.sales_commission_imports (business_id);
create index if not exists sc_imports_period_idx     on public.sales_commission_imports (business_id, period_year, period_month);
-- Único ACTIVO por archivo: impide dos importaciones vivas del mismo hash.
create unique index if not exists sc_imports_hash_uq on public.sales_commission_imports (business_id, file_hash) where status <> 'anulado';

create index if not exists sc_sales_biz_idx          on public.sales_commission_sales (business_id);
create index if not exists sc_sales_import_idx       on public.sales_commission_sales (import_id);
create index if not exists sc_sales_emp_idx          on public.sales_commission_sales (business_id, employee_id);
-- Único por transacción: impide insertar dos veces la misma venta.
create unique index if not exists sc_sales_rowhash_uq on public.sales_commission_sales (business_id, row_hash) where row_hash is not null;

create index if not exists sc_rules_biz_idx          on public.sales_commission_rules (business_id, rule_type, active);
create index if not exists sc_rules_eff_idx          on public.sales_commission_rules (business_id, effective_from, effective_to);

create index if not exists sc_svc_details_idx        on public.sales_commission_service_details (business_id, period_year, period_month, employee_id);
create index if not exists sc_calc_idx               on public.sales_commission_calculations (business_id, period_year, period_month, employee_id);
create index if not exists sc_calc_import_idx        on public.sales_commission_calculations (import_id);
create index if not exists sc_patients_idx           on public.sales_commission_patient_counts (business_id, period_year, period_month, employee_id);
create index if not exists sc_alias_biz_idx          on public.sales_commission_employee_aliases (business_id, active);
create unique index if not exists sc_alias_uq        on public.sales_commission_employee_aliases (business_id, lower(alias)) where active;
create index if not exists sc_audit_idx              on public.sales_commission_audit_logs (business_id, period_year, period_month);

-- ─── business_id por defecto (business 'csl') + RLS por tenant + grants ─────
do $$
declare
  csl_id uuid := (select id from public.businesses where slug = 'csl');
  t text;
  tables text[] := array[
    'sales_commission_imports','sales_commission_sales','sales_commission_rules',
    'sales_commission_service_details','sales_commission_calculations',
    'sales_commission_patient_counts','sales_commission_employee_aliases',
    'sales_commission_audit_logs'
  ];
begin
  if csl_id is null then
    raise exception 'Falta business csl. Ejecuta la migración base de businesses primero.';
  end if;
  foreach t in array tables loop
    execute format('alter table public.%I alter column business_id set default %L', t, csl_id);
    execute format('alter table public.%I enable row level security', t);
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
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

notify pgrst, 'reload schema';

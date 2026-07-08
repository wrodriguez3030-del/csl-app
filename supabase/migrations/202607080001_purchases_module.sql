-- ============================================================================
-- Módulo: COMPRAS (facturas de proveedores, pagos/gastos, gastos menores,
-- pagos recurrentes) + auditoría.
--
-- Aditivo y NO destructivo. Crea 8 tablas con business_id multi-tenant, RLS por
-- tenant, soft delete, grants a service_role e índices. REUTILIZA proveedores
-- (texto libre, mismo criterio que material_catalog.supplier_group) y materiales
-- (FK opcional a material_catalog) — NO crea catálogo nuevo.
--
-- Modelo contable (anti-doble-conteo):
--   * purchase_payments = ÚNICO ledger de dinero aplicado a una factura. El
--     balance de la factura = total - SUM(pagos vivos). Tanto "Registrar pago"
--     como el módulo Pagos/gastos (Tipo=Pago de factura) escriben aquí.
--   * expenses = gastos GENERALES que NO se aplican a una factura
--     (operativo/servicio/otro). Nunca tocan el balance de una factura.
--   * Una factura NUNCA aumenta inventario (la entrada real es la recepción de
--     materiales de la requisición, no la factura).
-- ============================================================================

-- ─── 1. Facturas de proveedores ─────────────────────────────────────────────
create table if not exists public.purchase_invoices (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid references public.businesses(id),
  branch         text,
  invoice_number text,
  ncf            text,
  supplier       text,                    -- proveedor (texto; reutiliza supplier_group)
  supplier_rnc   text,                    -- RNC/Cédula
  invoice_date   date,
  due_date       date,
  purchase_type  text,                    -- tipo de compra
  payment_method text,                    -- forma de pago
  condition      text default 'contado',  -- contado | credito
  subtotal       numeric(14,2) not null default 0,
  discount       numeric(14,2) not null default 0,
  itbis          numeric(14,2) not null default 0,
  total          numeric(14,2) not null default 0,
  paid_amount    numeric(14,2) not null default 0,
  balance        numeric(14,2) not null default 0,   -- = total - paid_amount (recalculado)
  status         text not null default 'borrador',   -- borrador|pendiente|parcial|pagada|vencida|anulada
  notes          text,
  attachment_path text,                   -- objeto en el bucket purchase-docs
  requisition_id uuid,                    -- ref opcional a material_requisitions (integración)
  created_by     uuid,
  created_by_name text,
  updated_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     uuid,
  deleted_reason text
);

-- ─── 2. Detalle de factura (productos/materiales) ───────────────────────────
create table if not exists public.purchase_invoice_items (
  id                     uuid primary key default gen_random_uuid(),
  business_id            uuid references public.businesses(id),
  invoice_id             uuid references public.purchase_invoices(id) on delete cascade,
  material_id            uuid references public.material_catalog(id),  -- opcional (reutiliza catálogo)
  material_name_snapshot text,
  description            text,
  quantity               numeric(12,2) not null default 0,
  unit                   text default 'unidad',
  unit_cost              numeric(14,2) not null default 0,
  itbis                  numeric(14,2) not null default 0,
  total                  numeric(14,2) not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ─── 3. Pagos aplicados a facturas (ledger único de balances) ───────────────
create table if not exists public.purchase_payments (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid references public.businesses(id),
  branch         text,
  invoice_id     uuid references public.purchase_invoices(id) on delete cascade,
  expense_id     uuid,                    -- backref si el pago vino del módulo Pagos/gastos
  payment_date   date,
  amount         numeric(14,2) not null default 0,
  method         text,
  account        text,                    -- cuenta/caja de origen (texto libre)
  reference      text,
  attachment_path text,
  notes          text,
  created_by     uuid,
  created_by_name text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     uuid,
  deleted_reason text
);

-- ─── 4. Pagos / gastos generales (NO ligados a factura) ─────────────────────
create table if not exists public.expenses (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid references public.businesses(id),
  branch         text,
  expense_date   date,
  kind           text default 'gasto_operativo',  -- gasto_operativo|servicio|otro
  category       text,
  payee          text,                    -- proveedor o beneficiario
  concept        text,
  method         text,
  account        text,
  amount         numeric(14,2) not null default 0,
  reference      text,
  invoice_id     uuid,                    -- ref informativa opcional
  attachment_path text,
  notes          text,
  status         text not null default 'registrado',  -- registrado|anulado
  created_by     uuid,
  created_by_name text,
  updated_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     uuid,
  deleted_reason text
);

-- ─── 5. Gastos menores (caja chica) ─────────────────────────────────────────
create table if not exists public.petty_expenses (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid references public.businesses(id),
  branch         text,
  expense_date   date,
  responsible    text,                    -- responsable
  category       text,
  concept        text,
  amount         numeric(14,2) not null default 0,
  method         text,
  receipt_number text,                    -- número de comprobante
  attachment_path text,
  notes          text,
  status         text not null default 'pendiente',   -- pendiente|aprobado|rechazado|pagado
  approved_by    uuid, approved_by_name text, approved_at timestamptz,
  rejected_by    uuid, rejected_at timestamptz, reject_reason text,
  paid_by        uuid, paid_at timestamptz,
  created_by     uuid,
  created_by_name text,
  updated_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     uuid,
  deleted_reason text
);

-- ─── 6. Pagos recurrentes (compromisos periódicos) ──────────────────────────
create table if not exists public.recurring_payments (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid references public.businesses(id),
  branch         text,
  name           text not null,
  payee          text,                    -- proveedor/beneficiario
  category       text,
  frequency      text not null default 'mensual',  -- semanal|quincenal|mensual|trimestral|semestral|anual
  amount         numeric(14,2) not null default 0, -- monto estimado
  next_date      date,                    -- próxima fecha de pago
  payment_day    integer,                 -- día habitual de pago (1..31)
  method         text,
  active         boolean not null default true,
  reminder_days  integer default 3,       -- recordatorio (días antes)
  notes          text,
  created_by     uuid,
  created_by_name text,
  updated_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     uuid,
  deleted_reason text
);

-- ─── 7. Historial de pagos recurrentes realizados ───────────────────────────
create table if not exists public.recurring_payment_history (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid references public.businesses(id),
  recurring_id   uuid references public.recurring_payments(id) on delete cascade,
  paid_date      date,
  period_label   text,                    -- período cubierto (ej. "2026-07")
  amount         numeric(14,2) not null default 0,
  method         text,
  reference      text,
  attachment_path text,
  notes          text,
  created_by     uuid,
  created_by_name text,
  created_at     timestamptz not null default now()
);

-- ─── 8. Auditoría del módulo de compras ─────────────────────────────────────
create table if not exists public.purchase_audit_logs (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid references public.businesses(id),
  entity       text not null,            -- invoice|payment|expense|petty|recurring|recurring_payment
  entity_id    uuid,
  action       text not null,
  old_values   jsonb,
  new_values   jsonb,
  reason       text,
  user_id      uuid,
  created_at   timestamptz not null default now()
);

-- ─── Índices ─────────────────────────────────────────────────────────────────
create index if not exists purchase_inv_biz_idx    on public.purchase_invoices (business_id) where deleted_at is null;
create index if not exists purchase_inv_branch_idx on public.purchase_invoices (branch);
create index if not exists purchase_inv_status_idx on public.purchase_invoices (status);
create index if not exists purchase_inv_date_idx   on public.purchase_invoices (invoice_date desc);
create index if not exists purchase_inv_req_idx    on public.purchase_invoices (requisition_id);
create index if not exists purchase_items_inv_idx  on public.purchase_invoice_items (invoice_id);
create index if not exists purchase_items_biz_idx  on public.purchase_invoice_items (business_id);
create index if not exists purchase_pay_inv_idx    on public.purchase_payments (invoice_id);
create index if not exists purchase_pay_biz_idx    on public.purchase_payments (business_id) where deleted_at is null;
create index if not exists purchase_pay_date_idx   on public.purchase_payments (payment_date desc);
create index if not exists expenses_biz_idx        on public.expenses (business_id) where deleted_at is null;
create index if not exists expenses_date_idx       on public.expenses (expense_date desc);
create index if not exists expenses_branch_idx     on public.expenses (branch);
create index if not exists petty_biz_idx           on public.petty_expenses (business_id) where deleted_at is null;
create index if not exists petty_date_idx          on public.petty_expenses (expense_date desc);
create index if not exists petty_status_idx        on public.petty_expenses (status);
create index if not exists petty_branch_idx        on public.petty_expenses (branch);
create index if not exists recurring_biz_idx       on public.recurring_payments (business_id) where deleted_at is null;
create index if not exists recurring_next_idx      on public.recurring_payments (next_date);
create index if not exists recurring_hist_rec_idx  on public.recurring_payment_history (recurring_id);
create index if not exists purchase_audit_biz_idx  on public.purchase_audit_logs (business_id);
create index if not exists purchase_audit_ent_idx  on public.purchase_audit_logs (entity, entity_id);

-- ─── business_id por defecto (business 'csl') + RLS por tenant ───────────────
do $$
declare
  csl_id uuid := (select id from public.businesses where slug = 'csl');
  t text;
  tables text[] := array[
    'purchase_invoices','purchase_invoice_items','purchase_payments','expenses',
    'petty_expenses','recurring_payments','recurring_payment_history','purchase_audit_logs'
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

-- ─── Bucket privado para adjuntos de compras (facturas, comprobantes) ────────
insert into storage.buckets (id, name, public)
values ('purchase-docs', 'purchase-docs', false)
on conflict (id) do nothing;

notify pgrst, 'reload schema';

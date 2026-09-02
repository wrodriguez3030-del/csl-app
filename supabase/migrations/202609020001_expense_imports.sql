-- ════════════════════════════════════════════════════════════════════════════
-- Importaciones del libro de gastos (Incentivos de Ventas › Importador › Gastos)
--
-- Cabecera idempotente por archivo (file_hash) + trazabilidad por fila
-- (import_id, row_hash) en las tablas destino, espejo de lo que ya hace
-- sales_commission_imports para ventas/reservas. Solo operaciones ADITIVAS.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.expense_imports (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid references public.businesses(id),
  import_type           text not null default 'EXPENSES',   -- EXPENSES (libro mensual: gastos + inversiones + retiros + histórico)
  filename              text,
  file_hash             text not null,                      -- sha256 del archivo
  status                text not null default 'importado',  -- importado | anulado
  rows_count            int  not null default 0,
  gross_total           numeric(16,2) not null default 0,
  detected_period_start date,
  detected_period_end   date,
  raw_summary           jsonb,                              -- conciliación, avisos, ids reemplazados
  imported_by           text,
  imported_at           timestamptz not null default now(),
  committed_at          timestamptz,
  voided_at             timestamptz,
  voided_by             uuid,
  void_reason           text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Un mismo archivo no se importa dos veces mientras la importación siga activa.
create unique index if not exists expense_imports_type_hash_uq
  on public.expense_imports (business_id, import_type, file_hash) where status <> 'anulado';
create index if not exists expense_imports_biz_idx
  on public.expense_imports (business_id, imported_at desc);

-- Trazabilidad por fila en los destinos. Las filas existentes quedan con
-- row_hash NULL: fuera del índice parcial, nada se reescribe.
alter table public.expenses add column if not exists import_id uuid references public.expense_imports(id);
alter table public.expenses add column if not exists row_hash  text;
create unique index if not exists expenses_rowhash_uq
  on public.expenses (business_id, row_hash) where row_hash is not null and deleted_at is null;
create index if not exists expenses_import_idx on public.expenses (import_id) where import_id is not null;

alter table public.bi_finance_investments add column if not exists import_id uuid references public.expense_imports(id);
alter table public.bi_finance_investments add column if not exists row_hash  text;
create unique index if not exists bi_fin_invest_rowhash_uq
  on public.bi_finance_investments (business_id, row_hash) where row_hash is not null and deleted_at is null;
create index if not exists bi_fin_invest_import_idx on public.bi_finance_investments (import_id) where import_id is not null;

-- ─── business_id por defecto (business 'csl') + RLS por tenant ───────────────
do $$
declare
  csl_id uuid := (select id from public.businesses where slug = 'csl');
  t text;
  tables text[] := array['expense_imports'];
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

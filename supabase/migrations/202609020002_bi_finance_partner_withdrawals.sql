-- ════════════════════════════════════════════════════════════════════════════
-- Retiros de socios (dividendos / retiros de cuenta)
--
-- Salida de caja que NO es gasto operativo: no debe inflar `expenses` (y con
-- ello la rentabilidad de BI Finanzas). Entra al flujo de efectivo como rubro
-- propio, igual que en la hoja «consolidado» del libro de incentivos
-- (columna «RETIRO DIVIDENDO SOCIOS»). Solo operaciones ADITIVAS.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.bi_finance_partner_withdrawals (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid references public.businesses(id),
  withdrawal_date date not null,
  kind            text not null default 'dividendo' check (kind in ('dividendo', 'cuenta')),
  partner         text,                                     -- socio (opcional)
  branch          text,                                     -- opcional; null = del negocio
  amount          numeric(14,2) not null default 0 check (amount >= 0),
  notes           text,
  import_id       uuid references public.expense_imports(id),
  row_hash        text,
  created_by      uuid,
  created_by_name text,
  updated_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  deleted_by      uuid,
  deleted_reason  text
);

create index if not exists bi_fin_withdrawals_biz_date_idx
  on public.bi_finance_partner_withdrawals (business_id, withdrawal_date) where deleted_at is null;
create unique index if not exists bi_fin_withdrawals_rowhash_uq
  on public.bi_finance_partner_withdrawals (business_id, row_hash) where row_hash is not null and deleted_at is null;
create index if not exists bi_fin_withdrawals_import_idx
  on public.bi_finance_partner_withdrawals (import_id) where import_id is not null;

-- ─── business_id por defecto (business 'csl') + RLS por tenant ───────────────
do $$
declare
  csl_id uuid := (select id from public.businesses where slug = 'csl');
  t text;
  tables text[] := array['bi_finance_partner_withdrawals'];
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

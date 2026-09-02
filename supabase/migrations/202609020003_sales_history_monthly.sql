-- ════════════════════════════════════════════════════════════════════════════
-- Histórico mensual de ventas de REFERENCIA (antes de la primera venta real)
--
-- La app tiene ventas reales desde 2020-05-20 (sales_commission_sales). Para el
-- «Histórico anual 2017 → hoy» del tablero hace falta lo anterior, que solo
-- existe en la hoja «Historico ventas» del libro de incentivos. Esta tabla
-- guarda esos meses como referencia; a partir del primer mes real manda la
-- venta real y estas filas se ignoran. Solo operaciones ADITIVAS.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.sales_history_monthly (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id),
  year        int not null check (year between 2000 and 2100),
  month       int not null check (month between 1 and 12),
  efectivo    numeric(14,2) not null default 0,
  tarjeta     numeric(14,2) not null default 0,
  total       numeric(14,2) not null default 0,
  source      text not null default 'excel:Historico ventas',
  import_id   uuid references public.expense_imports(id),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists sales_history_monthly_uq
  on public.sales_history_monthly (business_id, year, month);

-- ─── business_id por defecto (business 'csl') + RLS por tenant ───────────────
do $$
declare
  csl_id uuid := (select id from public.businesses where slug = 'csl');
  t text;
  tables text[] := array['sales_history_monthly'];
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

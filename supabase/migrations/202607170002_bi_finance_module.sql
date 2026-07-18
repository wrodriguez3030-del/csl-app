-- ============================================================================
-- Módulo: BI FINANCIERO IA (Asistente Financiero Estratégico)
--
-- Aditivo y NO destructivo. Crea 5 tablas con business_id multi-tenant, RLS por
-- tenant, grants a service_role e índices. NO duplica ninguna tabla de ingresos
-- ni de gastos: el módulo LEE de las fuentes existentes (sales_commission_*,
-- purchase_invoices/expenses/petty_expenses/recurring_payments, hr_payroll_*,
-- material_requisition_items, sales_commission_patient_counts). Estas 5 tablas
-- solo guardan lo PROPIO del módulo: historial de consultas a la IA, alertas
-- financieras, inversiones/ROI, proyecciones y la configuración de la IA.
--
-- Aislamiento por tenant: Cibao Spa Láser y Depicenter NUNCA se mezclan.
-- ============================================================================

-- ─── 1. Historial de consultas al asistente IA ─────────────────────────────
create table if not exists public.bi_finance_ai_queries (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid references public.businesses(id),
  user_id       uuid,
  user_email    text,
  scope         text,                          -- pantalla/contexto (dashboard|ventas|gastos|rentabilidad|...)
  branch        text,                          -- sucursal en foco (o NULL = todas)
  period_month  smallint,
  period_year   smallint,
  question      text not null,
  answer        jsonb,                         -- respuesta estructurada (resumen/hallazgos/riesgos/recomendaciones/...)
  model         text,
  provider      text default 'openai',
  tokens_prompt integer,
  tokens_completion integer,
  tokens_total  integer,
  confidence    text,                          -- alto|medio|bajo (nivel de confianza declarado por la IA)
  ok            boolean not null default true,
  error         text,
  created_at    timestamptz not null default now()
);

-- ─── 2. Alertas financieras ────────────────────────────────────────────────
create table if not exists public.bi_finance_alerts (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid references public.businesses(id),
  tipo          text not null,                 -- margen_bajo|gasto_alto|caida_ventas|meta|liquidez|otro
  severidad     text not null default 'media', -- info|media|alta|critica
  titulo        text not null,
  detalle       text,
  branch        text,
  metric        text,                          -- nombre de la métrica (margen_neto, gastos_totales, ...)
  metric_value  numeric(16,2),
  threshold     numeric(16,2),
  period_month  smallint,
  period_year   smallint,
  status        text not null default 'abierta', -- abierta|revisada|resuelta|descartada
  source        text not null default 'sistema', -- sistema|ia|manual
  created_by    uuid,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   uuid
);

-- ─── 3. Inversiones y ROI ──────────────────────────────────────────────────
create table if not exists public.bi_finance_investments (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid references public.businesses(id),
  nombre             text not null,
  categoria          text,                     -- equipo|marketing|remodelacion|personal|otro
  branch             text,
  monto_inversion    numeric(16,2) not null default 0,
  beneficio_estimado numeric(16,2) not null default 0,
  beneficio_real     numeric(16,2),
  fecha_inicio       date,
  fecha_fin          date,
  estado             text not null default 'planificada', -- planificada|en_curso|completada|cancelada
  roi_estimado       numeric(10,4),            -- (beneficio_estimado - inversion) / inversion
  roi_real           numeric(10,4),            -- (beneficio_real - inversion) / inversion
  payback_meses      numeric(8,2),
  notas              text,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

-- ─── 4. Proyecciones financieras ───────────────────────────────────────────
create table if not exists public.bi_finance_forecasts (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid references public.businesses(id),
  metric        text not null,                 -- ingresos|gastos|utilidad_neta|pacientes
  method        text not null default 'promedio_movil', -- promedio_movil|tendencia|escenarios
  branch        text,                          -- sucursal o NULL = consolidado
  scenario      text,                          -- base|optimista|conservador (para method=escenarios)
  base_from     date,
  base_to       date,
  horizon_months smallint not null default 3,
  base_data     jsonb,                         -- serie histórica usada
  result_data   jsonb,                         -- serie proyectada
  created_by    uuid,
  created_at    timestamptz not null default now()
);

-- ─── 5. Configuración de la IA (una fila por tenant) ───────────────────────
create table if not exists public.bi_finance_settings (
  business_id        uuid primary key references public.businesses(id),
  enabled            boolean not null default true,
  provider           text not null default 'openai',
  model              text,                     -- si NULL → usa env OPENAI_MODEL
  temperature        numeric(4,2) not null default 0.2,
  max_tokens         integer not null default 1200,
  system_prompt      text,                     -- prompt base personalizado por tenant (opcional)
  monthly_query_limit integer not null default 300,
  extra              jsonb,
  updated_by         uuid,
  updated_at         timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

-- ─── Índices ────────────────────────────────────────────────────────────────
create index if not exists bi_fin_queries_biz_idx    on public.bi_finance_ai_queries (business_id, created_at desc);
create index if not exists bi_fin_queries_period_idx on public.bi_finance_ai_queries (business_id, period_year, period_month);
create index if not exists bi_fin_alerts_biz_idx     on public.bi_finance_alerts (business_id, status);
create index if not exists bi_fin_alerts_period_idx  on public.bi_finance_alerts (business_id, period_year, period_month);
create index if not exists bi_fin_invest_biz_idx     on public.bi_finance_investments (business_id) where deleted_at is null;
create index if not exists bi_fin_invest_estado_idx  on public.bi_finance_investments (estado);
create index if not exists bi_fin_forecast_biz_idx   on public.bi_finance_forecasts (business_id, created_at desc);

-- ─── business_id por defecto (business 'csl') + RLS por tenant ───────────────
do $$
declare
  csl_id uuid := (select id from public.businesses where slug = 'csl');
  t text;
  tables text[] := array[
    'bi_finance_ai_queries','bi_finance_alerts','bi_finance_investments',
    'bi_finance_forecasts','bi_finance_settings'
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

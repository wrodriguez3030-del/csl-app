-- ============================================================================
-- BI FINANCIERO IA — Configuración segura de OpenAI: credenciales cifradas,
-- selección de modelos, límites de uso/gasto y bitácora de consumo.
--
-- Aditivo y NO destructivo. NO borra ni renombra nada. RLS por tenant + grants.
-- La API key se guarda CIFRADA (AES-256-GCM en backend), nunca en texto plano.
-- ============================================================================

-- ─── 1. Columnas nuevas en bi_finance_settings (límites y umbrales) ─────────
alter table public.bi_finance_settings add column if not exists daily_query_limit          integer;
alter table public.bi_finance_settings add column if not exists monthly_input_token_limit  integer;
alter table public.bi_finance_settings add column if not exists monthly_output_token_limit integer;
alter table public.bi_finance_settings add column if not exists monthly_total_token_limit  integer;
alter table public.bi_finance_settings add column if not exists monthly_cost_limit         numeric(14,2);
alter table public.bi_finance_settings add column if not exists cost_currency              text default 'USD';
alter table public.bi_finance_settings add column if not exists alert_threshold_70         boolean default true;
alter table public.bi_finance_settings add column if not exists alert_threshold_90         boolean default true;
alter table public.bi_finance_settings add column if not exists block_at_100               boolean default true;

-- ─── 2. Credenciales OpenAI cifradas (una fila activa por negocio/proveedor) ─
create table if not exists public.bi_finance_ai_secrets (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid references public.businesses(id),
  provider          text not null default 'openai',
  encrypted_api_key text not null,        -- iv|tag|ciphertext en base64 (AES-256-GCM)
  key_last4         text,                  -- últimos 4 chars para mostrar sk-****abcd
  configured_by     uuid,
  configured_at     timestamptz not null default now(),
  rotated_at        timestamptz,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ─── 3. Bitácora de consumo (tokens + costo estimado por consulta) ──────────
create table if not exists public.bi_finance_ai_usage_logs (
  id                     uuid primary key default gen_random_uuid(),
  business_id            uuid references public.businesses(id),
  user_id                uuid,
  model                  text,
  endpoint               text default 'assistant',
  question_id            uuid,
  input_tokens           integer default 0,
  output_tokens          integer default 0,
  total_tokens           integer default 0,
  estimated_input_cost   numeric(14,6),
  estimated_output_cost  numeric(14,6),
  estimated_total_cost   numeric(14,6),
  currency               text default 'USD',
  created_at             timestamptz not null default now()
);

-- ─── 4. Precios por modelo (editables; se dejan NULL si se desconocen) ──────
create table if not exists public.bi_finance_ai_model_pricing (
  id                        uuid primary key default gen_random_uuid(),
  business_id               uuid references public.businesses(id),
  model_id                  text not null,
  input_cost_per_1m_tokens  numeric(14,4),
  output_cost_per_1m_tokens numeric(14,4),
  currency                  text not null default 'USD',
  active                    boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists bi_fin_pricing_uq on public.bi_finance_ai_model_pricing (business_id, model_id);

-- ─── 5. Cache de modelos consultados a la API de OpenAI ─────────────────────
create table if not exists public.bi_finance_ai_models_cache (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid references public.businesses(id),
  model_id            text not null,
  provider            text not null default 'openai',
  display_name        text,
  active              boolean not null default true,
  supports_responses  boolean,
  supports_reasoning  boolean,
  input_token_cost    numeric(14,4),
  output_token_cost   numeric(14,4),
  last_seen_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists bi_fin_models_cache_uq on public.bi_finance_ai_models_cache (business_id, model_id);

-- ─── Índices ────────────────────────────────────────────────────────────────
create index if not exists bi_fin_secrets_biz_idx  on public.bi_finance_ai_secrets (business_id) where active;
create index if not exists bi_fin_usage_biz_idx    on public.bi_finance_ai_usage_logs (business_id, created_at desc);
create index if not exists bi_fin_pricing_biz_idx  on public.bi_finance_ai_model_pricing (business_id) where active;
create index if not exists bi_fin_models_biz_idx   on public.bi_finance_ai_models_cache (business_id) where active;

-- ─── business_id por defecto (business 'csl') + RLS por tenant ───────────────
do $$
declare
  csl_id uuid := (select id from public.businesses where slug = 'csl');
  t text;
  tables text[] := array[
    'bi_finance_ai_secrets','bi_finance_ai_usage_logs',
    'bi_finance_ai_model_pricing','bi_finance_ai_models_cache'
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

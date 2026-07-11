-- Comisión de Ventas · CÁLCULO MENSUAL DE INCENTIVOS (runs) + colaboradores
-- por sucursal + captura manual de pacientes + FIX de sucursales sin canonizar.
--
-- 1) FIX filtros por sucursal: las ventas/cálculos/pacientes guardaban el
--    nombre COMPLETO del Excel ("CIBAO SPA LASER AV. RAFAEL VIDAL") mientras la
--    UI filtra por el canónico ("RAFAEL VIDAL") → todo filtro por sucursal
--    devolvía vacío. Se canonizan los datos y el normalizador de importación
--    queda corregido en código (match por contención).
-- 2) Colaboradores editables por sucursal/servicio (roster con participación,
--    limpieza, bono, evaluación cualitativa; soft delete).
-- 3) Runs mensuales de incentivo por sucursal (borrador→finalizado→anulado,
--    corrección auditada) + detalle por colaborador.
-- 4) patient_counts: columnas para captura MANUAL (servicio + observación).
-- 5) Regla nueva laser_split (fracción del fondo repartida por pacientes;
--    el resto se reparte lineal entre colaboradores lineales).
-- NO destructiva: solo ALTER ADD, CREATE, UPDATE de canonización e INSERT seed.

-- ─── 1. Canonizar sucursales en datos existentes ────────────────────────────
update public.sales_commission_sales        set branch = 'RAFAEL VIDAL' where branch ilike '%RAFAEL VIDAL%' and branch <> 'RAFAEL VIDAL';
update public.sales_commission_sales        set branch = 'LOS JARDINES' where branch ilike '%JARDINES%'     and branch <> 'LOS JARDINES';
update public.sales_commission_sales        set branch = 'VILLA OLGA'   where branch ilike '%VILLA OLGA%'   and branch <> 'VILLA OLGA';

update public.sales_commission_calculations set branch = 'RAFAEL VIDAL' where branch ilike '%RAFAEL VIDAL%' and branch <> 'RAFAEL VIDAL';
update public.sales_commission_calculations set branch = 'LOS JARDINES' where branch ilike '%JARDINES%'     and branch <> 'LOS JARDINES';
update public.sales_commission_calculations set branch = 'VILLA OLGA'   where branch ilike '%VILLA OLGA%'   and branch <> 'VILLA OLGA';

update public.sales_commission_patient_counts set branch = 'RAFAEL VIDAL' where branch ilike '%RAFAEL VIDAL%' and branch <> 'RAFAEL VIDAL';
update public.sales_commission_patient_counts set branch = 'LOS JARDINES' where branch ilike '%JARDINES%'     and branch <> 'LOS JARDINES';
update public.sales_commission_patient_counts set branch = 'VILLA OLGA'   where branch ilike '%VILLA OLGA%'   and branch <> 'VILLA OLGA';

update public.sales_commission_reservations set branch_normalized = 'RAFAEL VIDAL' where branch_normalized ilike '%RAFAEL VIDAL%' and branch_normalized <> 'RAFAEL VIDAL';
update public.sales_commission_reservations set branch_normalized = 'LOS JARDINES' where branch_normalized ilike '%JARDINES%'     and branch_normalized <> 'LOS JARDINES';
update public.sales_commission_reservations set branch_normalized = 'VILLA OLGA'   where branch_normalized ilike '%VILLA OLGA%'   and branch_normalized <> 'VILLA OLGA';

-- ─── 2. patient_counts: captura manual por servicio ─────────────────────────
alter table public.sales_commission_patient_counts
  add column if not exists service     text,
  add column if not exists observation text;

-- ─── 3. Colaboradores por sucursal ──────────────────────────────────────────
create table if not exists public.sales_commission_collaborators (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid references public.businesses(id),
  branch                text not null,
  name                  text not null,
  services              text[]        default '{}',
  participation_type    text          default 'mixto',  -- lineal | pacientes | mixto | porcentaje
  fixed_percentage      numeric(9,4),
  linear_participation  boolean       default true,
  patient_participation boolean       default true,
  active                boolean       default true,
  start_date            date,
  end_date              date,
  cleaning_contribution numeric(16,2) default 400,
  bonus_extra           numeric(16,2) default 0,
  evaluation_pct        numeric(9,2)  default 100,
  notes                 text,
  created_by            text,
  updated_by            text,
  deleted_at            timestamptz,
  deleted_by            text,
  created_at            timestamptz   default now(),
  updated_at            timestamptz   default now()
);
-- Único VIVO por sucursal+nombre (soft delete no reserva el nombre).
create unique index if not exists sc_collab_uq  on public.sales_commission_collaborators (business_id, branch, name) where deleted_at is null;
create index        if not exists sc_collab_idx on public.sales_commission_collaborators (business_id, branch, active);

-- ─── 4. Runs mensuales de incentivo ─────────────────────────────────────────
create table if not exists public.sales_commission_runs (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid references public.businesses(id),
  branch            text not null,
  period_month      int  not null,
  period_year       int  not null,
  status            text default 'borrador',  -- borrador | finalizado | anulado
  card_pct          numeric(9,4) default 0.27,
  base_summary      jsonb,   -- bases por servicio × método de pago (bruta/neta)
  rules_snapshot    jsonb,
  totals            jsonb,
  alerts            jsonb,
  notes             text,
  created_by        text,
  updated_by        text,
  finalized_by      text,
  finalized_at      timestamptz,
  voided_by         text,
  voided_at         timestamptz,
  void_reason       text,
  corrected_by      text,
  corrected_at      timestamptz,
  correction_reason text,
  deleted_at        timestamptz,
  deleted_by        text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
-- Un run VIVO por sucursal + período (los anulados no bloquean recalcular).
create unique index if not exists sc_runs_uq  on public.sales_commission_runs (business_id, branch, period_year, period_month) where status <> 'anulado' and deleted_at is null;
create index        if not exists sc_runs_idx on public.sales_commission_runs (business_id, period_year, period_month, status);

create table if not exists public.sales_commission_run_items (
  id                         uuid primary key default gen_random_uuid(),
  run_id                     uuid references public.sales_commission_runs(id) on delete cascade,
  business_id                uuid references public.businesses(id),
  collaborator_id            uuid,
  collaborator_name          text not null,
  branch                     text,
  service_breakdown          jsonb,  -- por categoría: base neta atribuible, %, monto
  patients                   int           default 0,
  patients_pct               numeric(9,4)  default 0,
  product_units              int           default 0,
  product_incentive          numeric(16,2) default 0,
  service_incentive          numeric(16,2) default 0,
  evaluation_pct             numeric(9,2)  default 100,
  service_incentive_adjusted numeric(16,2) default 0,
  laser_linear               numeric(16,2) default 0,
  laser_patients             numeric(16,2) default 0,
  laser_total                numeric(16,2) default 0,
  bonus_extra                numeric(16,2) default 0,
  cleaning_contribution      numeric(16,2) default 0,
  manual_adjustment          numeric(16,2) default 0,
  gross_total                numeric(16,2) default 0,
  net_total                  numeric(16,2) default 0,
  notes                      text,
  created_at                 timestamptz default now(),
  updated_at                 timestamptz default now()
);
create index if not exists sc_run_items_run_idx on public.sales_commission_run_items (run_id);
create index if not exists sc_run_items_biz_idx on public.sales_commission_run_items (business_id);

-- ─── 5. RLS por tenant + grants (mismo patrón del módulo) ───────────────────
do $$
declare t text;
begin
  foreach t in array array['sales_commission_collaborators','sales_commission_runs','sales_commission_run_items'] loop
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

-- ─── 6. Regla laser_split (fracción del fondo por pacientes; default 100%) ──
insert into public.sales_commission_rules
  (business_id, name, rule_type, percentage, priority, active, effective_from, created_by)
select b.id, 'Reparto láser: fracción por pacientes atendidos', 'laser_split', 1.0, 100, true, '2000-01-01', 'seed'
from public.businesses b
where b.slug = 'csl'
  and not exists (
    select 1 from public.sales_commission_rules r
    where r.business_id = b.id and r.rule_type = 'laser_split'
  );

-- ─── 7. Seed de colaboradores (Cibao / csl) — listas iniciales del negocio ──
-- ASHLEY figura en Rafael Vidal Y Los Jardines (permitido: único por sucursal).
-- KARLA (RV) y LUISA (VO) entran INACTIVAS con nota "verificar si aplica".
insert into public.sales_commission_collaborators
  (business_id, branch, name, services, active, notes, created_by)
select b.id, v.branch, v.name, array['DEPILACION_LASER'], v.active, v.notes, 'seed'
from public.businesses b
cross join (values
  ('RAFAEL VIDAL', 'LUISA',    true,  null),
  ('RAFAEL VIDAL', 'YANIBEL',  true,  null),
  ('RAFAEL VIDAL', 'RIQUELMI', true,  null),
  ('RAFAEL VIDAL', 'ROSA',     true,  null),
  ('RAFAEL VIDAL', 'DIANA',    true,  null),
  ('RAFAEL VIDAL', 'MADELINE', true,  null),
  ('RAFAEL VIDAL', 'ASHLEY',   true,  null),
  ('RAFAEL VIDAL', 'EMELI',    true,  null),
  ('RAFAEL VIDAL', 'KARLA',    false, 'Seed: verificar si aplica'),
  ('LOS JARDINES', 'LESLIE',   true,  null),
  ('LOS JARDINES', 'YADIBEL',  true,  null),
  ('LOS JARDINES', 'ASHLEY',   true,  null),
  ('LOS JARDINES', 'NAYELI',   true,  null),
  ('LOS JARDINES', 'KATHERIN', true,  null),
  ('LOS JARDINES', 'LILIAN',   true,  null),
  ('LOS JARDINES', 'YAMILKA',  true,  null),
  ('LOS JARDINES', 'JOELY',    true,  null),
  ('LOS JARDINES', 'BENITA',   true,  null),
  ('VILLA OLGA',   'ANGELICA', true,  null),
  ('VILLA OLGA',   'GIPSY',    true,  null),
  ('VILLA OLGA',   'YESSICA',  true,  null),
  ('VILLA OLGA',   'SAHOMY',   true,  null),
  ('VILLA OLGA',   'EIDYLEE',  true,  null),
  ('VILLA OLGA',   'DAYHANA',  true,  null),
  ('VILLA OLGA',   'LUISA',    false, 'Seed: verificar si aplica')
) as v(branch, name, active, notes)
where b.slug = 'csl'
on conflict (business_id, branch, name) where deleted_at is null do nothing;

notify pgrst, 'reload schema';

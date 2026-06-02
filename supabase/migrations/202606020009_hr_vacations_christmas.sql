-- ─────────────────────────────────────────────────────────────────────────
-- RR.HH. Fase 3 (Pagos) · módulo 6: Vacaciones + Doble sueldo (Salario Navidad).
-- Multi-tenant + RLS. FK a businesses(id) (db-cls). Idempotente.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hr_vacations (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id     text NOT NULL,
  employee_nombre text,
  periodo         text,                              -- ej. "2026"
  dias            numeric(5,1) NOT NULL DEFAULT 0,
  fecha_inicio    date,
  fecha_fin       date,
  sueldo_diario   numeric(12,2) NOT NULL DEFAULT 0,
  monto           numeric(12,2) NOT NULL DEFAULT 0,   -- sueldo_diario × días
  status          text NOT NULL DEFAULT 'solicitado', -- solicitado|aprobado|pagado|anulado
  observations    text,
  created_by      uuid,
  approved_by     uuid,
  approved_at     timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_vacations_business_idx ON hr_vacations (business_id);
CREATE INDEX IF NOT EXISTS hr_vacations_emp_idx      ON hr_vacations (business_id, employee_id);

CREATE TABLE IF NOT EXISTS hr_christmas_bonus (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id     text NOT NULL,
  employee_nombre text,
  anio            integer NOT NULL,
  sueldo_mensual  numeric(12,2) NOT NULL DEFAULT 0,
  proporcional    boolean NOT NULL DEFAULT false,
  meses           numeric(4,1) NOT NULL DEFAULT 12,
  monto           numeric(12,2) NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'calculado',  -- calculado|aprobado|pagado|anulado
  observations    text,
  created_by      uuid,
  approved_by     uuid,
  approved_at     timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_christmas_business_idx ON hr_christmas_bonus (business_id);
-- Bloqueo de doble pago: un registro por empleado + año (excepto anulados ya
-- se controla en backend; el índice evita duplicar el cálculo del año).
CREATE UNIQUE INDEX IF NOT EXISTS hr_christmas_emp_year_uniq ON hr_christmas_bonus (business_id, employee_id, anio);

ALTER TABLE hr_vacations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_christmas_bonus ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['hr_vacations', 'hr_christmas_bonus'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DO $i$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN EXECUTE %3$L; END IF; END $i$;',
      t, t || '_tenant_select',
      format('CREATE POLICY %I ON %I FOR SELECT USING (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1))', t || '_tenant_select', t));
    EXECUTE format('DO $i$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN EXECUTE %3$L; END IF; END $i$;',
      t, t || '_tenant_insert',
      format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1))', t || '_tenant_insert', t));
    EXECUTE format('DO $i$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN EXECUTE %3$L; END IF; END $i$;',
      t, t || '_tenant_update',
      format('CREATE POLICY %I ON %I FOR UPDATE USING (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1))', t || '_tenant_update', t));
    EXECUTE format('DO $i$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN EXECUTE %3$L; END IF; END $i$;',
      t, t || '_tenant_delete',
      format('CREATE POLICY %I ON %I FOR DELETE USING (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1))', t || '_tenant_delete', t));
    EXECUTE format('DO $i$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN EXECUTE %3$L; END IF; END $i$;',
      t, t || '_service_all',
      format('CREATE POLICY %I ON %I FOR ALL USING (auth.role() = ''service_role'')', t || '_service_all', t));
  END LOOP;
END $$;

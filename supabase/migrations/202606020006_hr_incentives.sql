-- ─────────────────────────────────────────────────────────────────────────
-- RR.HH. Fase 3 (Pagos) · módulo 3: Incentivos y comisiones.
-- Comisiones, bonos y ajustes; aprobación previa al pago; salida a nómina o TXT.
-- Multi-tenant + RLS. FK a businesses(id) (db-cls). Idempotente.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hr_incentives (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id     text NOT NULL,
  employee_nombre text,
  tipo            text NOT NULL DEFAULT 'comision',  -- comision|bono_fijo|bono_meta|incentivo_especial|ajuste
  monto           numeric(12,2) NOT NULL DEFAULT 0,
  periodo         text,                              -- ej. "2026-06" o "Quincena 1 jun"
  descripcion     text,
  salida          text NOT NULL DEFAULT 'nomina',    -- nomina | txt_separado
  status          text NOT NULL DEFAULT 'pendiente', -- pendiente | aprobado | anulado | pagado
  created_by      uuid,
  approved_by     uuid,
  approved_at     timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_incentives_business_idx ON hr_incentives (business_id);
CREATE INDEX IF NOT EXISTS hr_incentives_emp_idx      ON hr_incentives (business_id, employee_id);
CREATE INDEX IF NOT EXISTS hr_incentives_status_idx   ON hr_incentives (business_id, status);

ALTER TABLE hr_incentives ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text := 'hr_incentives';
BEGIN
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
END $$;

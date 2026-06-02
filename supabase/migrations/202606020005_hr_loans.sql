-- ─────────────────────────────────────────────────────────────────────────
-- RR.HH. Fase 3 (Pagos) · módulo 2: Préstamos y avances.
-- Préstamo con cuotas; pagos (por nómina o extra) reducen el balance.
-- Multi-tenant + RLS. FK a businesses(id) (db-cls). Idempotente.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hr_loans (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id     text NOT NULL,
  employee_nombre text,
  principal       numeric(12,2) NOT NULL DEFAULT 0,
  cuotas          integer NOT NULL DEFAULT 1,
  monto_cuota     numeric(12,2) NOT NULL DEFAULT 0,
  balance         numeric(12,2) NOT NULL DEFAULT 0,
  descripcion     text,
  status          text NOT NULL DEFAULT 'activo',  -- activo | pagado | cancelado
  start_date      date NOT NULL DEFAULT current_date,
  created_by      uuid,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_loans_business_idx ON hr_loans (business_id);
CREATE INDEX IF NOT EXISTS hr_loans_emp_idx      ON hr_loans (business_id, employee_id);
CREATE INDEX IF NOT EXISTS hr_loans_status_idx   ON hr_loans (business_id, status);

CREATE TABLE IF NOT EXISTS hr_loan_payments (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id  uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  loan_id      uuid NOT NULL REFERENCES hr_loans(id) ON DELETE CASCADE,
  monto        numeric(12,2) NOT NULL DEFAULT 0,
  fecha        date NOT NULL DEFAULT current_date,
  tipo         text NOT NULL DEFAULT 'extra',  -- nomina | extra
  notes        text,
  created_by   uuid,
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_loan_payments_business_idx ON hr_loan_payments (business_id);
CREATE INDEX IF NOT EXISTS hr_loan_payments_loan_idx     ON hr_loan_payments (business_id, loan_id);

ALTER TABLE hr_loans         ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_loan_payments ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['hr_loans', 'hr_loan_payments'];
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

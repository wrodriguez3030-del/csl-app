-- ─────────────────────────────────────────────────────────────────────────
-- RR.HH. Contratos laborales. Snapshot de datos del empleado al momento del
-- contrato + campos editables. Aditivo · idempotente · RLS multi-tenant.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_contracts (
  id                 uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id        uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id        text NOT NULL,
  employee_nombre    text,
  cedula             text,
  estado_civil       text,
  direccion          text,
  telefono           text,
  email              text,
  contract_type      text DEFAULT 'Tiempo indefinido',
  start_date         date,
  position           text,
  branch             text,
  salary             numeric DEFAULT 0,
  payment_frequency  text DEFAULT 'Mensual',
  payment_method     text DEFAULT 'Transferencia bancaria',
  bank               text,
  account_type       text,
  account_number     text,
  account_holder     text,
  schedule_summary   text,
  work_days          text,
  break_time         text,
  weekly_rest        text,
  incentive_applies  boolean DEFAULT false,
  incentive_detail   text,
  observaciones      text,
  status             text DEFAULT 'Borrador',
  pdf_url            text,
  template_version   text DEFAULT 'v1',
  created_by         uuid,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_contracts_biz_idx ON hr_contracts (business_id, employee_id);

ALTER TABLE hr_contracts ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text := 'hr_contracts';
BEGIN
  EXECUTE format('DO $i$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN EXECUTE %3$L; END IF; END $i$;',
    t, t || '_tenant_select',
    format('CREATE POLICY %I ON %I FOR SELECT USING (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1))', t || '_tenant_select', t));
  EXECUTE format('DO $i$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN EXECUTE %3$L; END IF; END $i$;',
    t, t || '_service_all',
    format('CREATE POLICY %I ON %I FOR ALL USING (auth.role() = ''service_role'')', t || '_service_all', t));
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON hr_contracts TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────
-- RR.HH. Fase 2 (cierre): Permisos y licencias.
-- Multi-tenant: business_id NOT NULL + RLS por tenant + service_role.
-- FK a businesses(id) (db-cls). Idempotente y no destructivo.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hr_leave_requests (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id   uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id   text NOT NULL,
  leave_type    text NOT NULL,   -- personal_con_disfrute | personal_sin_disfrute | medica | duelo | emergencia | maternidad | paternidad
  start_date    date NOT NULL,
  end_date      date NOT NULL,
  days          numeric(5,1) NOT NULL DEFAULT 0,
  reason        text,
  evidence_url  text,            -- certificado médico, etc.
  impact        text NOT NULL DEFAULT 'no_aplica',  -- con_disfrute | sin_disfrute | no_aplica (impacto en nómina)
  status        text NOT NULL DEFAULT 'pendiente',  -- pendiente | aprobado | rechazado | cancelado
  approved_by   uuid,
  approved_at   timestamptz,
  observations  text,
  created_by    uuid,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_leave_business_idx ON hr_leave_requests (business_id);
CREATE INDEX IF NOT EXISTS hr_leave_emp_idx      ON hr_leave_requests (business_id, employee_id);
CREATE INDEX IF NOT EXISTS hr_leave_status_idx   ON hr_leave_requests (business_id, status);
CREATE INDEX IF NOT EXISTS hr_leave_range_idx    ON hr_leave_requests (business_id, start_date, end_date);

ALTER TABLE hr_leave_requests ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text := 'hr_leave_requests';
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

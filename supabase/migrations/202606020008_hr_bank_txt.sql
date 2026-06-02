-- ─────────────────────────────────────────────────────────────────────────
-- RR.HH. Fase 3 (Pagos) · módulo 5: Archivos TXT bancarios.
-- Registro de TXT generados (idempotencia por hash) + cuenta origen en config.
-- Reutiliza hr_employee_bank_accounts (ya existente) para la cuenta destino.
-- Multi-tenant + RLS. FK a businesses(id). Idempotente.
-- ─────────────────────────────────────────────────────────────────────────

-- Cuenta origen de la empresa para el TXT (en la config de nómina).
ALTER TABLE hr_payroll_config ADD COLUMN IF NOT EXISTS bank_origin_account text;
ALTER TABLE hr_payroll_config ADD COLUMN IF NOT EXISTS bank_origin_name text;

CREATE TABLE IF NOT EXISTS hr_bank_txt_files (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id  uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  origen       text NOT NULL DEFAULT 'nomina',   -- nomina|incentivos|vacaciones|doble_sueldo|dias_laborados|liquidacion
  run_id       uuid,                             -- corrida de nómina (si aplica)
  filename     text NOT NULL,
  hash         text NOT NULL,
  total        numeric(14,2) NOT NULL DEFAULT 0,
  lineas       integer NOT NULL DEFAULT 0,
  content      text,                             -- contenido para re-descarga
  status       text NOT NULL DEFAULT 'generado',
  created_by   uuid,
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_bank_txt_business_idx ON hr_bank_txt_files (business_id);
CREATE UNIQUE INDEX IF NOT EXISTS hr_bank_txt_hash_uniq ON hr_bank_txt_files (business_id, hash);

ALTER TABLE hr_bank_txt_files ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text := 'hr_bank_txt_files';
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

-- hr_employee_bank_accounts YA EXISTE (no se recrea). Aseguramos RLS service_all
-- por si fue creada con solo 4 policies (sin service_all).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='hr_employee_bank_accounts' AND policyname='hr_employee_bank_accounts_service_all') THEN
    EXECUTE 'CREATE POLICY hr_employee_bank_accounts_service_all ON hr_employee_bank_accounts FOR ALL USING (auth.role() = ''service_role'')';
  END IF;
END $$;

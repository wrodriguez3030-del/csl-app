-- ─────────────────────────────────────────────────────────────────────────
-- RR.HH. Fase 3 (Pagos) · módulo 4: Nómina.
-- hr_payroll_config (tasas TSS/ISR CONFIGURABLES por tenant — valores RD por
-- defecto, A VERIFICAR con contabilidad), hr_payroll_runs (corridas) y
-- hr_payroll_items (renglón por empleado). Multi-tenant + RLS.
-- FK a businesses(id) (db-cls). Idempotente y no destructivo.
-- ─────────────────────────────────────────────────────────────────────────

-- Config de nómina: una fila por business.
CREATE TABLE IF NOT EXISTS hr_payroll_config (
  business_id   uuid PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  daily_base    numeric(6,2)  NOT NULL DEFAULT 23.83,   -- sueldo diario = mensual / daily_base
  afp_rate      numeric(6,5)  NOT NULL DEFAULT 0.02870, -- AFP empleado (a verificar)
  sfs_rate      numeric(6,5)  NOT NULL DEFAULT 0.03040, -- SFS/salud empleado (a verificar)
  afp_cap       numeric(12,2) NOT NULL DEFAULT 0,       -- tope salarial AFP (0 = sin tope)
  sfs_cap       numeric(12,2) NOT NULL DEFAULT 0,       -- tope salarial SFS (0 = sin tope)
  -- Escala ISR ANUAL DGII (a verificar): [{li, ls(null=inf), tasa, cuota}]
  isr_brackets  jsonb NOT NULL DEFAULT '[
    {"li":0,"ls":416220.00,"tasa":0,"cuota":0},
    {"li":416220.01,"ls":624329.00,"tasa":0.15,"cuota":0},
    {"li":624329.01,"ls":867123.00,"tasa":0.20,"cuota":31216.00},
    {"li":867123.01,"ls":null,"tasa":0.25,"cuota":79776.00}
  ]'::jsonb,
  verificado    boolean NOT NULL DEFAULT false,         -- contabilidad valida → true
  updated_by    uuid,
  updated_at    timestamptz DEFAULT now()
);

-- Corridas de nómina.
CREATE TABLE IF NOT EXISTS hr_payroll_runs (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id   uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  tipo          text NOT NULL DEFAULT 'quincenal',  -- quincenal | mensual
  sucursal      text,
  status        text NOT NULL DEFAULT 'borrador',   -- borrador|calculada|revision|aprobada|pagada
  totals        jsonb,
  created_by    uuid,
  approved_by   uuid,
  approved_at   timestamptz,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_payroll_runs_business_idx ON hr_payroll_runs (business_id);
CREATE INDEX IF NOT EXISTS hr_payroll_runs_status_idx   ON hr_payroll_runs (business_id, status);

-- Renglón por empleado dentro de una corrida.
CREATE TABLE IF NOT EXISTS hr_payroll_items (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id      uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  run_id           uuid NOT NULL REFERENCES hr_payroll_runs(id) ON DELETE CASCADE,
  employee_id      text NOT NULL,
  employee_nombre  text,
  sueldo_mensual   numeric(12,2) NOT NULL DEFAULT 0,
  base_periodo     numeric(12,2) NOT NULL DEFAULT 0,
  incentivos       numeric(12,2) NOT NULL DEFAULT 0,
  afp              numeric(12,2) NOT NULL DEFAULT 0,
  sfs              numeric(12,2) NOT NULL DEFAULT 0,
  isr              numeric(12,2) NOT NULL DEFAULT 0,
  prestamos        numeric(12,2) NOT NULL DEFAULT 0,
  otros_ingresos   numeric(12,2) NOT NULL DEFAULT 0,
  otros_descuentos numeric(12,2) NOT NULL DEFAULT 0,
  bruto            numeric(12,2) NOT NULL DEFAULT 0,
  total_deducciones numeric(12,2) NOT NULL DEFAULT 0,
  neto             numeric(12,2) NOT NULL DEFAULT 0,
  detalle          jsonb,
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_payroll_items_business_idx ON hr_payroll_items (business_id);
CREATE INDEX IF NOT EXISTS hr_payroll_items_run_idx      ON hr_payroll_items (business_id, run_id);

ALTER TABLE hr_payroll_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_payroll_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_payroll_items  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['hr_payroll_config', 'hr_payroll_runs', 'hr_payroll_items'];
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

-- Seed de config por defecto para los businesses existentes (no pisa si ya hay).
INSERT INTO hr_payroll_config (business_id)
SELECT id FROM businesses
ON CONFLICT (business_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- RR.HH. Fase 3 (Pagos) · módulo 1: Días laborados.
-- Pago proporcional = sueldo_diario × días, con sueldo_diario = mensual / 23.83.
-- NO aplica TSS/ISR (eso va en Nómina, configurable). Multi-tenant + RLS.
-- FK a businesses(id) (db-cls). Idempotente y no destructivo.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hr_dias_laborados (
  id                 uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id        uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id        text NOT NULL,
  employee_nombre    text,                       -- snapshot para listado/PDF
  period_start       date NOT NULL,
  period_end         date NOT NULL,
  sucursal           text,
  sueldo_mensual     numeric(12,2) NOT NULL DEFAULT 0,
  sueldo_diario      numeric(12,2) NOT NULL DEFAULT 0,   -- = mensual / 23.83
  dias_laborados     numeric(5,1)  NOT NULL DEFAULT 0,
  dias_origen        text NOT NULL DEFAULT 'manual',     -- 'asistencia' | 'manual'
  edit_reason        text,                       -- motivo obligatorio si se edita manual
  ingresos           numeric(12,2) NOT NULL DEFAULT 0,
  ingresos_detalle   text,
  descuentos         numeric(12,2) NOT NULL DEFAULT 0,
  descuentos_detalle text,
  pago_dias          numeric(12,2) NOT NULL DEFAULT 0,   -- sueldo_diario × días
  total              numeric(12,2) NOT NULL DEFAULT 0,   -- pago_dias + ingresos − descuentos
  estado             text NOT NULL DEFAULT 'borrador',   -- borrador|calculado|en_revision|aprobado|anulado
  observations       text,
  created_by         uuid,
  approved_by        uuid,
  approved_at        timestamptz,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_dias_business_idx ON hr_dias_laborados (business_id);
CREATE INDEX IF NOT EXISTS hr_dias_emp_idx      ON hr_dias_laborados (business_id, employee_id);
CREATE INDEX IF NOT EXISTS hr_dias_estado_idx   ON hr_dias_laborados (business_id, estado);
CREATE INDEX IF NOT EXISTS hr_dias_period_idx   ON hr_dias_laborados (business_id, period_start, period_end);

ALTER TABLE hr_dias_laborados ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text := 'hr_dias_laborados';
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

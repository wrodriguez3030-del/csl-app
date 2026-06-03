-- ─────────────────────────────────────────────────────────────────────────
-- RR.HH. Fase 4 (Prestaciones) · Liquidaciones y prestaciones laborales RD.
-- Cálculo REFERENCIAL (Código de Trabajo RD) — requiere validación legal/
-- contable. Conceptos editables; nada se paga automáticamente.
-- Multi-tenant + RLS. FK a businesses(id) (db-cls). Idempotente.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hr_severance (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id      uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id      text NOT NULL,
  employee_nombre  text,
  motivo           text NOT NULL DEFAULT 'desahucio',
                   -- desahucio|renuncia|despido_justificado|despido_injustificado|
                   -- mutuo_acuerdo|fin_contrato|abandono|fallecimiento
  fecha_ingreso    date,
  fecha_salida     date,
  anios_servicio   numeric(6,2) NOT NULL DEFAULT 0,
  sueldo_mensual   numeric(12,2) NOT NULL DEFAULT 0,
  salario_diario   numeric(12,2) NOT NULL DEFAULT 0,
  preaviso_dias    numeric(6,1) NOT NULL DEFAULT 0,
  preaviso_monto   numeric(12,2) NOT NULL DEFAULT 0,
  cesantia_dias    numeric(7,1) NOT NULL DEFAULT 0,
  cesantia_monto   numeric(12,2) NOT NULL DEFAULT 0,
  vacaciones_monto numeric(12,2) NOT NULL DEFAULT 0,
  navidad_monto    numeric(12,2) NOT NULL DEFAULT 0,
  salario_pendiente numeric(12,2) NOT NULL DEFAULT 0,
  otros_ingresos   numeric(12,2) NOT NULL DEFAULT 0,
  descuentos       numeric(12,2) NOT NULL DEFAULT 0,
  total            numeric(12,2) NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'borrador',
                   -- borrador|calculado|revisado|aprobado|pagado|archivado|anulado
  observations     text,
  created_by       uuid,
  approved_by      uuid,
  approved_at      timestamptz,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_severance_business_idx ON hr_severance (business_id);
CREATE INDEX IF NOT EXISTS hr_severance_emp_idx      ON hr_severance (business_id, employee_id);
CREATE INDEX IF NOT EXISTS hr_severance_status_idx   ON hr_severance (business_id, status);

ALTER TABLE hr_severance ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text := 'hr_severance';
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

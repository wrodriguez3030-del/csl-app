-- ─────────────────────────────────────────────────────────────────────────
-- RR.HH. · Modalidades de ponche configurables + enriquecimiento de hr_punches.
--
-- 1) Amplía hr_punches con la modalidad usada y metadatos de validación
--    (biometría del dispositivo, selfie, precisión GPS, nombre de dispositivo).
-- 2) Crea hr_punch_modality_config: qué modalidades están habilitadas y qué
--    validaciones son obligatorias, configurable por negocio / sucursal /
--    empleado. Una fila con sucursal=NULL y employee_id=NULL = config GLOBAL
--    del negocio; filas más específicas la sobreescriben.
--
-- Multi-tenant + RLS, idéntico patrón a 202606050003. Idempotente y NO
-- destructivo (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────

-- Modalidad y metadatos de validación del ponche.
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS modality           text;     -- pin | qr | mobile_biometric | face | gps | kiosk | remote | manual
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS selfie_url         text;
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS verified_biometric boolean NOT NULL DEFAULT false;
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS validation_result  text;     -- ok | warning | rejected (resumen legible)
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS accuracy_meters    numeric(10,2);
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS device_name        text;

CREATE INDEX IF NOT EXISTS hr_punches_modality_idx ON hr_punches (business_id, modality);

-- Configuración de modalidades de ponche por nivel (negocio/sucursal/empleado).
CREATE TABLE IF NOT EXISTS hr_punch_modality_config (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id           uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sucursal              text,                 -- NULL = aplica a todas las sucursales del negocio
  employee_id           text,                 -- NULL = aplica a todos los empleados del alcance
  -- Modalidades permitidas
  allow_pin             boolean NOT NULL DEFAULT true,
  allow_qr              boolean NOT NULL DEFAULT true,
  allow_mobile_biometric boolean NOT NULL DEFAULT false,
  allow_face            boolean NOT NULL DEFAULT false,
  allow_gps             boolean NOT NULL DEFAULT true,
  allow_kiosk           boolean NOT NULL DEFAULT true,
  allow_remote_punch    boolean NOT NULL DEFAULT false,
  -- Requisitos obligatorios
  require_photo         boolean NOT NULL DEFAULT false,
  require_location      boolean NOT NULL DEFAULT true,
  require_biometric     boolean NOT NULL DEFAULT false,
  only_within_schedule  boolean NOT NULL DEFAULT false,
  tolerance_minutes     integer NOT NULL DEFAULT 10,
  double_validation     boolean NOT NULL DEFAULT false,
  active                boolean NOT NULL DEFAULT true,
  created_by            uuid,
  updated_by            uuid,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_punch_modality_config_scope_idx
  ON hr_punch_modality_config (business_id, sucursal, employee_id);

-- Unicidad por NIVEL mediante índices parciales (NULL no es "distinto" aquí,
-- a diferencia de un UNIQUE de tabla). Garantiza 1 sola config por alcance:
--   · global   → 1 por negocio
--   · sucursal → 1 por (negocio, sucursal)
--   · empleado → 1 por (negocio, empleado)
CREATE UNIQUE INDEX IF NOT EXISTS hr_pmc_global_uidx
  ON hr_punch_modality_config (business_id)
  WHERE sucursal IS NULL AND employee_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS hr_pmc_sucursal_uidx
  ON hr_punch_modality_config (business_id, sucursal)
  WHERE sucursal IS NOT NULL AND employee_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS hr_pmc_employee_uidx
  ON hr_punch_modality_config (business_id, employee_id)
  WHERE employee_id IS NOT NULL;

ALTER TABLE hr_punch_modality_config ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['hr_punch_modality_config'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DO $i$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN EXECUTE %3$L; END IF; END $i$;',
      t, t || '_tenant_select',
      format('CREATE POLICY %I ON %I FOR SELECT USING (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1))', t || '_tenant_select', t));
    EXECUTE format('DO $i$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN EXECUTE %3$L; END IF; END $i$;',
      t, t || '_service_all',
      format('CREATE POLICY %I ON %I FOR ALL USING (auth.role() = ''service_role'')', t || '_service_all', t));
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON hr_punch_modality_config TO authenticated, service_role;

-- Seed: una config GLOBAL por negocio (sucursal/empleado NULL) con los
-- valores por defecto, para que la pantalla de admin tenga base editable.
INSERT INTO hr_punch_modality_config (business_id, sucursal, employee_id)
SELECT b.id, NULL, NULL FROM businesses b
WHERE NOT EXISTS (
  SELECT 1 FROM hr_punch_modality_config c
  WHERE c.business_id = b.id AND c.sucursal IS NULL AND c.employee_id IS NULL
);

NOTIFY pgrst, 'reload schema';

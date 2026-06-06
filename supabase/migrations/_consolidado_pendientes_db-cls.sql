-- ════════════════════════════════════════════════════════════════════════
-- CONSOLIDADO de migraciones pendientes para db-cls (SQL Editor).
-- 100% aditivo · idempotente · multi-tenant (business_id) · con RLS y GRANTS.
-- No contiene DELETE/TRUNCATE/DROP. Aplicar en Supabase self-hosted db-cls.
--   1) 202606050001  payroll TSS 2026
--   2) 202606050002  vacaciones legal
--   3) 202606050003  ponche QR + geolocalización + dispositivos
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1) NÓMINA · tasas TSS/ISR RD 2026 verificadas (columnas patronales + topes)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE hr_payroll_config ADD COLUMN IF NOT EXISTS srl_cap               numeric(12,2) NOT NULL DEFAULT 92892.00;
ALTER TABLE hr_payroll_config ADD COLUMN IF NOT EXISTS afp_employer_rate     numeric(6,5)  NOT NULL DEFAULT 0.07100;
ALTER TABLE hr_payroll_config ADD COLUMN IF NOT EXISTS sfs_employer_rate     numeric(6,5)  NOT NULL DEFAULT 0.07090;
ALTER TABLE hr_payroll_config ADD COLUMN IF NOT EXISTS srl_employer_rate     numeric(6,5)  NOT NULL DEFAULT 0.01100;
ALTER TABLE hr_payroll_config ADD COLUMN IF NOT EXISTS infotep_employer_rate numeric(6,5)  NOT NULL DEFAULT 0.01000;

INSERT INTO hr_payroll_config (business_id)
SELECT id FROM businesses
ON CONFLICT (business_id) DO NOTHING;

UPDATE hr_payroll_config SET
  daily_base            = 23.83,
  afp_rate              = 0.0287,
  sfs_rate              = 0.0304,
  afp_cap               = 464460.00,
  sfs_cap               = 232230.00,
  srl_cap               = 92892.00,
  afp_employer_rate     = 0.0710,
  sfs_employer_rate     = 0.0709,
  srl_employer_rate     = 0.0110,
  infotep_employer_rate = 0.0100,
  isr_brackets = '[
    {"li":0,"ls":416220.00,"tasa":0,"cuota":0},
    {"li":416220.01,"ls":624329.00,"tasa":0.15,"cuota":0},
    {"li":624329.01,"ls":867123.00,"tasa":0.20,"cuota":31216.00},
    {"li":867123.01,"ls":null,"tasa":0.25,"cuota":79776.00}
  ]'::jsonb,
  verificado = true,
  updated_at = now();

-- ─────────────────────────────────────────────────────────────────────────
-- 2) VACACIONES · cálculo legal (Código de Trabajo RD)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE hr_vacations ADD COLUMN IF NOT EXISTS sueldo_mensual   numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE hr_vacations ADD COLUMN IF NOT EXISTS fecha_ingreso    date;
ALTER TABLE hr_vacations ADD COLUMN IF NOT EXISTS antiguedad_anios numeric(6,2)  NOT NULL DEFAULT 0;
ALTER TABLE hr_vacations ADD COLUMN IF NOT EXISTS dias_legales     numeric(5,1)  NOT NULL DEFAULT 0;
ALTER TABLE hr_vacations ADD COLUMN IF NOT EXISTS cedula           text;
ALTER TABLE hr_vacations ADD COLUMN IF NOT EXISTS puesto           text;
ALTER TABLE hr_vacations ADD COLUMN IF NOT EXISTS sucursal         text;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) PONCHE QR + geolocalización + dispositivos autorizados
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_employee_qr_tokens (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id   uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id   text NOT NULL,
  token         text NOT NULL,
  token_hash    text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  revoked_at    timestamptz,
  regenerated_by uuid,
  UNIQUE (business_id, employee_id)
);
CREATE INDEX IF NOT EXISTS hr_qr_tokens_hash_idx ON hr_employee_qr_tokens (token_hash);

CREATE TABLE IF NOT EXISTS hr_punch_devices (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id       uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sucursal          text,
  device_name       text NOT NULL,
  device_token_hash text NOT NULL,
  active            boolean NOT NULL DEFAULT true,
  last_seen_at      timestamptz,
  device_info       text,
  created_by        uuid,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_punch_devices_hash_idx ON hr_punch_devices (device_token_hash);
CREATE INDEX IF NOT EXISTS hr_punch_devices_business_idx ON hr_punch_devices (business_id);

CREATE TABLE IF NOT EXISTS hr_branch_geofences (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id   uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sucursal      text NOT NULL,
  latitude      numeric(10,7) NOT NULL DEFAULT 0,
  longitude     numeric(10,7) NOT NULL DEFAULT 0,
  radius_meters integer NOT NULL DEFAULT 80,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE (business_id, sucursal)
);

ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS latitude         numeric(10,7);
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS longitude        numeric(10,7);
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS distance_meters  numeric(10,2);
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS device_id        uuid;
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS status           text NOT NULL DEFAULT 'approved';
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS ip               text;

ALTER TABLE hr_employee_qr_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_punch_devices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_branch_geofences   ENABLE ROW LEVEL SECURITY;

-- RLS multi-tenant + service_role (idempotente: solo crea la policy si falta).
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['hr_employee_qr_tokens', 'hr_punch_devices', 'hr_branch_geofences'];
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
      t, t || '_service_all',
      format('CREATE POLICY %I ON %I FOR ALL USING (auth.role() = ''service_role'')', t || '_service_all', t));
  END LOOP;
END $$;

-- Seed de geocercas (radio 80 m, lat/lng 0 a editar). No pisa si ya existe.
INSERT INTO hr_branch_geofences (business_id, sucursal, latitude, longitude, radius_meters)
SELECT b.id, s.sucursal, 0, 0, 80
FROM businesses b
CROSS JOIN (VALUES ('RAFAEL VIDAL'), ('LOS JARDINES'), ('VILLA OLGA'), ('LA VEGA'), ('DEPICENTER')) AS s(sucursal)
ON CONFLICT (business_id, sucursal) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- GRANTS (el backend usa service_role; authenticated queda cubierto por RLS)
-- ─────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_employee_qr_tokens TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_punch_devices      TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_branch_geofences   TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_payroll_config     TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_vacations          TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_punches            TO authenticated, service_role;

COMMIT;

-- Refrescar el cache de esquema de PostgREST.
NOTIFY pgrst, 'reload schema';

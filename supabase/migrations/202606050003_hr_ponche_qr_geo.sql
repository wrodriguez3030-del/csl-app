-- ─────────────────────────────────────────────────────────────────────────
-- RR.HH. · Ponche por QR + geolocalización + dispositivo autorizado.
-- Tablas nuevas: QR por empleado, dispositivos autorizados y geocercas por
-- sucursal. Amplía hr_punches con lat/lng/distancia/dispositivo/estado.
-- Multi-tenant + RLS. FK a businesses(id). Idempotente y NO destructivo.
-- ─────────────────────────────────────────────────────────────────────────

-- QR único por empleado (token hasheado; el QR lleva el token en claro).
CREATE TABLE IF NOT EXISTS hr_employee_qr_tokens (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id   uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id   text NOT NULL,
  token         text NOT NULL,        -- token opaco (para re-mostrar el QR); no contiene datos del empleado
  token_hash    text NOT NULL,        -- hash para validación en el ponche
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  revoked_at    timestamptz,
  regenerated_by uuid,
  UNIQUE (business_id, employee_id)
);
CREATE INDEX IF NOT EXISTS hr_qr_tokens_hash_idx ON hr_employee_qr_tokens (token_hash);

-- Dispositivos autorizados para operar el kiosco de ponche.
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

-- Geocercas por sucursal (centro + radio en metros).
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

-- Ampliar hr_punches con datos del ponche por QR/geo (no destructivo).
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS latitude         numeric(10,7);
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS longitude        numeric(10,7);
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS distance_meters  numeric(10,2);
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS device_id        uuid;
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS status           text NOT NULL DEFAULT 'approved'; -- approved | rejected
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS ip               text;

ALTER TABLE hr_employee_qr_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_punch_devices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_branch_geofences   ENABLE ROW LEVEL SECURITY;

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
      t, t || '_service_all',
      format('CREATE POLICY %I ON %I FOR ALL USING (auth.role() = ''service_role'')', t || '_service_all', t));
  END LOOP;
END $$;

-- Seed de geocercas SOLO desde las sucursales reales de cada negocio
-- (csl_sucursales). Evita nombres cruzados entre tenants. Radio 80 m, lat/lng 0.
INSERT INTO hr_branch_geofences (business_id, sucursal, latitude, longitude, radius_meters)
SELECT business_id, nombre, 0, 0, 80
FROM csl_sucursales
WHERE nombre IS NOT NULL AND btrim(nombre) <> ''
ON CONFLICT (business_id, sucursal) DO NOTHING;

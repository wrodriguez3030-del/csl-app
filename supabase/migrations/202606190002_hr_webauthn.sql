-- ─────────────────────────────────────────────────────────────────────────
-- RR.HH. · Biometría del dispositivo (WebAuthn / Passkeys) para ponche móvil.
--
-- hr_webauthn_credentials: credencial(es) biométrica(s) registradas por el
--   empleado desde su celular (huella / Face ID → passkey). public_key en
--   base64url, counter anti-replay.
-- hr_webauthn_challenges: reto efímero entre "options" y "verify" (registro o
--   autenticación). Se borra al verificar; expira en minutos.
--
-- Multi-tenant + RLS service_role (los endpoints públicos usan service role).
-- Idempotente y NO destructivo.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hr_webauthn_credentials (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id    uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id    text NOT NULL,
  credential_id  text NOT NULL UNIQUE,   -- base64url
  public_key     text NOT NULL,          -- base64url de la clave pública COSE
  counter        bigint NOT NULL DEFAULT 0,
  transports     text,                   -- CSV: internal,hybrid,…
  device_label   text,
  created_at     timestamptz DEFAULT now(),
  last_used_at   timestamptz
);
CREATE INDEX IF NOT EXISTS hr_webauthn_cred_emp_idx ON hr_webauthn_credentials (business_id, employee_id);

CREATE TABLE IF NOT EXISTS hr_webauthn_challenges (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id  uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id  text NOT NULL,
  kind         text NOT NULL,            -- register | auth
  challenge    text NOT NULL,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_webauthn_chal_lookup_idx ON hr_webauthn_challenges (business_id, employee_id, kind);

ALTER TABLE hr_webauthn_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_webauthn_challenges  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['hr_webauthn_credentials', 'hr_webauthn_challenges'];
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

GRANT SELECT, INSERT, UPDATE, DELETE ON hr_webauthn_credentials, hr_webauthn_challenges TO service_role;

NOTIFY pgrst, 'reload schema';

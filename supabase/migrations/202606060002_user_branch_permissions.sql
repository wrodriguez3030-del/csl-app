-- ─────────────────────────────────────────────────────────────────────────
-- Seguridad: permisos por SUCURSAL por usuario. Limita qué sucursales ve cada
-- usuario dentro de su business. Aditivo · idempotente · RLS multi-tenant.
-- Se usa `active` para revocar sin DELETE (no destructivo).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_branch_permissions (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  branch_name text NOT NULL,                 -- normalizada: RAFAEL VIDAL / LOS JARDINES / ...
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (business_id, user_id, branch_name)
);
CREATE INDEX IF NOT EXISTS ubp_user_idx ON user_branch_permissions (business_id, user_id);

ALTER TABLE user_branch_permissions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text := 'user_branch_permissions';
BEGIN
  EXECUTE format('DO $i$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN EXECUTE %3$L; END IF; END $i$;',
    t, t || '_tenant_select',
    format('CREATE POLICY %I ON %I FOR SELECT USING (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1))', t || '_tenant_select', t));
  EXECUTE format('DO $i$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN EXECUTE %3$L; END IF; END $i$;',
    t, t || '_service_all',
    format('CREATE POLICY %I ON %I FOR ALL USING (auth.role() = ''service_role'')', t || '_service_all', t));
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON user_branch_permissions TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────
-- MANTENIMIENTO · Catálogo de cabinas por negocio + sucursal.
--
-- Hasta ahora el selector de Cabina del editor de Equipos usaba una lista
-- HARDCODED ("Cabina 1".."Cabina 10", Backup, Taller, Sin asignar). Esta tabla
-- permite que cada negocio cree cabinas adicionales (ej. "Cabina 11") desde la
-- propia pantalla de edición de equipos, sin tocar código.
--
-- Multi-tenant + RLS, mismo patrón que 202606190001_hr_ponche_modalidades.
-- Idempotente y NO destructivo (CREATE ... IF NOT EXISTS). Soft-delete vía
-- deleted_at (nunca DELETE físico).
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS maintenance_cabins (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch      text NOT NULL DEFAULT '',   -- sucursal (csl_sucursales.nombre); '' = sin sucursal
  name        text NOT NULL,              -- nombre de la cabina (se guarda en MAYÚSCULA)
  code        text,                       -- código corto opcional
  active      boolean NOT NULL DEFAULT true,
  notes       text,
  created_by  text,
  updated_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz                 -- soft delete
);

-- Unicidad por negocio + sucursal + nombre (case-insensitive), solo filas vivas.
-- Evita duplicar "Cabina 11" en la misma sucursal del mismo negocio.
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_cabins_biz_branch_name_ux
  ON maintenance_cabins (business_id, branch, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS maintenance_cabins_biz_idx
  ON maintenance_cabins (business_id)
  WHERE deleted_at IS NULL;

ALTER TABLE maintenance_cabins ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['maintenance_cabins'];
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

GRANT SELECT, INSERT, UPDATE, DELETE ON maintenance_cabins TO authenticated, service_role;

-- Seed: materializa las cabinas DEFAULT (Cabina 1..10, Backup, Taller,
-- Sin asignar) por negocio, sin sucursal (branch=''), para que el catálogo
-- arranque poblado y consistente con el selector. Idempotente.
INSERT INTO maintenance_cabins (business_id, branch, name)
SELECT b.id, '', c.name
FROM businesses b
CROSS JOIN (VALUES
  ('CABINA 1'),('CABINA 2'),('CABINA 3'),('CABINA 4'),('CABINA 5'),
  ('CABINA 6'),('CABINA 7'),('CABINA 8'),('CABINA 9'),('CABINA 10'),
  ('BACKUP'),('TALLER'),('SIN ASIGNAR')
) AS c(name)
WHERE NOT EXISTS (
  SELECT 1 FROM maintenance_cabins mc
  WHERE mc.business_id = b.id AND mc.branch = '' AND lower(mc.name) = lower(c.name)
    AND mc.deleted_at IS NULL
);

NOTIFY pgrst, 'reload schema';

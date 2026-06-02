-- ─────────────────────────────────────────────────────────────────────────
-- Fase 1 (continuación): contratos laborales y archivo digital de
-- documentos por empleado. Estas dos tablas cierran la base de Personal
-- del módulo RR.HH.
--
-- Multi-tenant: business_id NOT NULL + RLS por tenant + service_role.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Contratos laborales ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_contracts (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id       uuid NOT NULL REFERENCES csl_businesses(id) ON DELETE CASCADE,
  employee_id       text NOT NULL,           -- referencia a csl_empleados.empleado_id
  contract_type     text NOT NULL,           -- "indefinido" | "fijo" | "prueba" | "prestacion_servicios"
  start_date        date NOT NULL,
  end_date          date,                    -- null en indefinido
  salary            numeric(12,2),
  position_name     text,                    -- snapshot del cargo al firmar
  schedule          text,                    -- libre: descripción del horario
  workday           text,                    -- "completa" | "media" | "por_horas"
  status            text NOT NULL DEFAULT 'borrador',
                    -- "borrador" | "activo" | "vencido" | "renovado" | "archivado" | "anulado"
  file_url          text,                    -- URL del PDF firmado (storage)
  observations      text,
  created_by        uuid,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_contracts_business_idx ON hr_contracts (business_id);
CREATE INDEX IF NOT EXISTS hr_contracts_employee_idx ON hr_contracts (business_id, employee_id);
CREATE INDEX IF NOT EXISTS hr_contracts_status_idx ON hr_contracts (business_id, status);
CREATE INDEX IF NOT EXISTS hr_contracts_end_date_idx ON hr_contracts (business_id, end_date) WHERE end_date IS NOT NULL;

-- ── Documentos por empleado ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_documents (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id       uuid NOT NULL REFERENCES csl_businesses(id) ON DELETE CASCADE,
  employee_id       text NOT NULL,
  document_type     text NOT NULL,           -- "cedula" | "contrato" | "licencia" | "certificado_medico" | ...
  title             text NOT NULL,
  file_url          text,                    -- URL del archivo en storage
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  expires_at        date,                    -- para alertas de vencimiento
  visibility        text NOT NULL DEFAULT 'rrhh',
                    -- "rrhh" | "supervisor" | "empleado" | "publico"
  status            text NOT NULL DEFAULT 'activo',
                    -- "activo" | "vencido" | "archivado" | "eliminado"
  uploaded_by       uuid,
  observations      text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_documents_business_idx ON hr_documents (business_id);
CREATE INDEX IF NOT EXISTS hr_documents_employee_idx ON hr_documents (business_id, employee_id);
CREATE INDEX IF NOT EXISTS hr_documents_expires_idx ON hr_documents (business_id, expires_at) WHERE expires_at IS NOT NULL;

-- ── RLS multi-tenant ──────────────────────────────────────────────────────
ALTER TABLE hr_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_documents ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['hr_contracts', 'hr_documents'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'DO $i$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN
          EXECUTE %3$L;
        END IF;
      END $i$;',
      t, t || '_tenant_select',
      format('CREATE POLICY %I ON %I FOR SELECT USING (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1))', t || '_tenant_select', t)
    );
    EXECUTE format(
      'DO $i$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN
          EXECUTE %3$L;
        END IF;
      END $i$;',
      t, t || '_tenant_insert',
      format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1))', t || '_tenant_insert', t)
    );
    EXECUTE format(
      'DO $i$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN
          EXECUTE %3$L;
        END IF;
      END $i$;',
      t, t || '_tenant_update',
      format('CREATE POLICY %I ON %I FOR UPDATE USING (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1))', t || '_tenant_update', t)
    );
    EXECUTE format(
      'DO $i$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN
          EXECUTE %3$L;
        END IF;
      END $i$;',
      t, t || '_tenant_delete',
      format('CREATE POLICY %I ON %I FOR DELETE USING (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1))', t || '_tenant_delete', t)
    );
    EXECUTE format(
      'DO $i$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN
          EXECUTE %3$L;
        END IF;
      END $i$;',
      t, t || '_service_all',
      format('CREATE POLICY %I ON %I FOR ALL USING (auth.role() = ''service_role'')', t || '_service_all', t)
    );
  END LOOP;
END $$;

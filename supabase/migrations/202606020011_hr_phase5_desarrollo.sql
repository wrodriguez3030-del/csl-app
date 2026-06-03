-- ─────────────────────────────────────────────────────────────────────────
-- RR.HH. Fase 5 · Desarrollo: Reclutamiento, Onboarding, Evaluación,
-- Disciplina, Capacitación, Comunicación. Multi-tenant + RLS. FK businesses(id).
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hr_recruitment (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  nombre text NOT NULL, puesto text, sucursal text, telefono text, email text,
  estado text NOT NULL DEFAULT 'nuevo',  -- nuevo|evaluando|entrevista|aprobado|rechazado|contratado
  notas text, created_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_recruitment_business_idx ON hr_recruitment (business_id);

CREATE TABLE IF NOT EXISTS hr_onboarding (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id text NOT NULL, employee_nombre text,
  checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  estado text NOT NULL DEFAULT 'en_progreso',  -- en_progreso|completado
  notas text, created_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_onboarding_business_idx ON hr_onboarding (business_id);

CREATE TABLE IF NOT EXISTS hr_evaluations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id text NOT NULL, employee_nombre text, periodo text,
  puntaje numeric(5,2) NOT NULL DEFAULT 0, comentarios text, plan_mejora text,
  estado text NOT NULL DEFAULT 'borrador',  -- borrador|finalizada
  created_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_evaluations_business_idx ON hr_evaluations (business_id);

CREATE TABLE IF NOT EXISTS hr_disciplinary (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id text NOT NULL, employee_nombre text,
  tipo text NOT NULL DEFAULT 'amonestacion_verbal',  -- amonestacion_verbal|amonestacion_escrita|suspension|incidencia
  fecha date NOT NULL DEFAULT current_date, descripcion text, evidencia_url text,
  estado text NOT NULL DEFAULT 'borrador',  -- borrador|emitida|firmada|rechazada|archivada|anulada
  created_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_disciplinary_business_idx ON hr_disciplinary (business_id);

CREATE TABLE IF NOT EXISTS hr_trainings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id text, employee_nombre text, curso text NOT NULL,
  tipo text NOT NULL DEFAULT 'interno',  -- interno|externo
  fecha_objetivo date, vencimiento date, certificado_url text,
  estado text NOT NULL DEFAULT 'asignado',  -- asignado|en_progreso|completado|vencido
  created_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_trainings_business_idx ON hr_trainings (business_id);

CREATE TABLE IF NOT EXISTS hr_communications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  titulo text NOT NULL, mensaje text,
  segmento text NOT NULL DEFAULT 'general',  -- general|sucursal|cargo
  destinatario text, fecha date NOT NULL DEFAULT current_date,
  created_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_communications_business_idx ON hr_communications (business_id);

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['hr_recruitment','hr_onboarding','hr_evaluations','hr_disciplinary','hr_trainings','hr_communications'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
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

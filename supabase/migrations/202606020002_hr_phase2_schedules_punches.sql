-- ─────────────────────────────────────────────────────────────────────────
-- RR.HH. Fase 2 (parte 1): Horarios y turnos + Ponche / Reloj checador.
-- Spec: docs/superpowers/specs/2026-06-02-hr-fase2-horarios-ponche-design.md
--
-- Multi-tenant: business_id NOT NULL + RLS por tenant + service_role.
-- Mismo patrón que hr_contracts / hr_documents (Fase 1).
-- Idempotente y no destructivo.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Horarios / turnos ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_schedules (
  id                 uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id        uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name               text NOT NULL,
  type               text NOT NULL DEFAULT 'fijo',   -- "fijo" | "rotativo"
  entry_time         time,
  exit_time          time,
  lunch_start        time,
  lunch_end          time,
  workdays           text[] NOT NULL DEFAULT '{}',   -- ej. {lun,mar,mie,jue,vie}
  late_tolerance_min integer NOT NULL DEFAULT 0,
  status             text NOT NULL DEFAULT 'activo',  -- "activo" | "inactivo"
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_schedules_business_idx ON hr_schedules (business_id);
CREATE INDEX IF NOT EXISTS hr_schedules_status_idx   ON hr_schedules (business_id, status);

-- ── Asignación de horario a empleado ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_schedule_assignments (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id  uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id  text NOT NULL,                 -- ref csl_empleados.empleado_id
  schedule_id  uuid NOT NULL REFERENCES hr_schedules(id) ON DELETE CASCADE,
  sucursal     text,
  start_date   date NOT NULL DEFAULT current_date,
  end_date     date,                          -- null = vigente
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_sched_assign_business_idx ON hr_schedule_assignments (business_id);
CREATE INDEX IF NOT EXISTS hr_sched_assign_emp_idx      ON hr_schedule_assignments (business_id, employee_id);
-- Una sola asignación VIGENTE (end_date null) por empleado dentro del tenant.
CREATE UNIQUE INDEX IF NOT EXISTS hr_sched_assign_active_uniq
  ON hr_schedule_assignments (business_id, employee_id)
  WHERE end_date IS NULL;

-- ── Marcas de ponche ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_punches (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id       uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id       text NOT NULL,
  type              text NOT NULL,            -- entrada|salida|almuerzo_inicio|almuerzo_fin|salida_autorizada
  punched_at        timestamptz NOT NULL DEFAULT now(),
  sucursal          text,
  source            text NOT NULL DEFAULT 'kiosk',  -- "kiosk" | "manual"
  device_info       text,
  ip                text,
  is_correction     boolean NOT NULL DEFAULT false,
  correction_reason text,
  approved_by       uuid,
  photo_url         text,                     -- nullable, futuro
  gps               text,                     -- nullable, futuro
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_punches_business_idx ON hr_punches (business_id);
CREATE INDEX IF NOT EXISTS hr_punches_emp_time_idx ON hr_punches (business_id, employee_id, punched_at);
CREATE INDEX IF NOT EXISTS hr_punches_suc_time_idx ON hr_punches (business_id, sucursal, punched_at);

-- ── PIN de empleado para identificación en kiosco (hasheado) ───────────────
ALTER TABLE csl_empleados ADD COLUMN IF NOT EXISTS hr_pin_hash text;

-- ── RLS multi-tenant (mismo patrón que Fase 1) ─────────────────────────────
ALTER TABLE hr_schedules            ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_schedule_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_punches              ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['hr_schedules', 'hr_schedule_assignments', 'hr_punches'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'DO $i$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN EXECUTE %3$L; END IF; END $i$;',
      t, t || '_tenant_select',
      format('CREATE POLICY %I ON %I FOR SELECT USING (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1))', t || '_tenant_select', t)
    );
    EXECUTE format(
      'DO $i$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN EXECUTE %3$L; END IF; END $i$;',
      t, t || '_tenant_insert',
      format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1))', t || '_tenant_insert', t)
    );
    EXECUTE format(
      'DO $i$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN EXECUTE %3$L; END IF; END $i$;',
      t, t || '_tenant_update',
      format('CREATE POLICY %I ON %I FOR UPDATE USING (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1))', t || '_tenant_update', t)
    );
    EXECUTE format(
      'DO $i$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN EXECUTE %3$L; END IF; END $i$;',
      t, t || '_tenant_delete',
      format('CREATE POLICY %I ON %I FOR DELETE USING (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1))', t || '_tenant_delete', t)
    );
    EXECUTE format(
      'DO $i$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN EXECUTE %3$L; END IF; END $i$;',
      t, t || '_service_all',
      format('CREATE POLICY %I ON %I FOR ALL USING (auth.role() = ''service_role'')', t || '_service_all', t)
    );
  END LOOP;
END $$;

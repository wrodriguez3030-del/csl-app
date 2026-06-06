-- ─────────────────────────────────────────────────────────────────────────
-- RR.HH. · Horario por empleado + geolocalización de sucursal + horas trabajadas.
-- Aditivo · idempotente · multi-tenant (business_id) · RLS + GRANTS.
-- ─────────────────────────────────────────────────────────────────────────

-- Horario asignado a un empleado (cabecera).
CREATE TABLE IF NOT EXISTS hr_employee_schedules (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id    uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id    text NOT NULL,
  sucursal       text,
  name           text,
  effective_from date,
  effective_to   date,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_emp_sched_emp_idx ON hr_employee_schedules (business_id, employee_id);

-- Detalle por día de la semana (0=Domingo … 6=Sábado).
CREATE TABLE IF NOT EXISTS hr_employee_schedule_days (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_id   uuid NOT NULL REFERENCES hr_employee_schedules(id) ON DELETE CASCADE,
  business_id   uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  day_of_week   int NOT NULL,
  is_working_day boolean NOT NULL DEFAULT true,
  start_time    text,
  end_time      text,
  break_minutes int NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE (schedule_id, day_of_week)
);
CREATE INDEX IF NOT EXISTS hr_emp_sched_days_idx ON hr_employee_schedule_days (schedule_id);

-- Sucursal/geocerca: datos de Google Maps + horario general + contacto.
ALTER TABLE hr_branch_geofences ADD COLUMN IF NOT EXISTS google_maps_url text;
ALTER TABLE hr_branch_geofences ADD COLUMN IF NOT EXISTS timezone        text NOT NULL DEFAULT 'America/Santo_Domingo';
ALTER TABLE hr_branch_geofences ADD COLUMN IF NOT EXISTS direccion       text;
ALTER TABLE hr_branch_geofences ADD COLUMN IF NOT EXISTS telefono        text;
ALTER TABLE hr_branch_geofences ADD COLUMN IF NOT EXISTS email           text;
ALTER TABLE hr_branch_geofences ADD COLUMN IF NOT EXISTS workday_config  jsonb;

-- Ponche: horario programado + cálculo de horas.
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS scheduled_start     text;
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS scheduled_end       text;
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS expected_minutes    int;
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS worked_minutes      int;
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS late_minutes        int;
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS early_leave_minutes int;
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS overtime_minutes    int;
ALTER TABLE hr_punches ADD COLUMN IF NOT EXISTS manual_adjustment_reason text;

ALTER TABLE hr_employee_schedules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_employee_schedule_days  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['hr_employee_schedules', 'hr_employee_schedule_days'];
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

GRANT SELECT, INSERT, UPDATE, DELETE ON hr_employee_schedules     TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_employee_schedule_days TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

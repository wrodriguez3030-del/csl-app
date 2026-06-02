-- ─────────────────────────────────────────────────────────────────────────
-- Fase 1 del módulo Recursos Humanos: tablas de soporte para el catálogo
-- corporativo (departamentos, cargos), historia salarial, cuentas bancarias
-- por empleado y log de auditoría RR.HH.
--
-- NO se redefine csl_empleados porque ya existe en el sistema actual y se
-- usa desde el menú existente "Empleados". Sus columnas operativas se
-- ampliarán en migraciones futuras cuando los módulos correspondientes lo
-- requieran (ponche, nómina, etc.).
--
-- Multi-tenant: todas las tablas tienen business_id NOT NULL + RLS por
-- tenant con bypass para service_role. Índices por business_id.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Departamentos ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_departments (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id  uuid NOT NULL REFERENCES csl_businesses(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  parent_id    uuid REFERENCES hr_departments(id) ON DELETE SET NULL,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  CONSTRAINT hr_departments_name_unique UNIQUE (business_id, name)
);
CREATE INDEX IF NOT EXISTS hr_departments_business_idx ON hr_departments (business_id);

-- ── Cargos / posiciones ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_positions (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id     uuid NOT NULL REFERENCES csl_businesses(id) ON DELETE CASCADE,
  department_id   uuid REFERENCES hr_departments(id) ON DELETE SET NULL,
  name            text NOT NULL,
  description     text,
  salary_min      numeric(12,2),
  salary_max      numeric(12,2),
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  CONSTRAINT hr_positions_name_unique UNIQUE (business_id, name)
);
CREATE INDEX IF NOT EXISTS hr_positions_business_idx ON hr_positions (business_id);
CREATE INDEX IF NOT EXISTS hr_positions_department_idx ON hr_positions (department_id);

-- ── Historia salarial por empleado ────────────────────────────────────────
-- Cada cambio de salario crea una fila. Permite auditoría retroactiva sin
-- depender solo del log de cambios.
CREATE TABLE IF NOT EXISTS hr_employee_salary_history (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id  uuid NOT NULL REFERENCES csl_businesses(id) ON DELETE CASCADE,
  employee_id  text NOT NULL,        -- referencia a csl_empleados.empleado_id
  salary       numeric(12,2) NOT NULL,
  effective_from date NOT NULL,
  effective_to   date,
  reason         text,
  created_by     uuid,
  created_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_salary_history_business_idx ON hr_employee_salary_history (business_id);
CREATE INDEX IF NOT EXISTS hr_salary_history_employee_idx ON hr_employee_salary_history (business_id, employee_id, effective_from DESC);

-- ── Cuentas bancarias por empleado ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_employee_bank_accounts (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id    uuid NOT NULL REFERENCES csl_businesses(id) ON DELETE CASCADE,
  employee_id    text NOT NULL,
  bank_name      text NOT NULL,
  account_number text NOT NULL,
  account_type   text NOT NULL,      -- "ahorros" | "corriente" | "otros"
  beneficiary    text,
  is_primary     boolean NOT NULL DEFAULT true,
  active         boolean NOT NULL DEFAULT true,
  notes          text,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_bank_business_idx ON hr_employee_bank_accounts (business_id);
CREATE INDEX IF NOT EXISTS hr_bank_employee_idx ON hr_employee_bank_accounts (business_id, employee_id);

-- ── Log de auditoría RR.HH. ───────────────────────────────────────────────
-- Registra acciones críticas: cambio de sueldo, cambio de cuenta bancaria,
-- ponche manual, aprobación de nómina, generación de TXT/PDF, liquidación.
CREATE TABLE IF NOT EXISTS hr_audit_logs (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id     uuid NOT NULL REFERENCES csl_businesses(id) ON DELETE CASCADE,
  user_id         uuid,
  user_email      text,
  module          text NOT NULL,     -- "empleados" | "nomina" | "ponche" | ...
  action          text NOT NULL,     -- "create" | "update" | "delete" | "approve" | ...
  entity_type     text NOT NULL,     -- "employee" | "payroll_run" | "punch" | ...
  entity_id       text,
  old_values      jsonb,
  new_values      jsonb,
  ip_address      text,
  user_agent      text,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_audit_business_idx ON hr_audit_logs (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hr_audit_entity_idx ON hr_audit_logs (business_id, entity_type, entity_id);

-- ── RLS multi-tenant para todas las tablas HR ─────────────────────────────
ALTER TABLE hr_departments              ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_positions                ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_employee_salary_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_employee_bank_accounts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_audit_logs               ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'hr_departments',
    'hr_positions',
    'hr_employee_salary_history',
    'hr_employee_bank_accounts',
    'hr_audit_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'DO $inner$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN
          EXECUTE %3$L;
        END IF;
      END $inner$;',
      t,
      t || '_tenant_select',
      format(
        'CREATE POLICY %I ON %I FOR SELECT USING (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1))',
        t || '_tenant_select', t
      )
    );
    EXECUTE format(
      'DO $inner$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN
          EXECUTE %3$L;
        END IF;
      END $inner$;',
      t,
      t || '_tenant_insert',
      format(
        'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1))',
        t || '_tenant_insert', t
      )
    );
    EXECUTE format(
      'DO $inner$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN
          EXECUTE %3$L;
        END IF;
      END $inner$;',
      t,
      t || '_tenant_update',
      format(
        'CREATE POLICY %I ON %I FOR UPDATE USING (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1))',
        t || '_tenant_update', t
      )
    );
    EXECUTE format(
      'DO $inner$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN
          EXECUTE %3$L;
        END IF;
      END $inner$;',
      t,
      t || '_tenant_delete',
      format(
        'CREATE POLICY %I ON %I FOR DELETE USING (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1))',
        t || '_tenant_delete', t
      )
    );
    EXECUTE format(
      'DO $inner$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=%1$L AND policyname=%2$L) THEN
          EXECUTE %3$L;
        END IF;
      END $inner$;',
      t,
      t || '_service_all',
      format(
        'CREATE POLICY %I ON %I FOR ALL USING (auth.role() = ''service_role'')',
        t || '_service_all', t
      )
    );
  END LOOP;
END $$;

-- Resumen semanal de disparos reportados por operadora desde AgendaPro.
-- Una fila por (tenant, semana operativa, sucursal_normalizada, operadora_normalizada).
-- Alimenta Registro de Servicios + Auditoría/IA (lado DISP Operador) sin
-- depender de csl_sesiones_cliente para agregaciones por período.

CREATE TABLE IF NOT EXISTS csl_operator_shots (
  id                       uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id              uuid NOT NULL REFERENCES csl_businesses(id) ON DELETE CASCADE,
  period_start             date NOT NULL,
  period_end               date NOT NULL,
  period_label             text,
  sucursal_original        text,
  sucursal_normalizada     text NOT NULL,
  operadora_original       text,
  operadora_normalizada    text NOT NULL,
  sesiones                 integer NOT NULL DEFAULT 0,
  disparos                 bigint  NOT NULL DEFAULT 0,
  source_file              text,
  source_type              text DEFAULT 'agendapro',
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now(),
  CONSTRAINT csl_operator_shots_unique
    UNIQUE (business_id, period_start, period_end, sucursal_normalizada, operadora_normalizada)
);

CREATE INDEX IF NOT EXISTS csl_operator_shots_period_idx
  ON csl_operator_shots (business_id, period_start DESC);
CREATE INDEX IF NOT EXISTS csl_operator_shots_match_idx
  ON csl_operator_shots (business_id, period_start, period_end, sucursal_normalizada, operadora_normalizada);

ALTER TABLE csl_operator_shots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='csl_operator_shots' AND policyname='os_tenant_select') THEN
    CREATE POLICY os_tenant_select ON csl_operator_shots FOR SELECT
      USING (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='csl_operator_shots' AND policyname='os_tenant_insert') THEN
    CREATE POLICY os_tenant_insert ON csl_operator_shots FOR INSERT
      WITH CHECK (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='csl_operator_shots' AND policyname='os_tenant_update') THEN
    CREATE POLICY os_tenant_update ON csl_operator_shots FOR UPDATE
      USING (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='csl_operator_shots' AND policyname='os_tenant_delete') THEN
    CREATE POLICY os_tenant_delete ON csl_operator_shots FOR DELETE
      USING (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='csl_operator_shots' AND policyname='os_service_all') THEN
    CREATE POLICY os_service_all ON csl_operator_shots FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

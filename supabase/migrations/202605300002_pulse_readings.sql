-- Canonical table for weekly pulse readings
CREATE TABLE IF NOT EXISTS csl_pulse_readings (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id           uuid NOT NULL REFERENCES csl_businesses(id) ON DELETE CASCADE,
  equipo_id             text NOT NULL,
  serial                text,
  sucursal              text NOT NULL,
  cabina                text,
  operadora             text,
  period_start          date NOT NULL,
  period_end            date NOT NULL,
  period_label          text,
  lectura_inicial       bigint NOT NULL DEFAULT 0,
  lectura_final         bigint NOT NULL DEFAULT 0,
  disp_laser            bigint GENERATED ALWAYS AS (lectura_final - lectura_inicial) STORED,
  disp_operador         bigint,
  diferencia            bigint GENERATED ALWAYS AS (
                          CASE WHEN disp_operador IS NOT NULL
                          THEN disp_operador - (lectura_final - lectura_inicial)
                          ELSE NULL END
                        ) STORED,
  diferencia_pct        numeric(8,4),
  estado_cuadre         text DEFAULT 'lectura_guardada',
  estado_mantenimiento  text,
  fallas                text,
  source_file           text,
  source_type           text DEFAULT 'manual',
  observaciones         text,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  CONSTRAINT csl_pulse_readings_unique
    UNIQUE (business_id, equipo_id, period_start, period_end)
);

ALTER TABLE csl_pulse_readings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='csl_pulse_readings' AND policyname='pr_tenant_select') THEN
    CREATE POLICY pr_tenant_select ON csl_pulse_readings FOR SELECT
      USING (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='csl_pulse_readings' AND policyname='pr_tenant_insert') THEN
    CREATE POLICY pr_tenant_insert ON csl_pulse_readings FOR INSERT
      WITH CHECK (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='csl_pulse_readings' AND policyname='pr_tenant_update') THEN
    CREATE POLICY pr_tenant_update ON csl_pulse_readings FOR UPDATE
      USING (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='csl_pulse_readings' AND policyname='pr_tenant_delete') THEN
    CREATE POLICY pr_tenant_delete ON csl_pulse_readings FOR DELETE
      USING (business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid() LIMIT 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='csl_pulse_readings' AND policyname='pr_service_all') THEN
    CREATE POLICY pr_service_all ON csl_pulse_readings FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

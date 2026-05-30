-- 202605300001_equipo_snapshots_fallas.sql
--
-- Soporte para importación del Excel "Dashboard Mantenimiento".
-- 1. fallas_recientes en csl_equipos: acceso rápido al último import.
-- 2. csl_equipo_snapshots: snapshot de lecturas por período importado.
-- 3. csl_equipo_fallas: códigos de falla normalizados por equipo/período.
--
-- Idempotente.

-- 1. Columna fallas_recientes en csl_equipos
ALTER TABLE IF EXISTS public.csl_equipos
  ADD COLUMN IF NOT EXISTS fallas_recientes text;

COMMENT ON COLUMN public.csl_equipos.fallas_recientes IS
  'Códigos de falla del último Excel Dashboard Mantenimiento importado. Ej: "10.5,19.1".';

-- 2. Tabla de snapshots por período
CREATE TABLE IF NOT EXISTS public.csl_equipo_snapshots (
  snapshot_id      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id      uuid        NOT NULL REFERENCES public.businesses(id),
  equipo_id        text        NOT NULL,
  serie            text,
  sucursal         text,
  cabina           text,
  operadora        text,
  lectura_final    bigint,
  estado           text,
  fallas           text,
  periodo_inicio   date,
  periodo_fin      date,
  etiqueta_periodo text,
  archivo_nombre   text,
  fuente           text        DEFAULT 'excel_dashboard_mantenimiento',
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csl_equipo_snapshots_biz_eq_idx
  ON public.csl_equipo_snapshots (business_id, equipo_id, periodo_inicio DESC);

-- 3. Tabla de fallas normalizadas
CREATE TABLE IF NOT EXISTS public.csl_equipo_fallas (
  falla_id       uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id    uuid        NOT NULL REFERENCES public.businesses(id),
  equipo_id      text        NOT NULL,
  codigo_falla   text        NOT NULL,
  periodo_inicio date,
  fuente         text        DEFAULT 'excel',
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csl_equipo_fallas_biz_eq_idx
  ON public.csl_equipo_fallas (business_id, equipo_id, periodo_inicio DESC);

-- 4. RLS
ALTER TABLE public.csl_equipo_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.csl_equipo_fallas    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.csl_equipo_snapshots;
DROP POLICY IF EXISTS tenant_insert ON public.csl_equipo_snapshots;
DROP POLICY IF EXISTS tenant_select ON public.csl_equipo_fallas;
DROP POLICY IF EXISTS tenant_insert ON public.csl_equipo_fallas;

CREATE POLICY tenant_select ON public.csl_equipo_snapshots FOR SELECT
  USING (business_id = public.current_business_id() OR public.is_superadmin());
CREATE POLICY tenant_insert ON public.csl_equipo_snapshots FOR INSERT
  WITH CHECK (business_id = public.current_business_id() OR public.is_superadmin());

CREATE POLICY tenant_select ON public.csl_equipo_fallas FOR SELECT
  USING (business_id = public.current_business_id() OR public.is_superadmin());
CREATE POLICY tenant_insert ON public.csl_equipo_fallas FOR INSERT
  WITH CHECK (business_id = public.current_business_id() OR public.is_superadmin());

NOTIFY pgrst, 'reload schema';

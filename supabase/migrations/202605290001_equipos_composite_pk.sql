-- 202605290001_equipos_composite_pk.sql
--
-- BUG fix: csl_equipos.equipo_id era PK simple. Cuando un user Depicenter
-- creaba el "Equipo 1" via upsert, sobreescribía el "Equipo 1" de CSL
-- (mismo PK, distinto business_id). Caso real: CSL Equipo 1 (MADELIN,
-- Rafael Vidal, Serial 9914-0950-133) fue perdido cuando Depicenter creó
-- su Equipo 1 (SELENIA, La Vega, Serial 9914-0950-342).
--
-- Fix: cambiar la PK a (business_id, equipo_id) — cada tenant puede tener
-- su propio Equipo 1/2/3/... sin colisiones.
--
-- Operación SEGURA: las filas existentes se preservan. Los FKs que apuntan
-- a csl_equipos por equipo_id (lecturas, sesiones, reportes) siguen
-- funcionando porque el filtro tenant ya separaba ese join lógicamente.
--
-- IDEMPOTENTE: el bloque DO $$ verifica antes de aplicar.

DO $$
BEGIN
  -- 1) Verificar que ambas columnas existen (deberían — son la base)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='csl_equipos'
      AND column_name='business_id'
  ) THEN
    RAISE EXCEPTION 'csl_equipos.business_id no existe — primero aplicar migración 202605220003';
  END IF;

  -- 2) Asegurar que no haya rows con business_id NULL (necesario para PK composite)
  IF EXISTS (SELECT 1 FROM public.csl_equipos WHERE business_id IS NULL) THEN
    RAISE EXCEPTION 'Hay equipos con business_id NULL — corrige antes de aplicar PK composite';
  END IF;

  -- 3) Detectar y eliminar la PK simple actual (si existe)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.csl_equipos'::regclass
      AND contype='p'
  ) THEN
    EXECUTE 'ALTER TABLE public.csl_equipos DROP CONSTRAINT ' ||
      (SELECT conname FROM pg_constraint
       WHERE conrelid='public.csl_equipos'::regclass AND contype='p' LIMIT 1);
  END IF;

  -- 4) Crear la PK composite (business_id, equipo_id)
  ALTER TABLE public.csl_equipos
    ADD CONSTRAINT csl_equipos_pkey PRIMARY KEY (business_id, equipo_id);

  -- 5) Asegurar UNIQUE redundante por (business_id, equipo_id) — ya cubierto por PK,
  -- pero idempotente y explícito para que upserts con onConflict="business_id,equipo_id"
  -- funcionen sin ambigüedad.
END $$;

COMMENT ON CONSTRAINT csl_equipos_pkey ON public.csl_equipos IS
  'PK composite multi-tenant: cada business puede tener su propia secuencia de equipo_id (1, 2, 3, …) sin colisión cross-tenant.';

-- 6) RESTAURAR el CSL Equipo 1 perdido (MADELIN / Rafael Vidal / Cabina 4).
--    Solo se inserta si NO existe ya para CSL — idempotente.
INSERT INTO public.csl_equipos
  (equipo_id, business_id, sucursal, empresa, modelo, serie, numero,
   p_cabeza, p_totales, max_cabeza, estado, observaciones,
   cabina, operadora, operadora_id)
SELECT
  '1', '66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6',
  'Rafael Vidal', 'CIBAO SPA LASER, CSL, S.R.L.',
  'CANDELA GENTLEYAG', '9914-0950-133', '',
  0, 0, 6000000, 'Activo',
  'Restaurado tras PK collision 2026-05-29 (Depicenter sobrescribió CSL Equipo 1)',
  'Cabina 4', 'Madelin', 'Madelin'
WHERE NOT EXISTS (
  SELECT 1 FROM public.csl_equipos
  WHERE business_id = '66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6'
    AND equipo_id = '1'
);

-- ─────────────────────────────────────────────────────────────────────────
-- Fix de PERMISOS: las tablas HR creadas por supabase_admin (vía pg-meta) no
-- otorgaron privilegios a service_role/authenticated → la app (service_role)
-- daba "permission denied for table hr_...". Las creadas por postgres sí.
--
-- Solución: GRANT dinámico a TODAS las public.hr_% + ALTER DEFAULT PRIVILEGES
-- para que las tablas futuras de supabase_admin auto-otorguen. No toca datos.
-- RLS multi-tenant por business_id ya está activo (policies por tabla).
-- ─────────────────────────────────────────────────────────────────────────

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'hr_%' LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role, authenticated', r.tablename);
  END LOOP;
END $$;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role, authenticated;

-- Prevenir recurrencia para futuras tablas creadas por cada owner usado.
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO service_role, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role, authenticated;

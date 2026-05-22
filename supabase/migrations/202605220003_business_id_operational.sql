-- ─────────────────────────────────────────────────────────────────────────────
-- 003 — business_id en las 19 tablas operativas
-- ─────────────────────────────────────────────────────────────────────────────
-- Agrega columna business_id, backfill, NOT NULL, default, índice — todo en
-- un loop atómico por tabla.
--
-- Regla de backfill:
--   - csl_certificados_depicenter → Depicenter (esa tabla ya es de ellos)
--   - resto (18 tablas)           → CSL
--
-- Pre-condición: 001 y 002 ejecutados.
-- Rollback: alter table public.<t> drop column business_id;
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  csl_id        uuid := (select id from public.businesses where slug = 'csl');
  depicenter_id uuid := (select id from public.businesses where slug = 'depicenter');
  t             text;
  default_id    uuid;
begin
  if csl_id is null or depicenter_id is null then
    raise exception 'Faltan businesses csl/depicenter. Ejecuta 001 primero.';
  end if;

  foreach t in array array[
    'csl_sucursales',
    'csl_equipos',
    'csl_reportes',
    'csl_piezas',
    'csl_tecnicos',
    'csl_inventario',
    'csl_credenciales',
    'csl_solicitudes_empleo',
    'csl_empleados',
    'csl_cosmiatria_clientes',
    'csl_ficha_dermatologica',
    'csl_consent_masajes',
    'csl_consent_tatuajes_cejas',
    'csl_certificados_regalo',
    'csl_certificados_depicenter',
    'csl_operadoras',
    'csl_lecturas_semanales',
    'csl_sesiones_cliente',
    'csl_auditorias_semanales'
  ] loop
    -- Por regla del usuario: solo csl_certificados_depicenter va a Depicenter
    default_id := case
      when t = 'csl_certificados_depicenter' then depicenter_id
      else csl_id
    end;

    -- 3a. Agregar columna (nullable temporal, idempotente)
    execute format(
      'alter table public.%I add column if not exists business_id uuid references public.businesses(id)',
      t
    );

    -- 3b. Backfill de rows existentes
    execute format(
      'update public.%I set business_id = %L where business_id is null',
      t, default_id
    );

    -- 3c. Forzar NOT NULL
    execute format(
      'alter table public.%I alter column business_id set not null',
      t
    );

    -- 3d. Default para nuevos inserts (útil cuando backend olvida setearlo)
    execute format(
      'alter table public.%I alter column business_id set default %L',
      t, default_id
    );

    -- 3e. Índice para filtros (todas las queries van a filtrar por business_id)
    execute format(
      'create index if not exists %I on public.%I(business_id)',
      t || '_business_idx', t
    );

    raise notice 'Tabla %: business_id=% aplicado', t, default_id;
  end loop;
end $$;

-- Verificación: cuenta de rows por business en cada tabla
-- do $$
-- declare t text;
-- begin
--   foreach t in array array['csl_sucursales','csl_equipos','csl_reportes',
--     'csl_piezas','csl_tecnicos','csl_inventario','csl_credenciales',
--     'csl_solicitudes_empleo','csl_empleados','csl_cosmiatria_clientes',
--     'csl_ficha_dermatologica','csl_consent_masajes','csl_consent_tatuajes_cejas',
--     'csl_certificados_regalo','csl_certificados_depicenter','csl_operadoras',
--     'csl_lecturas_semanales','csl_sesiones_cliente','csl_auditorias_semanales'
--   ] loop
--     execute format(
--       'select %L as tabla, b.slug, count(*) from public.%I t join public.businesses b on b.id = t.business_id group by b.slug',
--       t, t
--     );
--   end loop;
-- end $$;

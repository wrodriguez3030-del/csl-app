-- =====================================================================
-- CSL · Backfill de nombres de clientes vacíos
-- =====================================================================
--
-- Repara filas en `csl_cosmiatria_clientes` cuyo `nombre`/`apellido` están
-- vacíos por culpa del bug donde `clienteCosmiatriaToDb` no leía el campo
-- `nombreCliente` de los consentimientos. La lógica ya está corregida en
-- backend; este script recupera datos antiguos.
--
-- Estrategia, en orden de preferencia para cada cliente con nombre vacío:
--   1. Tomar `cliente_nombre` de su consentimiento de masajes más reciente
--   2. Tomar `cliente_nombre` de su consentimiento de tatuajes/cejas más reciente
--   3. Tomar `nombre` de su ficha dermatológica más reciente
--
-- Es idempotente: sólo toca filas con nombre vacío y no destruye datos.
--
-- Ejecuta esto UNA vez en el SQL Editor de Supabase tras desplegar el fix.
-- =====================================================================

-- 1. Desde csl_consent_masajes (más reciente por cliente)
update public.csl_cosmiatria_clientes c
   set nombre = sub.cliente_nombre
  from (
    select distinct on (cliente_id)
      cliente_id,
      cliente_nombre
    from public.csl_consent_masajes
    where cliente_id is not null
      and coalesce(cliente_nombre, '') <> ''
    order by cliente_id, fecha desc nulls last, created_at desc nulls last
  ) sub
 where c.cliente_id = sub.cliente_id
   and coalesce(c.nombre, '') = ''
   and coalesce(c.apellido, '') = '';

-- 2. Desde csl_consent_tatuajes_cejas (los que aún quedaron sin nombre)
update public.csl_cosmiatria_clientes c
   set nombre = sub.cliente_nombre
  from (
    select distinct on (cliente_id)
      cliente_id,
      cliente_nombre
    from public.csl_consent_tatuajes_cejas
    where cliente_id is not null
      and coalesce(cliente_nombre, '') <> ''
    order by cliente_id, fecha desc nulls last, created_at desc nulls last
  ) sub
 where c.cliente_id = sub.cliente_id
   and coalesce(c.nombre, '') = ''
   and coalesce(c.apellido, '') = '';

-- 3. Desde fichas dermatológicas (las que aún quedaron sin nombre)
update public.csl_cosmiatria_clientes c
   set nombre = sub.nombre
  from (
    select distinct on (cliente_id)
      cliente_id,
      nombre
    from public.csl_ficha_dermatologica
    where cliente_id is not null
      and coalesce(nombre, '') <> ''
    order by cliente_id, fecha desc nulls last, created_at desc nulls last
  ) sub
 where c.cliente_id = sub.cliente_id
   and coalesce(c.nombre, '') = ''
   and coalesce(c.apellido, '') = '';

-- Diagnóstico (descomenta para ver el resultado):
--
-- select count(*) filter (where coalesce(nombre, '') = '' and coalesce(apellido, '') = '') as sin_nombre,
--        count(*) as total
-- from public.csl_cosmiatria_clientes;

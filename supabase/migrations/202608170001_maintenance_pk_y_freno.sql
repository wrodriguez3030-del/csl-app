-- ─────────────────────────────────────────────────────────────────────────────
-- 202608170001 — Mantenimiento: clave por negocio + freno contra pérdidas
-- ─────────────────────────────────────────────────────────────────────────────
-- Contexto: se reportó pérdida de datos en Mantenimiento, siempre al pedir
-- cambios en el módulo de Disparos (trabajo de desarrollo). La migración
-- 202608150002 ya dejó estas tablas sin escritura para los usuarios, pero las
-- migraciones y los scripts corren con `service_role` y atraviesan todo eso.
--
-- Esta migración ataca las dos causas que quedaban:
--
--   1. CLAVE PRIMARIA GLOBAL. `csl_tecnicos` se identificaba solo por `codigo`,
--      `csl_inventario` por `item_id` y `csl_reportes` por `report_id`. Una fila
--      de un negocio podía SOBRESCRIBIR la del otro con la misma clave. No es
--      hipotético: en mayo los Equipos 2 y 3 de CSL fueron sobrescritos por los
--      de Depicenter (ver 202605290002_restore_csl_e2_e3.sql) y por eso
--      `csl_equipos` ya lleva la clave compuesta. Aquí se hace lo mismo en las
--      tres que faltaban. CSL usa códigos de técnico 1..7 — el día que
--      Depicenter creara un técnico "1", el 1 de CSL desaparecía.
--
--   2. SIN FRENO EN LA BASE. Nada impedía que un script vaciara una tabla o
--      moviera filas de un negocio a otro. Ahora hay disparadores que lo
--      rechazan **aunque quien escriba sea el servidor**:
--        · borrar más de 3 filas en una sola sentencia → bloqueado
--        · TRUNCATE → bloqueado
--        · cambiar el business_id de una fila → bloqueado
--      Un borrado puntual desde el módulo (1 fila) sigue funcionando igual.
--
--      Escape deliberado, para una migración real que sí deba hacerlo:
--        set local csl.mantenimiento_libre = 'on';
--      Dura solo esa transacción y deja constancia en csl_maintenance_audit.
--
-- Aditiva y reversible. No borra ni modifica ninguna fila.
--
-- Rollback:
--   alter table public.csl_reportes drop constraint csl_reportes_pkey,
--     add constraint csl_reportes_pkey primary key (report_id);   -- (y análogos)
--   drop trigger csl_freno_borrado on public.<tabla>;             -- (los 3 por tabla)
--   drop function public.csl_mantenimiento_freno_borrado();
--   drop function public.csl_mantenimiento_freno_tenant();
--   drop function public.csl_mantenimiento_freno_truncate();
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. CLAVE PRIMARIA POR NEGOCIO ═══════════════════════════════════════════
-- Idempotente: solo actúa si la PK todavía es la simple.
do $$
declare
  objetivo record;
  pk_actual text;
  cols_actuales text;
begin
  for objetivo in
    select * from (values
      ('csl_reportes',   'report_id'),
      ('csl_tecnicos',   'codigo'),
      ('csl_inventario', 'item_id')
    ) as t(tabla, clave)
  loop
    select con.conname,
           (select string_agg(a.attname, ',' order by k.ord)
              from unnest(con.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum)
      into pk_actual, cols_actuales
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where con.contype = 'p' and c.relname = objetivo.tabla;

    if cols_actuales is distinct from 'business_id,' || objetivo.clave then
      execute format('alter table public.%I drop constraint %I', objetivo.tabla, pk_actual);
      execute format(
        'alter table public.%I add constraint %I primary key (business_id, %I)',
        objetivo.tabla, objetivo.tabla || '_pkey', objetivo.clave);
      raise notice 'PK de % ahora es (business_id, %)', objetivo.tabla, objetivo.clave;
    end if;

    -- La búsqueda por clave sola (sin negocio) sigue siendo frecuente en la app.
    execute format('create index if not exists %I on public.%I (%I)',
                   objetivo.tabla || '_clave_idx', objetivo.tabla, objetivo.clave);
  end loop;
end $$;

-- ═══ 2. FRENO: borrados masivos ══════════════════════════════════════════════
create or replace function public.csl_mantenimiento_freno_borrado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cuantas int;
begin
  if coalesce(current_setting('csl.mantenimiento_libre', true), 'off') = 'on' then
    return null;
  end if;
  select count(*) into cuantas from eliminadas;
  if cuantas > 3 then
    raise exception
      'Mantenimiento protegido: se intentó borrar % filas de % en una sola sentencia. Un borrado masivo solo se hace a propósito (set local csl.mantenimiento_libre = ''on'').',
      cuantas, tg_table_name
      using errcode = 'raise_exception';
  end if;
  return null;
end $$;

-- ═══ 3. FRENO: cambio de negocio de una fila ═════════════════════════════════
-- Es el mecanismo exacto por el que una fila "desaparece": no se borra, se muda
-- al otro tenant y deja de verse.
create or replace function public.csl_mantenimiento_freno_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('csl.mantenimiento_libre', true), 'off') = 'on' then
    return new;
  end if;
  if new.business_id is distinct from old.business_id then
    raise exception
      'Mantenimiento protegido: no se puede mover una fila de % de un negocio a otro (% → %).',
      tg_table_name, old.business_id, new.business_id
      using errcode = 'raise_exception';
  end if;
  return new;
end $$;

-- ═══ 4. FRENO: TRUNCATE ══════════════════════════════════════════════════════
create or replace function public.csl_mantenimiento_freno_truncate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('csl.mantenimiento_libre', true), 'off') = 'on' then
    return null;
  end if;
  raise exception 'Mantenimiento protegido: TRUNCATE bloqueado en %.', tg_table_name
    using errcode = 'raise_exception';
end $$;

-- ═══ 5. Enganchar los frenos ═════════════════════════════════════════════════
do $$
declare
  t text;
begin
  foreach t in array array[
    'csl_equipos',
    'csl_reportes',
    'csl_piezas',
    'csl_tecnicos',
    'csl_inventario',
    'csl_piezas_poliza_lista'
  ] loop
    execute format('drop trigger if exists csl_freno_borrado on public.%I', t);
    execute format(
      'create trigger csl_freno_borrado after delete on public.%I '
      'referencing old table as eliminadas for each statement '
      'execute function public.csl_mantenimiento_freno_borrado()', t);

    execute format('drop trigger if exists csl_freno_truncate on public.%I', t);
    execute format(
      'create trigger csl_freno_truncate before truncate on public.%I '
      'for each statement execute function public.csl_mantenimiento_freno_truncate()', t);

    -- csl_piezas es catálogo compartido: no tiene dueño por negocio.
    if t <> 'csl_piezas' then
      execute format('drop trigger if exists csl_freno_tenant on public.%I', t);
      execute format(
        'create trigger csl_freno_tenant before update on public.%I '
        'for each row execute function public.csl_mantenimiento_freno_tenant()', t);
    end if;
  end loop;
end $$;

comment on function public.csl_mantenimiento_freno_borrado() is
  'Rechaza borrados de más de 3 filas por sentencia en las tablas de Mantenimiento, incluso desde service_role. Escape: set local csl.mantenimiento_libre = ''on''.';

notify pgrst, 'reload schema';

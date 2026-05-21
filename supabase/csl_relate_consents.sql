-- =====================================================================
-- CSL · Relación entre consentimientos, ficha dermatológica y clientes
-- =====================================================================
--
-- Agrega columnas `cliente_id` y `ficha_id` a las tablas de consentimientos
-- y las conecta a `csl_cosmiatria_clientes` y `csl_ficha_dermatologica`
-- mediante claves foráneas con `ON DELETE SET NULL` (nunca borrar
-- consentimientos firmados sólo porque se elimine un cliente).
--
-- Es idempotente: se puede correr múltiples veces sin romper datos.
--
-- Backfill:
--   intenta resolver consentimientos huérfanos asociándolos al cliente
--   cuyo `documento_identidad` coincide con `consent.documento`, o cuyo
--   `telefono` coincide con `consent.telefono` (en ese orden).
-- =====================================================================

-- 1. Columnas y FK en csl_consent_masajes -----------------------------

alter table public.csl_consent_masajes
  add column if not exists cliente_id text,
  add column if not exists ficha_id   text;

alter table public.csl_consent_masajes
  drop constraint if exists csl_consent_masajes_cliente_fk;
alter table public.csl_consent_masajes
  add constraint csl_consent_masajes_cliente_fk
  foreign key (cliente_id) references public.csl_cosmiatria_clientes(cliente_id)
  on delete set null;

alter table public.csl_consent_masajes
  drop constraint if exists csl_consent_masajes_ficha_fk;
alter table public.csl_consent_masajes
  add constraint csl_consent_masajes_ficha_fk
  foreign key (ficha_id) references public.csl_ficha_dermatologica(ficha_id)
  on delete set null;

create index if not exists csl_consent_masajes_cliente_idx
  on public.csl_consent_masajes (cliente_id);
create index if not exists csl_consent_masajes_ficha_idx
  on public.csl_consent_masajes (ficha_id);

-- 2. Columnas y FK en csl_consent_tatuajes_cejas ----------------------

alter table public.csl_consent_tatuajes_cejas
  add column if not exists cliente_id text,
  add column if not exists ficha_id   text;

alter table public.csl_consent_tatuajes_cejas
  drop constraint if exists csl_consent_tatuajes_cejas_cliente_fk;
alter table public.csl_consent_tatuajes_cejas
  add constraint csl_consent_tatuajes_cejas_cliente_fk
  foreign key (cliente_id) references public.csl_cosmiatria_clientes(cliente_id)
  on delete set null;

alter table public.csl_consent_tatuajes_cejas
  drop constraint if exists csl_consent_tatuajes_cejas_ficha_fk;
alter table public.csl_consent_tatuajes_cejas
  add constraint csl_consent_tatuajes_cejas_ficha_fk
  foreign key (ficha_id) references public.csl_ficha_dermatologica(ficha_id)
  on delete set null;

create index if not exists csl_consent_tatuajes_cejas_cliente_idx
  on public.csl_consent_tatuajes_cejas (cliente_id);
create index if not exists csl_consent_tatuajes_cejas_ficha_idx
  on public.csl_consent_tatuajes_cejas (ficha_id);

-- 3. Backfill: vincular consentimientos huérfanos a clientes existentes
--    Estrategia: por documento → por teléfono → por correo.

-- 3.a Masajes
update public.csl_consent_masajes m
   set cliente_id = c.cliente_id
  from public.csl_cosmiatria_clientes c
 where m.cliente_id is null
   and length(coalesce(m.documento, '')) > 0
   and regexp_replace(m.documento, '\D', '', 'g')
       = regexp_replace(coalesce(c.documento_identidad, ''), '\D', '', 'g')
   and length(regexp_replace(coalesce(c.documento_identidad, ''), '\D', '', 'g')) > 0;

update public.csl_consent_masajes m
   set cliente_id = c.cliente_id
  from public.csl_cosmiatria_clientes c
 where m.cliente_id is null
   and length(coalesce(m.telefono, '')) > 0
   and regexp_replace(m.telefono, '\D', '', 'g')
       = regexp_replace(coalesce(c.telefono, ''), '\D', '', 'g')
   and length(regexp_replace(coalesce(c.telefono, ''), '\D', '', 'g')) >= 7;

update public.csl_consent_masajes m
   set cliente_id = c.cliente_id
  from public.csl_cosmiatria_clientes c
 where m.cliente_id is null
   and length(coalesce(m.correo, '')) > 0
   and lower(m.correo) = lower(coalesce(c.email, ''))
   and length(coalesce(c.email, '')) > 0;

-- 3.b Tatuajes/cejas
update public.csl_consent_tatuajes_cejas t
   set cliente_id = c.cliente_id
  from public.csl_cosmiatria_clientes c
 where t.cliente_id is null
   and length(coalesce(t.documento, '')) > 0
   and regexp_replace(t.documento, '\D', '', 'g')
       = regexp_replace(coalesce(c.documento_identidad, ''), '\D', '', 'g')
   and length(regexp_replace(coalesce(c.documento_identidad, ''), '\D', '', 'g')) > 0;

update public.csl_consent_tatuajes_cejas t
   set cliente_id = c.cliente_id
  from public.csl_cosmiatria_clientes c
 where t.cliente_id is null
   and length(coalesce(t.telefono, '')) > 0
   and regexp_replace(t.telefono, '\D', '', 'g')
       = regexp_replace(coalesce(c.telefono, ''), '\D', '', 'g')
   and length(regexp_replace(coalesce(c.telefono, ''), '\D', '', 'g')) >= 7;

update public.csl_consent_tatuajes_cejas t
   set cliente_id = c.cliente_id
  from public.csl_cosmiatria_clientes c
 where t.cliente_id is null
   and length(coalesce(t.correo, '')) > 0
   and lower(t.correo) = lower(coalesce(c.email, ''))
   and length(coalesce(c.email, '')) > 0;

-- 4. Diagnóstico (opcional — descomenta para ver el resultado del backfill):
--
-- select 'masajes total' as label, count(*) from public.csl_consent_masajes
-- union all
-- select 'masajes vinculados', count(*) from public.csl_consent_masajes where cliente_id is not null
-- union all
-- select 'tatuajes total', count(*) from public.csl_consent_tatuajes_cejas
-- union all
-- select 'tatuajes vinculados', count(*) from public.csl_consent_tatuajes_cejas where cliente_id is not null;

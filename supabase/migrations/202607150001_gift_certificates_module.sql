-- CF PARA IMPRIMIR · Módulo profesional de Certificados de Regalo (gift certificates)
--
-- Amplía la tabla existente `csl_certificados_regalo` de forma ADITIVA para
-- soportar: multi-tenant (business_id), vencimiento, plantilla/diseño, datos de
-- contacto opcionales, snapshot de la sucursal (nombre/dirección/teléfono al
-- momento de emitir, para conservar históricos si la sucursal cambia luego),
-- y la máquina de estados completa (Borrador→Emitido→Entregado→Canjeado, más
-- Vencido/Anulado) con trazas de quién/cuándo.
--
-- NO destructiva: solo `alter add column if not exists`, `create ... if not
-- exists` y `create or replace function`. Conserva el PK actual (`codigo`) y
-- todos los certificados anteriores. Ninguna columna se renombra ni elimina.
--
-- Objetos nuevos:
--   · secuencia + función  csl_next_gift_cert_code()  → 'CSL-REG-2026-000001'
--   · tabla de auditoría    csl_certificados_regalo_audit
--
-- Rollback: ver docs/2026-07-15-cf-para-imprimir-gift-certificates.md §Rollback.

-- ─── 1. Columnas nuevas (aditivas) ──────────────────────────────────────────
alter table public.csl_certificados_regalo
  add column if not exists business_id         uuid references public.businesses(id),
  add column if not exists fecha_vencimiento    date,
  add column if not exists template_id          text not null default 'moderno',
  add column if not exists telefono             text,
  add column if not exists correo               text,
  add column if not exists nota_interna         text not null default '',
  -- Snapshot de la sucursal al emitir (conserva el histórico si luego cambia):
  add column if not exists sucursal_direccion   text,
  add column if not exists sucursal_telefono    text,
  -- Trazabilidad de la máquina de estados:
  add column if not exists creado_por           text,
  add column if not exists entregado_por        text,
  add column if not exists entregado_en         timestamptz,
  add column if not exists canjeado_por         text,
  add column if not exists canjeado_sucursal    text,
  add column if not exists motivo_anulacion     text,
  add column if not exists anulado_por          text,
  add column if not exists anulado_en           timestamptz;

-- Índices para búsqueda/filtros del listado (los de estado/sucursal/fecha/tipo
-- ya existen desde csl_certificados_regalo.sql).
create index if not exists idx_csl_certificados_regalo_business    on public.csl_certificados_regalo (business_id);
create index if not exists idx_csl_certificados_regalo_vencimiento on public.csl_certificados_regalo (fecha_vencimiento);

-- ─── 2. Código único server-side  (CSL-REG-YYYY-000001) ─────────────────────
-- El PK `codigo` ya garantiza unicidad; la secuencia da el consecutivo. El año
-- va en el texto para lectura humana; el consecutivo es global (siempre único).
create sequence if not exists public.csl_gift_cert_seq;

create or replace function public.csl_next_gift_cert_code()
returns text
language sql
volatile
as $$
  select 'CSL-REG-' || to_char(now(), 'YYYY') || '-' ||
         lpad(nextval('public.csl_gift_cert_seq')::text, 6, '0');
$$;

-- ─── 3. Auditoría (reutilizable por el módulo) ──────────────────────────────
create table if not exists public.csl_certificados_regalo_audit (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid,
  codigo         text not null,
  accion         text not null,     -- crear|editar|emitir|imprimir|descargar_pdf|descargar_png|descargar_jpg|entregar|canjear|anular|cambio_fecha|cambio_sucursal|cambio_plantilla|duplicar
  usuario        text,
  valor_anterior jsonb,
  valor_nuevo    jsonb,
  motivo         text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_csl_cert_regalo_audit_codigo   on public.csl_certificados_regalo_audit (codigo);
create index if not exists idx_csl_cert_regalo_audit_business on public.csl_certificados_regalo_audit (business_id);
create index if not exists idx_csl_cert_regalo_audit_created  on public.csl_certificados_regalo_audit (created_at desc);

-- RLS: deny-by-default para clientes; el servidor accede con service_role y
-- aísla por business_id en la capa de aplicación (igual que el resto del sistema).
alter table if exists public.csl_certificados_regalo_audit enable row level security;

-- Refrescar el cache de PostgREST tras cambios de esquema.
notify pgrst, 'reload schema';

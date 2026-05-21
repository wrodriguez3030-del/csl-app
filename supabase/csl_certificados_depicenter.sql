-- =====================================================================
-- CSL · Certificados Digitales DEPICENTER
-- =====================================================================
--
-- Tabla SEPARADA de `csl_certificados_regalo` (Cibao Spa Laser). Permite
-- emitir, validar y consultar certificados de regalo bajo la marca
-- Depicenter sin mezclar datos con los certificados de CSL.
--
-- Idempotente: se puede correr varias veces sin destruir datos.
-- =====================================================================

create table if not exists public.csl_certificados_depicenter (
  codigo               text primary key,
  tipo                 text not null default 'Digital',
  fecha                date,
  fecha_vencimiento    date,
  sucursal             text,
  otorgado_a           text not null default '',
  cortesia_de          text not null default '',
  valido_por           text not null default '',
  monto                numeric,
  servicio             text,
  firma                text,
  emitido_en           timestamptz not null default now(),
  emitido_por          text,
  estado               text not null default 'Activo',
  usado_en             text,
  fecha_uso            timestamptz,
  cancelado_en         timestamptz,
  notas_estado         text not null default '',
  cliente_nombre       text,
  cliente_telefono     text,
  cliente_correo       text,
  cliente_documento    text,
  observaciones        text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_csl_cert_depicenter_fecha on public.csl_certificados_depicenter (fecha desc);
create index if not exists idx_csl_cert_depicenter_estado on public.csl_certificados_depicenter (estado);
create index if not exists idx_csl_cert_depicenter_sucursal on public.csl_certificados_depicenter (sucursal);
create index if not exists idx_csl_cert_depicenter_cliente on public.csl_certificados_depicenter (cliente_nombre);

alter table public.csl_certificados_depicenter enable row level security;

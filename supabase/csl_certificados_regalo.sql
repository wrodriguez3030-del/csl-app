create table if not exists public.csl_certificados_regalo (
  codigo text primary key,
  tipo text not null default 'Digital',
  fecha date,
  sucursal text,
  otorgado_a text not null default '',
  cortesia_de text not null default '',
  valido_por text not null default '',
  firma text,
  emitido_en timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_csl_certificados_regalo_fecha on public.csl_certificados_regalo (fecha desc);
create index if not exists idx_csl_certificados_regalo_sucursal on public.csl_certificados_regalo (sucursal);
create index if not exists idx_csl_certificados_regalo_tipo on public.csl_certificados_regalo (tipo);

alter table public.csl_certificados_regalo
  add column if not exists estado text not null default 'Emitido',
  add column if not exists canjeado_en timestamptz,
  add column if not exists notas_estado text not null default '';

create index if not exists idx_csl_certificados_regalo_estado on public.csl_certificados_regalo (estado);

create table if not exists public.csl_cosmiatria_clientes (
  cliente_id text primary key,
  numero_cliente text,
  documento_identidad text,
  email text,
  nombre text not null default '',
  apellido text not null default '',
  telefono text not null default '',
  telefono2 text,
  direccion text,
  localidad text,
  ciudad text,
  region text,
  fecha_nacimiento date,
  edad integer not null default 0,
  genero text,
  sucursal text not null default '',
  puede_agendar boolean not null default true,
  cliente_desde date not null default current_date,
  estado text not null default 'Activo',
  notas text,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.csl_ficha_dermatologica
  add column if not exists cliente_id text references public.csl_cosmiatria_clientes(cliente_id) on delete set null;

create unique index if not exists csl_cosmiatria_clientes_documento_uidx
  on public.csl_cosmiatria_clientes (documento_identidad)
  where documento_identidad is not null and documento_identidad <> '';

create index if not exists csl_cosmiatria_clientes_nombre_idx on public.csl_cosmiatria_clientes (lower(nombre), lower(apellido));
create index if not exists csl_cosmiatria_clientes_telefono_idx on public.csl_cosmiatria_clientes (telefono);
create index if not exists csl_cosmiatria_clientes_sucursal_idx on public.csl_cosmiatria_clientes (sucursal);
create index if not exists csl_ficha_dermatologica_cliente_idx on public.csl_ficha_dermatologica (cliente_id);

create or replace function public.csl_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists csl_cosmiatria_clientes_updated_at on public.csl_cosmiatria_clientes;
create trigger csl_cosmiatria_clientes_updated_at
before update on public.csl_cosmiatria_clientes
for each row execute function public.csl_set_updated_at();

alter table public.csl_cosmiatria_clientes enable row level security;

drop policy if exists "CSL authenticated can read cosmiatria clientes" on public.csl_cosmiatria_clientes;
create policy "CSL authenticated can read cosmiatria clientes"
on public.csl_cosmiatria_clientes
for select to authenticated
using (true);

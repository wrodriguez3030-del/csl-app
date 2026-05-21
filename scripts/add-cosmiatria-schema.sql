create table if not exists public.csl_ficha_dermatologica (
  ficha_id text primary key,
  fecha date,
  sucursal text not null default '',
  operadora text not null default '',
  nombre text not null default '',
  edad text,
  ciudad text,
  telefono text not null default '',
  ocupacion text,
  motivo_consulta text not null default '',
  cedula text,
  email text,
  estado text not null default 'Completada',
  firma_digital text,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists csl_ficha_dermatologica_fecha_idx on public.csl_ficha_dermatologica (fecha);
create index if not exists csl_ficha_dermatologica_sucursal_idx on public.csl_ficha_dermatologica (sucursal);
create index if not exists csl_ficha_dermatologica_operadora_idx on public.csl_ficha_dermatologica (operadora);

create or replace function public.csl_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists csl_ficha_dermatologica_updated_at on public.csl_ficha_dermatologica;
create trigger csl_ficha_dermatologica_updated_at
before update on public.csl_ficha_dermatologica
for each row execute function public.csl_set_updated_at();

alter table public.csl_ficha_dermatologica enable row level security;

drop policy if exists "CSL authenticated can read fichas dermatologia" on public.csl_ficha_dermatologica;
create policy "CSL authenticated can read fichas dermatologia"
on public.csl_ficha_dermatologica
for select to authenticated
using (true);

-- Clientes de Cosmiatria: ejecutar tambien scripts/add-cosmiatria-clientes.sql


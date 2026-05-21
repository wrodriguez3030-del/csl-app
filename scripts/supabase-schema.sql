create extension if not exists pgcrypto;

create or replace function public.set_csl_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.csl_user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null default '',
  username text not null unique,
  is_admin boolean not null default false,
  activo boolean not null default true,
  menus text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.csl_sucursales (
  codigo text primary key,
  nombre text not null,
  ciudad text not null default '',
  direccion text,
  estado text not null default 'Activa',
  notas text,
  correo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.csl_equipos (
  equipo_id text primary key,
  sucursal text not null default '',
  empresa text not null default '',
  domicilio text,
  modelo text not null default '',
  serie text,
  numero text,
  p_cabeza numeric not null default 0,
  p_totales numeric not null default 0,
  max_cabeza numeric not null default 6000000,
  estado text not null default 'Activo',
  observaciones text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.csl_tecnicos (
  codigo text primary key,
  nombre text not null,
  telefono text,
  correo text,
  estado text not null default 'Activo',
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.csl_piezas (
  pieza text primary key,
  categoria text not null default '',
  prioridad text not null default 'Media',
  tipo text not null default 'Consumible',
  funcion text,
  fallas_comunes text,
  activa text not null default 'Sí',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.csl_reportes (
  report_id text primary key,
  fecha date,
  equipo_id text not null default '',
  sucursal text not null default '',
  empresa text,
  cliente text,
  domicilio text,
  ciudad text,
  modelo text,
  serie text,
  numero text,
  tipo text not null default 'Preventivo',
  estado_equipo text not null default 'Operativo',
  prioridad text not null default 'Baja',
  problema text,
  correccion text,
  observaciones text,
  checklist text,
  p_cabeza numeric not null default 0,
  p_totales numeric not null default 0,
  atendio text,
  piezas_json text not null default '[]',
  partes_texto text,
  firma_cliente text,
  firma_tecnico text,
  fotos text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.csl_inventario (
  item_id text primary key,
  codigo_barras text,
  pieza text not null default '',
  categoria text not null default '',
  marca text,
  modelo text,
  numero_parte text,
  precio_compra numeric not null default 0,
  precio_compra_mercado numeric not null default 0,
  precio_venta numeric not null default 0,
  stock_rafael_vidal numeric not null default 0,
  stock_los_jardines numeric not null default 0,
  stock_villa_olga numeric not null default 0,
  stock_la_vega numeric not null default 0,
  stock_minimo numeric not null default 0,
  proveedor text,
  estado text not null default 'Activo',
  observaciones text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.csl_operadoras (
  operadora_id text primary key,
  nombre text not null,
  sucursal text not null default '',
  estado text not null default 'Activa',
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.csl_lecturas_semanales (
  lectura_id text primary key,
  fecha_semana date,
  equipo_id text not null default '',
  sucursal text not null default '',
  cabina text not null default '',
  operadora_id text not null default '',
  lectura_inicial numeric not null default 0,
  lectura_final numeric not null default 0,
  diferencia_real numeric not null default 0,
  observaciones text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.csl_sesiones_cliente (
  sesion_id text primary key,
  fecha date,
  sucursal text not null default '',
  cabina text not null default '',
  operadora_id text not null default '',
  cliente text not null default '',
  area_trabajada text not null default '',
  disparos_reportados numeric not null default 0,
  duracion numeric,
  equipo_id text not null default '',
  observaciones text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.csl_auditorias_semanales (
  auditoria_id text primary key,
  fecha_semana date,
  equipo_id text not null default '',
  sucursal text not null default '',
  pulsos_reales numeric not null default 0,
  pulsos_reportados numeric not null default 0,
  diferencia numeric not null default 0,
  porcentaje_desviacion numeric not null default 0,
  alerta text not null default 'OK',
  observaciones text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.csl_credenciales (
  credencial_id text primary key,
  sucursal text not null default '',
  area text,
  equipo text,
  sistema text not null default '',
  usuario text,
  contrasena text,
  pin text,
  url text,
  correo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.csl_ficha_dermatologica (
  ficha_id text primary key,
  cliente_id text,
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
  add constraint csl_ficha_dermatologica_cliente_fk
  foreign key (cliente_id) references public.csl_cosmiatria_clientes(cliente_id) on delete set null;

create table if not exists public.csl_solicitudes_empleo (
  solicitud_id text primary key,
  fecha_solicitud date,
  estado text not null default 'Pendiente',
  puesto_solicitado text not null default '',
  nombre text not null default '',
  apellido text not null default '',
  cedula text not null default '',
  email text,
  telefono text,
  fecha_nacimiento date,
  sexo text,
  nacionalidad text,
  provincia text,
  ciudad text,
  sector text,
  direccion text,
  experiencia text,
  salario numeric not null default 0,
  nivel_educacion text,
  especialidad text,
  documentos_adjuntos text[] not null default '{}',
  firma_digital text,
  observaciones text,
  fecha_revision date,
  revisado_por text,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.csl_empleados (
  empleado_id text primary key,
  solicitud_id text,
  fecha_solicitud date,
  estado text not null default 'Aprobado',
  puesto_solicitado text not null default '',
  nombre text not null default '',
  apellido text not null default '',
  cedula text not null default '',
  email text,
  telefono text,
  fecha_nacimiento date,
  sexo text,
  nacionalidad text,
  provincia text,
  ciudad text,
  sector text,
  direccion text,
  experiencia text,
  salario numeric not null default 0,
  nivel_educacion text,
  especialidad text,
  documentos_adjuntos text[] not null default '{}',
  firma_digital text,
  observaciones text,
  fecha_revision date,
  revisado_por text,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists csl_user_profiles_username_idx on public.csl_user_profiles (lower(username));
create index if not exists csl_sucursales_estado_idx on public.csl_sucursales (estado);
create index if not exists csl_sucursales_ciudad_idx on public.csl_sucursales (ciudad);
create index if not exists csl_equipos_sucursal_idx on public.csl_equipos (sucursal);
create index if not exists csl_equipos_estado_idx on public.csl_equipos (estado);
create index if not exists csl_equipos_modelo_idx on public.csl_equipos (modelo);
create index if not exists csl_tecnicos_estado_idx on public.csl_tecnicos (estado);
create index if not exists csl_piezas_categoria_idx on public.csl_piezas (categoria);
create index if not exists csl_piezas_prioridad_idx on public.csl_piezas (prioridad);
create index if not exists csl_piezas_activa_idx on public.csl_piezas (activa);
create index if not exists csl_reportes_fecha_idx on public.csl_reportes (fecha);
create index if not exists csl_reportes_equipo_idx on public.csl_reportes (equipo_id);
create index if not exists csl_reportes_sucursal_idx on public.csl_reportes (sucursal);
create index if not exists csl_reportes_tipo_idx on public.csl_reportes (tipo);
create index if not exists csl_reportes_prioridad_idx on public.csl_reportes (prioridad);
create index if not exists csl_inventario_pieza_idx on public.csl_inventario (pieza);
create index if not exists csl_inventario_categoria_idx on public.csl_inventario (categoria);
create index if not exists csl_inventario_estado_idx on public.csl_inventario (estado);
create index if not exists csl_operadoras_sucursal_idx on public.csl_operadoras (sucursal);
create index if not exists csl_operadoras_estado_idx on public.csl_operadoras (estado);
create index if not exists csl_lecturas_fecha_idx on public.csl_lecturas_semanales (fecha_semana);
create index if not exists csl_lecturas_equipo_idx on public.csl_lecturas_semanales (equipo_id);
create index if not exists csl_lecturas_operadora_idx on public.csl_lecturas_semanales (operadora_id);
create index if not exists csl_sesiones_fecha_idx on public.csl_sesiones_cliente (fecha);
create index if not exists csl_sesiones_sucursal_idx on public.csl_sesiones_cliente (sucursal);
create index if not exists csl_sesiones_operadora_idx on public.csl_sesiones_cliente (operadora_id);
create index if not exists csl_sesiones_equipo_idx on public.csl_sesiones_cliente (equipo_id);
create index if not exists csl_auditorias_fecha_idx on public.csl_auditorias_semanales (fecha_semana);
create index if not exists csl_auditorias_equipo_idx on public.csl_auditorias_semanales (equipo_id);
create index if not exists csl_auditorias_alerta_idx on public.csl_auditorias_semanales (alerta);
create index if not exists csl_credenciales_sucursal_idx on public.csl_credenciales (sucursal);
create index if not exists csl_credenciales_sistema_idx on public.csl_credenciales (sistema);
create index if not exists csl_ficha_dermatologica_fecha_idx on public.csl_ficha_dermatologica (fecha);
create index if not exists csl_ficha_dermatologica_sucursal_idx on public.csl_ficha_dermatologica (sucursal);
create index if not exists csl_ficha_dermatologica_operadora_idx on public.csl_ficha_dermatologica (operadora);
create index if not exists csl_ficha_dermatologica_cliente_idx on public.csl_ficha_dermatologica (cliente_id);
create index if not exists csl_cosmiatria_clientes_nombre_idx on public.csl_cosmiatria_clientes (lower(nombre), lower(apellido));
create index if not exists csl_cosmiatria_clientes_telefono_idx on public.csl_cosmiatria_clientes (telefono);
create index if not exists csl_cosmiatria_clientes_sucursal_idx on public.csl_cosmiatria_clientes (sucursal);
create index if not exists csl_solicitudes_estado_idx on public.csl_solicitudes_empleo (estado);
create index if not exists csl_solicitudes_cedula_idx on public.csl_solicitudes_empleo (cedula);
create index if not exists csl_solicitudes_puesto_idx on public.csl_solicitudes_empleo (puesto_solicitado);
create index if not exists csl_empleados_cedula_idx on public.csl_empleados (cedula);
create index if not exists csl_empleados_puesto_idx on public.csl_empleados (puesto_solicitado);
create index if not exists csl_empleados_ciudad_idx on public.csl_empleados (ciudad);

create or replace function public.create_csl_updated_at_trigger(table_name text)
returns void
language plpgsql
as $$
begin
  execute format('drop trigger if exists %I on public.%I', table_name || '_updated_at', table_name);
  execute format(
    'create trigger %I before update on public.%I for each row execute function public.set_csl_updated_at()',
    table_name || '_updated_at',
    table_name
  );
end;
$$;

select public.create_csl_updated_at_trigger('csl_user_profiles');
select public.create_csl_updated_at_trigger('csl_sucursales');
select public.create_csl_updated_at_trigger('csl_equipos');
select public.create_csl_updated_at_trigger('csl_tecnicos');
select public.create_csl_updated_at_trigger('csl_piezas');
select public.create_csl_updated_at_trigger('csl_reportes');
select public.create_csl_updated_at_trigger('csl_inventario');
select public.create_csl_updated_at_trigger('csl_operadoras');
select public.create_csl_updated_at_trigger('csl_lecturas_semanales');
select public.create_csl_updated_at_trigger('csl_sesiones_cliente');
select public.create_csl_updated_at_trigger('csl_auditorias_semanales');
select public.create_csl_updated_at_trigger('csl_credenciales');
select public.create_csl_updated_at_trigger('csl_cosmiatria_clientes');
select public.create_csl_updated_at_trigger('csl_ficha_dermatologica');
select public.create_csl_updated_at_trigger('csl_solicitudes_empleo');
select public.create_csl_updated_at_trigger('csl_empleados');

drop function public.create_csl_updated_at_trigger(text);

create or replace function public.handle_csl_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.csl_user_profiles (user_id, nombre, username, is_admin, activo, menus)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), ''),
    coalesce(new.raw_user_meta_data->>'username', new.email),
    coalesce((new.raw_user_meta_data->>'is_admin')::boolean, false),
    coalesce((new.raw_user_meta_data->>'activo')::boolean, true),
    case
      when jsonb_typeof(new.raw_user_meta_data->'menus') = 'array'
        then array(select jsonb_array_elements_text(new.raw_user_meta_data->'menus'))
      else '{}'::text[]
    end
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists csl_new_user_profile on auth.users;
create trigger csl_new_user_profile
after insert on auth.users
for each row execute function public.handle_csl_new_user();

insert into public.csl_user_profiles (user_id, nombre, username, is_admin, activo, menus)
select
  users.id,
  coalesce(users.raw_user_meta_data->>'nombre', users.raw_user_meta_data->>'name', split_part(users.email, '@', 1), ''),
  coalesce(users.raw_user_meta_data->>'username', users.email),
  coalesce((users.raw_user_meta_data->>'is_admin')::boolean, false),
  coalesce((users.raw_user_meta_data->>'activo')::boolean, true),
  case
    when jsonb_typeof(users.raw_user_meta_data->'menus') = 'array'
      then array(select jsonb_array_elements_text(users.raw_user_meta_data->'menus'))
    else '{}'::text[]
  end
from auth.users
on conflict (user_id) do nothing;

alter table public.csl_user_profiles enable row level security;
alter table public.csl_sucursales enable row level security;
alter table public.csl_equipos enable row level security;
alter table public.csl_tecnicos enable row level security;
alter table public.csl_piezas enable row level security;
alter table public.csl_reportes enable row level security;
alter table public.csl_inventario enable row level security;
alter table public.csl_operadoras enable row level security;
alter table public.csl_lecturas_semanales enable row level security;
alter table public.csl_sesiones_cliente enable row level security;
alter table public.csl_auditorias_semanales enable row level security;
alter table public.csl_credenciales enable row level security;
alter table public.csl_cosmiatria_clientes enable row level security;
alter table public.csl_ficha_dermatologica enable row level security;
alter table public.csl_solicitudes_empleo enable row level security;
alter table public.csl_empleados enable row level security;

drop policy if exists "CSL profiles are readable by authenticated users" on public.csl_user_profiles;
create policy "CSL profiles are readable by authenticated users"
on public.csl_user_profiles for select to authenticated using (true);

drop policy if exists "CSL users can read their own profile" on public.csl_user_profiles;
create policy "CSL users can read their own profile"
on public.csl_user_profiles for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "CSL authenticated can read sucursales" on public.csl_sucursales;
create policy "CSL authenticated can read sucursales" on public.csl_sucursales for select to authenticated using (true);
drop policy if exists "CSL authenticated can read equipos" on public.csl_equipos;
create policy "CSL authenticated can read equipos" on public.csl_equipos for select to authenticated using (true);
drop policy if exists "CSL authenticated can read tecnicos" on public.csl_tecnicos;
create policy "CSL authenticated can read tecnicos" on public.csl_tecnicos for select to authenticated using (true);
drop policy if exists "CSL authenticated can read piezas" on public.csl_piezas;
create policy "CSL authenticated can read piezas" on public.csl_piezas for select to authenticated using (true);
drop policy if exists "CSL authenticated can read reportes" on public.csl_reportes;
create policy "CSL authenticated can read reportes" on public.csl_reportes for select to authenticated using (true);
drop policy if exists "CSL authenticated can read inventario" on public.csl_inventario;
create policy "CSL authenticated can read inventario" on public.csl_inventario for select to authenticated using (true);
drop policy if exists "CSL authenticated can read operadoras" on public.csl_operadoras;
create policy "CSL authenticated can read operadoras" on public.csl_operadoras for select to authenticated using (true);
drop policy if exists "CSL authenticated can read lecturas" on public.csl_lecturas_semanales;
create policy "CSL authenticated can read lecturas" on public.csl_lecturas_semanales for select to authenticated using (true);
drop policy if exists "CSL authenticated can read sesiones" on public.csl_sesiones_cliente;
create policy "CSL authenticated can read sesiones" on public.csl_sesiones_cliente for select to authenticated using (true);
drop policy if exists "CSL authenticated can read auditorias" on public.csl_auditorias_semanales;
create policy "CSL authenticated can read auditorias" on public.csl_auditorias_semanales for select to authenticated using (true);
drop policy if exists "CSL authenticated can read credenciales" on public.csl_credenciales;
create policy "CSL authenticated can read credenciales" on public.csl_credenciales for select to authenticated using (true);
drop policy if exists "CSL authenticated can read fichas dermatologia" on public.csl_ficha_dermatologica;
create policy "CSL authenticated can read fichas dermatologia" on public.csl_ficha_dermatologica for select to authenticated using (true);
drop policy if exists "CSL authenticated can read cosmiatria clientes" on public.csl_cosmiatria_clientes;
create policy "CSL authenticated can read cosmiatria clientes" on public.csl_cosmiatria_clientes for select to authenticated using (true);
drop policy if exists "CSL authenticated can read solicitudes" on public.csl_solicitudes_empleo;
create policy "CSL authenticated can read solicitudes" on public.csl_solicitudes_empleo for select to authenticated using (true);
drop policy if exists "CSL authenticated can read empleados" on public.csl_empleados;
create policy "CSL authenticated can read empleados" on public.csl_empleados for select to authenticated using (true);

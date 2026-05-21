create extension if not exists pgcrypto;

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

-- Migra datos desde el nombre viejo si existe, sin fallar si no existe.
do $$
begin
  if to_regclass('public.csl_fichas_dermatologia') is not null then
    execute $sql$
      insert into public.csl_ficha_dermatologica (
        ficha_id, cliente_id, fecha, sucursal, operadora, nombre, edad, ciudad,
        telefono, ocupacion, motivo_consulta, cedula, email, estado,
        firma_digital, payload_json, created_at, updated_at
      )
      select ficha_id, cliente_id, fecha, sucursal, operadora, nombre, edad, ciudad,
        telefono, ocupacion, motivo_consulta, cedula, email, estado,
        firma_digital, payload_json, created_at, updated_at
      from public.csl_fichas_dermatologia
      on conflict (ficha_id) do nothing
    $sql$;
  end if;
end $$;

create table if not exists public.csl_consent_masajes (
  id uuid primary key default gen_random_uuid(),
  consent_id text unique,
  cliente_id text,
  ficha_id text,
  fecha date,
  sucursal text,
  estado text default 'Pendiente',
  nombre_cliente text,
  cliente_nombre text,
  documento text,
  telefono text,
  correo text,
  fecha_nacimiento date,
  edad integer,
  direccion text,
  tipo_masaje text,
  zona_tratar text,
  observaciones text,
  contraindicaciones text,
  alergias text,
  enfermedades_antecedentes text,
  embarazo text,
  texto_consentimiento text,
  firma_cliente text,
  firma_especialista text,
  especialista text,
  especialista_nombre text,
  fecha_registro timestamptz default now(),
  payload_json jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.csl_consent_tatuajes_cejas (
  id uuid primary key default gen_random_uuid(),
  consent_id text unique,
  cliente_id text,
  ficha_id text,
  fecha date,
  sucursal text,
  estado text default 'Pendiente',
  nombre_cliente text,
  cliente_nombre text,
  documento text,
  telefono text,
  correo text,
  fecha_nacimiento date,
  edad integer,
  direccion text,
  tipo_procedimiento text,
  zona_tratar text,
  zona_otra_notas text,
  especialista text,
  especialista_nombre text,
  tipo_pigmento text,
  tipo_pigmento_otro_notas text,
  colores_pigmento_json jsonb default '[]'::jsonb,
  colores_pigmento_otro_notas text,
  antiguedad_pigmento text,
  tamano_aproximado text,
  sesiones_previas text,
  cantidad_sesiones_previas integer,
  reaccion_previa_laser text,
  observaciones_pigmento text,
  embarazo_lactancia text,
  embarazo_lactancia_notas text,
  alergias text,
  alergias_notas text,
  medicamentos text,
  medicamentos_notas text,
  exposicion_solar text,
  exposicion_solar_notas text,
  queloides text,
  queloides_notas text,
  instrucciones_antes_json jsonb default '[]'::jsonb,
  cuidados_despues_json jsonb default '[]'::jsonb,
  riesgos_aceptados_json jsonb default '[]'::jsonb,
  politicas_json jsonb default '[]'::jsonb,
  declaracion_resultados_aceptada boolean default false,
  autorizacion_fotografica_aceptada boolean default false,
  autorizacion_procedimiento_aceptada boolean default false,
  observaciones_medicas text,
  color_pigmento text,
  tiempo_aproximado text,
  sesiones_explicadas text,
  riesgos_explicados text,
  cuidados_antes text,
  cuidados_despues text,
  observaciones text,
  texto_consentimiento text,
  firma_cliente text,
  firma_especialista text,
  fecha_registro timestamptz default now(),
  payload_json jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.csl_ficha_dermatologica
  add column if not exists cliente_id text,
  add column if not exists email text;

alter table public.csl_consent_masajes
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists cliente_id text,
  add column if not exists ficha_id text,
  add column if not exists nombre_cliente text,
  add column if not exists cliente_nombre text,
  add column if not exists especialista text,
  add column if not exists especialista_nombre text,
  add column if not exists payload_json jsonb default '{}'::jsonb;

alter table public.csl_consent_tatuajes_cejas
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists cliente_id text,
  add column if not exists ficha_id text,
  add column if not exists nombre_cliente text,
  add column if not exists cliente_nombre text,
  add column if not exists especialista text,
  add column if not exists especialista_nombre text,
  add column if not exists zona_otra_notas text,
  add column if not exists tipo_pigmento text,
  add column if not exists tipo_pigmento_otro_notas text,
  add column if not exists colores_pigmento_json jsonb default '[]'::jsonb,
  add column if not exists colores_pigmento_otro_notas text,
  add column if not exists antiguedad_pigmento text,
  add column if not exists tamano_aproximado text,
  add column if not exists sesiones_previas text,
  add column if not exists cantidad_sesiones_previas integer,
  add column if not exists reaccion_previa_laser text,
  add column if not exists observaciones_pigmento text,
  add column if not exists embarazo_lactancia text,
  add column if not exists embarazo_lactancia_notas text,
  add column if not exists alergias text,
  add column if not exists alergias_notas text,
  add column if not exists medicamentos text,
  add column if not exists medicamentos_notas text,
  add column if not exists exposicion_solar text,
  add column if not exists exposicion_solar_notas text,
  add column if not exists queloides text,
  add column if not exists queloides_notas text,
  add column if not exists instrucciones_antes_json jsonb default '[]'::jsonb,
  add column if not exists cuidados_despues_json jsonb default '[]'::jsonb,
  add column if not exists riesgos_aceptados_json jsonb default '[]'::jsonb,
  add column if not exists politicas_json jsonb default '[]'::jsonb,
  add column if not exists declaracion_resultados_aceptada boolean default false,
  add column if not exists autorizacion_fotografica_aceptada boolean default false,
  add column if not exists autorizacion_procedimiento_aceptada boolean default false,
  add column if not exists observaciones_medicas text,
  add column if not exists color_pigmento text,
  add column if not exists tiempo_aproximado text,
  add column if not exists sesiones_explicadas text,
  add column if not exists riesgos_explicados text,
  add column if not exists cuidados_antes text,
  add column if not exists cuidados_despues text,
  add column if not exists observaciones text,
  add column if not exists texto_consentimiento text,
  add column if not exists firma_cliente text,
  add column if not exists firma_especialista text,
  add column if not exists fecha_registro timestamptz default now(),
  add column if not exists payload_json jsonb default '{}'::jsonb;

update public.csl_consent_masajes
   set nombre_cliente = coalesce(nullif(nombre_cliente, ''), cliente_nombre),
       cliente_nombre = coalesce(nullif(cliente_nombre, ''), nombre_cliente),
       especialista = coalesce(nullif(especialista, ''), especialista_nombre),
       especialista_nombre = coalesce(nullif(especialista_nombre, ''), especialista)
 where true;

update public.csl_consent_tatuajes_cejas
   set nombre_cliente = coalesce(nullif(nombre_cliente, ''), cliente_nombre),
       cliente_nombre = coalesce(nullif(cliente_nombre, ''), nombre_cliente),
       especialista = coalesce(nullif(especialista, ''), especialista_nombre),
       especialista_nombre = coalesce(nullif(especialista_nombre, ''), especialista)
 where true;

create unique index if not exists csl_consent_masajes_consent_id_uidx on public.csl_consent_masajes (consent_id);
create unique index if not exists csl_consent_tatuajes_cejas_consent_id_uidx on public.csl_consent_tatuajes_cejas (consent_id);

create index if not exists csl_cosmiatria_clientes_nombre_idx on public.csl_cosmiatria_clientes (lower(nombre), lower(apellido));
create index if not exists csl_cosmiatria_clientes_telefono_idx on public.csl_cosmiatria_clientes (telefono);
create index if not exists csl_cosmiatria_clientes_sucursal_idx on public.csl_cosmiatria_clientes (sucursal);
create index if not exists csl_ficha_dermatologica_fecha_idx on public.csl_ficha_dermatologica (fecha desc);
create index if not exists csl_ficha_dermatologica_cliente_idx on public.csl_ficha_dermatologica (cliente_id);
create index if not exists csl_consent_masajes_fecha_idx on public.csl_consent_masajes (fecha desc);
create index if not exists csl_consent_masajes_sucursal_idx on public.csl_consent_masajes (sucursal);
create index if not exists csl_consent_masajes_cliente_idx on public.csl_consent_masajes (nombre_cliente);
create index if not exists csl_consent_tatuajes_fecha_idx on public.csl_consent_tatuajes_cejas (fecha desc);
create index if not exists csl_consent_tatuajes_sucursal_idx on public.csl_consent_tatuajes_cejas (sucursal);
create index if not exists csl_consent_tatuajes_cliente_idx on public.csl_consent_tatuajes_cejas (nombre_cliente);

alter table public.csl_cosmiatria_clientes enable row level security;
alter table public.csl_ficha_dermatologica enable row level security;
alter table public.csl_consent_masajes enable row level security;
alter table public.csl_consent_tatuajes_cejas enable row level security;

-- El sistema escribe por API con service role; estas tablas no necesitan acceso público directo.
grant all on table public.csl_cosmiatria_clientes to service_role;
grant all on table public.csl_ficha_dermatologica to service_role;
grant all on table public.csl_consent_masajes to service_role;
grant all on table public.csl_consent_tatuajes_cejas to service_role;

notify pgrst, 'reload schema';
-- Ficha Dermatológica profesional: columnas adicionales sin borrar datos.
alter table public.csl_ficha_dermatologica
  add column if not exists nombre_cliente text,
  add column if not exists documento text,
  add column if not exists fecha_nacimiento date,
  add column if not exists direccion text,
  add column if not exists especialista text,
  add column if not exists tipo_piel text,
  add column if not exists fototipo text,
  add column if not exists evaluacion_dermatologica_json jsonb default '{}'::jsonb,
  add column if not exists antecedentes_medicos_json jsonb default '[]'::jsonb,
  add column if not exists alergias text,
  add column if not exists alergias_notas text,
  add column if not exists medicamentos text,
  add column if not exists medicamentos_notas text,
  add column if not exists embarazo text,
  add column if not exists embarazo_notas text,
  add column if not exists lactancia text,
  add column if not exists lactancia_notas text,
  add column if not exists piel_sensible text,
  add column if not exists piel_sensible_notas text,
  add column if not exists queloides text,
  add column if not exists queloides_notas text,
  add column if not exists exposicion_solar text,
  add column if not exists exposicion_solar_notas text,
  add column if not exists tratamientos_previos_json jsonb default '[]'::jsonb,
  add column if not exists observaciones_profesionales text,
  add column if not exists recomendaciones text,
  add column if not exists declaracion_aceptada boolean default false,
  add column if not exists firma_cliente text,
  add column if not exists firma_especialista text,
  add column if not exists correo text;

update public.csl_ficha_dermatologica
   set nombre_cliente = coalesce(nullif(nombre_cliente, ''), nombre),
       documento = coalesce(nullif(documento, ''), cedula),
       especialista = coalesce(nullif(especialista, ''), operadora),
       firma_cliente = coalesce(nullif(firma_cliente, ''), firma_digital),
       correo = coalesce(nullif(correo, ''), email),
       fototipo = coalesce(nullif(fototipo, ''), payload_json->>'fototipo'),
       tipo_piel = coalesce(nullif(tipo_piel, ''), payload_json->>'tipoPiel')
 where true;

create index if not exists csl_ficha_dermatologica_nombre_cliente_idx on public.csl_ficha_dermatologica (nombre_cliente);
create index if not exists csl_ficha_dermatologica_documento_idx on public.csl_ficha_dermatologica (documento);

notify pgrst, 'reload schema';


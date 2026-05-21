alter table if exists public.csl_sucursales enable row level security;
alter table if exists public.csl_equipos enable row level security;
alter table if exists public.csl_reportes enable row level security;
alter table if exists public.csl_piezas enable row level security;
alter table if exists public.csl_tecnicos enable row level security;
alter table if exists public.csl_inventario enable row level security;
alter table if exists public.csl_operadoras enable row level security;
alter table if exists public.csl_lecturas_semanales enable row level security;
alter table if exists public.csl_sesiones_cliente enable row level security;
alter table if exists public.csl_auditorias_semanales enable row level security;
alter table if exists public.csl_credenciales enable row level security;
alter table if exists public.csl_solicitudes_empleo enable row level security;
alter table if exists public.csl_empleados enable row level security;
alter table if exists public.csl_cosmiatria_clientes enable row level security;
alter table if exists public.csl_ficha_dermatologica enable row level security;
alter table if exists public.csl_certificados_regalo enable row level security;
alter table if exists public.csl_user_profiles enable row level security;

drop policy if exists csl_user_profiles_select_own on public.csl_user_profiles;
create policy csl_user_profiles_select_own
on public.csl_user_profiles
for select
to authenticated
using (user_id = auth.uid());

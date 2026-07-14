-- Asignación manual de prestador a ventas sin prestador (Incentivos de Ventas).
-- La fila conserva provider_original (fidelidad al archivo fuente); la asignación
-- manual escribe provider_normalized + assigned_at/assigned_by. assigned_at NO
-- nulo = el prestador efectivo es provider_normalized (comisionable), y todos
-- los cálculos derivados (detalle, dashboard, runs, pacientes) lo respetan.

alter table public.sales_commission_sales
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by text;

comment on column public.sales_commission_sales.assigned_at is
  'Momento de la asignación MANUAL de prestador (null = clasificación del archivo)';
comment on column public.sales_commission_sales.assigned_by is
  'Usuario que asignó manualmente el prestador';

-- Consulta típica: ventas sin asignar de un período (assigned_at is null).
create index if not exists idx_scs_assigned_at
  on public.sales_commission_sales (business_id, assigned_at)
  where assigned_at is not null;

notify pgrst, 'reload schema';

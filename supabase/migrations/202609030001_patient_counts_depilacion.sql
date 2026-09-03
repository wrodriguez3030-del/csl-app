-- Pacientes de DEPILACIÓN aparte del total de atenciones.
--
-- El reparto del fondo láser usa «pacientes atendidos de depilación», pero el
-- conteo sumaba toda cita asistida: en agosto 2026 ANGELICA entró al reparto de
-- Villa Olga con 18 citas de tatuaje y BENITA al de Los Jardines con 52
-- faciales. `patient_count` se conserva tal cual (alimenta el KPI «Clientes
-- atendidos»); la nueva columna es la que manda en el cálculo.
alter table public.sales_commission_patient_counts
  add column if not exists depilacion_count integer;

comment on column public.sales_commission_patient_counts.depilacion_count is
  'Atenciones ASISTE de depilación láser. NULL = período importado antes de la separación: el cálculo cae a patient_count.';

notify pgrst, 'reload schema';

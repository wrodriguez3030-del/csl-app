-- ============================================================================
-- Ventana de almuerzo explícita en el horario por día del empleado.
-- Aditiva, no destructiva: agrega lunch_start / lunch_end (texto "HH:MM") a
-- hr_employee_schedule_days. El cómputo de horas netas sigue usando
-- break_minutes (60 = 1 h de almuerzo); estas columnas guardan la ventana
-- exacta para mostrar "almuerzo inicio / fin" en la UI.
-- ============================================================================

alter table hr_employee_schedule_days
  add column if not exists lunch_start text,
  add column if not exists lunch_end   text;

notify pgrst, 'reload schema';

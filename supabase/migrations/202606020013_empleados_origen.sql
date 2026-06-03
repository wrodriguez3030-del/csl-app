-- RR.HH.: marcar el origen del empleado (solicitud_empleo | manual).
-- Soporta la sincronización empleados ← solicitudes aprobadas. Idempotente.
ALTER TABLE public.csl_empleados ADD COLUMN IF NOT EXISTS origen text;

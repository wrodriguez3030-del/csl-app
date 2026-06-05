-- ─────────────────────────────────────────────────────────────────────────
-- RR.HH. · Vacaciones · Cálculo legal (Código de Trabajo RD).
-- Agrega columnas para el cálculo por antigüedad: sueldo mensual, fecha de
-- ingreso, antigüedad, días legales (14/18) y snapshot de cédula/puesto/sucursal
-- para el reporte Excel. Idempotente y NO destructivo.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE hr_vacations ADD COLUMN IF NOT EXISTS sueldo_mensual   numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE hr_vacations ADD COLUMN IF NOT EXISTS fecha_ingreso    date;
ALTER TABLE hr_vacations ADD COLUMN IF NOT EXISTS antiguedad_anios numeric(6,2)  NOT NULL DEFAULT 0;
ALTER TABLE hr_vacations ADD COLUMN IF NOT EXISTS dias_legales     numeric(5,1)  NOT NULL DEFAULT 0;
ALTER TABLE hr_vacations ADD COLUMN IF NOT EXISTS cedula           text;
ALTER TABLE hr_vacations ADD COLUMN IF NOT EXISTS puesto           text;
ALTER TABLE hr_vacations ADD COLUMN IF NOT EXISTS sucursal         text;

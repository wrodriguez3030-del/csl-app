-- Corrección manual de operadora en Auditoría / IA (PulseControl).
--
-- PROBLEMA
-- --------
-- La operadora mostrada en Auditoría/IA y Lecturas se resuelve SIEMPRE desde el
-- catálogo oficial de equipos (csl_equipos). El campo `operadora` de la lectura
-- solo alimentaba la advertencia "⚠ Excel: …", por lo que editar la operadora
-- desde la pantalla nunca cambiaba el valor mostrado ni quitaba la advertencia.
--
-- SOLUCIÓN
-- --------
-- Campo de override manual con auditoría por fila. Cuando existe, el resolver lo
-- prioriza por encima del catálogo oficial y del Excel, y se respeta al recargar.
-- No se borra ni se sobrescribe `operadora` (se preserva la procedencia Excel).

ALTER TABLE csl_pulse_readings
  ADD COLUMN IF NOT EXISTS operadora_corregida          text,
  ADD COLUMN IF NOT EXISTS operadora_corregida_por      text,
  ADD COLUMN IF NOT EXISTS operadora_corregida_en       timestamptz,
  ADD COLUMN IF NOT EXISTS operadora_correccion_motivo  text;

COMMENT ON COLUMN csl_pulse_readings.operadora_corregida IS
  'Operadora corregida manualmente desde Auditoría/IA. Tiene prioridad sobre el catálogo oficial y el Excel. NULL = sin corrección.';

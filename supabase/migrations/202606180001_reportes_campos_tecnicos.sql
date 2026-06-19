-- ============================================================================
-- Campos técnicos editables del Reporte de Servicio de equipos láser.
-- Aditiva y no destructiva: agrega columnas para los parámetros técnicos que
-- el formato impreso ya muestra (N/S Fuente, N/S Fibra, HV, J, BS, BC, HV REF,
-- VDC, V, TX, Software) pero que hasta ahora salían en blanco porque no se
-- capturaban ni se guardaban.
--
-- Todas son TEXT: varios técnicos escriben valores con unidades ("12.5 kV",
-- "8 J", "—") y no deben perderse. Los pulsos (P. Totales / P. Cabeza) NO se
-- tocan: ya existen como p_totales / p_cabeza (numeric) y se reutilizan.
-- Corrección, Observaciones, Partes usadas, Atendió y Cliente tampoco se
-- duplican: ya existen como correccion / observaciones / partes_texto /
-- atendio / cliente.
-- ============================================================================

alter table csl_reportes
  add column if not exists power_source_number text,   -- Número de la fuente de poder
  add column if not exists power_source_serial text,   -- N/S Fuente
  add column if not exists fiber_serial        text,   -- N/S Fibra
  add column if not exists hv_value            text,   -- HV@
  add column if not exists joules_value        text,   -- J
  add column if not exists bs_value            text,   -- BS
  add column if not exists bc_value            text,   -- BC
  add column if not exists hv_ref_value        text,   -- HV REF@
  add column if not exists vdc_value           text,   -- VDC
  add column if not exists voltage_value       text,   -- V
  add column if not exists tx_value            text,   -- TX
  add column if not exists software_version    text;   -- Software

notify pgrst, 'reload schema';

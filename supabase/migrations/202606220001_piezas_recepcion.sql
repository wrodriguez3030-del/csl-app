-- ============================================================================
-- Recepción editable de piezas — Mantenimiento › Lista piezas póliza.
--
-- Aditiva y NO destructiva: agrega los campos para registrar y editar la
-- recepción de una pieza solicitada (fecha, cantidad recibida, recibido por,
-- estado, nota, factura, costo real, suplidor final y evidencia adjunta), más
-- el rastro de quién/cuándo editó la ficha de recepción.
--
-- La columna `estado` (pendiente|recibida) NO se toca ni se elimina: sigue
-- manejando el toggle binario, los contadores del dashboard y el PDF. El nuevo
-- `received_status` es la fuente granular y `estado` se mantiene sincronizado
-- desde el backend (recibida_completa -> estado=recibida; resto -> pendiente).
-- ============================================================================

alter table csl_piezas_poliza_lista
  add column if not exists received_status         text default 'pendiente',  -- pendiente | recibida_parcial | recibida_completa | cancelada
  add column if not exists received_at             date,                       -- Fecha de recepción
  add column if not exists received_quantity       integer,                    -- Cantidad recibida
  add column if not exists received_by             text,                       -- Recibido por (nombre/usuario)
  add column if not exists received_note           text,                       -- Nota de recepción
  add column if not exists received_invoice_number text,                       -- N.º de factura/comprobante
  add column if not exists received_cost           numeric(12,2),              -- Costo real
  add column if not exists received_supplier       text,                       -- Suplidor final
  add column if not exists received_attachment_url text,                       -- Path en bucket maintenance-docs
  add column if not exists reception_updated_at    timestamptz,                -- Última edición de la ficha de recepción
  add column if not exists reception_updated_by    text;                       -- Quién editó la ficha de recepción

-- Backfill coherente: lo que ya estaba marcado como recibido pasa a
-- "recibida_completa"; el resto queda "pendiente" (default).
update csl_piezas_poliza_lista
   set received_status = 'recibida_completa'
 where estado = 'recibida'
   and (received_status is null or received_status = 'pendiente');

notify pgrst, 'reload schema';

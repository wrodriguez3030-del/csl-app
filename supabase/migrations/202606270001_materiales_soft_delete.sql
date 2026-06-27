-- ============================================================================
-- Requisición de Materiales — eliminación lógica (soft delete) de requisiciones.
--
-- Aditivo y NO destructivo. Agrega columnas de borrado lógico a
-- material_requisitions para que "Eliminar" en Aprobaciones quite la
-- requisición de las listas activas conservando el historial/auditoría.
--
-- También deja documentado el estado 'devuelta' (la columna status es text
-- libre, no requiere cambio de tipo).
-- ============================================================================

alter table public.material_requisitions add column if not exists deleted_at     timestamptz;
alter table public.material_requisitions add column if not exists deleted_by     uuid;
alter table public.material_requisitions add column if not exists deleted_reason text;

-- Índice parcial: acelera el filtrado "solo activas" (deleted_at is null), que
-- es la consulta por defecto de Aprobaciones / Mis requisiciones / Consolidado.
create index if not exists material_req_active_idx
  on public.material_requisitions (business_id)
  where deleted_at is null;

notify pgrst, 'reload schema';

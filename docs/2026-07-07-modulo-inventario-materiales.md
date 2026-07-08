# Módulo: Inventario de materiales por sucursal — v0.17.0

Fecha: 2026-07-07 · Supabase: **solo local db-cls** (no Cloud)

## Qué es

Conteo físico e histórico de existencias de materiales por sucursal, dentro de
**Requisición de Materiales**. Reutiliza el catálogo maestro (`material_catalog`)
— no crea catálogo nuevo. Es independiente: **no** toca requisiciones, compras,
aprobaciones ni el catálogo.

## Menús nuevos

- **Inventario de materiales** (`req-mat-inventario`) — pantalla de captura.
- **Histórico de inventarios** (`req-mat-inventario-historico`) — lista + acciones.

Wiring en 6 puntos: `lib/types.ts` (TabId), `lib/menus.ts` (MENU_OPTIONS),
`components/sidebar.tsx` (EXTRA_GROUPS + iconos Boxes/History), `app/page.tsx`
(imports + switch), `components/header.tsx` (pageMeta), y los 2 componentes.

## Base de datos (`202607070001_material_inventories.sql`, aplicada a db-cls)

| Tabla | Rol |
|---|---|
| `material_inventories` | Cabecera: `business_id, branch, inventory_date, status (borrador\|finalizado), notes, created_by(_name), finalized_by(_name), finalized_at, deleted_at/by/reason` |
| `material_inventory_items` | Detalle: `inventory_id (cascade), material_id → material_catalog, *_snapshot, quantity numeric(12,2), unit, observation` |
| `material_inventory_audit_logs` | Auditoría: `action, old_values, new_values, reason, user_id` |

- Multi-tenant `business_id` + RLS por tenant (`current_business_id()` / `is_superadmin()`).
- Índice único parcial `(business_id, branch, inventory_date) WHERE status='borrador'`
  → un solo borrador vivo por sucursal+fecha (reanudar + anti-doble-clic).
- Único `(inventory_id, material_id)`. Soft delete. Snapshots de nombre/proveedor.

## Backend (`lib/server/materials.ts`)

`getInventoryDraft`, `saveInventory`, `getInventories`, `getInventory`,
`deleteInventory`, `restoreInventory`, `duplicateInventory`,
`correctInventoryItem`, `getInventoryAuditLogs`. Registrados en
`app/api/csl/_handlers.ts`. Mismo aislamiento que requisiciones: `bizId/scoped`,
`scopeByBranch`, `sucursalAllowedForTenant`. Service_role + filtros explícitos.

**Reglas:** finalizado = inmutable (solo corrección admin auditada). Autoguardado
reanuda el borrador de (sucursal, fecha). Cantidades con decimales.

## Frontend

- `components/req-mat-inventario-page.tsx` — captura: Sucursal/Fecha/Buscar,
  KPIs (Total/Contados/Sin contar/Cantidad total), lista por proveedor con
  "Cantidad en existencia" + Observación, autoguardado, Guardar borrador,
  Finalizar, Limpiar, PDF. Móvil: inputs grandes, `inputMode=decimal`.
- `components/req-mat-inventario-historico-page.tsx` — lista con columnas
  Fecha/Sucursal/Materiales/Estado/Creado por/Finalizado por/Fecha finalización
  + menú **Acciones** (Ver detalle, PDF, Duplicar, Editar[borrador],
  Corregir[admin], Eliminar, Ver historial de cambios). Filtros sucursal/estado/fechas.
- `lib/inventario-materiales-pdf.ts` — PDF con logo de empresa activa (HTML+print).
- Tipos en `lib/materials-client.ts`.

## Verificación

- **e2e** `scripts/_test-inventario-flow.js` (20/20) contra db-cls: NO-admin usa
  el módulo, catálogo reutilizado (58, sin duplicar), borrador+reanudar (1.5
  decimal), re-guardar sin duplicar, finalizar inmutable, histórico con nombres,
  RBAC (corrección/eliminación de finalizado rechazadas a NO-admin), business_id=CSL.
- **Navegador (Chrome)** como encargada NO-admin de Los Jardines: menús visibles,
  58 materiales agrupados, KPIs reactivos con decimales, Guardar borrador → toast,
  histórico con columnas correctas + snapshot de nombre.
- `tsc --noEmit` + `next build`: OK.

## Pendiente (acción del admin)

Asignar los 2 menús nuevos a las encargadas/compras en Configuración (o vía perfil
`csl_user_profiles.menus`). Candidatos: CARLOS, Enc. Jardines, Enc. Luisa RV,
Enc Villa Olga, "Requisición de materiales". Los admin/superadmin ya los ven.

# Módulo COMPRAS — v0.18.0

Fecha: 2026-07-08 · Supabase: **solo local db-cls** (no Cloud)

## Alcance

Grupo de menú **Compras** con 5 pantallas: Dashboard, Facturas de proveedores,
Pagos/gastos, Gastos menores, Pagos recurrentes. Reutiliza proveedores (texto,
`material_catalog.supplier_group`) y materiales — no duplica catálogos.

## Base de datos (`202607080001_purchases_module.sql`, aplicada a db-cls)

8 tablas, todas con `business_id` + RLS por tenant + soft delete +
`created_by/updated_by/deleted_at/by/reason`:

| Tabla | Rol |
|---|---|
| `purchase_invoices` | Facturas (proveedor, NCF, RNC, fechas, condición, subtotal/desc/ITBIS/total, paid/balance, estado, adjunto, `requisition_id`) |
| `purchase_invoice_items` | Detalle (FK `material_catalog` opcional, snapshots, costo/ITBIS/total) |
| `purchase_payments` | **Ledger único** de pagos de factura (balance = total − Σ pagos vivos) |
| `expenses` | Pagos/gastos generales (operativo/servicio/otro) |
| `petty_expenses` | Gastos menores (pendiente/aprobado/rechazado/pagado) |
| `recurring_payments` | Compromisos periódicos (frecuencia, próxima fecha, activo) |
| `recurring_payment_history` | Historial de pagos recurrentes (anti-duplicado por período) |
| `purchase_audit_logs` | Auditoría (entity, action, old/new, reason, user) |

Bucket privado de Storage **`purchase-docs`** (creado por la migración + self-heal
en el route de subida).

## Modelo contable (anti-doble-conteo)

- El balance de una factura sale **solo** de `purchase_payments`.
- "Pago de factura" del módulo Pagos/gastos → se enruta a `registerInvoicePayment`
  (crea `purchase_payments`), NO crea un `expenses`. Así el dinero vive en un solo
  lugar y el dashboard no lo cuenta doble.
- **Una factura NUNCA aumenta inventario.** La entrada real de existencias es la
  recepción de materiales de la requisición (módulo requisiciones), intacto.

## Backend

- `lib/server/purchases.ts` — CRUD de los 5 submódulos + dashboard + suppliers +
  URL firmada de adjuntos + `createInvoiceFromConsolidado`. Mismo aislamiento
  multi-tenant/sucursal que materiales (`scopeByBranch`, `sucursalAllowedForTenant`).
- RBAC: `lib/permissions.ts` (catálogo) + `hasPermission/requirePermission` en
  `lib/server/business-context.ts` (admin/superadmin bypassa). Permisos:
  `compras.ver/crear/editar/pagar/aprobar/anular/eliminar/exportar`.
- Subida: `app/api/purchases/documents/upload/route.ts` (multipart, bucket
  `purchase-docs`, self-heal). Handlers registrados en `app/api/csl/_handlers.ts`.

## Frontend

- `components/compras-dashboard-page.tsx` — KPIs + filtro mes/sucursal.
- `components/compras-facturas-page.tsx` — lista + filtros + Acciones + form
  (detalle + adjunto/foto) + registrar pago + detalle + "Desde requisición".
- `components/compras-pagos-page.tsx` — pagos/gastos generales.
- `components/compras-gastos-menores-page.tsx` — caja chica (aprobar/rechazar/pagar).
- `components/compras-recurrentes-page.tsx` — recurrentes + registrar pago + historial.
- `components/compras/attachment-input.tsx` — adjuntar archivo / **tomar foto** / ver.
- `lib/purchases-client.ts` (tipos + labels), `lib/purchases-export.ts` (PDF+Excel).
- RBAC en UI: `canPerm(user, "compras.*")`. Permisos asignables en
  Configuración › Usuarios (checkboxes nuevos) + rutas admin API.

## Wiring de menús (6 puntos)

`lib/types.ts` (TabId), `lib/menus.ts` (MENU_OPTIONS sección "Compras"),
`components/sidebar.tsx` (grupo + iconos), `app/page.tsx` (imports+switch),
`components/header.tsx` (pageMeta), + los 5 componentes.

## Verificación

- **e2e** `scripts/_test-compras-flow.js` (20/20 contra db-cls): factura+detalle,
  pago parcial→pagada, balance correcto, gasto, gasto menor (aprobar/pagar),
  recurrente + próxima fecha auto, filtros, integración requisición→factura,
  factura NO aumenta inventario, soft delete, RBAC negativo, business_id CSL.
- **Navegador (Chrome)** NO-admin con permisos: 5 menús, form con "Tomar foto",
  creación real de factura (toast + lista).
- `tsc --noEmit` + `next build`: OK.

## Pendiente (acción del admin)

Asignar los permisos `compras.*` (y opcionalmente los menús Compras) a las
personas de compras/administración en Configuración › Usuarios. Admin/superadmin
ya tienen acceso completo (bypass).

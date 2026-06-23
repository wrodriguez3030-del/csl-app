# Módulo Requisición de Materiales por Sucursal

Fecha: 2026-06-23 · Estado: implementado · Versión: v0.3.0

## Objetivo
Menú para que las encargadas de sucursal soliciten materiales (check + cantidad)
y compras/admin consolide por sucursal, apruebe/ajuste/rechace, compre y dé
seguimiento a la recepción. Multi-tenant (Cibao ≠ Depicenter), por sucursal.

## Arquitectura
- **DB** (`202606230001_materiales_requisicion.sql`): `material_catalog`,
  `material_requisitions`, `material_requisition_items`,
  `material_requisition_audit_logs`. Todas con `business_id`, RLS por tenant
  (`current_business_id()`/`is_superadmin()`), grants a service_role, índices.
  Catálogo CSL sembrado (BRAVO + PRICES MART). Aplicada a db-cls.
- **Backend** (`lib/server/materials.ts`, cableado en `app/api/csl/_handlers.ts`):
  aislamiento explícito por business_id + `scopeByBranch` (la encargada queda
  limitada a su sucursal vía `user_branch_permissions`). Acciones: catálogo
  (get/save/setActive), requisiciones (save/getMy/get/submit), consolidado,
  aprobación (approveItem/rejectItem/approveAllRequisition), compra
  (purchaseItem), recepción (receiveItem), dashboard. El estado de la
  requisición se deriva de sus ítems (`syncRequisitionStatus`).
- **Cliente**: tipos/helpers en `lib/materials-client.ts`, exportes en
  `lib/materials-export.ts` (Excel HTML→.xls, PDF HTML→print, agrupado por
  proveedor). 6 páginas `components/req-mat-*-page.tsx`. Menú en `lib/menus.ts`,
  `lib/types.ts` (TabId), `components/sidebar.tsx`, `app/page.tsx`.

## Flujo y estados
Requisición: borrador → enviada → en_revision → aprobada → comprada →
recibida_parcial / recibida_completa (o rechazada). Ítems igual a nivel línea.
Recepción: recibido < aprobado → parcial; ≥ → completa.

## Permisos / multi-tenant
Gating de menú por `csl_user_profiles.menus` (canAccessMenu). Encargada: solo su
sucursal (branchScope). Compras/Admin: todas las sucursales del tenant.
Superadmin respeta el business activo. business_id en toda lectura/escritura.

## Validación
Build + tsc verdes; migración + seed verificados en db-cls; insert real
(requisición + ítems + auditoría) probado con ROLLBACK. Flujo UI completo
(encargada → consolidado → aprobar → comprar → recibir → dashboard → export)
a validar en navegador.

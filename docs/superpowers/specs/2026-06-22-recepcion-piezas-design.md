# Recepción editable de piezas — Mantenimiento › Lista piezas póliza

Fecha: 2026-06-22 · Estado: aprobado · Versión objetivo: v0.2.31

## Problema

En `Mantenimiento › Inventario y piezas / Lista piezas póliza` se puede editar
una pieza solicitada, pero cuando la pieza llega no hay forma clara de registrar
la **recepción**: fecha de recepción, cantidad recibida, recibido por, estado,
nota, evidencia/factura, costo real ni suplidor final. Hoy solo existe un toggle
binario "marcar recibida" que pone la fecha de hoy y nada más.

## Objetivo

Permitir **registrar y editar** la recepción de una pieza, con auditoría de
cambios, badges de estado en el listado y adjunto de evidencia/factura, sin
romper el flujo binario actual ni mezclar datos entre Cibao y Depicenter.

## Decisiones de diseño

1. **Estado de recepción granular vs `estado` actual.** Se agrega columna
   `received_status` con 4 valores (`pendiente`, `recibida_parcial`,
   `recibida_completa`, `cancelada`). La columna `estado` (`pendiente|recibida`)
   se mantiene **sincronizada automáticamente** (`recibida_completa` →
   `estado=recibida`; el resto → `pendiente`) para no romper el toggle, los
   contadores del dashboard ni el PDF.
2. **Derivación por cantidad.** `received_status` se deriva de
   `received_quantity` vs `cantidad` (menor → parcial; igual o mayor →
   completa), salvo override manual a `cancelada`.
3. **Adjunto.** Bucket privado de Supabase Storage `maintenance-docs` (self-heal:
   se crea si falta), con signed URLs, igual que `hr-documents`. Se guarda
   `received_attachment_url` (path interno) + se sirve por URL firmada.

## Cambios

### DB — migración `202606220001_piezas_recepcion.sql` (aditiva, sin DELETE/DROP)
`alter table csl_piezas_poliza_lista add column if not exists`:
`received_status` (text default 'pendiente'), `received_at` (date),
`received_quantity` (integer), `received_by` (text), `received_note` (text),
`received_invoice_number` (text), `received_cost` (numeric(12,2)),
`received_supplier` (text), `received_attachment_url` (text),
`reception_updated_at` (timestamptz), `reception_updated_by` (text).
Backfill: filas con `estado='recibida'` → `received_status='recibida_completa'`.
Cierra con `notify pgrst, 'reload schema'`.

### Storage
`POST /api/maintenance/documents/upload` (multipart, Bearer auth, máx 10 MB,
PDF/JPG/PNG/DOC/XLS). Path `{business_id}/piezas/{pieza_id}/{fecha}_{ts}_{archivo}`.
Crea el bucket `maintenance-docs` si no existe. Devuelve `{ path }`.
Lectura: acción `getPiezaReceptionSignedUrl` (signed URL 2 min, scoped a tenant).

### Backend `app/api/csl/_handlers.ts`
- Nueva acción **`savePiezaPolizaRecepcion`** (añadida a
  `MAINTENANCE_MANUAL_ACTIONS` → pasa por el maintenance-guard). Lee la fila
  actual, calcula `received_status`, sincroniza `estado`/`fecha_recibida`,
  estampa `reception_updated_by`/`reception_updated_at`.
- Auditoría con `recordMaintenanceAudit()`: `op:"update"`,
  `changeSource:"part_received"` (primera vez) o `"part_reception_updated"`
  (ediciones), `details` con valores antes/después.
- `markPiezaPolizaRecibida`/`Pendiente` siguen existiendo y ahora también
  ajustan `received_status` coherente.

### Tipos y transform
`PiezaPolizaLista` (lib/types.ts) gana campos `Received*`/`Reception*`.
`csl-transforms.ts` mapea las columnas nuevas snake_case → camelCase.

### UI `components/piezas-poliza-page.tsx`
- Sección nueva **"Recepción de pieza"** en el modal de edición: estado
  (dropdown, default auto), fecha de recepción, cantidad recibida, recibido por
  (default usuario sesión), nota, costo real, # factura, suplidor final, adjunto
  (input file → sube al bucket). Botón **Registrar recepción** / **Editar
  recepción** según `received_at`.
- `ItemRow`: badge de estado con colores (Pendiente gris/amarillo, Parcial
  naranja, Completa verde, Cancelada rojo) + fecha y cantidad recibida.
- Filtro de estado pasa a 5 opciones: Todas / Pendiente / Parcial / Completa /
  Cancelada.

### Permisos / multi-tenant
Solo técnico/admin (garantizado por `MAINTENANCE_MANUAL_ACTIONS` +
maintenance-guard). `business_id` siempre respetado.

## Validación
1. Editar la pieza "FUENTE DE PODER" → registrar fecha + cantidad recibida →
   guardar → aparece recibida.
2. Recargar → la fecha de recepción permanece.
3. Editar ficha de recepción (nota/cantidad) → guarda cambios.
4. Confirmar fila en `csl_maintenance_audit` (part_received / part_reception_updated).
5. Confirmar que Cibao no mezcla datos con Depicenter.

## Entrega
`pnpm lint` · `pnpm build` · commit `feat(maintenance): agregar recepcion
editable de piezas` · push Gitea ARB · `vercel --prod --yes`.

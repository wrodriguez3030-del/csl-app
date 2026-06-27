# Consentimiento Depilación Láser (v0.9.0)

**Fecha:** 2026-06-27
**Objetivo:** Agregar un nuevo tipo de consentimiento "Consentimiento Depilación Láser"
(procedimiento: **eliminación del vello no deseado**) en el módulo *Clientes y
Consentimientos*, reutilizando por completo la infraestructura existente.

## Ubicación en el menú

Orden final del grupo *Clientes y Consentimientos*:

1. Clientes
2. Ficha Dermatología
3. Consentimiento Masajes
4. Consentimiento Peeling
5. Eliminación Tatuajes y Cejas
6. **Consentimiento Depilación Láser** ← nuevo (ícono ⚡, badge de pendientes)
7. Historial Fichas y Consentimientos

## Decisiones de diseño

- **Clon del tipo *peeling/tatuajes*.** Es un consentimiento "lite": el cliente solo
  ve el documento legal en lectura, acepta políticas y firma; los campos clínicos los
  completa el especialista. No se duplicó la lógica: se reutilizó el flujo público
  genérico (`/formulario-publico/[token]`), el token de un solo uso / 12 h, el envío
  por WhatsApp (`wa.me/?text=`, sin número → el cliente elige contacto; el SO decide
  app móvil vs WhatsApp Web), la firma (`SignaturePad`) y el historial unificado.
- **Tabla nueva** `csl_consent_depilacion_laser`, multi-tenant por `business_id`
  (default CSL, RLS `tenant_*`), clon estructural de `csl_consent_peeling`. El token y
  su expiración/uso viven en `csl_public_form_links` (igual que todos los demás tipos).
- **Texto del consentimiento:** redactado profesionalmente con todas las secciones
  pedidas (Descripción, Confirmación del cliente, Instrucciones previas, Cuidados
  posteriores, Consideraciones generales, Beneficios, Probabilidad de éxito, Riesgos,
  Contraindicaciones, Políticas, Protección de datos, Autorización). La **Autorización**
  y la casilla **"ACEPTO LAS POLÍTICAS DE LA EMPRESA"** usan el texto literal solicitado.
  > ⚠️ El PDF fuente adjunto no estaba disponible en el contexto de generación; el cuerpo
  > legal se compuso a partir de la lista de secciones provista + el estilo de los
  > consentimientos existentes + contenido estándar de depilación láser. El texto es
  > fácilmente reemplazable: vive en `components/public-depilacion-laser-consent-form.tsx`
  > (duplicado en `buildPrintHtml` para PDF y en el JSX para web). **Revisar/validar
  > legalmente** y, si se requiere literalidad con el PDF, pegar el texto allí.

## Archivos

**Nuevos**
- `components/public-depilacion-laser-consent-form.tsx` — formulario público + PDF.
- `supabase/migrations/202606280001_csl_consent_depilacion_laser.sql` — tabla nueva.
- `supabase/migrations/202606280002_public_form_links_depilacion_laser.sql` — extiende el
  CHECK de `form_type`.

**Modificados**
- `lib/menus.ts`, `lib/types.ts`, `app/page.tsx`, `components/sidebar.tsx` — menú/rutas/ícono/badge.
- `components/consentimientos-page.tsx` — `ConsentKind`, `KIND_CONFIG`, `DEPILACION_LASER_TEXT`, `publicFormType`.
- `components/link-generator-dialog.tsx` — `FormType` + servicios de depilación láser.
- `components/public-form-page.tsx`, `app/formulario-publico/[token]/page.tsx` — render + metadata.
- `lib/server/public-form-links.ts` — `FormType` + label.
- `lib/server/csl-transforms.ts` — `consentToDb` (kind `depilacion-laser`) + `fromDb`.
- `lib/server/csl-crud.ts` — `ENTITY_TABLES` + `getAllData`.
- `app/api/csl/_handlers.ts` — handlers get/save/delete/completo + `getClienteHistorial`.
- `app/api/public-form-links/route.ts`, `app/api/public-form-links/[token]/submit/route.ts`.
- `components/reportes-firmados-page.tsx` — tipo en el historial (filtro, badge, ver/imprimir/PDF/eliminar).

## Base de datos (Supabase self-hosted db-cls)

Migraciones aplicadas en `db-cls` (NO Supabase Cloud) vía Tailscale + `docker exec psql`:
- `csl_consent_depilacion_laser` creada (RLS + grants + índices + FKs + `business_id`).
- CHECK `csl_public_form_links_form_type_check` recreado incluyendo
  `consentimiento_depilacion_laser`.
- `notify pgrst, 'reload schema'` ejecutado; tabla verificada vía PostgREST (HTTP 200).

## Verificación

- `pnpm lint` (tsc --noEmit) → OK. `pnpm build` (next build) → OK.
- Round-trip INSERT→READ→DELETE en `csl_consent_depilacion_laser`: persiste `estado`,
  `firma_cliente`, `acepta_politicas`, `business_id` = CSL (sin mezcla con Depicenter).
  La fila de prueba se eliminó.

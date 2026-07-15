# CF PARA IMPRIMIR — Módulo profesional de Certificados de Regalo

**Fecha:** 2026-07-15 · **Versión:** 0.48.0 · **Estado:** en desarrollo (build/tests/typecheck OK; falta validación autenticada en la app y deploy a producción).

## 1. Resumen

Se transformó el módulo existente **CF PARA IMPRIMIR** (menú `cliente-certificados-imprimir`)
de un simple overlay de impresión sobre certificado físico a un módulo completo
de **creación, personalización, previsualización, emisión, impresión, descarga,
consulta, reimpresión, canje y anulación** de certificados de regalo, con tres
diseños profesionales, máquina de estados, RBAC, auditoría y multi-tenant.

- **No se creó** ningún menú nuevo ni se duplicó el existente. El id de menú y la
  ruta se conservan; solo cambió el encabezado visible a **"CF PARA IMPRIMIR"**.
- **Compatibilidad hacia atrás:** el flujo histórico (impresión sobre certificado
  físico pre-impreso, con calibración) se conserva íntegro en la pestaña
  **"Pre-impreso (físico)"**. Los certificados anteriores siguen disponibles.

## 2. Ruta y componentes

- **Menú/ruta:** `cliente-certificados-imprimir` (sin cambios) → `components/certificados-regalo-impresion-page.tsx`.
- **Encabezado:** "CF PARA IMPRIMIR" · subtítulo "Creación, personalización e impresión de certificados de regalo".

### Componentes nuevos (`components/cf-imprimir/`)
| Archivo | Rol |
|---|---|
| `use-gift-certificates.ts` | Hook de datos: todas las llamadas al backend (`giftCert*`) y tipos (`GiftCertRecord`). |
| `certificado-preview.tsx` | Previsualización (SVG inline + `@font-face` global). Mismo SVG que se exporta. |
| `gift-cert-editor.tsx` | Editor: formulario + preview en vivo + selector de 3 diseños + zoom + botones de acción gateados por permiso/estado. |
| `gift-cert-list.tsx` | Listado con filtros (búsqueda/estado/sucursal), paginación, acciones por fila e historial. |
| `legacy-preimpreso.tsx` | Modo histórico "Pre-impreso (físico)" (overlay + calibración), conservado. |

### Motor de render (`lib/certificados/`) — fuente única "lo que ves es lo que sale"
| Archivo | Rol |
|---|---|
| `cert-layout.ts` | PURO/isomórfico: auto-fit por conteo de caracteres, fecha en español, wrapping, pie, etiquetas exactas, validación. |
| `cert-state.ts` | PURO/isomórfico: máquina de estados (transiciones, estado efectivo/vencido). Usada por backend y UI. |
| `cert-svg.ts` | Render SVG isomórfico de los 3 diseños (moderno/minimalista/premium). |
| `cert-export.ts` | Solo navegador: QR local (`qrcode`), raster PNG/JPG, PDF (`pdf-lib`), impresión vector. |

### Reutilizado (sin duplicar)
`ENTITY_TABLES`, `fromDb`, `hasPermission/requirePermission`, `PERMISSION_OPTIONS`,
`db.sucursales`, fuentes `public/fonts/Montserrat.ttf` + `Allura-Regular.ttf`,
logo `public/cibao-spa-laser-logo.jpeg`, `usePagination`/`DataPagination`,
`apiJsonp`, `getSupabaseAdmin`, `businessContext`.

## 3. Campos del certificado

Obligatorios: **Otorgado a, Cortesía de, Válido para, Válido hasta, Sucursal de
entrega**. Opcionales: teléfono, correo, nota interna. Más: diseño/plantilla,
código, estado, usuario creador, fechas.

### Etiquetas EXACTAS (impresas)
`OTORGADO A:` · `CORTESÍA DE:` · `VÁLIDO PARA:` · `VÁLIDO HASTA:` · `SUCURSAL DE ENTREGA:`
> La etiqueta de servicio es **"VÁLIDO PARA:"** — nunca "VÁLIDO POR:".

Tipografía **Montserrat** (Medium etiquetas, SemiBold valores), título "Certificado
de Regalo" en **Allura** (manuscrita). Sucursal en turquesa corporativo `#18AEB8`.
Auto-fit por longitud (§9 del pedido) con wrapping a 2 líneas solo en "Válido para"
y "Sucursal de entrega". Fecha en español y mayúsculas (`14 DE AGOSTO DE 2026`).
Pie: teléfono · dirección · Instagram `@cibaospalaser` · Facebook `@cibaospalaser`.

## 4. Estados y transiciones

`Borrador → Emitido → Entregado → Canjeado`, más `Vencido` (calculado) y `Anulado`.

- **Borrador:** editable; no válido aún. **Emitido:** oficial; código bloqueado.
- **Entregado:** guarda usuario/fecha. **Canjeado:** terminal; guarda usuario/fecha/sucursal.
- **Vencido:** calculado por fecha (no se persiste solo); no canjeable.
- **Anulado:** terminal; requiere motivo; guarda usuario/fecha.

Reglas duras (revalidadas en **servidor**): no doble canje; no canjear vencido/
anulado/borrador; entregar solo desde Emitido; editar solo borradores; anular
bloqueado en terminales. Ver `lib/certificados/cert-state.ts`.

## 5. Código único

Server-side vía secuencia + función SQL `public.csl_next_gift_cert_code()` →
formato `CSL-REG-2026-000001`. Unicidad garantizada por el PK `codigo`. No editable
tras emitir. Fallback en app si el RPC fallara.

## 6. Diseños (plantillas)

Un **solo** componente parametrizable (`cert-svg.ts`); se guarda solo el
`template_id`. Diseños: `moderno` (cinta turquesa), `minimalista` (líneas limpias),
`premium` (marfil + detalles dorados). Mismos datos y servicios en los tres.

## 7. Base de datos

Se **amplió** la tabla existente `public.csl_certificados_regalo` (PK `codigo`),
de forma aditiva. Migración: `supabase/migrations/202607150001_gift_certificates_module.sql`
(aplicada a **db-cls** el 2026-07-15).

- Columnas nuevas: `business_id`, `fecha_vencimiento`, `template_id`, `telefono`,
  `correo`, `nota_interna`, `sucursal_direccion`, `sucursal_telefono`, `creado_por`,
  `entregado_por/_en`, `canjeado_por/_sucursal`, `motivo_anulacion`, `anulado_por/_en`.
  (`fecha` = emisión; `valido_por` = "Válido para"; `canjeado_en`/`estado`/`notas_estado` ya existían.)
- Índices: business_id, fecha_vencimiento (+ los previos estado/sucursal/fecha/tipo).
- Objetos nuevos: secuencia `csl_gift_cert_seq` + función `csl_next_gift_cert_code()`;
  tabla de auditoría `csl_certificados_regalo_audit` (RLS habilitada).
- **Snapshot de sucursal:** al guardar se copia la dirección oficial de la sucursal,
  para conservar el histórico si la sucursal cambia luego.

## 8. Backend (handlers en `app/api/csl/_handlers.ts`)

`giftCertList`, `giftCertGet`, `giftCertAudit`, `giftCertSave` (crea/edita borrador,
genera código, snapshot, valida), `giftCertEmit`, `giftCertTransition`
(entregar/canjear/anular), `giftCertDuplicate`, `giftCertLogExport`.
Cada uno: `requirePermission(...)`, aislamiento por `business_id` (nunca cross-tenant),
máquina de estados revalidada en servidor, auditoría (`recordGiftAudit`).
Los handlers legacy (`saveCertificadoRegalo`, etc.) quedan intactos.

## 9. Permisos (RBAC — `lib/permissions.ts`, sección "Certificados de Regalo")

`gift_certificates.view`, `.create`, `.edit`, `.emit`, `.deliver`, `.redeem`,
`.void`, `.audit.view`. Admin/superadmin bypassa. Gating en UI **y** servidor.

## 10. Impresión / exportación

- **Preview = export:** un solo SVG. Preview usa fuentes por URL; export embebe
  fuentes + logo + QR en base64 (SVG autocontenido → raster sin contaminar el canvas).
- **Imprimir:** ventana limpia, horizontal, vector, una sola página (`@page landscape`).
- **PDF:** `pdf-lib`, una página horizontal con el raster de alta resolución (×3).
- **PNG/JPG:** raster del SVG a ×3.
- **QR:** generado **localmente** con `qrcode` (sin servicios externos).

## 11. Pruebas

`scripts/test-gift-certificates.mjs` (`pnpm test:gift`): 22 casos — auto-fit, fecha
español, normalización (acentos/Ñ), validación, vigencia, wrapping, máquina de
estados (no doble canje/vencido/anulado/borrador), estado efectivo, SVG (etiquetas
exactas + socials + sin "VÁLIDO POR"), y menú no duplicado. `tsc --noEmit` y
`next build` en verde. Verificación visual de los 3 diseños + auto-fit realizada
(headless Chrome).

## 12. Pendiente / riesgos

- **Validación autenticada e2e en la app** (crear→emitir→imprimir→descargar→canjear
  por rol) — no ejecutada por falta de credenciales de sesión.
- **Deploy a producción** (`vercel --prod --yes`) — no realizado; a decisión del usuario.
- **Teléfono de sucursal:** el catálogo `csl_sucursales` no tiene teléfono; el pie lo
  omite cuando no existe (no se inventa). Si se desea, agregar el campo al catálogo.
- Filas legacy sin `business_id` se muestran a todos los tenants (compat); las nuevas
  siempre llevan `business_id`.

## 13. Rollback

- **Código:** revertir el commit (feature aislada; el menú/handlers legacy no se tocaron).
- **BD (opcional, no requerido — la migración es aditiva y no rompe nada previo):**
  ```sql
  drop table if exists public.csl_certificados_regalo_audit;
  drop function if exists public.csl_next_gift_cert_code();
  drop sequence if exists public.csl_gift_cert_seq;
  -- Las columnas nuevas pueden conservarse sin efecto; si se quisieran quitar:
  -- alter table public.csl_certificados_regalo drop column if exists <col> ...;
  ```
  Las columnas nuevas son nullable/con default y no afectan al flujo anterior, por
  lo que lo recomendado es **conservarlas** aunque se revierta el código.

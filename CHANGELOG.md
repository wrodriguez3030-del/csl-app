# Changelog — csl-app (Mantenimiento CSL / DEPICENTER)

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el proyecto usa [Versionado Semántico (SemVer)](https://semver.org/lang/es/).

> **Regla de oro:** ningún cambio se sube a `main` sin una entrada aquí y un
> bump de versión. Ver [`CONTRIBUTING.md`](./CONTRIBUTING.md) para el paso a paso.

## [Unreleased]

### Added
### Changed
### Fixed
### Removed
### Security

---

## [0.13.0] — 2026-07-03

### Fixed
- **El kiosko QR ignoraba la configuración de modalidades de RR.HH.**
  `/api/public/punch` no leía `hr_punch_modality_config` (pendiente documentado
  del epic Ponche): apagar el QR para un empleado/sucursal en RR.HH. →
  Configuración de modalidades solo afectaba al ponche móvil. Ahora el kiosko
  aplica la config con la misma precedencia (empleado > sucursal > global):
  - `allow_qr=false` o `allow_kiosk=false` → rechaza con `modality_off` y
    mensaje claro (no registra la marca).
  - `require_location=false` → tolera falta de GPS aunque haya geocerca.
  - `allow_remote_punch=true` → permite ponchar fuera de la geocerca
    (la distancia se sigue registrando).
  - El insert ahora estampa `modality="qr"` (antes quedaba null; el dashboard
    de ponche ya segmenta por modalidad).
  Probado e2e contra server local + db-cls
  (`scripts/_test-kiosk-modality.js`, 5/5 PASS con dispositivo/QR/config
  sintéticos y auto-limpieza). Config global actual (allow_qr=t en ambos
  tenants) → cero cambio de comportamiento hasta que se configure lo contrario.

---

## [0.12.1] — 2026-07-03

### Added
- **Prueba e2e del flujo completo de Requisición de Materiales**
  (`scripts/_test-reqmat-full-flow.js`): crear (2 ítems) → listar → aprobar
  con ajuste de cantidad → rechazar con motivo → comprar (costo + suplidor) →
  recibir completo → estados finales → consolidado → dashboard. Corre contra
  el server local + db-cls con un admin desechable y limpia todo al final.
  11/11 PASS — cierra el pendiente "validar flujo de compras" del módulo
  (v0.3.0). Sin cambios de producto.

---

## [0.12.0] — 2026-07-02

### Added
- **Permisos granulares por usuario (`csl_user_profiles.permissions text[]`).**
  Migración aditiva `202607020001_user_profile_permissions.sql` (aplicada a
  db-cls). Permiten habilitar UNA acción concreta a un usuario normal sin
  elevarlo a admin. Independientes de `menus` (visibilidad) y de
  `is_admin`/`is_superadmin` (roles). Fluyen por `loadBusinessContext`
  (backend, `BusinessContext.permissions`) y por la sesión del navegador
  (`SystemUser.permissions`; el resync de v0.9.2 los mantiene al día sin
  re-login).
- **Primer permiso: `material_requisitions.delete`** otorgado a CARLOS
  (Carlos Arias, compras). En Requisición de Materiales → Aprobaciones el
  menú Acciones → Eliminar ya no le sale deshabilitado: abre el modal
  "Eliminar requisición" (sucursal, fecha, estado, materiales, motivo
  opcional) y hace el soft delete existente (`deleted_at`/`deleted_by`/
  `deleted_reason` + `updated_at`, `deleted_by` = usuario real, auditado en
  `material_requisition_audit_logs`).

### Fixed
- **Eliminar salía deshabilitado para usuarios con rol de compras.** El gate
  (frontend `canDelete` y backend `deleteRequisition`) solo contemplaba
  admin/superadmin o al creador de la requisición. Ahora también acepta el
  permiso granular. La validación real sigue en el backend
  (`canDeleteRequisitions()` en `lib/server/materials.ts`) y todo queda
  scopeado al `business_id` del usuario (sin mezclar CSL con Depicenter).
  Probado end-to-end contra el server local + db-cls
  (`scripts/_test-reqmat-delete-perm.js`, 7/7 PASS: elimina con permiso,
  campos de soft delete correctos, usuario normal sin permiso no elimina,
  cross-tenant bloqueado).

---

## [0.11.0] — 2026-07-02

### Fixed
- **Causa raíz de la contaminación cross-tenant recurrente del import de pulsos.**
  El Excel semanal (equipos + AgendaPro) trae sucursales de CSL y DEPICENTER
  mezcladas, pero `savePulseReading`, `saveOperatorShots` y `saveSesionesBatch`
  estampaban TODAS las filas con el `business_id` ACTIVO de la UI. Resultado:
  cada import con CSL activo re-creaba filas DEPICENTER bajo CSL, que la guardia
  `sucursalAllowedForTenant` luego ocultaba a ambos tenants ("Depicenter no trae
  disparos"). Ya se había limpiado data dos veces (06-13, 06-14) y el import la
  volvía a contaminar.
  - Nuevo `tenantSlugForSucursal()` en `lib/normalize-pulse.ts` (inverso de
    `sucursalesForTenant`).
  - Nuevo `businessIdForRowSucursal()` en `_handlers.ts`: el `business_id` de
    cada fila se deriva de SU sucursal. Superadmin → la fila se rutea al tenant
    dueño automáticamente (el import semanal "simplemente funciona" sin cambiar
    de negocio activo). Usuario normal → la fila cross-tenant se rechaza
    (`savePulseReading` da error claro; los guardados masivos la omiten y
    reportan `skipped`).
  - `saveSesionesBatch`: la dedupe por `import_hash` contra la DB ahora agrupa
    por tenant (las filas de un mismo lote pueden ir a más de un `business_id`;
    el índice `csl_sesiones_cliente_import_hash_uidx` es por
    `(business_id, import_hash)`).
  - Cuadre semanal (UI): toast informativo con el conteo de filas omitidas por
    pertenecer a otro negocio.
  - Data: quedan 6 filas basura en `csl_pulse_readings` (Depicenter bajo CSL,
    semanas 06-01 y 06-08, lecturas incoherentes; las canónicas ya existen bajo
    Depicenter). Invisibles para ambos tenants; su borrado requiere
    confirmación explícita del usuario (política de datos cross-tenant).

---

## [0.10.0] — 2026-06-30

### Added
- **Campo "Número de fuente" en el maestro de Equipos (Mantenimiento → Equipos).**
  Nueva columna `source_number` en `csl_equipos` (migración aditiva
  `202606300001_equipos_source_number.sql`, aplicada a db-cls). Guarda el número
  de la fuente de poder del equipo (texto libre: "Fuente 1", "F-01", "PS-001").
  - Modal *Editar equipo*: input "Número de fuente" debajo de "Número".
  - Lista de equipos: nueva columna "Núm. fuente" (muestra "—" si vacío) con orden.
  - Guardado real vía `saveEquipo` / `updateEquipoCampos` (mapeo
    `sourceNumber`↔`source_number`); el CRUD estampa `updated_at` / `updated_by` /
    `change_source` y devuelve el registro con `.select()`. Si la columna falta,
    error real (no se tolera silenciosamente).
  - Vista de equipo (`RecordViewDialog`) muestra el campo automáticamente.

### Changed
- **El "No. fuente de poder" de los reportes se prellena desde el equipo.**
  Al elegir un equipo (o cambiar de sucursal) en *Nuevo reporte*, `PowerSourceNumber`
  toma el `SourceNumber` del maestro de equipos; el técnico puede editarlo si
  difiere en la visita.
- **PDF de reporte (`reporte-pdf.tsx`): sección N/S ahora muestra datos reales.**
  La fila antes vacía ahora rinde `NO. FUENTE` (`PowerSourceNumber`),
  `N/S FUENTE` (`PowerSourceSerial`) y `N/S FIBRA` (`FiberSerial`).

---

## [0.9.3] — 2026-06-29

### Fixed
- **Header mostraba "Dashboard Ejecutivo" sobre las pantallas de Requisición de Materiales.**
  `components/header.tsx` no tenía entradas en `pageMeta` para los 6 tabs `req-mat-*`, así que
  caía al fallback `panel` ("Dashboard Ejecutivo / Resumen general de mantenimiento") aunque el
  contenido fuera, p. ej., "Mis requisiciones". Agregadas las 6 entradas (título, descripción,
  eyebrow "Requisición de materiales"). El routing del contenido (`app/page.tsx switch`) ya era
  correcto; solo el encabezado estaba desacoplado del tab activo.

---

## [0.9.2] — 2026-06-29

### Fixed
- **Menú/permisos congelados tras cambiar permisos de un usuario (CARLOS).** El sidebar lee
  el usuario desde un snapshot en `localStorage` que solo se escribía al hacer login. Cuando un
  admin cambiaba los menús de un usuario en `csl_user_profiles`, su sesión activa seguía con los
  permisos viejos (solo "Nueva requisición" visible, p. ej.) hasta un logout+login manual.
  Ahora `app/page.tsx → sync()` re-sincroniza la sesión desde `csl_user_profiles` (fuente de
  verdad) en cada carga vía nuevo `refreshSessionUser()` en `lib/security.ts`; el botón
  **Actualizar** también refresca menús/permisos, no solo los datos. Cambio reflejado sin
  necesidad de cerrar sesión. Solo reescribe el snapshot cuando algo cambió (evita loops).
- **Superadmin sin menús explícitos quedaba sin sidebar.** `userFromProfile` solo daba acceso
  total a `isAdmin`; ahora `isAdmin || isSuperadmin` recibe `ALL_MENU_IDS`.

### Changed
- **Encargadas de Requisición de Materiales: sucursal + seguimiento.** Las 3 encargadas
  (Villa Olga, Los Jardines, Rafael Vidal) quedaron restringidas a su sucursal en
  `user_branch_permissions` y con el menú `req-mat-mis` para dar seguimiento a sus requisiciones
  (antes sin sucursal veían todas — hueco de aislamiento; sin `req-mat-mis` no daban seguimiento).

---

## [0.9.1] — 2026-06-27

### Changed
- **Consentimiento Depilación Láser: texto legal reemplazado por el contenido LITERAL del
  PDF oficial** "PROCEDIMIENTO: ELIMINACIÓN DEL VELLO NO DESEADO" (Descripción, Confirmación
  del cliente, Instrucciones previas, Cuidados posteriores, Consideraciones generales,
  Beneficios, Probabilidad de éxito, Riesgos/complicaciones, Contraindicaciones,
  Declaraciones finales, Políticas, Protección de datos, Autorización y aceptación de
  políticas). Se corrigieron solo erratas evidentes del original ("Iibremente"→"libremente",
  "se Allan aplicado"→"se hayan aplicado", "La La depilación"→"La depilación"). Aplica tanto
  al documento web como al PDF descargable.

---

## [0.9.0] — 2026-06-27

### Added
- **Clientes y Consentimientos › nuevo "Consentimiento Depilación Láser"** (eliminación
  del vello no deseado). Se agrega como cuarto tipo de consentimiento, ubicado en el
  menú lateral **justo debajo de "Eliminación Tatuajes y Cejas"** y encima de
  "Historial Fichas y Consentimientos". Reutiliza por completo la infraestructura
  existente de consentimientos (mismo flujo, permisos, link público de un solo uso /
  12 h, WhatsApp, firma del cliente, PDF, historial), clonando el tipo *peeling/tatuajes*:
  - **Formulario público** `public-depilacion-laser-consent-form.tsx`: datos del cliente
    en modo lectura, documento legal completo por secciones (Descripción, Confirmación,
    Instrucciones previas, Cuidados posteriores, Consideraciones generales, Beneficios,
    Probabilidad de éxito, Riesgos, Contraindicaciones, Políticas, Protección de datos y
    Autorización con el texto oficial), casilla obligatoria **"ACEPTO LAS POLÍTICAS DE LA
    EMPRESA"**, firma y envío. El PDF lleva el encabezado *CONSENTIMIENTO INFORMADO /
    PROCEDIMIENTO: ELIMINACIÓN DEL VELLO NO DESEADO* con logo y nombre de la empresa activa.
  - **Tabla nueva** `csl_consent_depilacion_laser` (clon multi-tenant de
    `csl_consent_peeling`, RLS por `business_id`) y nuevo valor de `form_type`
    `consentimiento_depilacion_laser` en el CHECK de `csl_public_form_links`.
  - Wiring de menú (`menus.ts`, `sidebar.tsx` con ícono ⚡ y badge de pendientes,
    `app/page.tsx`, `types.ts`), handlers CRUD (`getConsentDepilacionLaser`,
    `saveConsentDepilacionLaser`, `deleteConsentDepilacionLaser`, `…Completo`),
    transformaciones (`consentToDb`/`fromDb`), flujo público (`public-form-page`,
    `formulario-publico/[token]`, submit route), generador de link y **Historial Fichas
    y Consentimientos** (nuevo tipo filtrable, badge violeta, ver/imprimir/PDF/eliminar).

---

## [0.8.0] — 2026-06-27

### Added
- **Requisición de materiales › Aprobaciones: menú "Acciones" por requisición + eliminación lógica.**
  Cada fila reemplaza el botón único «Gestionar» por un menú **Acciones** (⋮) con:
  Ver detalle, Gestionar, Aprobar todo, Rechazar (con motivo), Devolver /
  corrección (con motivo, nuevo estado `devuelta`), Reenviar (estados rechazada/
  devuelta), Imprimir / PDF (de la requisición), Cambiar estado (solo admin/
  superadmin) y **Eliminar** (en rojo). Las acciones se ocultan/deshabilitan
  según estado y permiso.
- **Eliminación lógica (soft delete) de requisiciones.** Nuevas columnas
  `deleted_at` / `deleted_by` / `deleted_reason` en `material_requisitions`
  (migración `202606270001_materiales_soft_delete.sql`, aplicada a db-cls). Al
  eliminar, la requisición sale de Aprobaciones, Mis requisiciones, Consolidado
  y totales/Dashboard, conservando historial y auditoría. Modal de confirmación
  con sucursal/estado/fecha/#materiales + motivo opcional; mensaje «Requisición
  eliminada correctamente.». Permisos: admin/superadmin eliminan cualquier
  estado (aviso reforzado si ya está aprobada/en proceso); el creador solo si la
  requisición aún no entró en compra; sin permiso, opción deshabilitada con
  tooltip. Filtro **«Eliminadas»** y acción **Restaurar** solo para admin/
  superadmin. Todo scopeado por `business_id` activo (no mezcla CSL/Depicenter).
- Nuevas acciones de API: `deleteRequisition`, `restoreRequisition`,
  `rejectRequisition`, `returnRequisition`, `setRequisitionStatus`.

---

## [0.7.1] — 2026-06-26

### Fixed
- **Requisición de materiales › Nueva requisición: la cantidad ya no sale con `1` por defecto.**
  Todos los materiales aparecían con cantidad `1` aunque estuvieran desmarcados,
  y la encargada no podía dejar el campo en blanco para escribir el monto real.
  Causa raíz: el default de cada fila era `qty: 1` (`req-mat-nueva-page.tsx`) y el
  `onChange` forzaba `Math.max(1, Number(value) || 1)`, mientras el backend
  (`lib/server/materials.ts`) convertía la cantidad a `Math.max(1, … || 1)`.
  Ahora: la cantidad inicia **vacía** y el campo se habilita solo al marcar el
  check (con foco automático); al desmarcar se limpia; se aceptan números `> 0`
  con decimales (`step="any"`); si se marca un material sin cantidad se muestra
  la validación «Indica la cantidad solicitada.»; solo se envían materiales
  marcados con cantidad real y el backend descarta cualquier línea con cantidad
  vacía o `0` (sin forzar `1`). El consolidado refleja la cantidad real.

---

## [0.7.0] — 2026-06-25

### Fixed
- **Auditoría / IA: editar la operadora ahora guarda y se respeta al recargar.**
  La operadora mostrada se resuelve desde el catálogo oficial de equipos
  (`operadora-oficial.ts`), por lo que el campo `operadora` de la lectura solo
  alimentaba la advertencia "⚠ Excel: …" y **editar nunca cambiaba el valor**.
  Causa raíz: el display deriva del catálogo, no del valor editado, y no existía
  ningún campo de corrección manual.

### Added
- **Corrección manual de operadora con auditoría por fila** en
  `csl_pulse_readings`: columnas `operadora_corregida`, `operadora_corregida_por`,
  `operadora_corregida_en`, `operadora_correccion_motivo`
  (migración `202606250001_pulse_operadora_override.sql`, aplicada en db-cls).
  El editor de Auditoría/IA guarda la operadora como corrección manual; se
  preserva `operadora` (procedencia Excel) y se registra quién/cuándo/por qué
  (+ log best-effort en `hr_audit_logs`, acción `pulse_audit_operator_updated`).

### Changed
- **Nueva prioridad del resolver de operadora** (Auditoría/IA y Lecturas):
  `corrección manual > oficial del catálogo > Excel/lectura > Sin asignar`.
  Con corrección manual no se muestra la advertencia y aparece un indicador
  `✓ corregido`. La operadora corregida también manda en el match con AgendaPro
  para `Disp. Operador`. Aislamiento multi-tenant intacto (override por fila,
  filtrado por `business_id` activo).

---

## [0.6.1] — 2026-06-24

### Changed
- **Reutilizar el `normalizeOperadora` canónico de `lib/normalize-pulse.ts`** en
  el editor de equipos (cliente + backend) en vez de un duplicado en
  `normalize-fields.ts`. `normalize-pulse` es la fuente única ya usada por el
  resolver oficial (`operadora-oficial.ts`), PulseControl y los reportes
  (cubre KATHERINE→KATHERIN, EMELY→EMELI, RIQUELMI→ROQUELMI, YESICA→YESSICA,
  SAOMY→SAHOMY). Evita que el editor canonice distinto al resto del sistema.

---

## [0.6.0] — 2026-06-24

### Added
- **Operadoras oficiales por sucursal en el editor de equipos (CSL).** El
  selector de Operadora se restringe a la lista oficial de la sucursal del
  equipo (Los Jardines → NAYELI/LILIAN/YAMILKA/KATHERIN; Rafael Vidal →
  DIANA/EMELI/ROQUELMI/MADELIN/ROSA; Villa Olga → SAHOMY/YESSICA) más "Sin
  asignar". Al cambiar la sucursal, la lista de operadoras se actualiza. La
  operadora actual del equipo siempre permanece seleccionable. Para sucursales
  sin lista oficial / Depicenter se mantiene el catálogo real + respaldo.

### Changed
- **Normalización canónica de operadora** (`normalizeOperadora` de
  `lib/normalize-pulse.ts`, aplicada en cliente y backend: `updateEquipoCampos`
  y `saveEquipo`). Resuelve variantes ortográficas a la forma oficial:
  EMELY→EMELI, KATHERINE→KATHERIN, RIQUELMI→ROQUELMI, YESICA/JESSICA→YESSICA.
  Nombres desconocidos se conservan en MAYÚSCULA (no se pierden). Evita que la
  misma operadora se guarde de dos formas y rompa el cruce cabina→operadora y
  los reportes. Solo afecta nuevas escrituras; no reescribe datos existentes.

### Investigado (sin cambio de comportamiento)
- Reporte "la operadora no se guarda en Mantenimiento › Equipos": la auditoría
  de `csl_maintenance_audit` y el estado de la DB confirman que el guardado de
  operadora **sí persiste** (C-05 = JOHELY, `manual_tecnico`, auditado). El path
  frontend → `updateEquipoCampos` → `updateRowFields` verifica filas afectadas,
  estampa `change_source`/`updated_by`/`updated_at` y audita antes/después. No
  hay trigger, columna generada ni FK que revierta `operadora`; el store no
  persiste `db` (se recarga fresco). La confusión provenía del selector
  (operadoras no oficiales / sin filtro por sucursal) y del bug de mayúsculas
  del selector de Cabina ya corregido en v0.5.0.

---

## [0.5.0] — 2026-06-24

### Added
- **Cabinas configurables desde el editor de equipos.** Nuevo catálogo
  `maintenance_cabins` (multi-tenant + RLS, soft-delete, índice único por
  `business_id + branch + lower(name)`) sembrado con las cabinas por defecto
  (Cabina 1..10, Backup, Taller, Sin asignar) por negocio. En
  **Mantenimiento › Equipos › Editar**, junto al selector de Cabina hay un botón
  **"+"** que abre el modal **"Nueva cabina"** (nombre, sucursal, estado, nota).
  La cabina creada aparece de inmediato en el selector, queda seleccionada y se
  persiste al guardar el equipo. Acciones backend `getMaintenanceCabins` y
  `saveMaintenanceCabin` (scopeadas al negocio activo: Cibao no ve cabinas de
  Depicenter ni viceversa; el superadmin respeta el negocio activo). No duplica
  cabinas con el mismo nombre en la misma sucursal.

### Fixed
- **Selector de Cabina aparecía vacío al editar un equipo.** `fromDb` devuelve
  `Equipo.Cabina` en MAYÚSCULA ("CABINA 1") pero las opciones del dropdown eran
  "Cabina 1": nunca coincidían, así que el selector mostraba "Sin asignar" aunque
  el equipo SÍ tuviera cabina (causa de la percepción de que "no se guardaba").
  Ahora el selector compara y guarda en MAYÚSCULA y muestra etiquetas amigables.

---

## [0.4.0] — 2026-06-24

### Added
- **Paginación en cliente reutilizable.** Nuevo hook `lib/use-pagination.ts`
  (`usePagination`) + componente `components/ui/data-pagination.tsx`
  (`DataPagination`): pie "Mostrando X–Y de Z", selector de tamaño (25/50/100/200)
  y controles « ‹ › ». El arreglo filtrado/ordenado completo se conserva para
  exportes, contadores y totales; solo se pagina lo que se renderiza.

### Changed
- **Paginación aplicada en 13 pantallas con listas que crecen sin límite:**
  RR.HH. (Ponche, Asistencia, Auditoría, Liquidaciones), Pulse (Sesiones),
  Consentimientos, Reportes, Reportes firmados, Certificados de regalo,
  Certificados Depicenter, Inventario y piezas, Lista piezas póliza
  (Pendientes/Recibidas), Historial de equipos, Requisición de materiales
  (Mis requisiciones, Aprobaciones).
- **RR.HH. › Ponche:** se eliminó el tope artificial `.slice(0, 300)` (antes
  ocultaba todo lo posterior al ponche 300); ahora se navega todo con paginación.
- Numeración de filas continua entre páginas (`#` = posición global, no por página).

### Notes
- `Pulse › Auditoría` se mantiene sin paginar a propósito: sus tablas están
  agrupadas por semana con totales por grupo; una paginación plana rompería el
  agrupamiento. Páginas con catálogos pequeños (sucursales, config, credenciales)
  tampoco se paginan por innecesario.

---

## [0.3.1] — 2026-06-23

### Fixed
- **Liquidaciones y prestaciones — vacaciones proporcionales en renuncias.** El
  cálculo de vacaciones devolvía 0 días para empleados con menos de 1 año. Ahora
  aplica la escala proporcional del Código de Trabajo (art. 177/180): 5 meses = 6
  días, 6 = 7, 7 = 8, 8 = 9, 9 = 10, 10 = 11, 11 = 12. En renuncia/salida
  voluntaria preaviso y cesantía quedan en RD$ 0.00 y el total considera solo los
  derechos adquiridos (vacaciones proporcionales + salario de Navidad proporcional
  + salario pendiente). Corregido en backend (`computeSeverance`) y frontend
  (recalcular en pantalla, vista previa, guardar/editar y PDF Ministerio).
- **Tiempo laborado** ahora se muestra en años/meses/días (antes años/días), con
  criterio Ministerio (mes de 30 días, día inclusivo).
- Caso de validación EMELY CADIZ (ingreso 01/10/2025, salida 28/06/2026, RD$18,000,
  renuncia): tiempo 8 meses 28 días, diario RD$755.35, vacaciones 9 días
  RD$6,798.15, Navidad 5 meses 28 días RD$8,900.00, total **RD$15,698.15**. ✓

---

## [0.3.0] — 2026-06-23

### Added
- **Módulo nuevo: Requisición de Materiales por Sucursal.** Menú con 6 submenús
  (Nueva requisición, Mis requisiciones, Consolidado de compras, Aprobaciones,
  Materiales, Dashboard materiales) bajo la sección "Requisición de materiales".
- **Nueva requisición**: tabla con check por material agrupada por proveedor,
  cantidad obligatoria al marcar (mínimo 1), "Seleccionar todo" por categoría,
  "Limpiar", guardar borrador o "Enviar requisición". Sucursal limitada al
  scope de la encargada.
- **Consolidado de compras**: pivote Proveedor × Material × Sucursal con Total y
  Aprobado, filtros (fecha, estado, sucursal, proveedor), "Aprobar todo
  (visible)", export **Excel** y **PDF** profesional agrupado por proveedor.
- **Aprobaciones**: por requisición e ítem — aprobar (cantidad ajustable),
  rechazar con motivo, marcar comprado (suplidor + costo), registrar recepción
  (parcial/completa derivada por cantidad). Estado de la requisición se
  recalcula automáticamente desde sus ítems.
- **Materiales**: catálogo editable (agregar/editar/inactivar, sin borrado
  físico) agrupado por proveedor.
- **Dashboard materiales**: 8 KPIs + tops (sucursal/material/proveedor) +
  gráficos (solicitudes por sucursal, estado de requisiciones, materiales más
  solicitados, tendencia mensual, gasto por proveedor) con recharts.
- Catálogo inicial CSL sembrado: 12 materiales BRAVO + 9 PRICES MART (21).
- Auditoría completa en `material_requisition_audit_logs`
  (creación, envío, aprobación, rechazo, compra, recepción).

### Changed
- Migración aditiva `202606230001_materiales_requisicion.sql`: 4 tablas
  (`material_catalog`, `material_requisitions`, `material_requisition_items`,
  `material_requisition_audit_logs`) con `business_id` multi-tenant, RLS por
  tenant (`current_business_id()`/`is_superadmin()`), grants a service_role e
  índices. Aislamiento Cibao ↔ Depicenter por business_id + scope por sucursal.

---

## [0.2.31] — 2026-06-22

### Added
- **Recepción editable de piezas en Mantenimiento → Lista piezas póliza.** El
  modal de edición de una pieza ahora incluye una sección **"Recepción de
  pieza"** para registrar y editar: estado de recepción (Pendiente / Recibida
  parcial / Recibida completa / Cancelada), fecha de recepción, cantidad
  recibida, recibido por, nota, N.º de factura, costo real, suplidor final y
  evidencia/factura adjunta (PDF o imagen). Botón **"Registrar recepción"** /
  **"Editar recepción"** según si ya fue recibida.
- El estado de recepción se **deriva automáticamente** de la cantidad recibida
  vs la solicitada (menor → parcial; igual o mayor → completa), salvo override
  manual a "Cancelada". El `estado` binario heredado y `fecha_recibida` se
  mantienen sincronizados (no rompe el toggle, los contadores ni el PDF).
- **Evidencia adjunta** en bucket privado de Supabase Storage `maintenance-docs`
  (se crea solo si falta) vía `POST /api/maintenance/documents/upload`, con
  lectura por URL firmada (`getPiezaReceptionSignedUrl`).
- **Auditoría** de la recepción en `csl_maintenance_audit`
  (`part_received` / `part_reception_updated`) con valores antes/después.
- Listado: **badge de estado de recepción** con colores + cantidad recibida y
  fecha de recepción por fila; el filtro de estado pasa a 5 opciones
  (Todas / Pendientes / Recibida parcial / Recibida completa / Canceladas).

### Changed
- Migración aditiva `202606220001_piezas_recepcion.sql`: 11 columnas
  `received_*` / `reception_*` en `csl_piezas_poliza_lista` (sin DELETE/DROP);
  backfill `estado='recibida'` → `received_status='recibida_completa'`.

---

## [0.2.30] — 2026-06-19

### Added
- **KPI "Días con tardanza" clickeable con detalle en RR.HH. → Asistencia.** La
  tarjeta ahora es interactiva (cursor pointer, hover, texto "Ver detalle"). Al
  hacer clic abre un modal **"Detalle de tardanzas"** con la lista de los
  registros que componen el número: Fecha, Empleado, Sucursal, Entrada esperada,
  Entrada real, Tardanza (min), Estado y acción **Ver** (detalle completo del
  registro: incluye horas, modalidad/origen del horario y observaciones).
  - **Coincidencia garantizada KPI = lista:** ambos salen del mismo array
    `filtered` vía el helper compartido `getLateAttendanceRecords()`
    (predicado único `late_minutes > 0`). Imposible que el KPI diga 10 y la
    lista muestre otra cantidad.
  - **Respeta filtros** Desde/Hasta/Sucursal/Empleado y el **business_id activo**
    (no mezcla Cibao con Depicenter — el scoping ya lo hace el handler
    `getHrAttendanceHours`). Botón **Exportar** la lista de tardanzas a Excel.
  - Estado vacío: "No hay tardanzas en este período." Contador
    "N tardanza(s) encontrada(s)".
- **Cuadro de barras por empleado (Asistencia y tardanza).** Gráfico horizontal
  (recharts) bajo el dashboard de Asistencia: por cada empleado, barras de
  **Asistencias** (días con entrada) y **Tardanzas**, ordenado por tardanzas.
  Respeta los mismos filtros y el negocio activo.
  - Solo cliente: no se agregaron queries nuevas ni se tocó la base de datos.

---

## [0.2.29] — 2026-06-19

### Added
- **Estados "Renuncia" y "Desvinculado" en RR.HH. (Solicitudes/Empleados).** Al
  selector de Estado (editor y filtro de Solicitudes) se suman 🟠 Renuncia y
  ⚫ Desvinculado, además de los existentes. Badges con color propio (naranja /
  gris). Fuente única de estados, colores y regla activo/no-activo en nuevo
  `lib/empleado-estado.ts`.
  - **Regla de negocio:** activo = "Aprobado"/"Activo". Renuncia, Desvinculado y
    Rechazado **no** cuentan como activos en Dashboard RR.HH., Dashboard Ponche,
    selector de empleados (nómina/asistencia/ponche vía `EmployeeSelect`) ni en
    el listado de Empleados (filtro Activos/No activos/Todos, badge real por
    estado).
  - **No se borra nada:** al pasar a Renuncia/Desvinculado el registro del
    empleado se **conserva** (antes `saveSolicitudEmpleo` borraba la fila de
    `csl_empleados` para cualquier estado ≠ Aprobado); ahora solo se marca el
    estado. Historial, ponches, nómina, contratos y documentos intactos.
  - BD: `estado` es `text` sin constraint en `csl_solicitudes_empleo` /
    `csl_empleados` → no requiere migración; valores previos sin cambios.

---

## [0.2.28] — 2026-06-19

### Fixed
- **No se podía editar el nombre de una pieza ya creada en Inventario.** El campo
  "Nombre" del modal de edición era un `<Select>` que solo listaba piezas del
  **catálogo** (`db.piezas`), así que corregir un nombre libre (ej. *Manifull →
  Manifold*) era imposible si ese texto no existía en el catálogo. Ahora el
  nombre es un **input de texto libre** (obligatorio) como fuente de verdad, con
  el catálogo como autocompletado **opcional**. La categoría ya era editable
  aparte.
- **Guardado de inventario robusto:** `handleSave` ahora **confirma la
  escritura en Supabase local** antes de declarar éxito (antes era optimista y
  fire-and-forget); muestra "Pieza actualizada correctamente." o "No se pudo
  actualizar la pieza." según el resultado real. Guard `isSaving` (sin doble
  submit). El `update` va por `item_id` + `business_id` activo (vía `upsertRow`,
  que inyecta y valida el tenant) → no duplica ni mezcla Cibao/Depicenter, y no
  pierde stock/precio/categoría.

---

## [0.2.27] — 2026-06-19

### Fixed
- **Falso "error" al crear un Nuevo reporte de servicio.** El reporte se
  guardaba bien, pero si el correo (que adjunta el PDF) no se enviaba, se
  mostraba un toast ROJO de error ("Correo pendiente: …") aunque el guardado
  fue exitoso — por eso "el segundo reporte sí se guardó aunque dio error".
  Ahora:
  - El guardado se **confirma con la API antes** de declarar éxito (`apiCall`
    lanza si falla); solo entonces se muestra "Reporte guardado correctamente."
  - El fallo de **correo/PDF se informa aparte** y SIN estilo de error:
    "Reporte guardado correctamente. Hubo un problema generando el PDF/correo
    (puedes imprimirlo desde el detalle)."
  - **Sin doble submit:** guard `isSaving` + botón Guardar deshabilitado con
    "Guardando…" mientras procesa.
  - **Sin duplicados:** en error real se conservan los datos del formulario y se
    reutiliza el mismo `report_id` → el reintento hace upsert idempotente.
  - Mensajes de validación claros ("Faltan campos obligatorios: …").
  - Funciona igual en desktop y celular (mismo formulario responsive).

---

## [0.2.26] — 2026-06-19

### Added
- **Ponche desde el celular (PWA) + biometría WebAuthn/Passkeys** — tercer slice
  del epic RR.HH./Ponche.
  - Página móvil `/ponche-movil/[token]`: el empleado abre con su QR, marca
    Entrada/Salida con GPS, y puede registrar/usar la **biometría del propio
    teléfono** (huella / Face ID) como passkey. Responsive + manifest PWA
    instalable.
  - Endpoint `/api/public/mobile-punch`: autentica por QR (no por dispositivo),
    lee `hr_punch_modality_config` (alcance empleado > sucursal > global) y la
    **aplica**: modalidad habilitada, ubicación obligatoria, geocerca salvo
    `allow_remote_punch`, y biometría obligatoria cuando aplica. Calcula
    tardanza/horas igual que el kiosko; registra `modality`, `verified_biometric`,
    `source="mobile"`.
  - WebAuthn con `@simplewebauthn` (server+browser): endpoints
    `register-options/verify` y `auth-options/verify`. La verificación biométrica
    emite un ticket efímero (90 s) que el ponche consume.
  - Migración `202606190002_hr_webauthn.sql` (aditiva): tablas
    `hr_webauthn_credentials` y `hr_webauthn_challenges` con RLS.
  - NOTA: WebAuthn requiere prueba en dispositivo real con biometría (no
    verificable en headless).

---

## [0.2.25] — 2026-06-19

### Added
- **Configuración de modalidades de ponche (UI admin)** — nueva pantalla
  (RR.HH. · Asistencia) para habilitar/deshabilitar modalidades y validaciones
  por alcance: global del negocio, por sucursal o por empleado. Toggles para
  PIN, QR, biometría móvil, facial, GPS, kiosko, ponche remoto y para
  ubicación/foto/biometría obligatorias, solo-dentro-de-horario, doble
  validación y tolerancia de tardanza. Las configs de sucursal/empleado
  sobreescriben la global; la global no se puede borrar. Solo admin/superadmin
  (handlers `getHrModalityConfig` / `saveHrModalityConfig` /
  `deleteHrModalityConfig` con `requireAdmin`, auditados). Segundo slice del
  epic RR.HH./Ponche; usa la tabla `hr_punch_modality_config` creada en v0.2.24.

---

## [0.2.24] — 2026-06-19

### Added
- **Dashboard Ponche** (RR.HH. · Asistencia) — nueva pantalla con KPIs de
  asistencia en tiempo real: empleados activos, asistencias/ausencias/tardanzas
  de hoy, sin marca de salida, salidas tempranas, horas hoy/semana, horas extra,
  geocerca inválida y modalidad biométrica. Filtros Hoy/Semana/Mes + rango +
  sucursal. Gráficas (asistencia por día, distribución por modalidad), resumen
  por sucursal, alertas (sin salida / tardanzas) y tabla de últimos ponches.
  Calcula desde `hr_punches` + `getEmpleados`, scopeado por negocio. Primer
  slice del epic RR.HH./Ponche.
- **Modalidades de ponche** — migración `202606190001_hr_ponche_modalidades.sql`
  (aditiva): `hr_punches` gana `modality`, `selfie_url`, `verified_biometric`,
  `validation_result`, `accuracy_meters`, `device_name`; nueva tabla
  `hr_punch_modality_config` (config por negocio/sucursal/empleado: allow_pin,
  allow_qr, allow_mobile_biometric, allow_face, allow_gps, allow_kiosk,
  allow_remote_punch, require_photo/location/biometric, only_within_schedule,
  tolerance_minutes, double_validation) con RLS multi-tenant e índices únicos
  parciales por nivel. Seed de config global por negocio. El ponche por QR ahora
  registra `modality="qr"` y las correcciones manuales `modality="manual"`.

---

## [0.2.23] — 2026-06-18

### Added
- **Campos técnicos editables en el Reporte de Servicio de equipos.** El formato
  impreso ya mostraba N/S Fuente, N/S Fibra, HV@, J, BS, BC, HV REF@, VDC, V, TX
  y Software, pero salían siempre en blanco porque no se capturaban ni se
  guardaban. Ahora existe una tarjeta "Parámetros técnicos" en Nuevo/Editar
  reporte, los valores persisten en Supabase local, aparecen en la vista de
  detalle y se imprimen en el PDF. Se agregó también el número de la fuente de
  poder. Campos de texto: aceptan unidades ("12.5 kV", "8 J").
  - Migración aditiva `202606180001_reportes_campos_tecnicos.sql`: 12 columnas
    `ADD COLUMN IF NOT EXISTS` en `csl_reportes` (no destructiva, reportes
    previos intactos). Pulsos (p_totales/p_cabeza), corrección, observaciones,
    partes y atendió se reutilizaron, no se duplicaron.

---

## [0.2.22] — 2026-06-16

### Changed
- **Turno corrido (sin almuerzo) para toda entrada de las 12:30 PM en adelante**
  (12:30, 1:00, 1:30 PM…), no solo 12:30. Se reemplazó la lista exacta por un
  umbral central `NO_LUNCH_FROM_MINUTE = 12:30` en `lib/work-hours.ts`
  (`lunchMinutesForShift`): entrada ≥ 12:30 → 0 min; turnos de mañana (8:00,
  9:00, 10:30) → 60 min. Aplica en tarjeta, modal, ponche, asistencia y guardado.
- Seed `_seed-horarios-2026.js` usa el mismo umbral.

### Fixed
- Datos db-cls: días con entrada ≥ 12:30 quedan sin almuerzo (Eidylee 1:30 PM,
  Rosa/Benita 1:00 PM incluidos). Verificado: 0 días tarde con almuerzo, 0 días
  de mañana con `break_minutes ≠ 60`. Depicenter intacto.

---

## [0.2.21] — 2026-06-16

### Changed
- **Turno corrido sin almuerzo para entrada 12:30 PM** (regla oficial),
  codificada de forma central en `lib/work-hours.ts`:
  `NO_LUNCH_START_TIMES = ["12:30"]` + `lunchMinutesForShift(start)` → 0 min si
  entra 12:30, 60 min en cualquier otro turno. Reemplaza el "60 min fijo a
  todos" de v0.2.20 solo para los turnos 12:30.
  - Aplicado en cálculo (tarjeta/modal), ponche y asistencia (`_handlers.ts`,
    `app/api/public/punch/route.ts`) y en `saveHrEmployeeSchedule`
    (`break_minutes` y ventana de almuerzo se limpian en turno corrido).
  - `calculateWeeklyWorkedHours`: descansos = suma real de almuerzos del horario
    (no díasTrabajados × 1), por lo que los días 12:30 no suman descanso.
- **Modal Horario laboral**: los días con entrada 12:30 muestran
  **"Turno corrido · sin almuerzo"** (sin inputs de almuerzo) y se omiten de la
  validación de 60 min; el resto sigue exigiendo almuerzo de 60 min.

### Fixed
- Datos db-cls: el seed vuelve a eximir del almuerzo los turnos 12:30. Verificado
  en CSL: 0 días 12:30 con almuerzo, 0 días no-12:30 con `break_minutes ≠ 60`.
  Depicenter intacto. (Benita vuelve a 35.5 h netas.)

---

## [0.2.20] — 2026-06-16

### Changed
- **Almuerzo fijo de 60 minutos en TODO el sistema** (regla oficial única).
  Revierte la regla previa "entrada 12:30 = sin almuerzo" (v0.2.18): ahora
  **cada día trabajado descuenta 1 h**, día libre = 0. Constante única
  `DEFAULT_LUNCH_MINUTES = 60` en `lib/work-hours.ts`.
  - `calculateDailyWorkedHours({startTime, endTime, isDayOff})` →
    `{ grossHours, lunchMinutes:60, lunchHours:1, netHours }`.
  - `calculateWeeklyWorkedHours` → descansos = díasTrabajados × 1 h; horas
    netas = brutas − descansos; indicador > 44 h por horas **netas**.
  - Ponche y asistencia (`_handlers.ts`, `app/api/public/punch/route.ts`) usan
    el almuerzo fijo de 60 min para las horas esperadas/trabajadas.
  - `saveHrEmployeeSchedule` fuerza `break_minutes = 60` en días trabajados.
- **Modal Horario laboral**: el almuerzo es siempre 60 min — al cambiar inicio
  o fin, el otro extremo se ajusta a ±60; al guardar se valida (bloquea con
  "El almuerzo debe ser de 60 minutos." si no cuadra, si la salida ≤ entrada o
  si el almuerzo cae fuera del turno). Cada día muestra badge **"60 min"**.
- **Plantilla Horarios y turnos** (`hr_schedules`): mismo enforce de 60 min al
  guardar y autoajuste del fin de almuerzo.

### Fixed
- Datos en db-cls: restaurado el almuerzo de 60 min en los días con entrada
  12:30 (seed `_seed-horarios-2026.js` ya no los exime). Verificado: 0 días
  trabajados con `break_minutes ≠ 60` en CSL. Depicenter intacto (0 horarios).

---

## [0.2.19] — 2026-06-16

### Added
- **Horas trabajadas por empleado** en cada tarjeta de RRHH → Empleados:
  `Horas trabajadas: XX h / 44 h`. Badge **amarillo "⚠ Sobre 44 h"** si supera
  44 h semanales; verde/neutro si ≤ 44. Sin horario → "Horario pendiente"
  (no muestra 0 h como válido).
- Función central `lib/work-hours.ts` `calculateWeeklyWorkedHours(days)` →
  `{ totalHours, dailyHours, hasSchedule, exceeds44, status }`. Reutilizada por
  la tarjeta y el modal de horario (sin drift). Horas/día = salida − entrada −
  almuerzo real del día (turno corrido 12:30 = sin almuerzo); día libre = 0;
  formato máx. 1 decimal (`fmtHours`).
- Handler `getHrAllEmployeeSchedules`: horarios activos de todos los empleados
  del business activo (scopeado por `business_id`; Depicenter no se mezcla).

### Changed
- Modal **Horario laboral**: el resumen ahora muestra **Total semanal XX h / 44 h**
  con estado e indicador amarillo si pasa de 44 h. Cálculo centralizado en
  `lib/work-hours.ts` (mismo que la tarjeta).

### Notes
- Hoy ningún empleado CSL supera 44 h (máx. 40 h: Emely/Ashley), así que todas
  las tarjetas muestran el indicador normal; el amarillo se activa con cualquier
  horario > 44 h.

---

## [0.2.18] — 2026-06-16

### Changed
- **Regla de almuerzo**: el personal que **entra a las 12:30 PM no tiene hora
  de almuerzo** (turno corrido). Se eliminó el almuerzo (lunch_start/end = null,
  break_minutes = 0) en los 34 días con entrada 12:30; el total de esos días
  pasa a 7.5 h. Aplicado en db-cls y en el seed `_seed-horarios-2026.js`
  (`lunchWindow` devuelve null para entradas 12:30) para que sea idempotente.

### Added
- **ASHLEY** (Ashley Michelle Sánchez, R Vidal) con el **mismo horario que
  Emely**: L/M 12:30–20:00 (sin almuerzo), X 09:00–20:00, J 09:00–18:00, V
  libre, S 08:00–16:00. Total empleados con horario: 23.

---

## [0.2.17] — 2026-06-16

### Added
- **Horarios semanales de los 22 empleados de CSL** (R Vidal, Jardines, Villa
  Olga) cargados en `hr_employee_schedules` + `hr_employee_schedule_days`, con
  **1 hora de almuerzo por día trabajado** según las reglas oficiales por turno
  (turnos cortos 09:00–13:00 sin regla → almuerzo de 1 h centrado). Domingo y
  días marcados LIBRE quedan como no laborables (0 h). Seed idempotente
  `scripts/_seed-horarios-2026.js` (reusa el horario activo existente; no crea
  duplicados — Angélica y Dayhana se actualizaron, 20 creados).
- Columnas `lunch_start` / `lunch_end` (texto "HH:MM") en
  `hr_employee_schedule_days` (migración `202606160002`, aditiva) para mostrar
  la ventana de almuerzo exacta además de `break_minutes`.

### Changed
- Diálogo **Horario laboral** (`employee-schedule-dialog`): cada día laborable
  muestra/edita entrada, salida, **almuerzo inicio/fin** y **total del día**;
  `break_minutes` se sincroniza con la ventana de almuerzo. El resumen semanal
  calcula horas netas = salida − entrada − almuerzo.
- Handler `saveHrEmployeeSchedule`: persiste `lunch_start`/`lunch_end` y limpia
  la ventana en días libres.

### Notes
- Solo tenant CSL (business_id `66b0cf3e…`); Depicenter (La Vega) intacto.
- Match de nombres normalizado, sin duplicados: YADIBLE→Yadibel,
  NAYELIN→Nayeli, KETHERINE→Katerin, AIDYLEE→Eidylee, RIQUELMI→Riquelmy,
  ANGELICA→Angélica, YAMILKA (en apellido). 0 empleados no encontrados.

---

## [0.2.16] — 2026-06-16

### Added
- **BENITA** agregada como especialista oficial de CSL (`csl_operadoras`,
  sucursal Los Jardines, Activa). Aparece en todos los selectores de
  especialista de cosmiatría/fichas/consentimientos.
- `lib/especialistas.ts`: normalizador canónico compartido
  (`normalizeEspecialista` + `dedupeEspecialistas`) para que los dropdowns no
  mezclen variantes de la misma persona. Alias: `EMELY→EMELI`,
  `KATHERINE→KATHERIN`, `YESICA→YESSICA`, `SAOMY→SAHOMY`.

### Fixed
- **Especialistas duplicadas en los selectores** (p.ej. `Eidylee`/`EIDYLEE`,
  `Johely`/`JOHELY`). Causa raíz: los dropdowns fusionaban la fuente limpia
  (`csl_operadoras`, ya en MAYÚSCULAS) con valores históricos de los registros
  guardados con mayúsc/minúsc mezcladas, sin normalizar el case. Ahora
  Ficha Dermatología (`cosmiatria-ficha-page`), generador de links
  (`link-generator-dialog`) y el filtro de Reportes/Historial
  (`reportes-firmados-page`) normalizan y deduplican por nombre canónico.
- Constantes de masajes normalizadas a MAYÚSCULAS (`MASSAGE_SPECIALISTS`,
  `ESPECIALISTAS_POR_SUCURSAL`: `Benita→BENITA`).
- Migración `202606160001_normalize_especialistas.sql` (aditiva, sin DELETE):
  canoniza valores históricos `Eidylee→EIDYLEE`, `Johely→JOHELY`,
  `Benita→BENITA`, `Dayhana→DAYHANA` en fichas y consentimientos. Auditado en
  `csl_maintenance_audit` (`specialist_added`, `specialist_normalized`).
- Lado LÁSER intacto: `csl_equipos`/`normalize-pulse` siguen usando `ROQUELMI`;
  el normalizador de cosmiatría usa `RIQUELMI` y no toca las pantallas de Pulsos.

---

## [0.2.15] — 2026-06-15

### Removed
- **Desmantelado el proyecto Supabase Cloud `pfqnyzbtwhfkemkixril`** (eliminado
  desde el dashboard por el usuario). Era el respaldo de rollback posterior a la
  migración al self-hosted; ya no se usa. El self-hosted `db-cls.cibao-cloude.com`
  queda como **única fuente de verdad** de csl-app.
- Eliminado el archivo de credenciales obsoleto `.env.local.cloud-rollback`
  (apuntaba al Cloud ya borrado; no estaba versionado).

### Changed
- **Reconciliación final de datos antes del borrado:** se detectaron y migraron
  al self-hosted 5 registros que existían solo en el Cloud (2 fichas en
  `csl_ficha_dermatologica` del 24-may y 3 lecturas en `csl_pulse_readings` de
  Rafael Vidal del 31-may). Verificación exhaustiva triple-chequeada
  (estructura + datos en 3 pasadas + auth + storage) confirmó que el self-hosted
  contiene el 100% del Cloud.

### Security
- Reducida la superficie: ya no existe una copia en la nube de los datos de
  clientes/operación fuera de la infraestructura self-hosted de Cibao Cloud.

---

## [0.2.14] — 2026-06-14

### Fixed
- **Causa raíz de la contaminación cross-tenant semanal de Depicenter.** Los
  handlers de Cuadre/AgendaPro (`saveOperatorShots`, `recalculateDispOperador`,
  `deleteOperatorShot`, `deleteOperatorShotsByPeriod`) guardaban/leían con el
  `business_id` del **perfil del usuario** (CSL para el superadmin) en vez del
  **negocio activo**. Por eso cada semana los `csl_operator_shots` y el
  `disp_operador` de Depicenter terminaban bajo CSL (lo que se venía limpiando a
  mano). Ahora usan `effectiveBusinessId()` — guardan/recalculan SOLO en el
  negocio activo. Igual que el guardado masivo de sesiones, que ya era correcto.
  Nota: los handlers de RR.HH. (contratos/documentos) comparten el mismo patrón
  y deberían migrarse a `effectiveBusinessId()` en una corrección dedicada.

---

## [0.2.13] — 2026-06-13

### Fixed
- **Lecturas semanales: editar FIN no se guardaba (Depicenter).** Los handlers
  de PulseControl (`savePulseReading`, `getPulseReadings`, `deletePulseReading`,
  `recalculatePulseContinuity`, `getOperatorShots`) tomaban el `business_id` del
  **perfil del usuario logueado** (CSL para el superadmin), NO del **negocio
  activo** seleccionado en la UI. Al editar una lectura de Depicenter, el
  `upsert` usaba la clave `(business_id=CSL, equipo, period_start, period_end)`,
  que nunca coincidía con la fila real de Depicenter → el FIN no persistía (y
  podía escribir en el espacio de CSL). Ahora todos usan `effectiveBusinessId()`
  (el negocio activo vía BusinessContext/AsyncLocalStorage). Guardar/leer/borrar/
  recalcular operan SIEMPRE sobre el negocio activo; Depicenter guarda en
  Depicenter, Cibao en Cibao, sin mezclar.
- **Lecturas semanales:** validación al editar FIN — bloquea FIN < INICIO
  ("no puede ser menor que INICIO") y avisa si FIN = INICIO (DISP Láser 0).
  `recalculatePulseContinuity` solo ajusta el INICIO de semanas siguientes al
  FIN editado (no pisa el FIN manual). Auditoría/IA y exports leen la misma
  lectura ya persistida.

---

## [0.2.12] — 2026-06-13

### Fixed
- **Auditoría/IA: la discrepancia no salía cuando DISP LÁSER era 0.** Si la
  lectura final de la semana no avanzó respecto al inicio (Fin ≤ Inicio, p.ej.
  el Excel de Depicenter 08-jun trajo la misma lectura de la semana anterior)
  pero la operadora SÍ reportó disparos, la fila quedaba como **OK** y la
  diferencia no se resaltaba. Ahora esa fila se marca **Crítico** (la diferencia
  con el operador es real) y la columna DISP LÁSER muestra **"Falta lectura
  final"** en vez de un 0 engañoso, indicando que falta capturar la lectura del
  equipo de esa semana. Cambio acotado: solo afecta cuando DISP LÁSER = 0 con
  disparos de operadora > 0; Cibao (con lecturas reales) no cambia.

---

## [0.2.11] — 2026-06-13

### Fixed
- **PulseControl Auditoría/IA: Pulsos Inicio roto (DISP LÁSER absurdo) en
  Depicenter.** Las lecturas de Depicenter de la semana 08-jun traían
  `lectura_inicial` corrupto del import (eq1=642.194 en vez de 5.280.253) →
  DISP LÁSER de 4.638.059. Ahora la auditoría DERIVA Pulsos Inicio del
  `lectura_final` de la semana inmediatamente anterior del mismo equipo
  (encadenado, por sucursal+equipo, ignorando el `lectura_inicial`/`disp_laser`
  guardados que podían venir rotos). DISP LÁSER se recalcula = Pulsos Fin −
  Pulsos Inicio. Si no hay semana anterior ni inicial válido → "Falta lectura
  inicial" sin calcular DISP LÁSER. Misma lógica para Cibao y Depicenter; Cibao
  ya encadenaba 1:1 (40/40) así que NO cambia. Aplica a pantalla, Exportar Excel
  y Exportar PDF (todos leen las mismas filas).
- **Datos:** corregido `lectura_inicial` de las 3 lecturas Depicenter 08-jun
  (encadenado a la semana previa); `disp_laser` (columna generada) se recalculó
  a 0. Solo Depicenter; Cibao intacto. (Antes: movidas las 3 lecturas + 3 shots
  08-jun de business_id CSL→Depicenter, mal etiquetadas por el import.)

---

## [0.2.10] — 2026-06-13

### Fixed
- **PulseControl: DISP OPERADOR de Auditoría/IA no "cuadraba" con Registro de
  servicios por desfase de semana.** Registro de servicios (`pulsos-sesiones`)
  agrupaba por semana DOMINGO-sábado (`weekStartIso` con `- getDay()`),
  mientras Auditoría/IA usaba la semana operativa LUNES-sábado
  (`lib/operational-week.ts`). Mismas sesiones, distinto bucket/rótulo (p.ej.
  "31-may al 06-jun" vs "01-jun al 07-jun") → parecía que no cuadraba aunque la
  suma era idéntica. Ahora ambos módulos usan UNA sola función compartida
  (`operationalWeekStart` / `operationalWeekRangeLabel`) → misma semana y mismo
  rótulo lunes-sábado. Sin movimiento de datos (no hay sesiones en domingo en
  ningún tenant). El rótulo de Auditoría pasa de lunes+6 (domingo) al rango real
  lunes-sábado. `findWeeklyAssignment` de Registro de servicios ahora casa con
  el `FechaSemana` (lunes) de las lecturas. Aplica a CSL y Depicenter por igual;
  verificado que Cibao no cambia de cifras.

### Added
- `operationalWeekStart` y `operationalWeekRangeLabel` en `lib/operational-week.ts`
  — fuente única de inicio/rótulo de semana operativa para PulseControl.

---

## [0.2.9] — 2026-06-13

### Fixed
- **PulseControl Auditoría/IA y Lecturas: operadora incorrecta por cabina.**
  La operadora mostrada se tomaba directamente del Excel/lecturas importadas
  (`r.operadora` / `lec.OperadoraID`), que puede traer nombres equivocados o
  históricos (p.ej. Los Jardines Cabina 2 salía "MADELIN" cuando la oficial es
  "LILIAN"). Ahora un resolver central (`lib/operadora-oficial.ts`,
  `buildOperadoraResolver`) determina la operadora OFICIAL desde el catálogo de
  equipos (`csl_equipos` → `db.equipos`, ya filtrado por `business_id` activo)
  por (sucursal, equipo) y (sucursal, cabina) normalizados. El Excel queda solo
  como fallback cuando no hay asignación oficial, con observación/tooltip
  "Excel: X / Oficial: Y". Aplica a Auditoría/IA (pantalla + export Excel + PDF)
  y a Lecturas semanales. El Cuadre semanal y Registro de servicios son
  reconciliaciones por operadora de AgendaPro (no por cabina) y conservan su
  agregación, ya canonizada vía `normalizeOperadora`. Aislamiento por empresa
  garantizado: el catálogo solo contiene equipos del negocio activo. Sin SQL.

### Added
- `lib/operadora-oficial.ts` — resolver central de operadora oficial reutilizable.

---

## [0.2.8] — 2026-06-13

### Fixed
- **PulseControl: Depicenter no mostraba datos al cambiar de perfil.**
  `applyActiveBusiness` actualizaba `businessId` y `bypassTenantFilter` al
  seleccionar un business activo (superadmin), pero NO actualizaba
  `businessSlug`, que se quedaba con el del superadmin (`csl`). La guardia
  anti-fuga por sucursal de `getAllPulsosData` (`scopeTenantSuc` →
  `sucursalAllowedForTenant(suc, ctx.businessSlug)`) descartaba entonces todas
  las filas con sucursal `DEPICENTER` al compararlas contra la allow-list de
  CSL, dejando Dashboard, Lecturas semanales, Sesiones, Auditoría/IA, Cuadre
  semanal y operatorShots vacíos para Depicenter aunque el filtro por
  `business_id` sí devolvía sus datos. Ahora `applyActiveBusiness` también fija
  `businessSlug` vía mapa uuid→slug. Sin SQL ni cambios de datos. CSL no se ve
  afectado.

---

## [0.2.7] - 2026-06-12

### Fixed
- **CAUSA RAÍZ del "guarda pero al recargar vuelve atrás" en Mantenimiento >
  Equipos.** Las escrituras CRUD (`updateRowFields`, `upsertRow`, `deleteRow` en
  `lib/server/csl-crud.ts`) **no verificaban filas afectadas**. Supabase NO lanza
  error cuando el filtro `equipo_id` + `business_id` no calza con ninguna fila:
  devuelve éxito con **0 filas**. El código incluso registraba una **auditoría de
  éxito falsa** en ese caso. Resultado: la UI mostraba "Equipo actualizado
  correctamente" mientras la DB no cambiaba, y al recargar todo volvía atrás.
  Esto explica por qué los fixes previos (v0.2.5 / v0.2.6, sobre propagación de
  `businessId`) no cerraban el caso: el fallo real era el éxito silencioso de 0
  filas. Ahora todas las escrituras usan `.select()`, cuentan filas afectadas y,
  si son 0, **lanzan un error claro** — *"No se actualizó ningún equipo. Verifica
  business_id, permisos o RLS."* — visible como toast (no solo consola). La
  auditoría solo se registra cuando realmente se escribió.
- **No se podía LIMPIAR operadora/cabina a "Sin asignar".** El update parcial
  descartaba los campos vacíos (para preservar lo no editado), así que operadora
  y cabina nunca podían volver a vacío. Ahora los dropdowns viajan SIEMPRE con un
  sentinel `__CLEAR__` que el handler traduce a `null`, sin afectar a guardarCuadre
  ni al importador (que solo mandan los campos que sí editan).
- **Superadmin editaba contra el tenant "activo" y no el del registro.**
  `resolveMaintenanceTargetBusiness` ahora, para superadmin, apunta SIEMPRE al
  `business_id` del propio registro (el que manda la UI o el deducido), evitando
  tocar el homónimo del otro negocio (ids `1`/`2`/`3` colisionan entre CSL y
  Depicenter). Para usuarios no superadmin, un `businessId` ajeno deja de
  escribirse en silencio y produce error explícito ("No puedes editar equipos de
  otro negocio") — Cibao no edita Depicenter ni viceversa.
- **Toggle de Estado y eliminación ya no fingen éxito.** `handleToggleStatus` y
  `handleDelete` pasaban por un `syncApi` fire-and-forget que tragaba errores.
  Ahora esperan la respuesta del servidor, revierten el cambio optimista si el
  backend lo rechaza y muestran el error real.

### Changed
- Tras guardar/cambiar estado/eliminar un equipo se invalida el dedup-cache de
  lecturas (`invalidateReadCache("getAllData")`) para que el siguiente refresco
  traiga la verdad de la DB y no un snapshot viejo de <30 s.
- La auditoría de mantenimiento (`csl_maintenance_audit`) ahora guarda en
  `details` el **valor anterior y el nuevo** de cada campo editado (antes solo los
  nombres de los campos).

---

## [0.2.6] - 2026-06-11

### Fixed
- **Edición de equipos: el backend ahora deduce el tenant aunque el frontend no
  lo mande.** Refuerzo de v0.2.5: si un superadmin en "Todos los negocios" edita
  un equipo y la petición no trae `businessId` (típicamente porque el navegador
  sirve el bundle JS viejo cacheado), el backend resuelve el `business_id` desde
  el propio registro (`getRowBusinessIds`): si el `equipo_id` pertenece a un solo
  negocio, lo usa y guarda; si colisiona entre negocios (ids `1`/`2`/`3`), exige
  elegir negocio con el mensaje estándar. `resolveMaintenanceTargetBusiness`
  pasa a ser asíncrona y se aplica a `updateEquipoCampos` / `setEquipoEstado` /
  `deleteEquipo` / `saveEquipo`. Esto cierra el caso en que, con el backend nuevo
  pero un frontend cacheado, el update se rechazaba y la UI fingía éxito.

---

## [0.2.5] - 2026-06-11

### Fixed
- **Edición manual de equipos no guardaba en modo superadmin "Todos los
  negocios".** Causa raíz: en ese modo `bypassTenantFilter=true`, por lo que
  `updateRowFields` y `getRecordCompleto` **quitaban el filtro `business_id`**.
  Como `equipo_id` colisiona entre tenants (los ids `1`, `2`, `3` existen en CSL
  y en Depicenter), `getRecordCompleto(...).maybeSingle()` reventaba con
  *"multiple rows"* → el endpoint devolvía `{ ok:false }` y el frontend, que
  **nunca chequeaba `res.ok`**, mostraba un "Equipo actualizado" falso y revertía
  al recargar. Además el `UPDATE` sin tenant podía tocar ambos negocios.
  - Backend: `updateRowFields` / `getRecordCompleto` / `upsertRow` / `deleteRow`
    aceptan un `targetBusinessId` explícito que **siempre** scopea (aun bajo
    bypass). Los handlers `saveEquipo` / `updateEquipoCampos` / `setEquipoEstado`
    / `deleteEquipo` lo resuelven con `resolveMaintenanceTargetBusiness`: usan el
    tenant del usuario si está scopeado, o exigen el `businessId` del registro
    cuando el superadmin está en "Todos" (si falta → *"Selecciona un negocio
    específico para editar equipos."*). Se elimina la contaminación cruzada
    Cibao ↔ Depicenter.
  - Frontend (`equipos-page.tsx`): envía el `business_id` del registro y ahora
    **verifica `res.ok`** — si el backend no guardó, muestra el error real y
    mantiene el modal abierto (no finge éxito). Mensaje de éxito:
    *"Equipo actualizado correctamente"*.
  - La edición manual sigue permitida (`manual_tecnico` / `manual_admin`) y
    auditada en `csl_maintenance_audit`; el blindaje anti-automático intacto.

---

## [0.2.4] - 2026-06-11

### Security
- **Bloqueo total de feeds automáticos a Mantenimiento.** Se extiende v0.2.3:
  el endpoint `POST /api/integrations/mantenimiento/import-lecturas` (import del
  Excel "Dashboard Mantenimiento") **ya no escribe nada** — antes seguía
  alimentando el historial `csl_equipo_snapshots` / `csl_equipo_fallas`. Ahora
  registra el intento como `auto_change_blocked` y responde **403** con el
  mensaje estándar. Las tablas de historial se agregan al set protegido
  (`PROTECTED_MAINTENANCE_TABLES`). La carga de equipos se hace solo
  manualmente desde el módulo. Confirmado: ningún otro proceso (AgendaPro,
  pulse, cron, webhook) alimenta tablas de mantenimiento.

---

## [0.2.3] - 2026-06-11

### Security
- **Blindaje del módulo Mantenimiento (estricto total).** Las tablas de
  mantenimiento (`csl_equipos`, `csl_reportes`, `csl_piezas`, `csl_tecnicos`,
  `csl_inventario`, `csl_piezas_poliza_lista`) ahora **solo aceptan cambios
  manuales** hechos por un técnico/admin autorizado dentro del módulo. Ningún
  proceso automático (seed, sync API, import de Excel, PulseControl, AgendaPro,
  recálculos, scripts de normalización/reparación, cambios de tenant/sucursal,
  carga de maestros) puede crear/editar/reemplazar/borrar esas filas.
  - Guard centralizado nuevo `lib/server/maintenance-guard.ts`: las escrituras
    a tablas protegidas exigen un *scope* manual aprobado (`manual_tecnico` /
    `manual_admin`) en el contexto async; sin él se **bloquean** con el mensaje
    «Los datos de mantenimiento solo pueden ser modificados manualmente por un
    técnico autorizado.» y se registra el intento como `auto_change_blocked`.
  - La capa CRUD (`csl-crud.ts`) aplica el guard en `upsertRow` /
    `updateRowFields` / `deleteRow` y estampa `change_source` + `updated_by` en
    cada cambio manual.
  - El dispatcher (`_handlers.ts`) marca como manuales solo las acciones del
    módulo (saveEquipo/updateEquipoCampos/setEquipoEstado/deleteEquipo,
    saveTecnico/setTecnicoEstado/deleteTecnico, savePieza/deletePieza,
    saveReporte/updateReporteCampos/deleteReporte, addInventario/saveInventario/
    updateInventario/deleteInventario, savePiezaPolizaLista/markPiezaPoliza*/
    deletePiezaPolizaLista).

### Changed
- `savePulseReading` **ya no** sincroniza campos en `csl_equipos`
  (p_cabeza/sucursal/cabina/operadora/serie/fallas). La lectura se guarda solo
  en `csl_pulse_readings`; el equipo lo edita el técnico manualmente.
- `POST /api/integrations/mantenimiento/import-lecturas` **ya no** actualiza
  `csl_equipos`; conserva el historial append-only (`csl_equipo_snapshots`,
  `csl_equipo_fallas`).

### Added
- Migración aditiva `202606110001_maintenance_change_guard.sql`: columnas de
  auditoría (`change_source`, `created_by`, `updated_by`, `created_at`,
  `updated_at`) en las tablas protegidas + tabla de bitácora
  `csl_maintenance_audit` (cambios manuales e intentos `auto_change_blocked`).
  Aplicada en db-cls (`db-cls.cibao-cloude.com`) el 2026-06-11.

---

## [0.2.2] - 2026-06-09

### Fixed
- Generar link público de **Consentimiento Peeling** fallaba con
  `csl_public_form_links_form_type_check` violado: el CHECK de `form_type` no
  incluía `consentimiento_peeling`. Migración aditiva
  `202606090002_public_form_links_peeling.sql` recrea el constraint con todos
  los valores existentes (`ficha_dermatologica`, `consentimiento_masajes`,
  `consentimiento_tatuajes_cejas`, `solicitud_empleo`) + `consentimiento_peeling`.
  `form_type` estándar usado en front y back: **`consentimiento_peeling`**.
  Sin borrado de datos (solo DROP CONSTRAINT del check viejo).

---

## [0.2.1] - 2026-06-09

### Added
- Botón **"Sincronizar directamente con la API"** en la barra superior de
  Clientes (junto a Descargar datos / Unificar / Nuevo cliente). Ejecuta el sync
  manual contra AgendaPro (`POST /api/integrations/agendapro/sync-clients`):
  deshabilita y muestra "Sincronizando…", trae nuevos, actualiza existentes,
  dedup (agendapro_client_id / cédula / teléfono / email), refresca la tabla y
  muestra resumen (nuevos / actualizados / duplicados / omitidos / errores). Si
  el negocio no tiene credenciales, avisa "No hay credenciales AgendaPro
  configuradas para este negocio."
- Permiso de acción **"Sincronizar API"** (`sincronizar-api`): admin/superadmin
  lo ven por defecto; un usuario normal solo si se le asigna. Multi-tenant —
  el token AgendaPro nunca se expone al frontend (la llamada es server-side).

---

## [0.2.0] - 2026-06-09

### Added
- Nuevo módulo **Consentimiento Peeling** (`kind: "peeling"`) en "Clientes y
  Consentimientos", ubicado entre Consentimiento Masajes y Eliminación de
  Tatuajes y Cejas. Clona el flujo completo de los consentimientos existentes:
  - Pantalla interna: selección/creación de cliente, datos, plantilla oficial de
    peeling (contraindicaciones, cuidados antes/después, riesgos, políticas,
    protección de datos), firmas digitales, PDF imprimible e historial.
  - Formulario público (link único + WhatsApp) para firma remota del cliente:
    `components/public-peeling-consent-form.tsx` + `formType:
    "consentimiento_peeling"`.
  - Notificación por email (Resend) `sendConsentPeelingEmail`.
  - Integración en "Historial Fichas y Consentimientos" con filtros por tipo,
    cliente, fecha y sucursal.
- Tabla `csl_consent_peeling` en `db-cls` (self-hosted): RLS multi-tenant por
  `business_id` (Cibao no ve Depicenter y viceversa), grants a `service_role`,
  índices y FKs a cliente/ficha. Migración
  `supabase/migrations/202606090001_csl_consent_peeling.sql`.
- Permiso de menú `consent-peeling` (admin/superadmin lo ven por defecto).

### Notas
- Sin cambios destructivos: solo CREATE TABLE/POLICY/INDEX. Sin DELETE/DROP.

---

## [0.1.0] - 2026-06-09

### Added
- Sistema de versionado y documentación para colaboradores:
  `CHANGELOG.md` + `CONTRIBUTING.md`.
- Mirror del repositorio a Gitea Cibao Cloud: `http://infra:3000/ARB/csl-app`
  (remoto `gitea`, además del `origin` en GitHub).

### Notas
- Línea base del versionado. App multi-tenant (CSL + Depicenter) sobre Supabase
  self-hosted (`db-cls.cibao-cloude.com`). Deploy: auto-promote a producción con
  `vercel --prod --yes` tras cada push aprobado.

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

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

## [0.75.0] — 2026-07-22

### Added
- **Los correos de Masajes, Peeling y Eliminación de Tatuajes/Cejas ahora adjuntan
  su PDF legal formal** (antes solo Depilación Láser). Cada documento reproduce
  1:1 el texto legal que genera el navegador (datos del cliente, procedimiento,
  declaraciones, instrucciones, contraindicaciones, riesgos, políticas, protección
  de datos, autorización y firma). Motor genérico `buildConsentPdf` +
  `lib/server/consent-legal-forms.ts`. Aplica tanto al firmar in-app como por
  enlace público, y por Gmail o el respaldo Resend. Si la generación fallara, el
  correo se envía igual.

### Fixed
- Renderizado de PDF: los párrafos se dibujan por segmentos (una sola cadena por
  tramo del mismo peso), corrigiendo espacios que ocasionalmente se perdían entre
  palabras (p.ej. "Todas las" / "Yo entiendo").

---

## [0.74.0] — 2026-07-22

### Added
- **El correo del Consentimiento de Depilación Láser adjunta el PDF formal** del
  consentimiento (el mismo documento de 4 páginas que descarga el navegador:
  datos del cliente, texto legal completo, aceptación de políticas y firma).
  Se genera en el servidor con `pdf-lib` (nuevo `lib/server/consent-depilacion-pdf.ts`,
  sin navegador headless) y se adjunta tanto por Gmail como por el respaldo Resend.
  Si la generación del PDF fallara, el correo se envía igual (sin adjunto).

---

## [0.73.4] — 2026-07-22

### Added
- **Consentimiento de Depilación Láser ahora envía correo al firmar** (antes NO
  enviaba correo por ninguna vía). Al firmar: llega al **cliente** (correo tomado
  del sistema) + copia al **buzón interno del negocio** (Cibao:
  `cibaospa.consentimientos@gmail.com`), desde el Gmail del negocio. Nueva plantilla
  `consentDepilacionLaserEmailHtml` + `sendConsentDepilacionLaserEmail`.
- **Los consentimientos firmados por enlace público ahora también envían correo**
  (masaje, peeling, tatuajes/cejas y depilación láser). La ruta pública de firma
  guardaba pero nunca notificaba; ahora envía con el mismo flujo por-tenant. El
  fallo de correo no bloquea la confirmación al cliente.

---

## [0.73.3] — 2026-07-22

### Fixed
- **Los consentimientos NO enviaban desde el Gmail del negocio** (ni al cliente ni
  a la copia interna). Causa raíz: `upsertRow` estampa `business_id` en una copia
  interna, así que el objeto en memoria que se pasaba a `sendConsent*Email` tenía
  `business_id` vacío → `resolveGmailCredentialsForBusiness("")` = null → se saltaba
  el Gmail del negocio y caía a Resend con el buzón por defecto. Ahora los handlers
  pasan `getBusinessContext()?.businessId` a las funciones de envío (igual que ya
  hacía la Ficha Dermatológica), y se estampa en `row` para que destinatarios,
  remitente y HTML usen el negocio correcto.
- Log de observabilidad (sin secretos) en `sendBusinessEmail`: registra negocio,
  nº de destinatarios y vía (gmail/resend) + error, visible en los logs de Vercel.

---

## [0.73.2] — 2026-07-22

### Changed
- **Al firmar un consentimiento, el correo del cliente se toma del SISTEMA**
  (registro del cliente `csl_cosmiatria_clientes.email`), no de lo tecleado en el
  formulario. Así el consentimiento (masaje/tatuaje-cejas/peeling) llega al correo
  real del cliente + copia al buzón interno del negocio (para Cibao,
  `cibaospa.consentimientos@gmail.com`). La Ficha Dermatológica aplica el mismo
  criterio (email del sistema primero). Respaldo: si el registro no tiene email,
  se usa el del formulario.
- Los consentimientos ahora **guardan el email en el registro del cliente**
  (`clienteCosmiatriaToDb` lee también `correo`/`Correo`), para que "el sistema"
  quede con el correo del cliente para próximos envíos.

---

## [0.73.1] — 2026-07-22

### Changed
- **Separación por tenant también en el buzón interno** (Ficha Dermatológica +
  Consentimientos). Antes la copia interna usaba una lista global (env), que caía
  a `cibaospalaser@gmail.com` para **todos** los negocios (incluido Depicenter).
  Ahora la copia interna se resuelve **por negocio**: (1) la cuenta de Gmail
  configurada del negocio (`csl_email_settings.gmail_user`) o, si no está
  configurada, (2) el correo de contacto de marca del tenant
  (`cibaospalaser@` / `depicenterskinlaser@`). Así la copia de Depicenter llega
  a su propio buzón, no al de Cibao. Nuevo helper `internalNotifyRecipients`. Los
  correos de RR.HH./Reportes (internos) siguen usando la lista env sin cambios.

---

## [0.73.0] — 2026-07-22

### Added
- **Envío de correos desde el Gmail de cada negocio** (Clientes + Consentimientos).
  Los correos cara al cliente — **Ficha Dermatológica** y los **3 consentimientos**
  (masaje, tatuaje/cejas, peeling) — ahora salen **desde la cuenta de Gmail del
  negocio** (vía SMTP + "contraseña de aplicación"), de modo que el cliente ve el
  correo del negocio y sus respuestas llegan a ese buzón.
  - Nueva pantalla **Sistema → Configuración → Correo** (`EmailConfigDialog`):
    cuenta Gmail remitente + contraseña de aplicación (se guarda **cifrada
    AES-256-GCM**, nunca se muestra luego, solo `••••1234`) + **enviar correo de
    prueba**. Enlace a `myaccount.google.com/apppasswords`.
  - **Separación total por tenant:** cada negocio (Cibao, Depicenter) configura su
    propia cuenta; el resolver de credenciales solo devuelve el Gmail del
    `business_id` pedido — **nunca se cruzan**. Si el superadmin está en "Todos",
    la pantalla pide seleccionar un negocio concreto.
  - **Respaldo sin interrupción:** mientras un negocio no configure su Gmail, el
    envío cae al **Resend** actual (comportamiento previo intacto).
  - Nueva tabla `csl_email_settings` (RLS por `business_id`, migración
    `202607220001`). Nuevos módulos server-only `lib/server/email-settings.ts` y
    `lib/server/gmail-transport.ts` (nodemailer). Rutas
    `GET/PUT /api/settings/email` y `POST /api/settings/email/test`
    (solo admin/superadmin, la UI siempre manda `activeBusinessId`).

---

## [0.72.1] — 2026-07-21

### Fixed
- **Aislamiento por tenant · diálogo de Consentimientos (fuga de clientes entre
  negocios)**. Al generar un consentimiento en Depicenter, la búsqueda de clientes
  mostraba clientes de **Cibao** (p.ej. WILLIAN RODRIGUEZ con sucursal Villa Olga).
  Causa: el diálogo cargaba `getClientesCosmiatria` sin `activeBusinessId`; con un
  superadmin en modo "Todos" el backend devolvía clientes de TODOS los tenants
  (19.111 filas). Ahora el diálogo scopea la búsqueda de clientes, especialistas y
  el guardado **al negocio del que se genera el link** (`currentBusiness`) — mismo
  business que la generación. Reproducido y verificado contra db-cls: con
  `activeBusinessId=Depicenter` devuelve 2.828 (solo Depicenter), sin la fila de
  Cibao.
- **Filtro de sucursal en Clientes**: ya no une una lista hardcodeada con TODAS las
  sucursales (en Depicenter aparecían las de Cibao). Usa solo las del tenant activo;
  el hardcode queda como respaldo únicamente si la BD no trae ninguna.

---

## [0.72.0] — 2026-07-20

### Added
- **AgendaPro · sincronización incremental + auto-sync al entrar**. El botón
  "Sincronizar directamente con la API" ahora es **incremental**: trae solo los
  clientes NUEVOS desde la última sincronización (se detiene al llegar a los ya
  sincronizados, aprovechando que AgendaPro devuelve los más nuevos primero) — ya
  no relee toda la base cada vez. Al **entrar al menú Clientes Cosmiatría** se
  dispara un **auto-sync incremental en segundo plano** (con throttle de 3 min por
  negocio) que importa lo nuevo sin intervención. En "Configurar AgendaPro" ahora
  hay dos botones: **Sincronizar nuevos** (incremental, día a día) y **Sincronizar
  todos** (completo, para la migración inicial). Lógica en
  `lib/agendapro-full-sync.ts` (`runIncrementalAgendaProSync` / `runFullAgendaProSync`).

---

## [0.71.0] — 2026-07-20

### Fixed
- **AgendaPro · sincronización completa de TODOS los clientes**. Antes el sync
  traía solo las primeras páginas (una llamada completa chocaba con el límite de
  tiempo de la función y el botón siempre empezaba en la página 1 → "0 nuevos ·
  150 actualizados"), dejando clientes sin migrar (p.ej. Depicenter 1.449 de
  2.842). Ahora "Sincronizar todos" (diálogo) y "Sincronizar directamente con la
  API" (barra) recorren **todas las páginas en tandas cortas** con progreso en
  vivo, avanzando hasta que AgendaPro deja de devolver datos (`reachedEnd`) o de
  avanzar (guardia por `firstId` repetido). Lógica compartida en
  `lib/agendapro-full-sync.ts`. El endpoint `sync-clients` ahora devuelve
  `reachedEnd` y `firstId` para orquestar el recorrido.

---

## [0.70.1] — 2026-07-20

### Added
- **Configurar AgendaPro también en Sistema › Configuración**. Se agregó una
  tarjeta "Integración AgendaPro" en la página de Configuración con el botón
  "Configurar AgendaPro" (además del botón en Clientes). El botón en Clientes ahora
  es visible para cualquier usuario autenticado (la edición de credenciales sigue
  gateada dentro del diálogo por el servidor) y también aparece en la barra de
  estado de AgendaPro.

### Fixed
- Barra de estado de AgendaPro en Clientes: leía nombres de columna viejos
  (`created_count`/`updated_count`) → mostraba 0. Ahora usa `created`/`updated`/
  `errors` del endpoint `/status`.

---

## [0.70.0] — 2026-07-20

### Added
- **Clientes · Integración AgendaPro multi-tenant (Depicenter)**. Ahora cada
  negocio configura su propia cuenta de la API Pública de AgendaPro y sincroniza
  clientes con separación total por tenant.
  - **Tabla `csl_agendapro_credentials`** (mig `202607200001`): credenciales por
    `business_id`, con la clave CIFRADA (AES-256-GCM, reutiliza el motor de BI) —
    nunca en texto plano; se guarda solo `key_last4` para mostrar `****1234`. RLS
    por tenant.
  - **Módulo `lib/server/agendapro-credentials.ts`**: resuelve la config efectiva
    por negocio (credenciales de BD primero; solo el negocio dueño de las env vars
    legadas —CSL— cae a `AGENDAPRO_*`). Un tenant JAMÁS usa las credenciales de
    otro.
  - **Endpoints**: `POST /credentials` (guardar, gateado por
    `integrations.agendapro.configure` / admin), `POST /test` (probar conexión),
    `GET /status` (estado + última sync + historial). `sync-clients`,
    `import-clients` y `health` ahora resuelven el **negocio ACTIVO** del switcher
    (`applyActiveBusiness`) — antes usaban el negocio del perfil, lo que habría
    mezclado tenants con un superadmin.
  - **UI**: botón **Configurar AgendaPro** en Clientes → diálogo para pegar
    usuario/clave, probar conexión, guardar, sincronizar y ver historial. Todas
    las llamadas envían el `activeBusinessId`.
  - **Permisos**: `integrations.agendapro.view/configure/sync`.
  - Validado contra db-cls: cifrado round-trip, enmascarado, aislamiento CSL↔
    Depicenter y dedup por `business_id` (sin mezclar tenants). CSL (16.273
    clientes) intacto.

---

## [0.69.0] — 2026-07-20

### Added
- **RR.HH. · Asistencia · gráfica profesional "Asistencia y tardanza por empleado"**.
  Se reemplazó la gráfica básica de Recharts por una visualización premium propia
  (`components/hr/attendance-delay-chart.tsx`, sin librerías nuevas) con:
  - **3 KPIs superiores**: Total asistencias (teal), Total tardanzas (coral) y
    Promedio por empleado (2 decimales, azul) — todos calculados de datos reales del
    período/sucursal (0 sin romper si no hay datos).
  - **Filas por empleado**: avatar circular con iniciales, nombre abreviado de forma
    profesional (Angélica María J., María Xaviera A. — sin cortar feo con "…"), barra
    teal de asistencias y barra coral de tardanzas, con el número al final de cada
    barra.
  - **Orden**: asistencias desc → tardanzas desc → nombre asc.
  - **Resaltado de alerta**: empleados con ≥3 tardanzas en fondo rojo muy suave y
    número en rojo fuerte.
  - **Leyenda** arriba a la derecha, **eje inferior** con escala y etiqueta "Número de
    días", gridlines punteadas.
  - **Tooltip** por fila: empleado, asistencias, tardanzas, período y tasa de tardanza.
  - **Responsive**: filas amplias en desktop; en móvil se apilan como tarjetas sin
    cortar nombres ni barras y sin scroll horizontal.
  - **Estado vacío profesional** ("No hay datos de asistencia para este período." +
    botón Actualizar) en lugar de una gráfica rota.
  Respeta business_id, rango de fechas, sucursal y permisos (Cibao no ve Depicenter).

### Removed
- Dependencia de Recharts en la pantalla de Asistencia (la gráfica ahora es CSS puro).

---

## [0.68.4] — 2026-07-20

### Added
- **RR.HH. · Asistencia · números fijos en la gráfica**. La gráfica "Asistencia y
  tardanza por empleado" ahora muestra la cantidad al final de cada barra (fijo,
  siempre visible, sin depender del hover): asistencias en cian y tardanzas en rojo.
  Los ceros se ocultan para no ensuciar la gráfica ni pisar el eje. Se amplió el
  margen derecho para que no se corten los números.

---

## [0.68.3] — 2026-07-20

### Fixed
- **Cuadre Semanal · "no me trae la lectura anterior"**. La pantalla de Cuadre no
  cargaba lecturas propias: dependía del refresh global del store. Al entrar directo
  al Cuadre —o con el store desfasado tras cambiar de sucursal (Depicenter)— el
  histórico `pulseReadings` quedaba vacío y la "lectura anterior" (inicial) salía en
  0, mostrando los pulsos completos como disparos. Ahora la página carga lecturas
  frescas del tenant activo desde la BD al montar y al cambiar de sucursal, y además
  `Continuar →` garantiza histórico fresco ANTES de calcular la inicial (regla
  "Inicio = Fin de la semana anterior"). La lógica `calculateLecturaInicial` ya era
  correcta; el fallo era de datos no cargados. Verificado de punta a punta con el
  archivo real `13_18_Julio_2026.xlsx` de Depicenter (eq1 5.443.919, eq2 1.500.922,
  eq3 1.928.473).

---

## [0.68.2] — 2026-07-20

### Fixed
- **Cuadre Semanal · "formato no reconocido" con archivos de lecturas válidos**. El
  detector solo aceptaba una hoja llamada exactamente "Equipos"; los reportes de
  pulsos vienen con la hoja llamada **"Lecturas"** (mismas columnas: Equipo, Serial,
  Sucursal, Cabina, Operadora, Pulsos, Estado, Fallas). Ahora `detectPulseFileType`
  y `parseEquiposDashboard` reconocen la hoja **"Equipos" o "Lecturas"** y, como
  respaldo, **cualquier hoja cuyo encabezado tenga "Equipo" + "Pulsos"** (aunque esté
  renombrada). Verificado con el archivo real de Depicenter (13_18_Julio_2026.xlsx):
  3 equipos parseados correctamente.

---

## [0.68.1] — 2026-07-20

### Fixed
- **Auditoría PULSE · editar y guardar Pulsos Inicio y Final** ahora funciona y
  persiste. El encadenado (inicio = fin de la semana anterior) seguía como valor por
  defecto, pero impedía que una edición manual del inicio "pegara". Nueva regla: si
  el inicio guardado es DISTINTO al encadenado, ese **override manual manda** (edición
  directa / reset de equipo) — así se pueden editar y guardar ambos valores, sin
  perder el encadenado por defecto. Verificado a nivel BD que inicio+final persisten
  y recalculan DISP LÁSER.

---

## [0.68.0] — 2026-07-20

### Fixed
- **Auditoría PULSE · el fin de la semana anterior ahora es el inicio de la actual,
  encadenado por OPERADOR** (no por equipo_id). Los equipos se reasignan entre
  operadores, así que encadenar por `equipo_id` tomaba el fin de otra máquina/
  operador → inicio disparatado (ej. ASHLEY mostraba inicio 8,637,190 de la máquina
  que antes usaba ROSA). Ahora el inicio de cada semana = la lectura final de la
  semana anterior **del mismo operador** (ej. ASHLEY: 06-29 fin 733,532 → 07-06
  inicio 733,532), y DISP LÁSER se recalcula sobre ese inicio correcto.

---

## [0.67.5] — 2026-07-20

### Fixed
- **Auditoría PULSE · "dice guardado pero no se guarda" (causa real)**: el guardado
  SÍ persistía en la BD, pero la pantalla mostraba datos **viejos/desfasados** (la
  vista no se re-sincronizaba con la base), por lo que parecía que no guardaba.
  Ahora, tras guardar (o editar la auditoría), se **recargan los datos frescos**
  desde la BD (`getAllPulsosData`) y la pantalla refleja siempre lo persistido.
  Confirmado con datos reales: una lectura mostraba inicio 8,637,190 en pantalla
  mientras la BD tenía 733,532.

---

## [0.67.4] — 2026-07-19

### Fixed
- **Auditoría PULSE · guardar robusto**: si el `id` de la lectura que tiene el
  navegador quedó desactualizado (p.ej. tras un re-import que regeneró la fila), el
  update por id matcheaba 0 filas y el guardado fallaba. Ahora, si el update por id
  no encuentra la fila, cae automáticamente a un upsert por la clave natural
  (business_id, equipo_id, period_start, period_end), de modo que la edición
  **siempre persiste** sin duplicar. Verificado: el UPDATE a nivel BD funciona; el
  fallback cubre el caso de id obsoleto.

---

## [0.67.3] — 2026-07-19

### Fixed
- **Auditoría PULSE · "dice guardado pero no se guarda"** (el valor volvía al
  anterior tras guardar, aunque la BD sí persistía). Causa: una recarga automática
  (cada 60s) que arrancaba ANTES del guardado aterrizaba DESPUÉS y sobrescribía el
  valor en pantalla con datos previos. Ahora el modal de edición marca "formulario
  abierto" (el auto-refresh se salta mientras editas) y se invalida el snapshot
  cacheado tras guardar/eliminar, para que ninguna recarga en vuelo pise la edición.

---

## [0.67.2] — 2026-07-19

### Fixed
- **Auditoría PULSE · columna "Eq."** ahora muestra el equipo que el operador tiene
  asignado en el catálogo de **Equipos** (`csl_equipos`), no el `equipo_id` crudo de
  la lectura (que a veces viene mal del archivo). El resolver `operadora-oficial`
  expone `equipoDeOperadora(sucursal, operadora)` (prefiere la máquina real con
  serie sobre placeholders). Aplica a la tabla, el orden, el Excel y el modal de
  edición. Ej.: ASHLEY ahora muestra su equipo 1 (no 4), ROSA el 4 (no 6).

---

## [0.67.1] — 2026-07-19

### Fixed
- **Auditoría PULSE · editar una lectura no persistía** (guardaba pero al recargar
  volvía al valor anterior / se duplicaba la fila). Causa: `savePulseReading`
  actualizaba por la clave compuesta `(business_id, equipo_id, period_start,
  period_end)`; un desfase de 1 día en las fechas (zona horaria) hacía que el
  upsert NO matcheara la fila existente y creara una nueva. Ahora, si el payload
  trae `id` (edición), se actualiza **esa fila por id** (exacto, sin duplicar);
  el upsert por clave compuesta se reserva para lecturas nuevas del importador.

---

## [0.67.0] — 2026-07-18

### Added
- **BI Financiero · Caché de análisis IA (ahorro de tokens)**. Cada análisis se
  guarda con un *fingerprint* (SHA-256) de los datos + pregunta + modelo + pantalla.
  Si repites la misma consulta para el mismo período/sucursal y **los datos no
  cambiaron**, el asistente **reutiliza el análisis guardado sin llamar a OpenAI
  (0 tokens)**. Si los datos cambian, el fingerprint cambia y se re-analiza
  automáticamente. Los aciertos de caché **no consumen** el límite de uso/gasto.
  La UI muestra "Análisis reutilizado · 0 tokens" y un botón "Volver a analizar
  (gasta tokens)" para forzar una respuesta fresca. Migración aditiva
  `202607180002` (columna `data_hash` + índice).

---

## [0.66.7] — 2026-07-18

### Fixed
- **BI Financiero · Asistente IA con modelos GPT-5 / o-series**: fallaba con
  *"Unsupported parameter: 'max_tokens' … Use 'max_completion_tokens'"*. El endpoint
  ahora envía `max_completion_tokens` (no `max_tokens`) para gpt-5.x/o1/o3/o4/gpt-4.1,
  omite `temperature` en los modelos de razonamiento (que solo aceptan el valor por
  defecto), y **reintenta adaptándose** si la API rechaza cualquier parámetro
  (robusto a modelos futuros). Además aplica un **piso de tokens** en modelos de
  razonamiento para que la respuesta no salga vacía (consumen tokens "pensando").

---

## [0.66.6] — 2026-07-18

### Added
- **BI Financiero · Alertas · regla "mes en curso"**: el mes actual (incompleto)
  ya **no se evalúa** hasta cerrarlo — sus datos están parciales y toda comparación
  o umbral saldría distorsionado. Al "Recalcular" el mes en curso no genera alertas
  y avisa: "es el mes en curso: no se evalúa hasta cerrarlo".

---

## [0.66.5] — 2026-07-18

### Fixed
- **BI Financiero · Alertas · indicador "caída de ventas" confuso**. (1) Ya **no
  genera** la alerta cuando el período tiene RD$0 de ventas (mes sin datos
  importados ≠ caída del 100%). (2) El mensaje ahora es explícito: nombra ambos
  meses y sus montos ("Ventas de Junio 2026 bajaron 50.1% vs may 2026 · RD$… vs
  RD$…"). (3) "Recalcular" ahora reemplaza **todas** las alertas de sistema del
  período (antes solo las abiertas), eliminando el duplicado resuelta+abierta.
- Datos: eliminada la alerta falsa de julio 2026 (RD$0 → -100%).

---

## [0.66.4] — 2026-07-18

### Fixed
- **BI Financiero · los filtros "no funcionaban"**. Causa raíz: el **auto-salto**
  al último mes con ventas se disparaba también DESPUÉS de que el usuario cambiaba
  el filtro — al elegir un período/sucursal sin ventas (ingresos = 0) revertía la
  selección al mes con datos. Ahora el auto-salto solo ocurre **una vez, en el mes
  actual pristino** (default sin tocar); cualquier selección manual se respeta.
- **Rehidratación robusta del store de filtros**: clave nueva + `merge` que
  garantiza `quick`/`from`/`to` coherentes (usuarios con estado viejo en el
  navegador ya no quedaban con el rango vacío).
- **Alertas**: mensaje de estado vacío más claro cuando hay alertas en otros
  períodos ("Hay N en total — pon Año = Todos").

---

## [0.66.3] — 2026-07-18

### Changed
- **BI Financiero · Alertas financieras** ahora usa la **misma barra de filtros**
  que las demás pantallas (`BiFilterBar`: Mes + Año + rango Desde/Hasta + Sucursal),
  con el selector de Estado y el botón "Recalcular" integrados. Las alertas se
  filtran por rango de período (el período de la alerta dentro del rango) y por
  sucursal (la seleccionada + las consolidadas); "Año = Todos" muestra todos los
  períodos. Los conteos por estado siguen siendo globales para orientar.

---

## [0.66.2] — 2026-07-18

### Fixed
- **BI Financiero · Alertas financieras**: el filtro **no actualizaba** la lista.
  Causa: la carga tenía dependencias vacías y `getBiFinanceAlerts` ignoraba el
  período/estado. Ahora la lista reacciona a los filtros: **Estado** (Abiertas /
  Todas / Revisadas / Resueltas / Descartadas, con conteos) y **Vista** (Todos los
  períodos / Del período con Mes+Año). `getBiFinanceAlerts` filtra por período,
  estado y severidad server-side y devuelve conteos por estado.

### Changed
- **Reglas de alertas más completas**: además de sucursal en pérdida y margen
  consolidado <15%, ahora marca **sucursal con margen bajo (<10%)** y **gasto sobre
  ingresos >85%**. "Recalcular" muestra cuántas alertas generó y salta a ese período.

---

## [0.66.1] — 2026-07-18

### Added
- **BI Financiero · Inversiones y ROI**: filtro por **Año** (Todos / 2025 / 2026…)
  y columna **Sucursal** en la cartera; los KPIs (total invertido, inversiones, ROI,
  en curso) responden al año seleccionado.

### Migración de datos
- Cargadas las **inversiones 2025–2026** (26 filas, RD$25,337,833) en
  `bi_finance_investments` (tenant CSL, marcador `MIG-INVERSION-HIST`, no afectan el
  P&L): consolidado 2025 (12) + consolidado 2026 ene-may (5) + Villa Olga 2025
  sept-dic (4) + Villa Olga 2026 ene-may (5). Sumas validadas contra los totales.

---

## [0.66.0] — 2026-07-18

### Added
- **BI Financiero · barra de filtros completa** (misma que "Ventas por sucursal"
  de Incentivos): **Mes + Año + rango Desde/Hasta + Sucursal**, con chips de
  filtros activos, auto-aplicar (sin botón buscar) y "Limpiar". Aplicada a los
  menús que corresponden: Dashboard financiero, Ventas e ingresos, Gastos y
  egresos, Rentabilidad por sucursal, Reportes ejecutivos y Asistente IA. El
  filtro es independiente por sesión (no comparte estado con el módulo de comisión).

### Changed
- El agregador `getBiFinanceSummary` y el asistente ahora trabajan por **rango de
  fechas** (`from`/`to`), no solo por mes: permite consultar un mes, un año
  completo, un rango personalizado o todo el historial. La etiqueta del período y
  la tendencia se anclan al mes final del rango. Proyecciones y Alertas conservan
  su ancla mensual (aplican por mes).

---

## [0.65.1] — 2026-07-18

### Fixed
- **BI Financiero · "no aparecen ingresos"**: el módulo abría por defecto en el mes
  actual, que puede no tener ventas (las ventas cargadas van hasta jun-2026), por lo
  que mostraba ingresos en 0. Ahora el BI salta automáticamente (una vez por sesión)
  al **último mes con ventas** y muestra un aviso con botón "Ver <mes>" cuando el
  período seleccionado no tiene ventas. `getBiFinanceData` devuelve `latestPeriod`.

### Migración de datos
- Cargados los **gastos históricos 2025–2026** desde `GASTOS 2025 Y 2026.xlsx`
  (totales mensuales por sucursal): 42 filas en `expenses` (tenant CSL,
  `reference='MIG-GASTOS-HIST'`), total RD$33,580,691, cuadrado contra los totales
  del propio archivo. Cobertura: RAFAEL VIDAL y LOS JARDINES 2025 completo + 2026
  ene–jun; VILLA OLGA solo 2026 ene–jun.

---

## [0.65.0] — 2026-07-18

### Added
- **BI Financiero · Configuración IA segura y completa.** El admin autorizado ya
  puede **pegar la API key de OpenAI** desde la pantalla (campo password); viaja por
  HTTPS y se guarda **cifrada (AES-256-GCM)** en `bi_finance_ai_secrets` — nunca en
  el frontend, nunca en logs, solo se muestra como `sk-****abcd`. Ruta dedicada
  `POST /api/bi-finance/openai-key` (guardar/eliminar/estado) con validación de
  permiso. Nuevo permiso `bi_finance.ai_secrets.manage`.
- **Selección de modelos**: selector con lista de modelos recientes (gpt-5.2, 5.1,
  5, 5-mini, 5-nano, 4.1/mini/nano, 4o/mini) + botón **"Actualizar modelos"** que
  consulta `GET /v1/models` de OpenAI y cachea (`bi_finance_ai_models_cache`);
  modelos antiguos marcados como *legacy*; recomendados por tier. El modelo se
  guarda por negocio (`bi_finance_settings.model`).
- **Control de uso y gasto**: límites de consultas (día/mes), tokens (entrada/salida/
  totales por mes) y **gasto máximo mensual** con umbrales 70%/90% y bloqueo al 100%
  (superadmin exento). Bitácora de consumo `bi_finance_ai_usage_logs` (tokens reales
  de OpenAI + costo estimado). Precios editables por modelo `bi_finance_ai_model_pricing`
  (sin hardcodear; si falta precio, el costo queda "Pendiente" y no bloquea por gasto).
- **Tablero de consumo** en Configuración IA: consultas del mes, tokens, costo
  estimado, modelo más usado, última consulta y barra de progreso del límite.
- La activación del asistente ya se controla desde la pantalla
  (`bi_finance_settings.enabled`), sin depender de una variable de entorno.
- Migración aditiva `202607180001`: 9 columnas de límites en `bi_finance_settings`
  + 4 tablas (`ai_secrets`, `ai_usage_logs`, `ai_model_pricing`, `ai_models_cache`)
  con RLS por tenant.

### Changed
- El asistente resuelve la API key primero del negocio (DB cifrada) y, si no hay,
  de `OPENAI_API_KEY` (env). Antes de responder valida límites de uso/gasto; después
  registra el consumo real. Configuración 100% por negocio (Cibao ≠ Depicenter).

### Fixed
- Configuración IA: el admin **no podía pegar la API key** porque la pantalla anterior
  no tenía campo para hacerlo (era solo lectura del estado de env). Ahora existe el
  flujo seguro de configuración.

### Security
- API key cifrada en reposo (AES-256-GCM), clave de cifrado derivada de un secreto
  del servidor; nunca expuesta al cliente ni registrada. Auditoría de eventos
  (`api_key_configured`, `models_refreshed`, `openai_test_connection`,
  `ai_request_blocked_limit`, `ai_request_success/error`).

---

## [0.64.1] — 2026-07-18

### Added
- **BI Financiero · Asignación de gastos con prorrateo configurable**: la nómina y
  los gastos sin sucursal se tratan como *overhead* y se prorratean entre sucursales
  según su participación en ingresos (toggle "Prorratear gastos generales" en
  Configuración IA; `bi_finance_settings.extra.allocate_overhead`, default activo).
  Con el toggle apagado, el overhead se muestra como fila "(sin sucursal)". El total
  de gastos es idéntico en ambos modos.
- **Dashboard · Insights automáticos** por reglas sobre datos reales (margen,
  ventas vs mes anterior, sucursal más/menos rentable, aviso si Compras está vacío).
- Tendencia de 6 meses ahora incluye nómina y pagos recurrentes (consistente con el P&L).

### Fixed
- **BI Financiero · nómina**: la agregación intentaba leer `csl_empleados.sucursal`
  (columna inexistente) y perdía el desglose. El sistema no relaciona empleado→sucursal,
  así que la nómina se contabiliza como overhead del período (verificado: nómina real
  RD$238,609 de junio 2026 ahora entra correctamente al P&L).

### Verified
- Ingresos por sucursal cuadran contra `sales_commission_sales` (jun 2026 CSL:
  RV+LJ+VO = RD$2,558,505). Endpoint `/api/bi-finance/assistant` en prod responde 401
  sin token (seguro). Módulo visible en producción.

---

## [0.64.0] — 2026-07-17

### Added
- **Módulo BI Financiero IA** (asistente financiero estratégico con OpenAI). Nuevo
  menú "BI Financiero IA" con 10 pantallas: Dashboard financiero, Asistente IA,
  Ventas e ingresos, Gastos y egresos, Rentabilidad por sucursal, Proyecciones,
  Inversiones y ROI, Alertas financieras, Reportes ejecutivos y Configuración IA.
  Respeta permisos y `business_id` (Cibao y Depicenter NUNCA se mezclan).
- **Asistente IA seguro** (`POST /api/bi-finance/assistant`): OpenAI 100% backend
  (la API key nunca sale del servidor), valida sesión + permiso `bi_finance.ai_chat`
  + business_id, arma el contexto financiero REAL agregado (sin PII), responde en
  formato estructurado (resumen ejecutivo, hallazgos, riesgos, recomendaciones,
  plan de acción, nivel de confianza, datos faltantes), persiste y audita cada
  consulta. Reglas: usa solo datos reales; si faltan → "No tengo datos suficientes
  para confirmar esto."; cada recomendación termina en "Recomendación sujeta a
  revisión administrativa."; la IA solo recomienda, no decide.
- **Agregador financiero central** `lib/server/bi-finance.ts` (fuente única):
  reutiliza la agregación probada de comisión para ingresos y consulta directa de
  gastos (facturas + gastos generales + menores + recurrentes + nómina) para el
  P&L por sucursal (utilidad neta = ingresos − gastos, margen neto), tendencia de
  6 meses y pacientes. No crea tablas paralelas de ingresos/gastos.
- **12 permisos** `bi_finance.*` (view/dashboard/ai_chat/sales/expenses/
  profitability/forecasts/investments/alerts/reports/config/export).
- **5 tablas** (migración aditiva `202607170002`, RLS por tenant + grants a
  service_role): `bi_finance_ai_queries`, `bi_finance_alerts`,
  `bi_finance_investments`, `bi_finance_forecasts`, `bi_finance_settings`.
- **Proyecciones** (promedio móvil + tendencia lineal + escenarios base/optimista/
  conservador), **Inversiones/ROI** (ROI = (beneficio−inversión)/inversión, payback
  en meses), **Alertas** por reglas sobre datos reales (margen bajo, sucursal en
  pérdida, caída de ventas), **Reportes ejecutivos** Excel multihoja + PDF imprimible
  (branding por tenant), y **Configuración IA** por tenant (modelo/temperatura/
  tokens/prompt/límite + "Probar conexión") — la key permanece solo en env.

### Security
- La API key de OpenAI reside únicamente en variable de entorno del servidor
  (`OPENAI_API_KEY`); nunca se guarda en BD ni se expone al cliente. El asistente
  usa solo datos agregados del negocio activo y audita cada consulta.

---

## [0.63.0] — 2026-07-17

### Added
- **Número de cuenta bancaria por prestador.** Nueva columna `account_number` en
  `sales_commission_collaborators` (migración `202607170001`, aplicada a db-cls). Se muestra/edita en el
  editor "Personal que aplica incentivo láser" (columna "Cuenta") — igual que el resto, se agrega/edita/
  elimina/mueve de sucursal ahí mismo. Se exporta en la **columna M ("Cuenta")** de la hoja "Liquidación
  final" del Excel (y "Ventas por Prestador"): `getCommissionDashboard` adjunta la cuenta del roster a
  cada cálculo por nombre canónico. Sembradas 23 cuentas (25 filas, cubre multi-sucursal); solo ISAURY
  quedó sin cuenta (no estaba en la lista). El servidor solo toca la cuenta cuando se envía (no se borra
  al activar/inactivar).

---

## [0.62.3] — 2026-07-17

### Fixed
- **Nombre canónico JOHELY (antes se mostraba "JOELY" en algunas pantallas).** El alias mapeaba
  "JOHELY → JOELY"; se invirtió a "JOELY → JOHELY" en `lib/commission/normalize.ts` para que el motor
  use **JOHELY** en todo el módulo (misma persona, mismo cálculo). Renombrado también en el roster y el
  libro de liquidación. Test de alias actualizado.

---

## [0.62.2] — 2026-07-17

### Fixed
- **"Detalle de comisión por categoría" ahora cuadra con el motor/liquidación (base NETA).**
  Usaba la venta **BRUTA** (`gross_amount`) × %, mientras el motor netea la **tarjeta −27%** y usa su
  atribución → no coincidía (ej. EIDYLEE Tatuajes: bruto 5,300 vs neto 4,328). Regla confirmada por el
  negocio: comisión de servicios sobre **neto de tarjeta**. `getCommissionServiceDetail` se reconstruye
  desde el `serviceBreakdown` del run (base neta, %, monto por categoría/prestador), corriendo el motor
  por sucursal del período. Cuadra exacto con Cálculo mensual / Reportes / Liquidación. Tests 154/154 + 17/17.

---

## [0.62.1] — 2026-07-17

### Changed
- **Orden de sucursales en filtros y menús de comisión: Rafael Vidal → Los Jardines → Villa Olga**
  (antes salía alfabético con "Los Jardines" primero, tras hacerlas tenant-scoped en 0.61.0). Nuevo
  orden preferido por tenant `COMMISSION_BRANCH_ORDER` + `orderCommissionBranches(slug, branches)` en
  `lib/business.ts`; lo usan el hook `useCommissionBranches()` (cliente) y `readTenantBranches()`
  (servidor). Las sucursales no listadas quedan al final, alfabéticas. Cada tenant define su orden.

---

## [0.62.0] — 2026-07-17

### Fixed
- **Reportes/Liquidación/Comisiones por prestador CUADRAN con Cálculo mensual (láser y bono ya aparecen).**
  El libro de liquidación (`sales_commission_calculations`, que leen esos 3 menús + el dashboard de
  Reportes) se llenaba desde el IMPORT con **láser=0 y bono=0**, mientras el motor corregido
  (Cálculo mensual → `sales_commission_runs`) sí los calcula, en una tabla aparte **desconectada**.
  Ahora al **guardar el Cálculo mensual** (`saveCommissionRun`) se **materializa** el run corregido
  en el libro: `materializeRunToLedger` upsertea por (período, prestador, sucursal) los valores del
  motor (productos, servicio corregido con evaluación/exclusiones, **láser, bono, limpieza**, bruto,
  neto), **preservando** estado (aprobado/pagado), `fixed_incentive` y `manual_adjustment`. Fuente
  única = el motor; bono/limpieza se editan en el editor de personal (roster) + compuerta por sucursal.
  Para materializar un período hay que **guardar su Cálculo mensual por sucursal**. Tests 154/154 + 17/17.

---

## [0.61.0] — 2026-07-17

### Fixed
- **Módulo de Incentivos/Comisiones: sucursales por TENANT (independiente), no las 3 de CSL.**
  Las sucursales estaban hardcodeadas (`["RAFAEL VIDAL","LOS JARDINES","VILLA OLGA"]`) en 8
  componentes + el servidor, así que cualquier tenant (Depicenter) veía/calculaba con las de CSL.
  Ahora salen del catálogo del tenant activo:
  - **Cliente:** hook `useCommissionBranches()` (`db.sucursales` del tenant, MAYÚSCULAS canónicas)
    reemplaza `BRANCHES` en `laser-personnel-editor`, `comision-calculo/dashboard/pages/liquidacion/
    prestadores/reportes/sin-prestador`.
  - **Servidor:** `readTenantBranches()` (lee `csl_sucursales` del `business_id`, MAYÚSCULAS; fallback
    al roster) reemplaza `LASER_BRANCHES` en los loops de "Todas las sucursales" y dashboards anuales.
  Para CSL el resultado es idéntico (catálogo Title Case → MAYÚSCULAS = las 3 canónicas). Tests
  commission 154/154 + smoke mensual 17/17. (Nota: `normalize.ts`/`reception-splits.ts` siguen con
  reglas de datos propias de CSL, inertes para otros tenants.)

---

## [0.60.0] — 2026-07-17

### Added
- **Aporte de limpieza (RD$400) por sucursal, con compuerta Sí/No** en "Reglas de comisión".
  Nueva sección "Aporte de limpieza por sucursal" que lista cada sucursal del roster con un
  toggle: en **No aplica**, nadie de esa sucursal aporta limpieza (RD$0); en **Sí aplica**, cada
  colaborador aporta su propio monto (default 400, editable/0 por persona). Se respalda en reglas
  `cleaning_applies_branch` (flag por `branch`); el motor (`run-engine`) aplica la compuerta
  (`cleaningAppliesByBranch`). Default = aplica → cero cambio hasta que se apague una sucursal.
  Tests: commission 154/154, smoke mensual 17/17 (cuadre 0.00).
- **Cambiar de sucursal a un empleado** desde el editor "Personal que aplica incentivo láser":
  la sucursal pasó de solo-lectura a un selector editable (usa el update existente del servidor;
  si choca con el índice único de la sucursal destino, muestra el error). Activar/inactivar,
  agregar y multi-sucursal (una fila por sucursal) ya existían.

---

## [0.59.1] — 2026-07-17

### Fixed
- **Especialistas mezclaban tenant (salían las de Cibao Spa Laser estando en Depicenter/La Vega).**
  En el diálogo de generar link, `clientes` y `especialistas` se cargaban una sola vez
  (`if length===0`) y NO se refrescaban al cambiar de negocio activo (superadmin), quedando
  cacheadas las del primer tenant abierto. Fix: al cambiar `currentBusiness.slug` se descartan
  ambas listas para recargar las del tenant correcto (el backend ya scopea por `business_id`).
  Además, la lista cerrada de especialistas de **masajes** (`MASSAGE_SPECIALISTS`, de CSL) ahora
  SOLO se usa en CSL; en otros tenants se captura el nombre libremente — tanto en el diálogo como
  en el formulario interno. Regla: **un tenant nunca muestra datos de otro.**

---

## [0.59.0] — 2026-07-17

### Added
- **Firma presencial en tablet para consentimientos.** Además de "Enviar por WhatsApp",
  el diálogo de generar link (`LinkGeneratorDialog`) ahora ofrece **"Firmar en esta tablet"**,
  que abre el MISMO formulario público (token de un solo uso, misma validación y guardado) en
  una pestaña nueva para que el cliente lo complete y firme ahí mismo, sin pasar por WhatsApp.
  Al ser el diálogo compartido, aplica a **todos** los menús de consentimiento: Masajes, Peeling,
  Eliminación de Tatuajes y Cejas, Depilación Láser y Ficha Dermatológica. Respeta el tenant
  activo (Depicenter vs CSL) igual que el envío por WhatsApp.

---

## [0.58.2] — 2026-07-17

### Fixed
- **Link de WhatsApp de consentimientos salía con el tenant equivocado (Cibao bajo Depicenter).**
  El diálogo `LinkGeneratorDialog` creaba el link con un `fetch` crudo que **no enviaba
  `activeBusinessId`**, así que el backend usaba el negocio del *perfil* del usuario (CSL) en vez
  del tenant activo (Depicenter) — mezclando tenants en el mensaje, la vista previa (OG) y el
  formulario público. Ahora envía `activeBusinessId: businessIdForSlug(currentBusiness.slug)`
  (mismo patrón ya usado en RRHH `generateSolicitudLink`). `applyActiveBusiness` ignora el valor
  para usuarios normales (no pueden saltar de tenant) y scopea al superadmin al tenant activo.
  Regla: **un tenant nunca afecta al otro.** Test `scripts` de marca por tenant: 11/11 OK.

---

## [0.58.1] — 2026-07-17

### Added
- **Correo de contacto por tenant** en la marca canónica (`getBusinessBranding().contactEmail`):
  CSL → `cibaospalaser@gmail.com`, Depicenter → `depicenterskinlaser@gmail.com`. Se usa en el
  texto de "Protección de datos" del consentimiento de peeling (interno + público, pantalla y PDF),
  reemplazando el correo de CSL que aparecía bajo Depicenter.

---

## [0.58.0] — 2026-07-17

### Fixed
- **Consentimientos ahora usan la marca del tenant activo (Depicenter vs CSL).**
  El texto legal y los formularios salían a nombre de "Cibao Spa Laser" aunque el
  tenant fuera **Depicenter**. Ahora todo consentimiento (interno y público) toma el
  nombre desde la marca canónica `getBusinessBranding(slug)` (`lib/business.ts`):
  CSL → "Cibao Spa Láser", Depicenter → "Depicenter Skin Laser". Cero regresión para CSL.
  - Interno `components/consentimientos-page.tsx` (masajes/peeling/tatuajes/depilación):
    impresión, vista en pantalla, `DetailDialog` y guardado normalizan la marca (helper
    `applyBrand` + red de seguridad `replace(/Cibao Spa L[aá]ser/g, marca)`).
  - Formularios públicos (los que abre el cliente por WhatsApp): `public-masajes-`,
    `public-peeling-`, `public-tatuajes-`, `public-depilacion-laser-`,
    `public-ficha-consent-form.tsx` — nombre del tenant en cuerpo, PDF y pie.
  - Ficha dermatológica: `cosmiatria-ficha-page.tsx` (impresión) y `lib/dermo-server.ts`
    (PDF + correo Resend: encabezado, asunto y `from` por tenant).

### Added
- **Logo del tenant en los formularios públicos.** Antes el encabezado era solo texto;
  ahora muestra la imagen del logo (Depicenter/CSL según tenant) en pantalla y en el PDF,
  con el color primario del tenant. Reutiliza `public/brands/depicenter-logo.jpg`.

### Changed
- **Envío por WhatsApp dividido por tenant sin fallback a CSL.**
  `app/api/public-form-links/route.ts` toma el nombre del negocio desde la marca canónica
  (vía `ctx.businessSlug`), no desde un mapa hardcodeado. Se eliminó el fallback duro a
  "Cibao Spa Laser".

---

## [0.57.1] — 2026-07-17

### Changed
- **Reparto de recepción: se incluye "LOS JARDINES ENCARGADA 2"** entre LESLIE y YADIBEL
  (mismas destinatarias que ENCARGADA 1). Ahora LOS JARDINES reparte las dos cuentas
  ENCARGADA 1 y ENCARGADA 2; cada cuenta se reparte por separado (unidades ÷ 2). Las
  demás cuentas de recepción de la sucursal ("operaciones") siguen sin repartirse.
  Tests 154/154.

---

## [0.57.0] — 2026-07-17

### Added
- **Reparto de ventas de PRODUCTO de recepción entre prestadoras designadas**
  (`lib/commission/reception-splits.ts`, fuente única). Ciertas cuentas de recepción
  (rol "Recepcionista", no comisionables) reparten sus ventas de PRODUCTO en partes
  iguales por UNIDADES (reparto entero, remanente a las primeras: 100 u ÷ 3 → 34/33/33)
  entre prestadoras de la misma sucursal. Cada destinataria aplica SU tarifa de producto.
  Alcance confirmado con el usuario: **solo estas 3 cuentas** (las demás cuentas de
  recepción NO se reparten), **solo PRODUCTO**, insumos sin incentivo (rasuradoras)
  excluidos del pool:
  - **RAFAEL VIDAL** · "PC Recepcion LAP TOP R VIDAL" → LUISA, YANIBEL, KARLA
  - **LOS JARDINES** · "ENCARGADA 1" (no "ENCARGADA 2") → LESLIE, YADIBEL
  - **VILLA OLGA** · "ENCARGADA" → ANGELICA, GIPSY
- `allocateInt(total, n)` en `run-engine` (reparto entero en partes iguales) y campo
  `receptionSplits` en el input del motor; el reparto se calcula en la liquidación.
- Acción/reporte `getCommissionReceptionSplit` + tabla "Reparto de productos de recepción"
  en pantalla y hoja de Excel "Reparto Recepción" (Sucursal · Cuenta · Unidades · Reparto
  por prestadora · Incentivo) para transparencia.
- Estas ventas ya no aparecen en "Ventas sin prestador" (se reparten automáticamente).
- Tests del motor: casos de `allocateInt` y del reparto (152/152 en verde).

> **Para aplicar:** re-correr **Cálculo mensual** de los meses afectados.

---

## [0.56.1] — 2026-07-16

### Changed
- **Anestesia: se excluye SOLO el servicio "APLICACION DE ANESTESIA", NO los productos
  anestésicos.** Por decisión del negocio, los productos `ANESTESIA ENCAIN` y
  `ANESTESIA ZK-INA` **sí** vuelven a pagar incentivo de producto (≈RD$19,500 histórico);
  únicamente el servicio de aplicación queda sin incentivo. Patrón ajustado en
  `exclusions.ts`: `["RASURADORA", "APLICACION DE ANESTESIA"]` (antes `"ANESTESIA"` amplio).
  Rasuradoras y el prestador Carlos Arias siguen excluidos igual. Tests 140/140.

---

## [0.56.0] — 2026-07-16

### Added
- **Exclusiones de incentivo centralizadas** (`lib/commission/exclusions.ts`, fuente única
  usada por el motor de liquidación y por el reporte/deltas de asignación):
  - **Rasuradoras y anestesia NO pagan incentivo.** Son insumos que se le cobran al
    cliente pero no comisionan. Patrones por nombre: `RASURADORA`, `ANESTESIA` (cubre
    `RASURADORAS`, `ANESTESIA ENCAIN`, `ANESTESIA ZK-INA` y `APLICACION DE ANESTESIA`).
    Antes generaban incentivo de producto por unidad (≈RD$100/u): impacto histórico
    ≈RD$16,800 rasuradoras + ≈RD$19,500 anestesia.
  - **El prestador CARLOS ARIAS (Administrador Local) nunca cobra incentivo**, aunque se
    le asigne una venta manualmente. Ya quedaba fuera por rol "Administrador"; ahora es
    una regla explícita y robusta.
  - Las ventas excluidas **siguen contando en la facturación/ingreso** del negocio
    (reporte por sucursal y medios de pago): la exclusión aplica solo al incentivo.
- Tests del motor: 10 casos nuevos de exclusión (139/139 en verde).

### Changed
- `RunSaleRow` lleva ahora `serviceName` (opcional) para poder excluir insumos por nombre;
  el motor (`run-engine`) salta ítems sin incentivo y prestadores excluidos en la
  atribución de servicio y producto; `readRunSales`, `assign/unassign/reassign` y
  `getCommissionServiceDetail`/`effectiveProvider` aplican el mismo criterio.

> **Para aplicar:** re-correr **Cálculo mensual** de los meses afectados (el reporte lee
> las liquidaciones persistidas; el neteo/exclusión se materializa al recalcular).

---

## [0.55.2] — 2026-07-16

### Fixed
- **Incentivos de Ventas · el tramo del incentivo de láser ahora NETEA la TARJETA por
  sucursal antes de aplicar la escala.** El reporte (`getCommissionLaser`) calculaba el
  tramo sobre la venta láser **bruta** de cada sucursal, mientras que la liquidación real
  (`run-engine.ts`) netea la tarjeta (`bruta × (1 − cardPct)`, efectivo/transferencia/otros
  completos) **antes** de la escala. Ahora el reporte replica el motor: por cada venta
  láser con método `TARJETA` descuenta el `%` de tarjeta (27% por defecto), acumula la
  **base neta por sucursal** y con esa base determina el tramo y el fondo. Esto no solo
  reduce la base sino que puede **cambiar el tramo** (p. ej. junio 2026 RAFAEL VIDAL:
  bruto 813,000 → tramo 4%, pero base neta 711,574.50 → tramo 3%). El `%` y el incentivo
  varían mes a mes según la venta de cada sucursal, ya cubierto por el enfoque por sucursal.
- La tabla "Incentivo láser · tramo por sucursal" del reporte y una nueva hoja de Excel
  ("Láser · Tramo Sucursal") ahora muestran **Venta láser (bruta)**, **Base neta**,
  **Tramo %** y **Fondo** por sucursal, con el `%` de tarjeta neteado indicado.

---

## [0.55.1] — 2026-07-16

### Fixed
- **Incentivos de Ventas · el tramo del incentivo de láser ahora es POR SUCURSAL.**
  El reporte (`getCommissionLaser`) calculaba el tramo/% sobre la venta láser TOTAL
  combinada de todas las sucursales (`fondo = ventaTotal × %único`), mientras que la
  liquidación real ya lo hacía por sucursal. Ahora el reporte también calcula el tramo
  con la **venta láser individual de cada sucursal** (cada una cae en su propio tramo)
  y el fondo total = suma de fondos por sucursal.

### Added
- **Reportes · tabla "Incentivo láser · tramo por sucursal"**: muestra por sucursal la
  venta láser, el % del tramo aplicado y el fondo, con total.

---

## [0.55.0] — 2026-07-16

### Added
- **Incentivos de Ventas · Reportes — tabla "Comisión por prestador" con TODAS las
  prestadoras.** El "Detalle de comisión por categoría" solo mostraba SERVICIOS
  (excluye láser y productos por diseño), así que las empleadas cuya comisión venía
  de láser o productos **no aparecían**. Se agrega una tabla que lista a **todas** las
  prestadoras con su desglose: Inc. productos · Com. servicios · Inc. láser · Bono ·
  Bruto · Neto (los mismos datos de la hoja "Ventas por Prestador" del Excel, que ya
  se traían pero no se mostraban en pantalla).

---

## [0.54.2] — 2026-07-16

### Fixed
- **Incentivos de Ventas · Reportes — BLINDAJE anti-bucle definitivo.** Además de
  memoizar `filters` (v0.54.1), la pantalla de Reportes ahora dispara la carga por
  **VALOR** (`inputsKey` = apiUrl|año|mes|JSON(params)) vía `useRef`, no por identidad
  del callback `load`. Así, aunque cualquier dependencia sea un objeto nuevo en cada
  render, el efecto NO se re-dispara → es **imposible** que las 7 consultas entren en
  bucle (que tumbaba la sesión → "Inicia sesión con Supabase" / "sesión inválida").

---

## [0.54.1] — 2026-07-16

### Fixed
- **Incentivos de Ventas · bucle infinito en Reportes/Dashboard → "sesión inválida"
  y parpadeo.** En `useCommissionFilters`, cuando `commissionFilters` del store
  estaba en `null`, `defaultCommissionFilters()` devolvía un **objeto nuevo en cada
  render** → `params`/`load` cambiaban de identidad → el `useEffect([load])` de las
  pantallas re-disparaba las 7 consultas pesadas de comisión **en bucle infinito**,
  machacando el servidor (de ahí el falso "sesión inválida" y el parpadeo). Fix:
  **memoizar `filters`** (`useMemo([stored])`). Corrige las 7 pantallas del módulo
  (reportes, dashboard, cálculo, liquidación, prestadores, sin-prestador).

---

## [0.54.0] — 2026-07-16

### Fixed
- **Sesión inválida intermitente + parpadeo "actualizando".** Cuando el access
  token de Supabase vencía un instante, el cliente enviaba el token viejo y el
  servidor respondía "Sesion invalida" (HTTP 500) → mensaje + reintentos. Endurecido:
  - **API `/api/csl`**: los errores de auth ahora devuelven **401** (no 500) para
    que el cliente los distinga.
  - **Cliente (`apiCall`)**: ante **401 refresca el token y reintenta** la petición
    UNA vez de forma transparente; además reintenta `getSession` si vuelve null
    (hipo durante el refresco). El usuario ya no ve el falso "sesión inválida".
  - **`page.tsx`**: no se re-sincroniza la sesión en `TOKEN_REFRESHED` (refresco
    horario del token) → elimina el churn/parpadeo. Diagnóstico previo confirmó que
    las llaves, el endpoint, el reloj y el cliente estaban sanos (causa = token en el
    Supabase self-hosted).

---

## [0.53.2] — 2026-07-16

### Changed
- **CF PARA IMPRIMIR · al imprimir se guarda (y se confirma):** el talonario ya
  guardaba+emitía al imprimir; ahora el mensaje muestra el **código guardado**
  (`Guardado CSL-REG-… · enviado a impresión`). En el **certificado digital**,
  imprimir/descargar ahora **emite** el certificado si estaba en borrador (antes
  quedaba como borrador) → queda disponible en "Validar Certificados".

---

## [0.53.1] — 2026-07-16

### Changed
- **CF PARA IMPRIMIR · vigencia simplificada:** se quitaron los campos de fecha
  (Emisión y Válido hasta) y el check; ahora la vigencia es **solo dos botones,
  30 y 90 días** (el activo se resalta). La emisión es la fecha de hoy automática.
  Aplica al talonario y al certificado digital.

---

## [0.53.0] — 2026-07-16

### Added
- **CF PARA IMPRIMIR · vencimiento opcional + vigencia 30/120.** En la vigencia,
  un **check "Válido hasta"** activa/desactiva el vencimiento: desmarcado → el
  certificado **NO VENCE** (se imprime "VÁLIDO HASTA: NO VENCE"). Los botones de
  vigencia rápida ahora son **30 y 120 días** (antes 30/60/90). Aplica al talonario
  y al certificado digital. `Válido hasta` pasó a ser opcional en la validación
  (frontend y backend); el resto de reglas (orden de fechas, no canjear vencido) se
  mantienen y un cert sin vencimiento nunca se marca "Vencido".

---

## [0.52.2] — 2026-07-16

### Fixed
- **CF PARA IMPRIMIR · el talonario no guardaba → no aparecía en "Validar
  Certificados".** El guardado (`ensureRecord`/`doSave`/botón) todavía exigía el
  permiso `gift_certificates.create`, que se **retiró** al pasar el módulo a
  control-por-menú (v0.52.0) → para no-admin devolvía false y no persistía. Ahora
  el talonario guarda+emite para cualquiera con el menú, y el certificado queda
  disponible en "Validar Certificados". (0 certificados `CSL-REG-*` en BD lo confirmó.)
- **Talonario · certificados en secuencia reusaban el código.** Al cambiar cualquier
  dato de identidad (otorgado a / cortesía / servicio / fechas / sucursal) ahora se
  descarta el código previo → cada certificado distinto genera su propio registro.

---

## [0.52.1] — 2026-07-15

### Fixed
- **Ponche (reloj checador) · SALIDA de noche rechazada indebidamente.** La ventana
  de "hoy" para buscar la entrada usaba la medianoche del servidor (**UTC**), no la
  de República Dominicana (UTC-4). Una salida después de las **8 PM RD** caía en el
  día UTC siguiente y no encontraba la entrada del día → *"No hay una entrada previa
  registrada hoy"* (rechazo). Se corrigió en los **3 canales** (kiosko QR, ponche
  móvil y kiosko autenticado) + la inferencia del próximo tipo de marca, anclando el
  día al calendario RD (`dominicanDayStart` en `lib/work-hours.ts`). RD no tiene
  horario de verano → offset -04:00 estable.

---

## [0.52.0] — 2026-07-15

### Changed
- **CF PARA IMPRIMIR · acceso por MENÚ** (decisión del usuario): el módulo de
  certificados de regalo (talonario y digital) ahora se controla solo con el
  menú `cliente-certificados-imprimir` — quien tiene el menú puede ver, crear,
  emitir, imprimir, descargar, entregar, canjear y duplicar. Se retiró el permiso
  extra `gift_certificates.view` que bloqueaba el certificado digital.
  - **Solo la ANULACIÓN** (destructiva/irreversible) mantiene permiso:
    `gift_certificates.void`. El resto de permisos granulares se retiraron del
    catálogo (ya no se usaban).
  - Diagnóstico previo: ningún usuario tenía el permiso `gift_certificates.view`
    asignado en BD (nunca se guardó), por eso salía "no tienes permiso".
- El aislamiento por `business_id` (multi-tenant) se mantiene en todos los handlers.

---

## [0.51.2] — 2026-07-15

### Changed
- **Código de confirmación con prefijo de sucursal:** el QR y el código impreso
  ahora llevan prefijo por sucursal — **RV-** (Rafael Vidal), **JAR-** (Los Jardines),
  **VO-** (Villa Olga) + los 4 dígitos (ej. `RV-0024`, `JAR-0024`, `VO-0024`).

---

## [0.51.1] — 2026-07-15

### Changed
- **Talonario · vista centrada, impresión con calibración:** la previsualización
  web se muestra siempre **centrada** en la tarjeta (offset 0), mientras que la
  **impresión** usa la calibración (Mover) para alinear sobre el papel físico.
  Así la vista se ve balanceada y el papel sale correcto.

---

## [0.51.0] — 2026-07-15

### Changed
- **Talonario · centrado por defecto:** el texto ahora sale centrado bajo el
  título pre-impreso sin calibrar (se hornea el desplazamiento 130/-8 que el
  usuario validó como correcto para impresión). El certificado digital usa
  calibración cero (no cambia). "Restablecer" vuelve a ese valor centrado.

### Added
- **Código de confirmación de 4 dígitos** en el talonario: el QR ahora codifica
  **solo 4 dígitos** (derivados de los datos, estables) y se imprimen debajo del QR.
- **El QR siempre aparece** en la vista y en la impresión del talonario (antes solo
  salía tras guardar).

---

## [0.50.5] — 2026-07-15

### Changed
- **Talonario:** el QR se movió ~2 cm a la izquierda (queda separado del borde
  derecho y del bloque de texto, con su código debajo). El digital no cambia.

---

## [0.50.4] — 2026-07-15

### Fixed
- **Talonario · al imprimir el texto salía corrido a la izquierda** aunque la
  vista se veía bien: ahora el contenido se **centra en la página** al imprimir
  (muchas impresoras centran la tarjeta en la bandeja), lo que corrige el corrimiento.

### Added
- **Calibración con flechas** ◀ ▶ ▲ ▼ (paso fino y grueso) para mover el texto
  fácilmente sin escribir números, + guía para poner en el diálogo de impresión
  **Márgenes: Ninguno** y **Escala: 100%**. La calibración se guarda sola.

---

## [0.50.3] — 2026-07-15

### Fixed
- **Talonario · QR se salía de la impresión al calibrar horizontal:** el QR
  estaba pegado al borde derecho; se alejó (margen ~1.2 in) para que el
  desplazamiento horizontal de calibración no lo saque del área imprimible.

### Changed
- **Talonario:** los campos principales **OTORGADO A / CORTESÍA DE / VÁLIDO PARA**
  se muestran más grandes (jerarquía visual: nombres/servicio grandes, fecha y
  sucursal más pequeñas). El certificado digital no cambia.

---

## [0.50.2] — 2026-07-15

### Changed
- **Talonario:** letras de los campos **+40%** (escala compacta 0.52 → 0.73) y
  **bloque re-centrado** en el área en blanco; pie levemente mayor para equilibrio.
  El **QR se mantiene** en su tamaño compacto (a pedido del usuario).
- **Vista web del talonario al 100%**: la previsualización ocupa el ancho completo
  de su columna (antes limitada a 820px). El certificado digital no cambia.

---

## [0.50.1] — 2026-07-15

### Changed
- **Talonario pre-impreso:** letras de los campos y **QR reducidos a la mitad**
  (formato COMPACTO), a pedido del usuario, con posiciones recompactadas. El
  **certificado digital NO cambia** (queda con su formato/tamaños actuales).
  Implementado con formatos `FMT_FULL` (digital) / `FMT_COMPACT` (talonario) en
  `cert-talonario.ts`; el talonario pasa `compact: true`.

---

## [0.50.0] — 2026-07-15

### Added
- **Formato único de certificado + QR + pie.** El **certificado digital** ahora
  usa el **mismo formato** que el talonario: arte oficial de fondo + campos + QR.
  - **Código QR de validación en la esquina derecha**, legible (recuadro blanco
    de fondo para que escanee incluso sobre las cintas), con el código debajo.
    Generado localmente (`qrcode`, sin servicios externos).
  - **Pie del certificado** en cada certificado: **fecha de entrega** (día mes año,
    pequeña) + **teléfono de la sucursal** + **redes sociales** con ícono
    (Instagram/Facebook `@cibaospalaser`).
  - **Teléfono por sucursal**: nueva columna `csl_sucursales.telefono` (migración
    `202607150002`) + campo en la config de Sucursales; el certificado guarda un
    snapshot del teléfono al emitir y lo muestra en el pie.
- El talonario también imprime el QR (genera/emite el código al imprimir para que
  el QR valide) y el pie.

### Changed
- **Tamaño de letra reducido** en los campos del certificado (a pedido del usuario)
  y bloque recompactado para dar lugar al pie.
- El módulo digital deja de ofrecer 3 diseños: se unifica en el **formato oficial**
  (arte del talonario). Se retira el selector de diseño.

### Removed
- `lib/certificados/cert-svg.ts` (los 3 diseños sintéticos) — reemplazado por el
  formato oficial único (`cert-talonario.ts` → `renderCertificate`).

---

## [0.49.1] — 2026-07-15

### Changed
- **Talonario:** se reemplazó la guía por el **arte plano digital oficial** del
  certificado (`talonario-preimpreso.jpg`, sin perspectiva) y se **reajustaron las
  posiciones** de los campos contra ese arte: el bloque queda centrado en el área en
  blanco, sin rozar las cintas inferiores. Verificado por overlay (headless Chrome).

---

## [0.49.0] — 2026-07-15

### Added
- **CF PARA IMPRIMIR · modo "Talonario pre-impreso"** (corrección de alcance: el
  papel del certificado ya viene impreso —lazo, logo, título, cintas— y solo hay
  que completar los campos y que caigan en el lugar correcto).
  - Nueva pestaña **"Talonario pre-impreso"** (ahora la **pestaña por defecto**):
    formulario + **previsualización con la foto real del talonario de fondo** para
    ver dónde caen los campos, y **calibración** (mover horizontal/vertical, escala
    general, tamaño de letra) persistida en el navegador.
  - **Impresión de solo los campos** (fondo transparente) en página tamaño tarjeta
    (9.78×6.3 in) → al imprimir sobre el talonario físico, el texto cae en su sitio.
  - Reutiliza el modelo de datos y etiquetas EXACTAS ("VÁLIDO PARA:") y la fecha en
    español del módulo digital. Renderer `lib/certificados/cert-talonario.ts`
    (posiciones verificadas contra la foto del talonario real).
  - Botón "Guardar registro" opcional: persiste vía el backend (giftCertSave/emit)
    para que el certificado quede trazado y reimprimible.
- Asset `public/certificados/talonario-preimpreso.jpg` (guía de alineación).

### Changed
- El modo "Pre-impreso (físico)" anterior (overlay genérico con calibración por
  puntos) se **reemplazó** por el modo "Talonario pre-impreso" con posiciones
  correctas para el certificado actual y preview foto-guiada.

### Removed
- `components/cf-imprimir/legacy-preimpreso.tsx` (superado por `talonario-page.tsx`).

---

## [0.48.0] — 2026-07-15

### Added
- **CF PARA IMPRIMIR — módulo profesional de Certificados de Regalo.** Se amplió
  el módulo existente (menú `cliente-certificados-imprimir`, **sin renombrarlo ni
  duplicarlo**; encabezado ahora "CF PARA IMPRIMIR") de un simple overlay de
  impresión a un módulo completo de creación, personalización, previsualización en
  tiempo real, emisión, impresión, descarga (PDF/PNG/JPG), consulta, reimpresión,
  canje y anulación.
  - **Tres diseños** profesionales (moderno turquesa / minimalista / premium) desde
    un solo componente parametrizable (`lib/certificados/cert-svg.ts`); se guarda
    solo el `template_id`.
  - **Fuente única "lo que ves es lo que sale":** el mismo SVG alimenta preview,
    impresión (vector) y exportación (raster ×3 embebido en PDF). Tipografía
    Montserrat + Allura; QR generado **localmente** (`qrcode`, sin servicios
    externos). Auto-fit por longitud + wrapping a 2 líneas; fecha en español
    (`14 DE AGOSTO DE 2026`); etiquetas exactas (**"VÁLIDO PARA:"**, nunca "VÁLIDO POR:");
    pie con teléfono·dirección + Instagram/Facebook `@cibaospalaser`.
  - **Máquina de estados** (Borrador→Emitido→Entregado→Canjeado, + Vencido/Anulado)
    revalidada en **servidor** (no doble canje; no canjear vencido/anulado/borrador;
    editar solo borradores; código bloqueado al emitir).
  - **Backend:** handlers `giftCert*` con RBAC (`gift_certificates.*`), aislamiento
    por `business_id`, snapshot de sucursal y **auditoría** de cada operación.
  - **Código único** server-side `CSL-REG-2026-000001` (secuencia + función SQL).
  - **Listado** con filtros (búsqueda/estado/sucursal), paginación, historial y
    acciones por fila (abrir, imprimir, PDF, imagen, duplicar).
  - Permisos nuevos en el catálogo RBAC: sección "Certificados de Regalo".
  - Pruebas `pnpm test:gift` (22 casos); verificación visual de los 3 diseños.
- Migración aditiva `202607150001_gift_certificates_module.sql` (aplicada a db-cls):
  columnas de vencimiento/plantilla/contacto/snapshot/trazas de estado, secuencia +
  función de código, tabla `csl_certificados_regalo_audit`. **No destructiva.**

### Changed
- El componente `certificados-regalo-impresion-page.tsx` pasa a ser un contenedor
  con pestañas: **"Certificados digitales"** (flujo nuevo) y **"Pre-impreso (físico)"**
  (flujo histórico de overlay + calibración, conservado íntegro).

### Security
- RBAC y aislamiento por `business_id` en todos los handlers de certificados de
  regalo; estados y permisos validados en servidor (no se confía en el cliente).

---

## [0.47.0] — 2026-07-14

### Added
- **Reasignar ventas asignadas por error** (pedido del usuario: "si le agrego
  por error un servicio o un producto a un empleado quiero poder volver a
  asignar a quien corresponde").
  - En la vista "Asignadas": selecciona las ventas, elige el **nuevo
    prestador** y pulsa **"Reasignar a X"** — en una sola operación se resta
    el delta al empleado equivocado y se suma al correcto (cada uno con SU
    tarifa de producto). Doble entrada de auditoría
    (`prestador_desasignado` + `prestador_asignado`).

### Fixed
- **Asignar/deshacer ahora validan períodos cerrados ANTES de escribir**:
  antes un período cerrado podía abortar la operación a mitad dejando estado
  parcial (ventas actualizadas sin delta, o deltas sin ventas). Ahora se
  planifica y valida todo primero, y solo entonces se escriben ventas y
  liquidaciones.

---

## [0.46.0] — 2026-07-14

### Added
- **Productos sin empleado asignado: ver y asignar** (pedido del usuario). La
  pantalla "Servicios sin prestador" pasa a llamarse **"Ventas sin prestador"**
  y ahora incluye PRODUCTOS además de servicios (sigue excluyendo Depilación
  Láser). Junio 2026 real: 206 ventas de producto sin empleado (215 unidades,
  RD$294,200 vendidos, hasta RD$21,500 de incentivo sin pagar — casi todas
  cobradas en recepción).
  - **Asignar producto suma a la liquidación**: unidades × tarifa del
    colaborador (`product_unit_amount` del roster; si no tiene, la regla
    general RD$100/u) → `products_count` + `product_incentive` + bruto/neto.
  - **Deshacer también revierte productos** (unidades y montos).
  - Columna **Cant.** (ordenable) en la tabla y en la hoja Excel
    "Sin Prestador" (con suma en el total).
  - Los filtros existentes aplican: el selector de categoría ahora incluye
    "Productos" para trabajarlos por separado.

---

## [0.45.0] — 2026-07-14

### Added
- **Servicios sin prestador: vista "Asignadas" + deshacer asignación** (cierra
  el flujo: asignar → revisar → deshacer; antes una asignación equivocada no
  se podía ver ni revertir).
  - Toggle **Pendientes (n) | Asignadas (m)** en la pantalla; la vista
    Asignadas muestra prestador asignado, quién asignó y cuándo.
  - **"Quitar asignación"** (multi-selección): revierte el delta (venta × % de
    la categoría) de la liquidación del prestador y devuelve la venta a su
    clasificación original del archivo. Bloquea períodos cerrados. Auditado
    (`prestador_desasignado`).
  - Acciones `getCommissionAssignedServices` / `unassignCommissionSaleProvider`
    (permiso `sales_commission.adjust`).
  - Los filtros (servicio/cliente/categoría) y el orden por columna aplican a
    ambas vistas; en Asignadas la búsqueda también encuentra por prestador.

---

## [0.44.0] — 2026-07-14

### Added
- **Servicios sin prestador: filtros y ordenamiento** (pedido del usuario).
  - Búsqueda por servicio o cliente (sin acentos, reutiliza `normalizeName`).
  - Filtro por categoría (opciones derivadas de las filas del período).
  - Orden por columna con clic en el encabezado (Fecha, Sucursal, Cliente,
    Servicio, Categoría, Monto; asc/desc con indicador).
  - "Seleccionar todo" ahora opera sobre lo VISIBLE (filtrado), y la fila de
    total muestra el subtotal filtrado ("Total filtrado (n de N)").

---

## [0.43.0] — 2026-07-13

### Added
- **Servicios sin prestador: hoja Excel + asignación manual en sistema**
  (pedido del usuario). Junio 2026 real: 37 servicios por RD$58,870 sin
  prestador comisionable ("Sin Información") — comisión que nadie recibía.
  - **Nueva pantalla "Servicios sin prestador"** (Incentivos de Ventas):
    lista los servicios del período sin prestador comisionable (excluye
    Depilación Láser — va por fondo — y productos), con selección múltiple y
    asignación manual del colaborador correcto. Permiso
    `sales_commission.adjust`.
  - **La asignación recalcula la liquidación**: suma el delta (venta × % de la
    categoría) a la fila del prestador en el período — o la crea si no tenía —
    y bloquea períodos cerrados. Auditada en `sales_commission_audit_logs`
    (acción `prestador_asignado`).
  - **Hoja "Sin Prestador" en el Excel de Reportes (12 hojas)**: Fecha ·
    Sucursal · Cliente · Servicio · Categoría · Prestador (archivo) · Monto,
    con total.
  - Migración `202607130001` (aplicada a db-cls): columnas `assigned_at` /
    `assigned_by` en `sales_commission_sales` — `provider_original` conserva
    la fidelidad del archivo fuente; la asignación escribe
    `provider_normalized`.
  - **Fuente única `effectiveProvider`**: detalle por categoría, dashboard,
    pacientes-desde-ventas y el motor de runs respetan la asignación manual.

---

## [0.42.0] — 2026-07-13

### Added
- **Detalle de comisión por categoría también en pantalla y PDF** (completa la
  v0.41.0, que lo agregó solo al Excel — pantalla, PDF y Excel ahora cuentan
  la misma historia).
  - Pantalla Reportes: tabla "Detalle de comisión por categoría" bajo los KPIs
    (Prestador · Sucursal · Categoría · Venta base · % aplicado · Comisión,
    con fila de totales), usando los mismos filtros del período activo.
  - PDF: sección homónima después de la Liquidación final, con totales.

---

## [0.41.0] — 2026-07-13

### Added
- **Excel de Incentivos: hoja "Servicios Detalle"** (pedido del usuario: hoja
  con el detalle de la categoría y los cálculos detrás de "Comisión categoría").
  - Nueva hoja (11 en total) justo después de "Incentivos Servicios":
    Prestador · Sucursal · Categoría · Venta base · % aplicado · Comisión.
  - Nueva acción `getCommissionServiceDetail`: recalcula el detalle
    prestador × categoría desde `sales_commission_sales` con la MISMA lógica
    del importador (`classifyProvider` sobre el prestador original, sólo
    categorías con % configurado; láser va por su fondo, no aquí).
  - **Validado contra junio 2026: RD$41,190.00 exactos** — el total del
    detalle cuadra al centavo con `service_commission` almacenado.
  - Botón actualizado a "Exportar Excel (11 hojas)".

---

## [0.40.0] — 2026-07-13

### Added
- **Consolidado de compras: aprobado por sucursal + total general** (pedido del
  usuario: "quiero que me salga lo aprobado por cada sucursal y un total
  general de lo aprobado").
  - Cada sucursal ahora muestra dos sub-columnas: **Sol.** (solicitado) y
    **Apr.** (aprobado, en verde), con encabezado agrupado por sucursal.
  - Fila **TOTAL GENERAL** al final de la tabla: suma de solicitado y aprobado
    por sucursal + total global solicitado y aprobado.
  - Badge "Aprobado total: N" junto al contador de materiales, visible sin
    hacer scroll.
  - `buildConsolidated` acumula `approvedByBranch` y nuevo helper
    `buildConsolidatedTotals` en `lib/materials-client.ts` (fuente única para
    pantalla y exportes).
  - **Excel y PDF del consolidado** actualizados con las mismas sub-columnas
    Sol./Apr. por sucursal y la fila TOTAL GENERAL, para que cuadren con la
    pantalla.

---

## [0.39.3] — 2026-07-12

### Fixed
- **Sucursal "Todas" ahora FUNCIONA en Cálculo mensual** (reporte del usuario:
  se forzaba a RAFAEL VIDAL).
  - `getCommissionRunPreview` sin sucursal calcula **las 3 sucursales** y
    devuelve `multi.results` (motor completo por sucursal + run guardado).
  - La pantalla en modo "Todas" muestra el **consolidado** (Neto total del mes
    + tarjeta por sucursal con su estado Borrador/Finalizado y neto) y debajo
    el **detalle completo de cada sucursal** (KPIs, alertas, colaboradores,
    bases). Botón "Trabajar esta sucursal →" fija el filtro para poder
    Guardar/Finalizar/Anular (acciones que siguen siendo por sucursal).
  - Vista de una sucursal: sin cambios (extraída a `RunView` reutilizable).
- QA: tests 129/129 · `tsc` 0 · `build` OK.

---

## [0.39.2] — 2026-07-12

### Fixed
- **"Todos los meses" ahora FUNCIONA en Clientes atendidos** (reporte del
  usuario: quedaba en ceros porque forzaba el mes actual sin datos).
  - `getCommissionPatientCapture` soporta **mes=0 → SUMA ANUAL** por
    colaborador+sucursal (el efectivo de cada mes = manual si existe, si no
    reservas; fuente muestra "N meses") y **sucursal vacía → las 3 sucursales**
    (con columna Sucursal y edición por fila en modo mensual).
  - Vista anual = solo consulta (chip explica que la captura es por mes);
    verificado contra db-cls: **14,432 pacientes 2026** — cuadra exacto con
    las atenciones ASISTE del importador de reservas.
- **Revisión de las demás pantallas** (pedida por el usuario) con el filtro en
  "Todos los meses"/"Todo"/rango/Todas:
  - Historial, Sucursales, Prestadores, Productos, Liquidación, Reportes:
    ✔ correctas (consultan por rango de fechas).
  - Dashboard: ✔ datos correctos; se corrigió la **etiqueta del período**
    (decía el mes actual en vez de "Todos los meses AAAA" / "Todo el
    historial").
  - Comisión láser: ✔ anual OK; se agregó **chip del período efectivo** y
    aviso cuando el filtro es un rango personalizado (muestra el mes inicial).
  - Cálculo mensual: ✔ chip + aviso ya presentes (los runs son mensuales).
  - Nota conocida: en Reportes con "Todos", la sección láser del Excel usa el
    total del período completo (para el detalle láser real usar mes específico).
- QA: tests 129/129 · `tsc` 0 · `build` OK · smoke anual de pacientes ✓.

---

## [0.39.1] — 2026-07-12

### Changed
- **La barra de filtros estándar en TODAS las pantallas de Incentivos de
  Ventas.** Comisión depilación láser, Clientes atendidos y Cálculo mensual
  dejan el selector chico y usan la misma `CommissionFilterBar` que el resto
  (Filtros + chip del período, Mes con "Todos los meses", Año, Desde/Hasta,
  Sucursal, Limpiar) — mismo período global compartido.
  - **Láser**: el filtro de Sucursal ahora filtra el detalle (una o las 3);
    con "Todos los meses" muestra el resumen anual.
  - **Clientes atendidos / Cálculo mensual** (pantallas por mes y sucursal):
    chip con el mes/sucursal efectivos y aviso cuando el filtro global es
    "Todos" o "Todas" (usan mes actual / primera sucursal).
  - Se eliminó `periodo-picker.tsx` (reemplazado por la barra estándar).
- **Revisión pantalla por pantalla** (pedida por el usuario): barra presente
  en Historial, Ventas por sucursal, Comisiones por prestador, Incentivos de
  productos, Comisión láser, Clientes atendidos, Cálculo mensual, Liquidación
  y Reportes (9/9 pantallas de datos). Excepciones justificadas: Dashboard usa
  su barra ejecutiva (mismo store, con Actualizar/Exportar), Importador es una
  pantalla de carga (sin período) y Reglas usa sus filtros de vigencia.
- QA: tests 129/129 · `tsc` 0 · `build` OK.

---

## [0.39.0] — 2026-07-12

### Added / Changed
- **Incentivos de Ventas · filtros UNIFICADOS con "Todos los meses"** (pedido
  del usuario: un solo modelo de filtro para todo el módulo).
  - **"Todos los meses"** disponible en el selector de Mes de todas las
    pantallas (= todo el año elegido); en la barra estándar el Año además
    ofrece **"Todos (historial)"**.
  - **Un solo período global**: el picker de Comisión láser / Clientes
    atendidos / Cálculo mensual ahora escribe en el MISMO store
    (`commissionFilters`) que la barra de filtros y el Dashboard → elegir
    "Mayo 2026" en cualquier pantalla se mantiene en todas.
  - **Barra de filtros simplificada al modelo estándar**: Mes (con Todos los
    meses) + Año (con historial) + Desde/Hasta (rango) + Sucursal + Prestador;
    se eliminó el selector de "quick options" redundante. Etiqueta nueva
    "Todos los meses · YYYY". El Dashboard ejecutivo también ofrece/entiende
    la opción.
  - **Comisión láser en "Todos los meses" = RESUMEN ANUAL**: nueva acción
    `getCommissionLaserAnnual` (una sola consulta paginada de las ventas láser
    del año, tarjeta neteada por venta) → KPIs (fondo total del año + por
    sucursal) y tabla **Mes × Sucursal** con tramo aplicado, totales y meses
    sin datos en gris. Excel/PDF/Aplicar exigen un mes específico (con nota).
  - Pantallas estrictamente mensuales (Cálculo mensual, Clientes atendidos):
    sin opción "Todos" (usan el mes actual si el período global es anual).
  - Exportes: mes 0 → "Todos los meses" / `INCENTIVOS_VENTAS_TODOS LOS MESES_AAAA`.
- **QA**: smoke anual contra db-cls **3/3** (Junio RV 21,347.24 idéntico al
  cálculo mensual; 6 meses con fondo; total 2026 RD$412,012.54); tests
  129/129; `tsc` 0; `build` OK.

---

## [0.38.1] — 2026-07-11

### Changed
- **Renombrado en toda la UI: "Comisión de Ventas" → "Incentivos de Ventas"**
  (sección del menú/sidebar, títulos de las 12 pantallas, dashboard, sección de
  permisos en admin, encabezados de Excel/PDF y nombre de archivo de export:
  `INCENTIVOS_VENTAS_<MES>_<AÑO>.xlsx`). Solo etiquetas visibles: los IDs
  internos (`comision-*`), permisos (`sales_commission.*`), tablas y API no
  cambian (cero riesgo de romper menús asignados o permisos existentes).

---

## [0.38.0] — 2026-07-11

### Changed
- **Dashboards del sistema con el estilo EJECUTIVO** (el del dashboard de
  Comisión de Ventas) — look profesional y consistente en todo el sistema.
  - **`KpiCard` compartida rediseñada** (`components/kpi-card.tsx`): tarjeta
    blanca `rounded-2xl` con sombra suave, **chip de ícono** a la izquierda
    (tono semántico: marca/éxito/alerta/crítico), label en mayúsculas pequeñas,
    valor grande **tabular** en tinta de marca y nota opcional. Al ser
    compartida, actualiza de una vez: **panel de Mantenimiento** (reportes y
    piezas + cuadres), **PulseControl** (dashboard + mantenimiento),
    **RR.HH.** (dashboard + ponche) y **Materiales**.
  - **Kit de dashboard** (`components/dashboard-kit.tsx`): `DashHeader`,
    `DashPanel` (título + acción "Ver detalle →"), `EmptyChart`, `InsightItem`,
    skeletons y **paleta categórica validada** (dataviz: teal `#0D9488` · ámbar
    `#D97706` · violeta `#7C3AED` · rosa `#DB2777`, todas las pruebas PASS) +
    colores de **estado** reservados.
  - **Dashboard de Compras** rediseñado: encabezado, filtros en tarjeta
    redondeada, 8 KPIs con chips semánticos y la alerta de gastos menores como
    tarjeta de insight.
  - **Dashboard de Materiales** rediseñado: KPIs + tarjetas "top" unificadas;
    charts al estilo ejecutivo (ejes recesivos, barras con radio y etiquetas,
    donut con total al centro y leyenda con %, tendencia como área con
    degradado, tooltips redondeados); el **donut de estados usa colores
    semánticos por estado** (aprobada=verde, pendiente=ámbar, parcial=naranja,
    rechazada=rojo, comprada=teal) en vez de una paleta ciclada.
- QA: `tsc` 0 · `build` OK · tests 129/129 (sin cambios de lógica).

---

## [0.37.0] — 2026-07-11

### Changed / Fixed
- **Comisión de Ventas · INCENTIVO LÁSER alineado al cuadro oficial** (análisis
  de `SISTEMA INCENTIVOS .xlsx`, Junio). El reparto real del negocio NO es
  50/50: **modo EQUITATIVO** — cuota per cápita = fondo ÷ N elegibles; quien
  tiene **0 pacientes** cobra exactamente su cuota; el **resto del fondo** se
  reparte **por pacientes** entre quienes sí atendieron (pesos dinámicos).
  - **Motor** (`run-engine.ts`): `laserDistributionMode` `"equitativo"` |
    `"pesos"`; expone `eligibleCount` y `perCapita`. Test replica el cuadro de
    Junio RV **al centavo**: cuota 1,810.01 (LUISA/YANIBEL/KARLA) y por
    pacientes RIQUELMI 1,973.69 · ROSA 1,540.44 · DIANA 1,652.76 · MADELINE
    1,957.64 · EMELY 1,925.55; Σ = fondo exacto.
  - **Regla** `laser_split_mode` (Sí = equitativo **default**, No = pesos
    50/50) — editable en Reglas; los pesos quedan etiquetados "(solo modo
    pesos)" y su validación de 100% solo aplica en ese modo.
  - **Tarifa de producto POR COLABORADOR** (`product_unit_amount`, cuadro
    "50 P/P"): columna nueva en el roster (DDL aplicado a db-cls), override en
    el motor, editable en el editor de personal (vacío = regla general RD$100).
  - **Roster alineado al cuadro de Junio** (UPDATEs reversibles, sin borrar):
    RV = 8 elegibles (KARLA ACTIVA, ASHLEY inactiva en RV — cobra en LJ),
    LJ = 7 (JOELY y BENITA fuera del láser), VO = 4 (EIDYLEE y DAYHANA fuera;
    DAYHANA productos RD$50/u); alta de ISAURY (RV, sin láser, RD$50/u, sin
    aporte de limpieza).
- **UI más fácil y profesional:**
  - **`PeriodoSucursalPicker` compartido**: Comisión láser, Clientes atendidos
    y Cálculo mensual usan el mismo selector de mes/año/sucursal y **el período
    elegido se mantiene al cambiar de pantalla** (antes se reseteaba al mes
    actual en cada pantalla).
  - Pantalla láser: franja con el **modo de reparto vigente** (y dónde
    configurarlo), tarjeta **"Cuota (fondo÷N)"** en el resumen por sucursal;
    Excel/PDF describen el modo.
  - Editor de personal: columnas **Bono** (RD$ del mes) y **Prod. RD$/u**
    editables; fix: guardar una fila ya no resetea el bono a 0.
- **Migración `202607110004`** (aplicada a db-cls por SSH): columna
  `product_unit_amount` + seed de `laser_split_mode`.
- **QA**: `test:commission` **129/129** (12 aserciones nuevas replican el
  cuadro); smoke db-cls 17/17 con **modo equitativo y cuadre 0.00** en las 3
  sucursales; captura 7/7; `tsc` 0; `build` OK.

### Notas de negocio (discrepancias del cuadro detectadas — no se tocaron)
- El cuadro aplica **2% fijo** en Rafael Vidal con base 724,005.50, pero su
  propia escala (600,000 → 3%) daría 3%. El sistema aplica la escala (3% →
  fondo 21,347.24 vs 14,480.11 del cuadro). Si se desea 2% fijo, desactivar los
  tramos superiores en Reglas.
- El cuadro netea la tarjeta del TOTAL de la sucursal y resta las otras
  categorías a bruto (aprox. de tabla dinámica); el sistema netea la tarjeta de
  las ventas láser reales (más preciso; RV jun: 711,574.50 vs 724,005.50).
- Pacientes del cuadro (1,128/864/303) difieren de reservas (1,076/850/297):
  ajustables por sucursal/persona en **Clientes atendidos** (captura manual).

---

## [0.36.0] — 2026-07-11

### Added
- **Comisión de Ventas · captura MANUAL de pacientes atendidos.** La pantalla
  **Clientes atendidos** ahora permite capturar/ajustar los pacientes por
  colaborador (mes + sucursal), sobre la base de **Reservas** (atenciones ASISTE).
  - **Merge por colaborador** (`readPatientsForRun`): la captura **manual gana**
    solo sobre ese colaborador; los demás mantienen su valor de reservas (antes
    era todo-o-nada por sucursal). Fuente etiquetada `manual` / `mixto` /
    `reservas`. Alimenta el reparto láser y el Cálculo mensual sin cambios más.
  - **Server** (`lib/server/commission.ts`): `getCommissionPatientCapture`
    (roster + reservas base + manual, con valor efectivo y participación),
    `saveCommissionPatientCount` (upsert `source="manual"` + servicio/observación),
    `deleteCommissionPatientCount` (revierte a reservas). Auditado. Requiere
    `sales_commission.calculate`.
  - **API** (`app/api/csl/_handlers.ts`): 3 acciones nuevas.
  - **UI** (`ComisionClientesPage`): selectores mes/año/sucursal; tabla editable
    (Prestador, Reservas base, Pacientes editable, Fuente, % participación,
    Observación, Guardar/Revertir) con totales; invalida cachés de láser/run.
- **`scripts/_smoke-patient-capture.js`**: smoke del merge contra db-cls
  (inserta prestador de prueba → valida manual gana / reservas intactas → limpia).
  **7/7**, sin residuo. `test:commission` 117/117 · `tsc` 0 · `build` OK.

---

## [0.35.0] — 2026-07-11

### Fixed / Changed
- **Comisión de Ventas · INCENTIVO LÁSER — lógica corregida y completa.** El
  incentivo de depilación láser ahora se calcula **por sucursal**, **descontando
  la tarjeta antes de la escala** y repartiendo el fondo en **parte por personas
  + parte por pacientes** con pesos configurables y **cuadre exacto al centavo**.
  - **Motor** (`lib/commission/run-engine.ts`): reparto láser solo entre el
    **personal ELEGIBLE del roster** (los pacientes de quien no aplica ya NO
    diluyen ni reciben fondo — antes se filtraba); nueva regla
    `zeroPatientsGetsFixed` (empleado con 0 pacientes recibe o no la parte fija);
    **`allocateExact`** (método del mayor resto) garantiza Σ repartido = fondo
    exacto (elimina el residuo de RD$0.30–0.43 por redondeo).
  - **Reglas** (`lib/commission/rules.ts` + migración `202607110003`, aplicada a
    db-cls): `laser_weight_personas` / `laser_weight_pacientes` (default **50/50**,
    editables, deben sumar 100%), `laser_zero_patients_fixed` (Sí),
    `laser_card_discount_before_scale` (Sí). Pantalla de Reglas: editor con
    toggle Sí/No para banderas + validación de que los pesos sumen 100%.
  - **Personal que aplica** (roster CRUD, `sales_commission_collaborators`):
    server `saveCommissionCollaborator` / `setCommissionCollaboratorActive` /
    `deleteCommissionCollaborator` (soft delete) + componente
    `LaserPersonnelEditor` (alta/edición/baja por sucursal, sin hardcodear
    nombres) embebido en **Reglas** y en la pantalla de láser.
  - **Pantalla "Comisión depilación láser" rediseñada** (`comision-pages.tsx`):
    selectores mes/año; por sucursal → resumen (venta bruta, venta tarjeta,
    % tarjeta, descuento, base neta, tramo, %, fondo, personas/pacientes,
    pacientes, distribuido, **cuadre**) + tabla del personal (incentivo por
    personas / por pacientes / total) + alertas; **Excel** (.xlsx) y **PDF**
    (impresión) vía `lib/commission/laser-export.ts`; botón **Aplicar a
    liquidación**.
  - **Liquidación**: `applyCommissionLaser` usa el reparto CORREGIDO por sucursal
    (antes: fondo de todo el negocio, sin netear tarjeta, solo por pacientes).
- **Server**: `getCommissionLaserDetail` (resumen + personal por sucursal, con
  validaciones §11); `readRunRules` deriva la fracción del reparto de los pesos.
- **QA**: `test:commission` **117/117** (reparto exacto + regla 0 pacientes +
  cuadre); smoke `_smoke-calculo-mensual.mjs` contra db-cls (Jun 2026): cuadre
  **0.00 exacto** en las 3 sucursales (fondos RV 21,347.24 / LJ 9,219.52 /
  VO 6,982.00).

---

## [0.34.0] — 2026-07-11

### Added
- **Comisión de Ventas · pantalla "Cálculo mensual" (cablea el motor de runs).**
  Nuevo submenú que corre el motor `run-engine.ts` sobre datos persistidos y
  formaliza la liquidación mensual por sucursal como un *run* (borrador →
  finalizado → anulado).
  - **UI** `components/comision/comision-calculo-page.tsx`: selectores de
    sucursal / mes / año → **preview** (el servidor recalcula, no confía en el
    cliente) con KPIs del fondo láser (base neta, tramo, fondo, reparto
    pacientes/lineal, fuente de pacientes), desglose **por colaborador**
    (servicios, evaluación, servicios ajustados, productos, láser
    pacientes/lineal, bono, bruto, limpieza, neto) con totales, tabla de
    **bases por categoría** (tarjeta neteada) y panel de **alertas**. Acciones
    **Guardar borrador** / **Finalizar** / **Anular** (con motivo), gated por
    `sales_commission.calculate`.
  - **Server** (`lib/server/commission.ts`): `getCommissionRunPreview` (arma la
    entrada del motor desde ventas/roster/pacientes/reglas y corre `computeRun`),
    `saveCommissionRun` (recalcula en el servidor y persiste run + ítems como
    borrador; bloquea si ya hay un run finalizado), `getCommissionRuns` /
    `getCommissionRun`, `finalizeCommissionRun`, `voidCommissionRun` y
    `getCommissionCollaborators`. Helpers `readRoster` / `readRunRules`
    (reglas activas → `RunRules`) / `readPatientsForRun` (prefiere captura
    **manual** sobre **reservas**) / `readRunSales` / `computeRunForPeriod`.
    Todo con auditoría en `sales_commission_audit_logs`.
  - **API** (`app/api/csl/_handlers.ts`): 7 acciones nuevas registradas.
  - **Navegación**: submenú "Cálculo mensual" (ícono `Calculator`) en los 4
    lugares (TabId, `MENU_OPTIONS`, `sidebar.tsx`, `app/page.tsx`).
- **`scripts/_smoke-calculo-mensual.mjs`**: smoke de solo lectura que corre el
  motor sobre datos reales de db-cls (Jun 2026, 3 sucursales) y verifica
  invariantes. **14/14** (neto por sucursal: RV 22,702.24 · LJ 31,526.65 ·
  VO 27,416.50; Σ neto ítems = neto total; base neta ≤ bruta; fondo ≤ base×5%).

---

## [0.33.0] — 2026-07-11

### Added
- **Comisión de Ventas · Cálculo Mensual de Incentivos (fundación del motor).**
  Base tarifada y probada para formalizar la liquidación mensual por sucursal
  como *runs* persistidos (borrador → finalizado → anulado). En este incremento
  se entrega la fundación; la UI se cablea en el siguiente.
  - **Motor puro `lib/commission/run-engine.ts`** (`computeRun`, sin I/O): a
    partir de las ventas persistidas, el roster de colaboradores, los pacientes
    y las reglas produce el run completo. Reglas de negocio: TARJETA descuenta
    un % configurable (default 27%) **antes** de calcular incentivo; **base
    láser POR SUCURSAL** = efectivo + transferencia + tarjeta neteada; fondo =
    base × % del mayor tramo de la escala; el fondo se reparte en parte por
    **pacientes** (fracción `laser_split` configurable) y parte **lineal** (el
    resto, en partes iguales entre colaboradores lineales); incentivo por
    servicio = base neta atribuible × % de categoría (masajes/faciales 20 %,
    hollywood/tatuajes/HIFU 10 %, editable); productos = unidades × monto fijo;
    la **evaluación cualitativa** ajusta solo el incentivo de servicios;
    `neto = bruto − aporte de limpieza`. **Nunca calcula en silencio:** sin
    pacientes o sin lineales emite alertas explícitas.
  - **Migración `202607110002_commission_incentives_module.sql`** (aplicada a
    db-cls, no destructiva): tablas `sales_commission_collaborators` (roster
    editable por sucursal/servicio, soft delete), `sales_commission_runs` y
    `sales_commission_run_items` (con RLS por `business_id` y grants a
    `service_role`); columnas `service`/`observation` en
    `sales_commission_patient_counts` para captura manual; regla `laser_split`
    sembrada; seed de 25 colaboradores para Cibao (csl).
- **Categorías de venta `ANESTESIA` y `BOTOX_PLASMA`** + `CATEGORY_LABELS` para
  UI/reportes en `lib/commission/classification.ts`.
- **`scripts/test-commission-import.mjs`**: 33 aserciones nuevas del motor de
  runs (tarjeta 27 %, base láser por sucursal, escala, split pacientes/lineal,
  servicios con tarjeta neteada, productos, evaluación, alertas). **110/110.**
- **`scripts/_check-incentives-migration.js`**: diagnóstico de solo lectura del
  estado de la migración en db-cls.

### Fixed
- **Filtro por sucursal devolvía vacío**: las ventas/cálculos/pacientes
  guardaban el nombre COMPLETO del Excel (`CIBAO SPA LASER AV. RAFAEL VIDAL`)
  mientras la UI filtra por el canónico (`RAFAEL VIDAL`). `normalizeBranch`
  ahora hace match en dos pasos (alias exacto, luego por **contención** con los
  alias más largos primero) y la migración canoniza los datos existentes.
- **Colaboradores duplicados por errores de tipeo**: `canonicalCollaborator`
  aplica equivalencias (AHSLEY→ASHLEY, YANIBLE→YANIBEL, KATHERINE→KATHERIN,
  ROQUELMI→RIQUELMI, EMELY→EMELI, JOHELY→JOELY, MADELIN→MADELINE).

---

## [0.32.0] — 2026-07-11

### Added
- **Comisión de Ventas · Dashboard EJECUTIVO** (rediseño completo): título +
  subtítulo, barra de filtros propia (`DashboardFilterBar`: período por mes /
  rango personalizado / todo, sucursal, prestador, botones Más filtros /
  Exportar / Actualizar datos), 6 KPIs principales (ventas totales, comisiones,
  incentivos productos, láser, bono, neto) y 6 KPIs operativos (empleados,
  importaciones del mes, clientes atendidos, productos vendidos, % tarjeta,
  ticket promedio) **con tendencia vs mes anterior**, gráficos Ventas por
  sucursal (barras), Composición de incentivos (donut con total al centro) y
  Tendencia mensual de 6 meses (área), tabla Top prestadores, Resumen de
  liquidación (bruto − limpieza − descuentos = NETO A PAGAR) e Insights del
  período. Componentes: `ExecutiveKpiCard`, `OperationalKpiCard`,
  `SalesByBranchChart`, `IncentiveCompositionChart`, `MonthlyTrendChart`,
  `TopProvidersTable`, `SettlementSummaryCard`, `PeriodInsightsCard`
  (`components/comision/comision-dashboard-page.tsx`). Paleta de gráficos
  validada por accesibilidad (teal `#0D9488`, ámbar, violeta, rosa).
- Endpoint único `getCommissionExecutiveDashboard` (`lib/server/commission.ts`):
  KPIs del período + comparativas vs mes anterior (solo con mes completo),
  ventas/medios de pago, top prestadores (liquidación + ventas atribuibles),
  composición, tendencia e insights en UNA llamada. Smoke test de solo lectura
  `scripts/_smoke-exec-dashboard.mjs` (16/16 contra datos reales de db-cls).
- Función SQL `sc_sales_monthly` (migración `202607110001`, **aplicada a
  db-cls**): agregación mensual de ventas (año, mes, sucursal, pago) en la DB —
  la tendencia de 6 meses ya no transfiere miles de filas crudas por request;
  con fallback paginado si la función no existe.
- **Fondo láser → liquidación**: acción `applyCommissionLaser` + botón
  "Aplicar a liquidación" en Comisión depilación láser (permiso
  `sales_commission.calculate`). Escribe el `laser_incentive` de cada empleado
  según su participación de pacientes y recalcula bruto/neto, mes por mes.
  Idempotente (re-aplicar sincroniza, pone en 0 a quien salió del reparto);
  filas pagadas/cerradas no se tocan y se reportan; prestadores sin cálculo se
  reportan como no vinculados. Lógica pura testeable en
  `lib/commission/laser-apply.ts` (12 checks nuevos, 77/77 en verde).

### Changed
- `fetchSalesForPeriod` ahora lee **paginado** (páginas de 1,000, orden estable
  por id): inmune a caps de filas de PostgREST en meses con >5,000 ventas.
- El Dashboard anterior (KPIs planos, sin comparativas ni gráficos) queda
  reemplazado por el panel ejecutivo; el resto de pantallas del módulo no cambia.

---

## [0.31.2] — 2026-07-10

### Added
- Filtros de Comisión de Ventas: opción **"Todo (todos los meses)"** — consulta
  el historial completo sin restricción de fechas (chip "Todo el historial").

---

## [0.31.1] — 2026-07-10

### Changed
- **Filtros de Comisión de Ventas auto-aplican**: seleccionar período/año/mes/
  sucursal/prestador procesa al instante, sin botón "Actualizar" (retirado).
  Desde/Hasta (Personalizado) aplica en cuanto ambos son válidos y coherentes.

---

## [0.31.0] — 2026-07-10

### Added
- **Comisión de Ventas: filtros de fecha consistentes en TODO el módulo.**
  - **`CommissionFilterBar`** reusable (`components/comision/comision-filter-bar.tsx`)
    + hook `useCommissionFilters`: Período rápido (Hoy/Esta semana/Mes actual/
    Mes anterior/Últimos 30 días/Trimestre/Año/Personalizado), Año, Mes,
    Desde/Hasta (habilitados en Personalizado), Sucursal, Prestador, chips de
    filtros activos, Limpiar/Limpiar todo y Actualizar. Colapsable en móvil
    ("Filtros (n)").
  - **Período GLOBAL persistente** (zustand, persist): al navegar entre
    pantallas del módulo se mantiene (Mayo 2026 en Dashboard → sigue en
    Liquidación/Reportes); default = mes actual.
  - **Helpers puros** `lib/commission/period.ts`: TZ del negocio
    (America/Santo_Domingo — una venta del 31 a las 8pm no cae al mes
    siguiente), rango INCLUSIVO (`< to + 1 día`), `monthsCovered` para
    cálculos almacenados por mes. **14 tests nuevos** (65/65 en verde).
  - **Backend**: `from/to/branch/provider` aplicados en query (ventas por
    `sale_date`; reservas por `appointment_date` vía patient_counts);
    cálculos/liquidación por meses cubiertos + sucursal/prestador/estado;
    Ventas por sucursal acepta filtro de forma de pago; Historial filtra por
    fecha de carga/estado/tipo. Siempre combinado con `business_id`.
  - **Pantallas actualizadas**: Dashboard, Ventas por sucursal (+forma de
    pago), Comisiones por prestador, Incentivos de productos, Comisión láser,
    Clientes atendidos (usa Fecha de realización; muestra fuente), Liquidación
    (+estado), Historial mensual (+tipo/estado), **Reportes** (usa el período
    global — Excel/PDF/Imprimir respetan exactamente los filtros activos) y
    **Reglas** (Vigente en fecha / tipo / estado por `effective_from/to`).
  - El filtro solo consulta/visualiza: NUNCA dispara recálculos.

---

## [0.30.1] — 2026-07-10

### Added
- **Tests permanentes del Importador** (`pnpm test:commission`, runner `tsx`):
  51 verificaciones — normalización de pago/sucursal/estado/prestador, fechas
  multi-mes, dedup `row_hash`, clasificación de Items, y los controles de los
  archivos reales de Ventas (RD$19,486,006 + resumen exacto) y Reservas
  (23,706/14,432/7,130/2,114/18/8/4). Todos en verde.
- **Historial: botón "Diagnóstico"** por importación (tipo, filas, período
  detectado, bruto y el resumen crudo `raw_summary` del archivo).

---

## [0.30.0] — 2026-07-10

### Added
- **Comisión de Ventas — IMPORTADOR dual (Ventas + Reservas).** El submenú
  "Importar ventas" pasa a llamarse **"Importador"** (mismo id/permiso) y la
  pantalla ahora tiene tres tabs: **Ventas**, **Reservas** e **Historial**, más
  cards de estado del período (ventas/reservas cargadas, incompletos claros).
  - **Ventas** (hoja Produccion/Produccion v2): detecta TODOS los períodos del
    archivo (uno puede cubrir varios meses — cada venta va a su mes REAL y los
    cálculos por empleado se generan POR MES), **concilia contra la hoja
    Resumen** (total/servicios/productos/efectivo/tarjeta/transferencia con
    semáforo CUADRADO/ADVERTENCIA/CRÍTICO) y asigna el medio de pago por el
    **dominante del recibo** (el archivo lo registra por recibo, no por línea).
  - **Reservas** (hoja Reservas, 29 columnas): parser dedicado
    (`lib/commission/reservations-parser.ts`) con estados normalizados (solo
    **Asiste** cuenta como atención; No Asiste/Cancelado/Confirmado/Reservado/
    En Espera no), período por **Fecha de realización**, prestadores
    normalizados sin inventar empleados ("PROVEEDOR NO DISPONIBLE" → pendiente
    de vinculación), y confirmación **en lotes con progreso** (23k+ filas:
    start → append×N → finalize). Alimenta `sales_commission_patient_counts`
    (atenciones = métrica principal + clientes únicos) → Clientes atendidos y
    el reparto del fondo láser usan RESERVAS con fallback a ventas.
  - **Historial** unificado con filtro Todos/Ventas/Reservas y **anulación
    lógica** (sin borrado físico).
  - Dedup: archivo por `(business, tipo, hash)` y fila por `row_hash` (incl.
    hash de reservas por campos estables + ocurrencias).
  - Migración `202607100001`: `import_type`/`detected_period_*`/`raw_summary`
    en imports, tabla `sales_commission_reservations` (RLS + índices) y
    `provider_name`/`unique_patients` en patient_counts. Aplicada a db-cls.
  - Permisos nuevos: `sales_commission.import.sales` y
    `sales_commission.import.reservations` (el general sigue válido).
  - **Validado con los archivos reales**: Ventas 6 hojas, Ene–Jun 2026, total
    RD$19,486,006 exacto (servicios 16,924,532 / productos 2,561,474 / efectivo
    3,732,180 / transferencia 4,617,091 / tarjeta 11,136,735), 6 meses;
    Reservas 23,706 filas (Asiste 14,432 · Cancelado 7,130 · No Asiste 2,114 ·
    Confirmado 18 · Reservado 8 · En Espera 4), atenciones agregadas 14,432.

---

## [0.29.1] — 2026-07-10

### Fixed
- **Importación de Comisión de Ventas: "duplicate key" al confirmar.** Dos
  líneas de venta idénticas dentro del mismo archivo (mismo recibo, ítem
  repetido) generaban el MISMO `row_hash` y chocaban con el índice único al
  insertar (el archivo real trae 5,231 filas).
  - El cliente ahora incluye el **Identificador del recibo** en el hash y
    **desambigua ocurrencias repetidas** (`hash#2`, `hash#3`…): las líneas
    idénticas legítimas se conservan todas.
  - El servidor deduplica defensivamente dentro del lote (jamás revienta el
    índice) y **paraleliza** las consultas de dedup y los inserts de 500 en
    500 para que archivos grandes no rocen el timeout.
  - Los 5 intentos fallidos quedaron auto-anulados por la compensación de
    v0.28.4 (0 ventas huérfanas) — el reintento quedó libre.

---

## [0.29.0] — 2026-07-10

### Fixed
- **Sidebar ocultable y grupos colapsables.** Causa raíz de la "columna con
  flechas": en desktop el CSS forzaba el sidebar siempre visible
  (`translateX(0) !important`), ocultaba el botón de cierre y reservaba
  `padding-left: 18rem` fijo — no existía modo oculto.
  - Desktop: botón **"Ocultar menú"** (X) → `display:none` del aside +
    contenido al 100% (sin columna residual); botón flotante **"☰ Mostrar
    menú"** para restaurar.
  - **Todos los grupos plegables con acordeón** (uno abierto a la vez), chevron
    ▸/▾, `aria-expanded`/`aria-controls`, badge de pendientes al cerrar; el
    grupo del tab activo se abre automáticamente.
  - Preferencias visuales persistidas (`sidebarCollapsed`, `expandedGroup`) —
    nunca permisos (`canAccessMenu` sigue gobernando).
  - Drawer móvil: `Escape` cierra + scroll del fondo bloqueado.

---

## [0.28.4] — 2026-07-10

### Fixed
- **Importación de Comisión de Ventas fallaba** ("error de importación
  Supabase"): las fechas del Excel llegan como `30/06/2026 19:19` (DD/MM/YYYY)
  y Postgres (DateStyle ISO,MDY) las rechaza → fallaba el lote completo y la
  importación quedaba huérfana **bloqueando el reintento** por `file_hash`.
  - `commitCommissionImport` normaliza `sale_date` con `parseDateISO` (día
    primero) → ISO.
  - Compensación en fallo: quita solo las ventas del import fallido y lo marca
    `anulado` (ya no bloquea reintentos).
  - Import atascado del 2026-07-10 15:22 (779 declaradas / 0 insertadas)
    marcado `anulado` en db-cls (UPDATE, sin borrar datos).

---

## [0.28.3] — 2026-07-10

### Fixed
- La sección **"Comisión de Ventas" no aparecía en el menú lateral**: el
  sidebar tiene su propia lista de secciones (no se arma desde `MENU_OPTIONS`);
  se registró la sección con los 11 submenús e íconos.

---

## [0.28.2] — 2026-07-10

### Fixed
- **Clientes Cosmiatría mostraba 0 clientes + "verifica la conexión con
  Supabase".** Causa raíz: la tabla `csl_cosmiatria_clientes` creció a ~16,197
  filas (sync AgendaPro de Mayo 2026) y `getClientesCosmiatria` traía TODO con
  `select *` en páginas secuenciales de 1000 (~115s), excediendo el timeout de
  25s → el frontend lo ocultaba como lista vacía. Los datos SIEMPRE estuvieron
  presentes (16,197 csl / 1 depicenter); no era tabla vacía.
  - **Paginación server-side**: nuevos handlers `getClientesCosmiatriaPaged`
    (columnas lean + `.range()` + búsqueda `ilike` + orden + `count=exact`,
    scopeado por `business_id`) y `getClientesCosmiatriaKpis` (conteos globales).
    Verificado contra db-cls: página 50 = **0.47s** (antes 115s), KPIs ~0.2s.
  - Componente reescrito a paginación/búsqueda/orden **server-side** + KPIs por
    conteo; "Con fichas"/"Fichas" desde las fichas (pocas, enlazan por
    `cliente_id`).
  - **Manejo de errores**: si la consulta falla se muestra "Error al cargar
    clientes" con detalle seguro (recurso + fecha), ya NO se convierte el error
    en lista vacía silenciosa.
  - Infra confirmada correcta: `db-cls.cibao-cloude.com` (self-hosted), NO Cloud.

---

## [0.28.1] — 2026-07-10

### Fixed
- **Excel de comisión**: se elimina un `mergeCells` 1×1 inválido en las hojas
  de resumen que abortaba la generación del `.xlsx`. Refactor
  `buildCommissionWorkbook` (builder testeable) + `exportCommissionExcel`.
  Verificado por lectura de vuelta: 11 hojas, autofiltro `A6:J6`, freeze panes.

---

## [0.28.0] — 2026-07-10

### Added
- **Comisión de Ventas — Fase 2g: Reportes (Excel + PDF + impresión) — 11/11
  pantallas completas.**
  - **Excel profesional multi-hoja** (`lib/commission/commission-export.ts`,
    ExcelJS): 10 hojas — Resumen General, Ventas por Sucursal, Ventas por
    Prestador, Incentivos Productos, Incentivos Servicios, Depilación Láser,
    Láser·Reparto, Clientes Atendidos, Liquidación Final, Reglas Aplicadas,
    Conciliación — con logo, encabezado corporativo, colores de marca, bordes,
    freeze panes, autofiltro, formato moneda RD$ y totales. Nombre
    `COMISION_VENTAS_<MES>_<AÑO>.xlsx`.
  - **PDF/impresión** A4 horizontal branded (`window.print`): KPIs + Ventas por
    sucursal + Liquidación final con totales.
  - Pantalla **Reportes** con selector de mes/año, preview de KPIs y botones
    Excel / PDF / Imprimir (gateados por `sales_commission.export`).

### Changed
- Se eliminó el placeholder genérico de pantallas: las 11 vistas de Comisión de
  Ventas son dedicadas y funcionales.

---

## [0.27.0] — 2026-07-10

### Added
- **Comisión de Ventas — Fase 2f: vistas administrativas.**
  - **Ventas por sucursal**: bruto, tarjeta/efectivo/transferencia/otros,
    **% tarjeta (27% configurable)** y **resultado tarjeta**, productos/servicios/
    láser por sucursal, con totales.
  - **Comisión depilación láser**: venta láser, tramo/umbral alcanzado, **fondo
    generado** y **reparto por participación de pacientes** por prestador.
  - **Clientes atendidos**: pacientes distintos por prestador comisionable y
    participación proporcional con diferencia de redondeo.
  - Server: `getCommissionByBranch`, `getCommissionPatients`, `getCommissionLaser`
    (agregan `sales_commission_sales`; comisionabilidad vía `classifyProvider`
    sobre el prestador original; % tarjeta/escala desde reglas vivas).
- El **importador ahora prefiere la hoja "Produccion v2"** y captura el **medio
  de pago por fila** (efectivo/tarjeta/transferencia), habilitando el cálculo
  real de % tarjeta por sucursal (con fallback a "Produccion").

---

## [0.26.0] — 2026-07-10

### Added
- **Comisión de Ventas — Fase 2e: pantallas de resultado por empleado.**
  - **Comisiones por prestador**: tabla ordenable (por cualquier columna) sobre
    `sales_commission_calculations` — productos, incentivos, láser, ajuste, bono,
    limpieza, neto; total neto en la cabecera.
  - **Liquidación de incentivos**: tabla con inc. productos / inc. servicios
    (comisión+láser+fijo+ajuste) / bono / bruto / limpieza / neto / estado +
    acciones: **editar bono/limpieza/ajuste** (recalcula bruto/neto), **aprobar**,
    **marcar pagado**; badges de estado y guarda de período cerrado.
  - **Incentivos de productos**: unidades e incentivo por empleado con totales.
  - Server: `updateCommissionCalculation` (recalcula, permisos por campo:
    bono/limpieza/ajuste) y `setCommissionCalcStatus` (revisión/aprobado/pagado/
    cerrado con permiso, `paid_at`/`approved_at`, auditoría, no toca cerrados).

---

## [0.25.0] — 2026-07-10

### Added
- **Comisión de Ventas — Fase 2d: pantalla "Importar ventas" (flujo real).**
  - Drag & drop de `.xlsx` → SHA-256 del archivo (dedup) → parseo de la hoja
    "Produccion" con ExcelJS en el navegador → `toSaleRecord` + `aggregateSales`
    (motor ya probado) con la config derivada de las **reglas vivas** → **preview
    + diagnóstico/conciliación** (por categoría, por sucursal, fondo láser,
    filas sin sucursal/sin clasificar/sin prestador) → **Confirmar importación**.
  - Deduplicación **dos niveles**: archivo (`file_hash` único activo → "Este
    archivo ya fue importado…") y fila (`row_hash` FNV `lib/commission/hash.ts`,
    descarta transacciones ya existentes).
  - Persistencia por lotes en `sales_commission_imports/_sales/_calculations`
    (server `commitCommissionImport`/`checkCommissionImport`, tenant + permiso
    `sales_commission.import` + auditoría). **Verificado** el path de inserción
    contra db-cls (transacción con ROLLBACK, columnas correctas, sin residuo).

---

## [0.24.0] — 2026-07-09

### Added
- **Comisión de Ventas — Fase 2c: menú + capa de datos + pantalla de Reglas.**
  - **Sección de menú "Comisión de Ventas"** con los 11 submenús (Dashboard,
    Importar ventas, Ventas por sucursal, Comisiones por prestador, Incentivos
    de productos, Comisión depilación láser, Clientes atendidos, Liquidación de
    incentivos, Reglas de comisión, Historial mensual, Reportes). 11 `TabId` +
    entradas en `lib/menus.ts` + `case` en `app/page.tsx` (admin/superadmin ven
    todo; resto por `user.menus`).
  - **Capa de datos** `lib/server/commission.ts` (tenant-safe por `business_id`,
    permisos `sales_commission.*`, auditoría) + acciones en el dispatcher
    `/api/csl`: `getCommissionRules`, `saveCommissionRule`,
    `setCommissionRuleActive`, `getCommissionImports`, `getCommissionCalculations`,
    `getCommissionDashboard`. Siembra reglas por defecto si el negocio no tiene.
  - **Pantalla Reglas de comisión** funcional (lee las reglas vivas de db-cls,
    edita % / monto fijo / umbral / activa; gateada por permiso).
  - **Dashboard** e **Historial** leen datos vivos; las 8 pantallas restantes
    son scaffolds DEDICADOS (no reutilizan pantallas ajenas) claramente
    etiquetados con lo que harán en la próxima fase.
  - Verificado: `lint`/`build` OK; las 12 reglas se leen de db-cls con el mismo
    query del servidor. (La UI autenticada la valida el usuario en prod.)

---

## [0.23.0] — 2026-07-09

### Added
- **Comisión de Ventas — Fase 2b: importador (clasificación + agregación)**,
  verificado contra el archivo real de Cibao (Jun 2026, 779 ventas, RD$2,558,505).
  - `lib/commission/classification.ts` — deriva la CATEGORÍA del nombre del
    servicio (Depilación Láser→LÁSER, C-1→FACIALES, T-1→TATUAJES, M-1→MASAJES,
    HOLLYWOOD→HOLLYWOOD/AQUA PEEL, tipo Producto→PRODUCTO) con catálogo
    configurable; y `classifyProvider` (rol entre paréntesis → excluye
    recepción/POS/administración/"Sin Información").
  - `lib/commission/aggregate.ts` — `toSaleRecord` (normaliza+clasifica) y
    `aggregateSales` (por empleado/categoría/sucursal + motor: incentivo
    productos, comisión por categoría, fondo láser por escala).
  - **Verificado real**: bruto cuadra 2,558,505; ~98% clasificado (solo 12
    filas OTROS); sucursales normalizadas; fondo láser total 1,761,100→4%→70,444;
    15 empleados comisionables; expone 126 filas sin sucursal y 521 sin
    prestador (láser "Sin Información") para conciliación.
  - El RD$25,815.11 permanece como prueba unitaria del motor (Fase 1); importar
    datos reales produce los números reales del período (decisión del usuario).

---

## [0.22.0] — 2026-07-09

### Added
- **Comisión de Ventas — Fase 1: motor de cálculo + cimientos** (módulo nuevo,
  aún sin UI). Todo configurable, sin valores hardcodeados en la lógica.
  - `lib/commission/` — motor PURO y verificado:
    - `money.ts` (aritmética en centavos, sin errores de float),
    - `types.ts` (reglas, liquidación, orígenes de incentivo),
    - `rules.ts` (semilla de reglas + resolución por fecha efectiva + escala láser),
    - `engine.ts` (incentivo productos, % tarjeta administrativo, comisión por
      categoría, tramo láser por mayor umbral, participación de pacientes con
      redondeo, liquidación por empleado, totales, conciliación),
    - `normalize.ts` (nombres, sucursales Cibao LOS JARDINES/RAFAEL VIDAL/VILLA
      OLGA, formas de pago, montos multi-formato, fechas, alias de prestadores),
    - `column-mapping.ts` (equivalencias ES/EN de encabezados + detección),
    - `reference-model.ts` (modelo de referencia + auto-reconciliación).
  - **Verificado** (ruta de self-check temporal): el modelo reproduce
    **RD$25,815.11** neto exacto y todos los netos por empleado; detecta la
    discrepancia **67 vs 86** productos (diff 19, semáforo advertencia);
    participación de pacientes 21.81/17.02/18.26/21.63/21.28%; tramo láser
    650k→3%→19,500; normalización y mapeo de columnas OK.
  - **13 permisos** `sales_commission.*` en el catálogo (`lib/permissions.ts`).
  - **Migración** `202607090001_sales_commission_module.sql` — 8 tablas
    (`sales_commission_*`) multi-tenant con RLS por tenant, grants a
    service_role, índices, único activo por `(business_id, file_hash)` y por
    `(business_id, row_hash)`. Aditiva/idempotente. **Pendiente de aplicar a
    db-cls** (Fase 2).

---

## [0.21.0] — 2026-07-09

### Changed
- **Exportar Excel del inventario ahora genera un `.xlsx` NATIVO** (motor
  `lib/inventario-materiales-xlsx.ts` con **ExcelJS**), reemplazando el enfoque
  HTML→`.xls` de v0.20.0. Incluye, verificado por lectura de vuelta del archivo:
  **autofiltro** (`A6:F6`), **freeze panes** (encabezado congelado, `ySplit 6`),
  logo embebido (best-effort), encabezado corporativo, columnas con color de
  marca + negrita, bordes, anchos de columna definidos, cantidad con formato
  numérico alineada a la derecha, fila de totales y página **A4**. Nombre de
  archivo: `INVENTARIO_MATERIALES_<SUCURSAL>_<FECHA>.xlsx`.

### Added
- Dependencia `exceljs@^4.4.0` (browser build, importada dinámicamente para no
  cargar el bundle inicial).

### Removed
- `buildInventarioExcelHtml` / `exportInventarioExcel` (HTML→`.xls`) de
  `lib/inventario-materiales-pdf.ts`, sustituidos por el `.xlsx` nativo.

---

## [0.20.0] — 2026-07-09

### Added
- **Acciones de inventario en el Histórico de inventarios** (Requisición de
  Materiales → Histórico de inventarios). El menú ⋮ de cada fila ahora incluye,
  gateadas por permiso:
  - **Ver inventario** — modal a pantalla completa con encabezado corporativo
    (INVENTARIO DE MATERIALES, sucursal, fecha, estado, creado por, total de
    materiales y cantidad total), tabla **agrupada por proveedor/categoría**,
    numerada (No.) y responsive (tabla en desktop, tarjetas en móvil). El modal
    ofrece además botones directos de Imprimir / Excel / PDF.
  - **Imprimir** — versión limpia A4 con logo y marca vía `window.print()`.
  - **Exportar Excel** — `.xls` con el **formato profesional del sistema**
    (logo, encabezado corporativo, columnas No./Material/Proveedor·Categoría/
    Cantidad/Unidad/Observación, colores de marca, bordes, anchos de columna,
    cantidad alineada a la derecha, fila de totales). Reutiliza el mismo enfoque
    HTML→Excel de `hr-report-excel` / `purchases-export`. Nombre de archivo
    profesional: `INVENTARIO_MATERIALES_<SUCURSAL>_<FECHA>.xls`.
  - **Generar PDF** — misma vista branded A4; el `<title>` sugiere
    `INVENTARIO_MATERIALES_<SUCURSAL>_<FECHA>` al guardar como PDF.
- **Permisos granulares** en el catálogo (`lib/permissions.ts`):
  `materials.inventory.view`, `materials.inventory.print`,
  `materials.inventory.export_excel`, `materials.inventory.export_pdf`
  (admin/superadmin bypassan; asignables por UI a usuarios normales).

### Changed
- `lib/inventario-materiales-pdf.ts`: página de impresión a **A4**, título de
  documento con el nombre profesional, y nuevos builders reutilizables
  `buildInventarioExcelHtml` / `exportInventarioExcel` + `inventarioFileBase`.

---

## [0.19.0] — 2026-07-09

### Changed
- **Modal de aprobación de requisiciones de materiales** (Requisición de
  Materiales → Aprobaciones → *Gestionar / Ver detalle*): rediseño de la vista
  de detalle por ítem para aprovechar el ancho disponible y eliminar el scroll
  horizontal.
  - Ancho amplio en desktop: `width: calc(100vw - 48px)`, `max-width: 1400px`,
    `max-height: 90vh`.
  - Tabla con columnas proporcionales (`table-fixed`): Material 22% ·
    Solicitado 8% · Cant. aprobada 12% · Observación/suplidor 22% · Estado 12% ·
    Acciones 24%. La columna Acciones ya no queda cortada.
  - **Cabecera fija** (sucursal, estado, conteo y acciones globales) con
    **scroll vertical interno** en el cuerpo; se elimina el doble scroll previo.
  - Botones de acción por fila **en horizontal** `[Aprobar] [Rechazar]` (antes
    apilados verticalmente).
  - Input de *Cantidad aprobada* más compacto y centrado; nombres de material
    largos ahora hacen *wrap* en lugar de ensanchar la tabla.
  - **Adaptación a móvil**: por debajo de `md` la tabla se sustituye por
    tarjetas apiladas, sin scroll horizontal.

### Added
- Botón **"Rechazar todo"** en la cabecera del modal de detalle (junto a
  "Aprobar todo"), visible cuando la requisición está *enviada* / *en revisión*;
  reutiliza el flujo existente de rechazo a nivel de requisición (con motivo).

---

## [0.18.0] — 2026-07-08

### Added
- **Módulo COMPRAS completo** — nuevo grupo de menú "Compras" con 5 pantallas:
  **Dashboard de compras**, **Facturas de proveedores**, **Pagos / gastos**,
  **Gastos menores** y **Pagos recurrentes**. Reutiliza proveedores (texto, como
  `material_catalog.supplier_group`) y materiales — NO duplica catálogos.
  - **Facturas de proveedores**: número, NCF, proveedor, RNC/Cédula, fechas,
    sucursal, tipo de compra, forma de pago, condición (contado/crédito),
    subtotal/descuento/ITBIS/total, monto pagado, balance, estados
    (borrador/pendiente/parcial/pagada/vencida/anulada), detalle por líneas,
    **adjunto con foto o PDF** (bucket privado `purchase-docs`, `capture` de
    cámara). Acciones: ver detalle, editar, registrar pago, PDF, ver pagos,
    anular, eliminar borrador (soft delete). El balance sale SOLO de
    `purchase_payments` (ledger único → anti-doble-conteo).
  - **Pagos / gastos**: registro general (gasto operativo/servicio/otro); un
    "Pago de factura" se enruta al ledger de pagos de la factura (no duplica).
  - **Gastos menores**: caja chica con estados pendiente/aprobado/rechazado/
    pagado; aprobar, rechazar (con motivo), marcar pagado; filtros y comprobante.
  - **Pagos recurrentes**: frecuencias semanal…anual, próxima fecha, día habitual,
    activo/inactivo; muestra próximos y vencidos; registrar pago avanza la próxima
    fecha automáticamente y guarda historial; pausar/reactivar; anti-duplicado por
    período.
  - **Dashboard**: total compras del mes, total pagado, balance pendiente,
    facturas vencidas, gastos generales/menores del mes, recurrentes próximos y
    vencidos. Filtro por **mes** + sucursal (mes presente en todas las pantallas).
  - **PDF profesional** (logo empresa activa) + **Excel** por consulta
    (`lib/purchases-export.ts`); PDF por factura con detalle + pagos.
  - **Integración con requisiciones**: "Desde requisición" crea una factura
    borrador desde el consolidado aprobado (reutiliza proveedor + materiales,
    guarda `requisition_id`). **Una factura NUNCA aumenta inventario** — la
    entrada real sigue siendo la recepción de materiales de la requisición.
  - **RBAC granular** (nuevo catálogo `lib/permissions.ts`): `compras.ver/crear/
    editar/pagar/aprobar/anular/eliminar/exportar`, validados en backend
    (`requirePermission`, admin/superadmin bypassa) y frontend (`canPerm`).
    Asignables desde Configuración › Usuarios (checkboxes). Aislamiento por
    tenant + sucursal; Cibao/Depicenter nunca se mezclan.
  - **BD** (`202607080001_purchases_module.sql`, aplicada a db-cls): 8 tablas
    `purchase_invoices`, `purchase_invoice_items`, `purchase_payments`,
    `expenses`, `petty_expenses`, `recurring_payments`,
    `recurring_payment_history`, `purchase_audit_logs` — multi-tenant + RLS +
    soft delete + `created_by/updated_by/deleted_*`. Bucket privado `purchase-docs`.
  - Backend `lib/server/purchases.ts` + subida `app/api/purchases/documents/upload`.
  - Test e2e `scripts/_test-compras-flow.js` (20/20 pasos).

### Verified
- **e2e** (`scripts/_test-compras-flow.js`, contra db-cls, 20/20): factura con
  detalle, pago parcial→pagada con balance correcto, gasto, gasto menor
  (aprobar/pagar), recurrente con próxima fecha automática (+1 mes), filtros
  mes/sucursal, factura desde requisición con referencia, **factura NO aumenta
  inventario**, soft delete, **RBAC** (sin permiso rechazado), business_id=CSL,
  dashboard. **Solo Supabase local.**
- **Navegador (Chrome)** como NO-admin con permisos compras.*: 5 menús visibles,
  formulario de factura completo con **"Tomar foto"** (cámara), creación real →
  toast + fila en lista.
- `tsc --noEmit` (lint) y `next build`: OK.

---

## [0.17.0] — 2026-07-07

### Added
- **Inventario de materiales por sucursal (conteo físico histórico)** — nuevo
  módulo dentro de Requisición de Materiales, con dos menús:
  **Inventario de materiales** (captura) e **Histórico de inventarios** (lista).
  - **Reutiliza el catálogo maestro existente** (`material_catalog`) — NO crea
    catálogo nuevo. La lista se muestra agrupada por proveedor (BRAVO, NACIONAL,
    PRICES MART, SUPLIDOR), igual que en las requisiciones.
  - **Captura:** selección de Sucursal + Fecha + buscador; KPIs (Total / Contados
    / Sin contar / Cantidad total); campo "Cantidad en existencia" (enteros y
    decimales, teclado numérico) + Observación por material. **Autoguardado** de
    borrador (evita pérdida en conteos largos), **Guardar borrador**, **Finalizar
    inventario**, **Limpiar** y **PDF**. Reanuda el borrador de (sucursal, fecha)
    al volver (conserva las cantidades).
  - **Histórico:** columnas Fecha · Sucursal · Materiales · Estado · Creado por ·
    Finalizado por · Fecha finalización + menú **Acciones**: Ver detalle,
    Imprimir/PDF, Duplicar como nuevo conteo, Editar (solo borrador), Corregir
    (solo Admin/Superadmin, con auditoría), Eliminar (soft delete), Ver historial
    de cambios. Filtros por sucursal, estado y rango de fechas.
  - **PDF profesional** (`lib/inventario-materiales-pdf.ts`): logo de la empresa
    activa, título "INVENTARIO DE MATERIALES", sucursal/fecha/responsable/estado,
    tabla (# · Material · Unidad · Cantidad en existencia · Observación) agrupada
    por proveedor, total de materiales y fecha/hora + usuario de generación.
  - **Inmutabilidad:** un inventario **finalizado** no se edita por la vía normal;
    solo Admin/Superadmin lo corrige con auditoría (usuario, fecha, valor
    anterior, valor nuevo, motivo). Índice único parcial evita duplicar el
    borrador de una misma (sucursal, fecha) — el doble clic no crea duplicados.
  - **BD** (`202607070001_material_inventories.sql`, aplicada a db-cls):
    `material_inventories` + `material_inventory_items` (FK → `material_catalog`,
    snapshots de nombre/proveedor) + `material_inventory_audit_logs`. Multi-tenant
    (`business_id`) + RLS por tenant + soft delete. Aislamiento por sucursal
    (`scopeByBranch`) — la encargada ve solo su(s) sucursal(es); Cibao/Depicenter
    nunca se mezclan.
  - **RBAC:** crear/borrador/finalizar/ver-históricos/PDF para usuarios
    autorizados en sus sucursales; corregir/gestionar eliminaciones solo
    Admin/Superadmin. El módulo **NO** modifica requisiciones, compras,
    aprobaciones ni el catálogo (conteo independiente).
  - Backend en `lib/server/materials.ts` (acciones `getInventoryDraft`,
    `saveInventory`, `getInventories`, `getInventory`, `deleteInventory`,
    `restoreInventory`, `duplicateInventory`, `correctInventoryItem`,
    `getInventoryAuditLogs`) + registro en `app/api/csl/_handlers.ts`.
  - Test e2e de regresión: `scripts/_test-inventario-flow.js` (20/20).

### Verified
- **e2e** (`scripts/_test-inventario-flow.js`, contra db-cls): NO-admin usa el
  módulo; catálogo reutilizado (58, sin duplicar); borrador + reanudar (decimales
  1.5); re-guardar reutiliza el id (sin duplicar); finalizar → inmutable;
  histórico con conteo + "Creado/Finalizado por"; RBAC (corrección/eliminación de
  finalizado rechazadas a NO-admin); `business_id`=CSL. **Solo Supabase local.**
- **Navegador (Chrome)** como encargada NO-admin de Los Jardines: ambos menús
  visibles; 58 materiales agrupados por proveedor; KPIs reactivos con decimales;
  Guardar borrador → toast; histórico con columnas correctas y snapshot de nombre.
- `tsc --noEmit` (lint) y `next build`: OK.

---

## [0.16.0] — 2026-07-07

### Fixed
- **"Crear cabina" no hacía nada para usuarios NO-admin (encargados/recepción).**
  Causa raíz REAL (la nota "Verified" de v0.15.3 fue un diagnóstico incompleto:
  solo se probó como admin/owner, donde el bug no ocurre):

  1. **Permiso inconsistente (por qué NO se creaba la cabina).** El handler
     `saveMaintenanceCabin` exigía `requireAdmin(user.id)` y lanzaba
     `"Solo un administrador puede gestionar usuarios"` para cualquier no-admin.
     Pero el botón **"+ Agregar cabina"** vive dentro del editor de **Equipos**,
     que SÍ es accesible a roles no-admin (verificado: los perfiles `Cibao` y
     `CARLOS` tienen `equipos` en su menú), y **guardar un equipo**
     (`saveEquipo` / `updateEquipoCampos`) **no** exige admin. Resultado: una
     encargada de Los Jardines que edita equipos y necesita agregar una cabina
     era rechazada en el servidor antes del INSERT. El INSERT en sí siempre
     funcionó (Supabase local db-cls, status 201; no era DB/constraint/RLS/
     business_id). **Fix:** se quitó `requireAdmin` de `saveMaintenanceCabin`;
     la acción sigue **scopeada por `business_id` del contexto** (nunca cruza
     CSL/Depicenter) y deduplica por negocio+sucursal+nombre. `requireAdmin`
     queda intacto en las acciones realmente admin-only (gestión de usuarios,
     etc. — verificado que un no-admin sigue bloqueado ahí).

  2. **Mensajes de error/éxito invisibles con un modal abierto (por qué "no
     pasaba nada", sin mensaje).** `ToastNotification` se renderiza en el árbol
     normal con `z-50`, mientras el overlay del `Dialog` (Radix, portaleado al
     final de `<body>`) también es `z-50` y, al ir después en el DOM, lo tapaba.
     Cualquier error del servidor quedaba oculto tras el overlay → el formulario
     parecía "congelado". **Fix:** el toast sube a `z-[200]` (por encima de
     Dialog/Sheet/overlay `z-50` y del toast primitivo `z-[100]`) + `role=alert`
     / `aria-live=assertive`. Verificado por captura de pantalla: el toast se
     pinta nítido sobre el overlay del modal.

- **UX del botón:** ahora muestra "Creando…" mientras guarda (además del spinner)
  y el mensaje de duplicado es claro y **no bloqueante** — si la cabina ya existe
  en ese negocio+sucursal, la reutiliza y la deja seleccionada
  (`Ya existe "X" en <sucursal> — seleccionada`). Nombres iguales en sucursales
  distintas SÍ se permiten.

### Verified
- **e2e (`scripts/_test-cabina-noadmin-create.js`):** un usuario throwaway
  NO-admin (tenant CSL, menú `equipos`) inicia sesión y `POST saveMaintenanceCabin`
  crea la cabina "COSMIATRIA 2 / Los Jardines": `ok:true`, `business_id` = CSL,
  sucursal correcta, nombre en MAYÚSCULA, persistida en db-cls, y un 2º POST
  idéntico devuelve `reused` (doble clic no duplica). El mismo token no-admin
  sigue recibiendo `"Solo un administrador…"` en `getUsers` (gate intacto).
- **Navegador (Chrome desktop):** logueado como encargada NO-admin de Los
  Jardines se creó "COSMIATRIA 2" desde el editor de Equipos → el botón respondió,
  el modal cerró, apareció el toast "Cabina Cosmiatria 2 creada" y la cabina quedó
  seleccionada. En DB: `created_by` = UUID del usuario NO-admin, `business_id` =
  CSL. Dato de prueba y usuario throwaway eliminados. **NO se usó Supabase Cloud.**
- `tsc --noEmit` (lint) y `next build`: OK.

---

## [0.15.3] — 2026-07-07

### Fixed
- **Selector de Operadora (editor de Equipos) no mostraba EIDYLEE en Villa
  Olga.** Causa raíz: `operadoraOptions` usaba una lista OFICIAL hardcodeada por
  sucursal (`OPERADORAS_OFICIALES_CSL`, ej. `VILLA OLGA → ["SAHOMY","YESSICA"]`)
  que **reemplazaba** al catálogo real en vez de complementarlo; EIDYLEE existe
  como operadora activa de Villa Olga en `csl_operadoras` pero nunca se agregaba.
  Ahora la fuente PRINCIPAL es el catálogo real (`dbPulsos.operadoras`) filtrado
  por la MISMA sucursal del equipo (dinámico, sin hardcodear); la lista oficial
  se suma solo como respaldo de completitud. Resultado Villa Olga: EIDYLEE,
  SAHOMY, YESSICA. `normalizeOperadora` colapsa duplicados de alias
  (RIQUELMI/ROQUELMI) y el filtro por sucursal impide que aparezcan operadoras
  de otra sucursal. No se reasigna ningún equipo/cabina — solo cambian las
  opciones disponibles del selector. Multi-tenant intacto: `dbPulsos.operadoras`
  ya viene filtrado por `business_id` activo (Cibao no ve Depicenter).

### Verified (sin cambio de código)
- **Creación de cabinas:** verificada end-to-end en producción — se creó
  "COSMIATRIA 1" en Villa Olga desde el editor de Equipos: la fila se guardó en
  Supabase local (db-cls), el modal cerró y la cabina quedó seleccionada. El
  handler `saveMaintenanceCabin` y la tabla `maintenance_cabins` funcionan
  correctamente (insert 201, dedup por negocio+sucursal+nombre). El fallo
  reportado correspondía a un bundle viejo en caché del navegador.

---

## [0.15.2] — 2026-07-07

### Fixed
- **Auditoría PULSE → Editar: el selector "Operador" y el encabezado mostraban
  el id técnico** (`op_1777497348146`, y duplicados por mayúsculas
  `OP_...`/`op_...`). Causa raíz: `operadorasEditables` armaba las opciones con
  `op.OperadoraID` (el código del catálogo `csl_operadoras`) en vez de
  `op.Nombre`, y las mezclaba con `lecturas.OperadoraID` sin resolver. Ahora:
  - Nuevo resolvedor id→nombre (`resolveOperadoraNombre`) contra el catálogo,
    case-insensitive, que colapsa `OP_123`/`op_123` al mismo nombre y descarta
    cualquier código sin nombre (nunca se muestra crudo).
  - El selector lista **solo nombres** reales, deduplicados sin importar
    mayúsculas/minúsculas.
  - El encabezado del modal y el valor cargado al abrir muestran el **nombre**.
  - Al guardar se persiste el nombre en `operadora_corregida` (que es lo que usa
    el match de disparos), así que corregir manualmente ya no rompe DISP
    OPERADOR. No se toca ningún id interno ni se crean duplicados.
  - Verificado en db-cls: 0 lecturas tenían un código guardado en
    `operadora`/`operadora_corregida` — el código solo vivía en las opciones del
    dropdown, así que no hizo falta backfill de datos.

---

## [0.15.1] — 2026-07-06

### Fixed
- **Operadoras: la columna "ID" mostraba ids técnicos** (`op_1777497348146`,
  alias legacy "Emely"/"Katherine"). La columna se eliminó de la vista: el
  dato principal es el NOMBRE oficial (columna "Operadora", primera de la
  tabla). El `OperadoraID` técnico se CONSERVA internamente (key de fila,
  editar, eliminar, updateOperadora/deleteOperadora) — solo dejó de mostrarse.
  Ver/Imprimir también muestran únicamente campos legibles (Nombre, Sucursal,
  Estado, Notas).
- **Registro de servicios: Nueva Sesión guardaba el id técnico como
  operadora.** El dropdown ahora guarda el NOMBRE (lo que muestran las tablas
  y lo que matchea `makeAgendaMatchKey` en Auditoría/Cuadre; un `op_...` nunca
  matcheaba y la sesión manual no contaba para DISP OPERADOR).
- **Filtro "Operadora" del Registro** ahora filtra por nombre normalizado con
  alias ("Katherine" del Excel matchea el oficial "KATHERIN") en vez de
  comparación exacta contra el id del catálogo, que no encontraba nada.

---

## [0.15.0] — 2026-07-06

### Fixed
- **DISP OPERADOR = 0 en Auditoría PULSE con disparos reales (semana
  29-jun → 04-jul).** Causa raíz: `detectPeriodFromFilename` aplicaba el mes
  del nombre del archivo a AMBOS días. Con `29_04_Julio_2026.xlsx` producía
  `period_start=2026-07-29` / `period_end=2026-07-04` — una semana INVERTIDA
  (la real es 29-jun → 04-jul). Ningún disparo AgendaPro caía en ese rango
  imposible, los shots (guardados correctamente bajo 2026-06-29) nunca
  matcheaban, y toda la semana quedaba DISP OPERADOR=0 → DIFERENCIA -100% →
  Crítico falso. Ahora, cuando el día inicial > día final, el inicio se ancla
  al mes anterior (y a diciembre del año anterior si el fin es enero), con
  guardia que devuelve null antes que un período invertido. Bug latente desde
  `a6f424e` (redesign PulseControl): esta fue la primera semana que cruzó de
  mes desde el go-live.
- **Match de shots tolerante a `period_end` distinto.** Los readings
  importados como lun-dom (end domingo, ej. semana 06-08 con end 06-14) no
  matcheaban los shots lun-sáb (end 06-13) por la comparación exacta de
  `period_end`. Auditoría PULSE y `recalculateDispOperador` ahora matchean por
  `period_start` (ancla de la semana operativa) + sucursal + operadora, con
  preferencia al match exacto y a la fila más recién actualizada.
- **`recalculateDispOperador` ya no traga errores en silencio.** Un fallo en
  la consulta de `csl_operator_shots` dejaba DISP OPERADOR=0 falso sin señal;
  ahora se registra en consola y se devuelve en `warnings`.
- **Guardia anti período invertido en `savePulseReading`.** Cualquier intento
  de guardar una lectura con `period_start > period_end` se rechaza con error
  claro (defensa en profundidad para todas las vías de escritura).
- **Backfill aplicado en db-cls** (`scripts/_backfill-disp-operador-0629.js`,
  idempotente, con `--dry-run`): 10 readings de la semana rota corregidos a
  `2026-06-29` + 36 `disp_operador`/`diferencia_pct` recalculados desde
  `csl_operator_shots`/`csl_sesiones_cliente` en ambos tenants (incluye la
  semana 06-08 de CSL y el cruce CLARIBEL/NOELIA de Depicenter 06-08,
  verificado contra shots y sesiones individuales). Sin datos → null (nunca 0
  falso); tablas fuente intactas.

### Added
- **Prueba anti-regresión** `scripts/_test-disp-operador-cero.js`: unit del
  parser (cruce de mes/año, invariante sin períodos invertidos en 31×31
  combinaciones) + e2e contra db-cls (ningún reading con shots reales puede
  tener DISP OPERADOR nulo/0; ningún período invertido). 12/12 pass.
- Diagnóstico `scripts/_diag-disp-operador.js`: compara readings vs shots vs
  sesiones por (tenant, semana, sucursal, operadora) y detecta dónde se
  pierde el valor, más chequeo cross-tenant de shots.

---

## [0.14.1] — 2026-07-03

### Fixed
- **Contratos y Documentos de RR.HH. operaban sobre el business del PERFIL,
  no el activo.** Los 6 handlers (`getHrContracts`, `saveHrContract`,
  `deleteHrContract`, `getHrDocuments`, `saveHrDocument`, `deleteHrDocument`)
  hacían su propio lookup de `csl_user_profiles.business_id`, ignorando el
  negocio seleccionado en la UI: un superadmin viendo Depicenter leía y
  escribía contratos/documentos de CSL. Ahora usan `effectiveBusinessId()`
  (mismo patrón v0.2.13 del resto de handlers). Barrido del antipatrón en
  todo `_handlers.ts`: no quedan más instancias (los `profile = { business_id:
  bizId }` de operator_shots/recálculo son alias correctos del activo).
  Regresión e2e `scripts/_test-hr-contracts-scoping.js` (6/6 PASS): contrato
  guardado con Depicenter activo cae bajo DEPICENTER, no se ve desde CSL, y
  se borra con el tenant correcto.

---

## [0.14.0] — 2026-07-03

### Fixed
- **Cerrado el último path de escritura cross-tenant de pulsos:
  `saveSesion`/`saveLectura` (legacy fila-a-fila).** El import Excel de la
  pantalla *Sesiones* y el sync de *Auditoría* usan estas acciones, que aún
  estampaban el business ACTIVO sin mirar la sucursal de la fila (la misma
  familia del bug corregido en v0.11.0 para el asistente de cuadre). Ahora
  rutean con `businessIdForRowSucursal` vía `upsertRow(..., {targetBusinessId})`.
- **`upsertRow`: la guardia anti-fuga de `targetBusinessId` ahora exime al
  superadmin** (antes exigía `bypassTenantFilter`, así que un superadmin
  scopeado a un negocio no podía rutear filas al tenant dueño). Un usuario
  normal sigue bloqueado de escribir en otro tenant.

### Added
- **Prueba e2e del ruteo multi-tenant de pulsos**
  (`scripts/_test-pulse-tenant-routing.js`, 8/8 PASS): superadmin con CSL
  activo guarda lectura/sesión de Depicenter y caen bajo DEPICENTER; usuario
  normal recibe error claro sin escribir nada; `saveOperatorShots` reporta
  `skipped`. Cubre también el fix de v0.11.0 que había salido sin test.

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

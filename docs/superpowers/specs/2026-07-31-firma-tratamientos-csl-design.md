# Firma digital de tratamientos en csl-app — diseño

- **Fecha:** 2026-07-31
- **Versión base:** csl-app v0.86.2
- **Origen:** absorber el sistema de firma de Cibao Firma (v1.31.1) dentro de csl-app
- **Menú anfitrión:** «Control Digital de Tratamientos» (`control-tratamientos`)

---

## 1. Objetivo

Que el cliente firme la sesión de tratamiento que recibió, dentro de csl-app, contra
**una sola base de datos** (`db-cls`), sin duplicar clientes, pagos ni catálogos.

Cibao Firma deja de ser un sistema aparte. Aporta sus **reglas** —hash del documento,
inmutabilidad del PDF, enlace de un solo uso con vencimiento, reclamo atómico del
enlace, auditoría de cada acto— no su esquema ni su código.

**No se recorta ninguna función de Cibao Firma.** Lo que cambia es de dónde salen los
clientes y los catálogos.

---

## 2. Estado verificado (2026-07-31)

Ambas bases fueron consultadas antes de diseñar.

### Cibao Firma (SQLite, `src/db/cibao.db`)

| Tabla | Filas |
|---|---|
| `clients` | 6 |
| `session_packages` | 5 |
| `session_records` | 11 |
| `session_signatures` | 11 |
| `public_sign_links` | 0 |
| `agendapro_payments` | 0 |

Nunca salió de piloto. **No hay histórico real que migrar**: esto es una construcción
en csl-app, no una migración de datos.

### csl-app (`db-cls`)

| Tabla | Filas | Nota |
|---|---|---|
| `csl_cosmiatria_clientes` | 19 253 | fuente única de clientes |
| `csl_paquetes` | 77 | 100 % `origen = agendapro_webhook`; 447 sesiones disponibles |
| `csl_sesiones_cliente` | 15 532 | histórico importado de las máquinas PULSE |
| `csl_public_form_links` | 270 | enlaces públicos ya en producción |
| `csl_sucursales` / `csl_operadoras` | 4 / 18 | catálogos vigentes |

**Hallazgo que define el diseño:** `csl_paquetes.sesiones_disponibles` se escribe solo
al recibir el pago y **nunca se descuenta** — `lib/server/agendapro-payments.ts:318`
lo dice explícito: *«NUNCA se consume al recibir el pago»*. La firma es justamente la
pieza que falta para consumirlo. **No hay riesgo de doble descuento con AgendaPro.**

**AgendaPro no envía citas.** `lib/server/agendapro.ts:3` («NO traemos citas, ventas,
pagos ni servicios») y `csl_agendapro_webhook_events` solo tiene `event_type =
'payment'` (65 eventos). La sesión a firmar no puede nacer de una agenda: la origina
la operadora desde el paquete.

`csl_sesiones_cliente` **no** sirve como registro operativo de firma: el cliente está
en texto libre (`cliente`), sin `cliente_id`, y viene de importar Excel de las
máquinas. Queda intacta y separada.

---

## 3. Decisiones tomadas

| # | Decisión | Motivo |
|---|---|---|
| D1 | Extender csl-app, no portar el esquema de Cibao Firma | Portarlo dejaría dos listas de clientes (19 253 vs 6) y la firma quedaría colgada de un cliente que la pantalla no lee |
| D2 | La sesión nace desde el paquete, en un clic | Menos tecleo en el mostrador; imposible aplicar una sesión que el cliente no pagó |
| D3 | Tres vías de firma: tableta, enlace de WhatsApp y QR | El QR y el enlace son **el mismo mecanismo**, entregado de dos maneras |
| D4 | Anular con motivo, nunca borrar | Regla del proyecto: un PDF firmado no se edita |
| D5 | Aplica a **CSL y Depicenter** | Multi-tenant desde el día uno, por `business_id` |
| D6 | El enlace de firma vence a las **24 horas** | Sin dato histórico (0 enlaces usados en Cibao Firma); se revisa con uso real |
| D7 | El PDF se guarda, no se regenera | Si se regenerara, tocar la plantilla cambiaría un documento ya firmado y el hash dejaría de cuadrar |

---

## 4. Modelo de datos

### 4.1 Tablas nuevas

**`csl_tratamientos_aplicados`** — la sesión que se dio.

| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `business_id` | uuid NOT NULL | tenant |
| `cliente_id` | text NOT NULL | → `csl_cosmiatria_clientes.cliente_id` |
| `paquete_id` | text NOT NULL | → `csl_paquetes.paquete_id` |
| `firma_id` | uuid | → `csl_tratamientos_firmas`; nulo mientras esté `pendiente` |
| `sucursal` | text NOT NULL | |
| `operadora_id` | text | → `csl_operadoras` |
| `categoria`, `servicio` | text | **snapshot** copiado del paquete al aplicar |
| `fecha_sesion` | date NOT NULL | |
| `spot`, `potencia` | text | opcionales |
| `disparos_delantero`, `disparos_trasero`, `total_disparos` | int | opcionales |
| `comentarios` | text | |
| `estado` | text NOT NULL | `pendiente` \| `firmado` \| `anulado` |
| `created_by`, `created_at`, `updated_at` | | |

`categoria` y `servicio` se copian del paquete a propósito: si mañana alguien corrige
el nombre del servicio en el paquete, el documento firmado debe seguir diciendo lo que
decía cuando el cliente lo firmó. Mismo criterio que la comisión en AlojaControl.

**`csl_tratamientos_firmas`** — el **acto de firma** y su documento.

Una firma cubre **una o varias sesiones del mismo cliente**: si el cliente viene a
firmar tres sesiones atrasadas, firma una vez y sale **un solo PDF** que las lista
todas. Por eso la relación va al revés de lo que parece — el `firma_id` vive en la
sesión, no la sesión en la firma. Es el mismo comportamiento de Cibao Firma, sin su
truco de sufijar el código (`DOC-…-2`, `DOC-…-3`).

| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `business_id` | uuid NOT NULL | |
| `cliente_id` | text NOT NULL | todas las sesiones del acto son del mismo cliente |
| `firma_imagen` | text | PNG base64 del trazo |
| `firma_hash_sha256` | text NOT NULL | hash **del archivo PDF guardado** |
| `doc_codigo` | text NOT NULL UNIQUE | `DOC-20260731-a1b2c3` |
| `pdf_path` | text NOT NULL | ruta en el bucket `firmas-tratamientos` |
| `firmado_en` | timestamptz NOT NULL | |
| `firmado_ip`, `firmado_dispositivo` | text | evidencia |
| `origen` | text NOT NULL | `tableta` \| `enlace` \| `qr` |
| `is_locked` | bool NOT NULL DEFAULT true | |
| `anulado_en`, `anulado_motivo`, `anulado_por` | | nulos mientras esté vigente |

**`csl_paquetes_ajustes`** — que un admin sume o reste sesiones con motivo
(el `session_adjustments` de Cibao Firma). Etapa 4.

| Columna | Nota |
|---|---|
| `id`, `business_id`, `paquete_id`, `cliente_id` | |
| `tipo` | `suma` \| `resta` |
| `cantidad` | int > 0 |
| `motivo` | text NOT NULL |
| `aprobado_por`, `created_by`, `created_at` | |

### 4.2 Lo que se reusa — cero duplicación

| Cibao Firma | Pasa a ser en csl-app |
|---|---|
| `clients` | `csl_cosmiatria_clientes` |
| `session_packages` | `csl_paquetes` |
| `branches` / `operators` | `csl_sucursales` / `csl_operadoras` |
| `treatment_types` / `treatment_categories` | `categoria` y `servicio` del paquete |
| `public_sign_links` | `csl_public_form_links` con `form_type='firma_tratamiento'` |
| `email_settings` | `csl_email_settings` (Gmail por negocio) |
| `session_transfers` | `csl_cesiones` |
| `consent_forms` / `consent_templates` / `pending_consents` | las 4 tablas `csl_consent_*` |
| `users` / `roles` / `role_menus` | `csl_user_profiles` + permisos por menú |
| `audit_logs` | la auditoría de csl-app |
| `agendapro_*` / `v4_*` | ya existen en csl-app |

`csl_public_form_links` ya trae `token_hash`, `usado`, `usado_en`, `expira_en`,
`cancelado`, `prefill_payload` y `business_id` — es casi columna por columna
`public_sign_links`. Los `id` de las sesiones a firmar viajan en `prefill_payload`.

---

## 5. Flujos

### 5.1 Tableta (con login)

1. Control Digital de Tratamientos → cliente → paquete con sesiones disponibles.
2. **«Aplicar sesión»**: fecha de hoy, sucursal y operadora precargadas; lo técnico es
   opcional.
3. Se crea en `estado='pendiente'`. **Todavía no descuenta.**
4. **«Firmar ahora»** → pad de firma en la misma pantalla → el cliente firma.

Si el cliente tiene varias sesiones pendientes, se marcan todas y firma una sola vez:
un solo pad, un solo PDF que las lista todas.

### 5.2 Enlace de WhatsApp y QR

3'. **«Enviar a firmar»** → se crea el enlace en `csl_public_form_links`
    (`form_type='firma_tratamiento'`, vence en 24 h, un solo uso, solo el SHA-256 del
    token en la base). La pantalla muestra **el QR** y **un botón de WhatsApp** con el
    número vigente del cliente.
4'. El cliente abre `/firmar/[token]`, ve qué va a firmar y firma. Página pública con
    la marca del negocio (`getBusinessBranding`).

### 5.3 El acto de firmar — todo junto o nada

Una función de base de datos, `firmar_tratamiento(...)`, hace en una sola transacción:

1. Reclamo atómico del enlace, si lo hay:
   `UPDATE … SET usado=1 WHERE token_hash=? AND usado=0 AND cancelado=0 AND expira_en > now()`.
   Si `changes = 0` → 409, el enlace ya se usó, venció o se canceló.
2. Verifica que **cada** sesión del acto siga `pendiente` y que su paquete tenga
   `sesiones_disponibles > 0`. Si una sola falla, no se firma ninguna.
3. Inserta **una** fila de firma con su hash y su `doc_codigo`.
4. **`csl_paquetes.sesiones_disponibles -= 1` por cada sesión firmada.**
5. Cada sesión pasa a `firmado` y apunta a la firma (`firma_id`).
6. Escribe auditoría.

Fuera de la transacción, sin bloquear la respuesta: se sube el PDF al bucket y sale el
correo al cliente.

Esto es lo que impide que un doble clic, dos pestañas abiertas o el enlace abierto dos
veces descuenten dos sesiones. Mismo patrón que `transfer_stock_atomic` en DermaLand.

---

## 6. El documento

El PDF se genera **una sola vez** y se guarda tal cual en un bucket privado nuevo,
`firmas-tratamientos`. El SHA-256 sale del archivo guardado.

Contenido: membrete del negocio, cliente, servicio y paquete, sucursal, operadora,
fecha, datos técnicos si se anotaron, la firma, el `DOC-…`, el hash, la IP, el
dispositivo y la mención de la Ley 126-02.

Se sirve con **URL firmada de corta duración**. Nunca un enlace público permanente: el
PDF trae datos del paciente.

**Verificación pública:** `/validar-firma/[codigo]`, siguiendo el patrón de
`/validar-depicenter`. Muestra si el documento es auténtico, de qué servicio y fecha
es, y si está **vigente o anulado**, con el nombre del cliente enmascarado. **El PDF no
se descarga desde ahí.**

---

## 7. Anulación y auditoría

Anular es acto de admin, con motivo obligatorio. Se anula **una sesión**, no el
documento. En una sola transacción:

- `sesiones_disponibles += 1` (esa sesión vuelve a su paquete)
- la sesión pasa a `anulado`
- **el PDF no se toca ni se borra**

La firma solo se marca `anulado_en` / `anulado_motivo` / `anulado_por` cuando **todas**
las sesiones que cubre quedan anuladas. Si un documento cubre tres sesiones y se anula
una, el documento sigue vigente: la página de verificación lo muestra vigente y señala
cuál de las tres se anuló. Anular el documento entero cuando dos de sus tres sesiones
siguen siendo válidas sería falsear lo que el cliente firmó.

Se auditan: registrar, firmar, generar enlace, cancelar enlace, anular y ajustar
sesiones. Con quién, cuándo, desde qué IP y qué dispositivo.

---

## 8. Interfaz y permisos

«Control Digital de Tratamientos» gana pestañas. Al catálogo `lib/menus.ts`, sección
«Clientes y Consentimientos»:

| Permiso | Navegable | Habilita |
|---|---|---|
| `control-tratamientos` *(ya existe)* | sí | la pantalla, con las pestañas nuevas |
| `tratamientos-aplicar` | no | «Aplicar sesión» y firmar |
| `tratamientos-firmados` | sí | historial, reimpresión y verificación |
| `tratamientos-anular` | no | anular una sesión firmada |
| `paquetes-ajustes` | no | sumar o restar sesiones con motivo |

Los permisos no navegables siguen el patrón que ya existe con `sincronizar-api`.

**Corrección de nombres:** hoy el KPI «Firmas pendientes» cuenta *consentimientos*, no
sesiones. Pasa a **«Consentimientos pendientes»**, y se agrega **«Sesiones sin
firmar»**. Si no, quedan dos números distintos con el mismo nombre en la misma
pantalla.

---

## 9. Seguridad

1. **Secretos.** Nada nuevo del lado del cliente. El bucket es privado y las URLs se
   firman en el servidor. Ninguna variable nueva con `NEXT_PUBLIC_`.
2. **SQL parametrizado.** Todo por PostgREST o por función de base de datos con
   argumentos tipados. El `cliente_id` que hoy se interpola en un `.or()` de PostgREST
   (`_handlers.ts:4295`) ya valida charset; las consultas nuevas no interpolan texto de
   usuario.
3. **RLS deny-by-default.** Las tres tablas nuevas nacen con RLS activo y sin policy
   permisiva: se llega solo por el service role del servidor, con `business_id` filtrado
   por `effectiveBusinessId()`. El bucket `firmas-tratamientos` nace privado.

Además:

- Las rutas públicas (`/firmar/[token]`, `/validar-firma/[codigo]`) no exigen login por
  diseño y deben quedar fuera del guard de sesión, como el resto de `/api/public/*`.
- El token plano nunca se guarda: en la base vive solo su SHA-256.
- La página de verificación enmascara el nombre del cliente.
- **Aislamiento por tenant:** toda lectura y escritura filtra por `effectiveBusinessId()`,
  no por el `business_id` del perfil — el error ya corregido en `csl-handlers-active-business`.

---

## 10. Etapas

| # | Entrega | Contenido |
|---|---|---|
| 1 | **Firma en tableta** | las 2 tablas, `firmar_tratamiento`, «Aplicar sesión», el pad, el PDF con hash, el descuento, la auditoría. Ya operable. |
| 2 | **Enlace y QR** | el `form_type` nuevo, `/firmar/[token]`, el QR en pantalla, el botón de WhatsApp con el número vigente |
| 3 | **Historial, verificación y correo** | pestaña de firmados, reimpresión, `/validar-firma/[codigo]`, envío del PDF por el Gmail del negocio |
| 4 | **Anulación y ajustes** | anular con motivo y `csl_paquetes_ajustes` |

Cada etapa cierra con `pnpm lint`, `pnpm build`, bump SemVer, entrada en `CHANGELOG.md`,
commit y push.

**Deploy:** el push **no** despliega y `vercel --prod` está en deny global para el
agente. Al cerrar cada etapa se le pide al usuario que lo corra él con `!` delante.

---

## 11. Riesgos

| Riesgo | Mitigación |
|---|---|
| Doble descuento por doble clic o enlace reabierto | reclamo atómico + descuento dentro de la misma función de base de datos |
| El PDF cambia si se toca la plantilla | el archivo se guarda una vez; el hash sale del archivo, no de la plantilla |
| Paquete sin sesiones disponibles pero el cliente sí vino | D2 lo bloquea. La salida es el ajuste de la etapa 4, con motivo y auditoría |
| Cruce entre negocios (CSL / Depicenter) | `effectiveBusinessId()` en cada consulta, RLS deny-by-default |
| Confusión entre «consentimiento pendiente» y «sesión sin firmar» | se renombra el KPI en la etapa 1 |
| Los 11 registros del piloto de Cibao Firma | no se migran. Cibao Firma queda de solo lectura y se apaga cuando el usuario lo decida |

---

## 12. Fuera de alcance

- Migrar los 11 registros del piloto de Cibao Firma.
- Tocar `csl_sesiones_cliente` ni el importador de PULSE.
- Traer citas de AgendaPro (la API no las envía).
- Firma con certificado digital o sello de tiempo de un tercero. La firma es
  manuscrita sobre pantalla, con evidencia de hash, IP, dispositivo y fecha, conforme a
  la Ley 126-02 — igual que Cibao Firma hoy.

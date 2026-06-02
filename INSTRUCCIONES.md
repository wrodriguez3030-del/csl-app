# Sistema de Mantenimiento CSL / Cibao Spa Laser

## URL en producción

https://csl-app-eta.vercel.app/

## Stack

- **Frontend:** Next.js 16 (App Router) + React 19 + Tailwind 4
- **Backend:** Next.js API Routes (`/api/csl`, `/api/public/*`)
- **DB / Auth:** Supabase **self-hosted** (`https://db-cls.cibao-cloude.com`)
- **Email:** Resend
- **Hosting:** Vercel

## ⚠️ Base de datos — Supabase SELF-HOSTED (única fuente)

**TODA** operación de base de datos (queries, scripts, migraciones, dev local y
producción) va contra el **Supabase self-hosted del servidor**:

```
https://db-cls.cibao-cloude.com        (Cloudflare Tunnel → VM supabase-01 :8000 / Kong)
```

- El proyecto Cloud antiguo `pfqnyzbtwhfkemkixril.supabase.co` **NO se usa más**.
  Queda solo como rollback de emergencia (revertir 3 env vars en Vercel + redeploy).
  **Nunca** apuntar `.env.local`, scripts ni Vercel al Cloud salvo rollback explícito.
- `.env.local` ya apunta al self-hosted (anon + service_role del self-hosted).
  Backup del Cloud (rollback) en `.env.local.cloud-rollback` (gitignored).
- Vercel `csl-app` (producción `csl-app-eta.vercel.app`) ya está repuntado a db-cls.
- Migraciones / DDL: correr en el **SQL Editor del Studio self-hosted** (o vía
  psql a la VM por Tailscale). NO en el dashboard del Cloud.

### 🔴 Regla de borrado de datos — CONFIRMAR DOS VECES

Borrar datos en la base de datos es **delicado e irreversible**. Antes de ejecutar
cualquier `DELETE`, `TRUNCATE`, `DROP` o un `UPDATE` masivo sin `WHERE` acotado:

1. Mostrar exactamente QUÉ se va a borrar (tabla, filas afectadas, condición).
2. Pedir confirmación explícita al usuario.
3. **Pedir una segunda confirmación** antes de ejecutar.

Nunca borrar sin esa doble confirmación. Lecturas y escrituras normales (insert /
update acotado) no requieren este paso.

## Para correr localmente

1. Instalar Node.js LTS desde nodejs.org
2. Abrir cmd / PowerShell y ejecutar: `npm install -g pnpm`
3. Entrar a la carpeta del proyecto: `cd ruta\al\csl-app`
4. Instalar dependencias: `pnpm install`
5. Crear `.env.local` con las claves de Supabase y Resend (ver más abajo)
6. Iniciar: `pnpm dev`
7. Abrir navegador en: http://localhost:3000

## Variables de entorno (`.env.local` y Vercel)

Obligatorias:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Opcionales (si faltan, el envío de correo se desactiva sin romper nada):

```
RESEND_API_KEY=...
EMAIL_FROM="Cibao Spa Laser <onboarding@resend.dev>"
```

Destinatarios de notificaciones (opcional — si no se configuran, se usan los
hardcoded legacy: `cibaospalaser@gmail.com` y `cariascmad@gmail.com` para
reportes; `cibaospalaser@gmail.com` para RRHH y fichas):

```
CSL_NOTIFY_EMAILS=...                   # fallback común (opcional)
CSL_NOTIFY_EMAILS_REPORTES=...          # reportes de mantenimiento
CSL_NOTIFY_EMAILS_RRHH=...              # solicitudes de empleo aprobadas
CSL_NOTIFY_EMAILS_FICHAS=...            # fichas dermatológicas
```

Cada uno admite múltiples direcciones separadas por coma:
`"operaciones@cibao.com, soporte@cibao.com"`. Las direcciones inválidas se
descartan en silencio.

> **Nunca** subas `.env.local` a git. Está en `.gitignore`.

## Scripts SQL — orden de ejecución en Supabase

Los SQL viven en dos carpetas (`scripts/` y `supabase/`) y deben correrse en este orden en el **SQL Editor del Studio self-hosted** (db-cls), NO en el Cloud:

1. **`scripts/supabase-schema.sql`** — schema base, índices, triggers `updated_at`, trigger `auth.users → csl_user_profiles`, RLS habilitado y policies SELECT para usuarios `authenticated`.
2. **`scripts/add-cosmiatria-schema.sql`** — tabla `csl_fichas_dermatologia` con índices.
3. **`scripts/add-cosmiatria-clientes.sql`** — tabla `csl_cosmiatria_clientes` y FK `csl_fichas_dermatologia.cliente_id`.
4. **`supabase/csl_consentimientos.sql`** — tablas `csl_consent_masajes` y `csl_consent_tatuajes_cejas`.
5. **`supabase/csl_certificados_regalo.sql`** — tabla `csl_certificados_regalo`.
6. **`supabase/enable_rls_public_tables.sql`** — refuerza RLS y la policy de `csl_user_profiles_select_own`.
7. **`supabase/csl_relate_consents.sql`** — agrega `cliente_id` y `ficha_id` (FKs) a las tablas de consentimientos, indexa, y backfillea por documento/teléfono/correo.
8. **`supabase/csl_certificados_depicenter.sql`** — tabla `csl_certificados_depicenter` (independiente de los certificados de Cibao Spa Laser).

> Los scripts son idempotentes (`if not exists`, `drop policy if exists`), así que se pueden volver a correr sin romper datos existentes.

## Despliegue a Vercel

El proyecto está vinculado a Vercel (carpeta `.vercel/` local). Despliegues:

- **Producción:** `pnpm build` (validar local) y luego `vercel deploy --prod`.
- **Preview:** `vercel deploy`.

Antes de cada despliegue:

```bash
pnpm install   # si hay cambios en dependencias
pnpm build     # debe terminar verde
```

## Headers de seguridad

`vercel.json` aplica:

- HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restrictiva.
- En `/api/*`: `Cache-Control: no-store` y `X-Robots-Tag: noindex`.

## Rate-limit en endpoints públicos

Los formularios públicos están protegidos con rate-limit en memoria (por IP),
implementado en `lib/rate-limit-server.ts`:

| Endpoint | Límite | Ventana |
|---|---|---|
| `POST /api/public/ficha-dermatologia` | 12 envíos | 10 min |
| `POST /api/public/solicitud-empleo` | 5 envíos | 10 min |

Cuando se excede el límite la respuesta es `429 Too Many Requests` con headers
`Retry-After` y `X-RateLimit-*`. El estado vive en memoria del worker
serverless: un cold start lo resetea, así que es protección "best effort"
contra flooding obvio. Para protección distribuida real cambiar a Upstash o
Vercel KV manteniendo la firma de `rateLimit({ key, max, windowMs })`.

## Estructura del proyecto

```
app/                   App Router (páginas y API)
  api/csl/             Endpoint principal autenticado (1 dispatcher, 50+ acciones)
  api/public/          Endpoints públicos (formularios sin login)
  ficha-dermatologia/  Página pública de la ficha
  solicitud-empleo/    Página pública de solicitud de empleo
  certificado-regalo/  Validador público de certificados (QR)
components/            Componentes React (uno por módulo)
hooks/                 Hooks compartidos
lib/                   Utilidades, tipos, store zustand, capa Supabase, menús
public/                Assets estáticos
scripts/               SQL maestro de Supabase (#1–#3)
supabase/              SQL incrementales y de RLS (#4–#6)
styles/                Estilos globales adicionales
```

## Convenciones internas

- **Fuente única de menús:** `lib/menus.ts` exporta `MENU_OPTIONS` y `ALL_MENU_IDS`. Tanto `lib/security.ts` (frontend) como `app/api/csl/_handlers.ts` (backend) consumen de ahí — no duplicar listas.
- **Permisos:** `is_admin` se determina por `csl_user_profiles.is_admin`. Los admins tienen acceso a todos los menús (short-circuit en `canAccessMenu`).
- **Acceso a la base:** todo escribe contra Supabase usando la **service-role key** desde el servidor. La anon-key se usa solo para autenticación. RLS está activo.
- **Persistencia local:** zustand con `persist` (`csl-maintenance-storage`). El campo `apiUrl` es legado del backend GAS; siempre se fuerza a `/api/csl`.
- **Sesión del usuario:** consumir el hook `useSessionUser()` de `hooks/use-session-user.ts`. No duplicar listeners de `storage` / `csl-auth-changed`.
- **XLSX (SheetJS):** cargar bajo demanda con `loadXLSX()` de `lib/load-xlsx.ts`. NO inyectar `<script src="...xlsx.full.min.js">` en el JSX.
- **Dedup de lecturas:** `apiCallCached(apiUrl, params)` cachea por 30 s las acciones de lectura pesadas (`getAllData`, `getAllPulsosData`, etc.). Tras una mutación, llamar `invalidateReadCache()`.

## Backend `/api/csl` — organización

```
app/api/csl/
  route.ts           45  GET/POST + dispatcher
  _handlers.ts       400 handleAction (switch único, 50+ acciones + getRowsPaged)
lib/server/
  supabase.ts        46  getSupabaseAdmin, requireAuthenticatedUser
  csl-types.ts       18  ActionParams, Row, ActionUser
  csl-helpers.ts     152 formatters/parsers (textValue, dateValue, formatCedula, etc.)
  csl-crud.ts        205 ENTITY_TABLES, getRows, getRowsPaged, upsert, delete, syncFichasCliente
  csl-pdf.ts         307 buildReportePdf, buildSolicitudPdf
  csl-email.ts       173 sendApprovedSolicitudEmail, sendReporteEmail
  csl-transforms.ts  240 fromDb, *ToDb, profileToUser
```

Para agregar una acción nueva: editar `_handlers.ts` y, si requiere mappers nuevos, `csl-transforms.ts`.

## Modelo relacional Clientes ↔ Ficha ↔ Consentimientos

```
csl_cosmiatria_clientes (cliente_id PK)
    ▲
    │ ON DELETE SET NULL
    ├── csl_fichas_dermatologia.cliente_id  (FK)
    ├── csl_consent_masajes.cliente_id      (FK)
    └── csl_consent_tatuajes_cejas.cliente_id (FK)

csl_fichas_dermatologia (ficha_id PK)
    ▲
    │ ON DELETE SET NULL
    ├── csl_consent_masajes.ficha_id        (FK opcional)
    └── csl_consent_tatuajes_cejas.ficha_id (FK opcional)
```

Reglas que aplica el backend (`saveConsentMasaje` / `saveConsentTatuajeCeja` /
`saveFichaDermatologia`):

- **Upsert no destructivo del cliente**: si la UI manda `clienteId`, se respeta.
  Si no, se deriva de la cédula → del teléfono → como último recurso se crea
  un cliente nuevo. Mismo helper que ya usa la ficha dermatológica.
- **Vínculo automático**: el `cliente_id` se persiste en cada consentimiento,
  asegurando la relación aunque la UI no haya pasado por el selector.
- **Acción `getClienteHistorial`**: devuelve `{ cliente, fichas, consentMasajes,
  consentTatuajesCejas }` filtrado por `cliente_id`. La usa el módulo Clientes
  (botón "Historial") y el formulario de consentimientos para listar las
  fichas vinculables.
- **`ON DELETE SET NULL`**: borrar un cliente no borra sus consentimientos
  firmados; sólo desconecta la relación.

## Paginación (capacidad disponible, frontend aún no la usa)

La acción `getRowsPaged` permite leer cualquier entidad por páginas:

```js
await apiJsonp("/api/csl", {
  action: "getRowsPaged",
  entity: "reportes",
  limit: 50,
  offset: 0,
  data: JSON.stringify({ filters: { sucursal: "Rafael Vidal" } }),
})
// → { ok: true, records: [...], total: 1234, limit: 50, offset: 0 }
```

Cuando `csl_reportes` o `csl_sesiones_cliente` superen unos miles de filas, migrar los listados del frontend a esta acción.

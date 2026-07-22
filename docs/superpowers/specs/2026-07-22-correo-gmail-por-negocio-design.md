# Envío de correos desde el Gmail de cada negocio (CSL)

- **Fecha:** 2026-07-22
- **Estado:** Aprobado (pendiente de plan de implementación)
- **Ámbito:** csl-app (multi-tenant: Cibao Spa Láser + Depicenter)

## 1. Problema y objetivo

Hoy CSL envía todos sus correos por **Resend** (`api.resend.com`) usando
`RESEND_API_KEY` y `EMAIL_FROM` **globales** (variables de entorno). El remitente
es un dominio genérico de Resend (`onboarding@resend.dev`), no la cuenta real del
negocio, así que las respuestas del cliente no llegan al buzón del negocio y el
correo no se ve "propio".

**Objetivo:** que los correos **cara al cliente** salgan **desde la cuenta de
Gmail del negocio** (con su "contraseña de aplicación"), configurable desde la
app. Cada negocio (Cibao y Depicenter) usa **su propia** cuenta de Gmail y **nunca
se cruzan**.

### Alcance (confirmado)

Migran a Gmail por negocio **solo los correos cara al cliente**:

1. **Ficha Dermatológica** (Clientes / Cosmiatría) — `sendFichaDermoEmail`
   (`lib/dermo-server.ts`).
2. **Consentimiento de Masajes** — `sendConsentMasajeEmail`.
3. **Consentimiento de Tatuajes/Cejas** — `sendConsentTatuajeCejaEmail`.
4. **Consentimiento de Peeling** — `sendConsentPeelingEmail`.
   (las tres en `lib/server/csl-email.ts`).

**Fuera de alcance (siguen en Resend):** RR.HH. solicitud aprobada
(`sendApprovedSolicitudEmail`) y reportes de mantenimiento (`sendReporteEmail`),
que son notificaciones internas.

### Respaldo (confirmado)

Si un negocio **aún no** tiene su Gmail configurado, el envío **cae al Resend
actual** (cero interrupción durante la transición). Los tenants no se cruzan: el
destinatario ya se resuelve por registro (lista interna + `row.correo`).

## 2. Principios no negociables

- **Cibao y Depicenter SIEMPRE separados.** El resolver de credenciales solo
  devuelve el Gmail del `business_id` pedido; jamás usa el de otro negocio.
- **La contraseña de aplicación nunca vuelve al cliente.** La UI solo ve
  `configured`, el usuario Gmail y los últimos 4 caracteres enmascarados.
- **Cifrado AES-256-GCM** reutilizando `lib/server/bi-finance-crypto.ts`
  (`encryptSecret` empaqueta `iv|tag|ciphertext` en un solo blob base64).
- **La UI SIEMPRE envía `activeBusinessId`** y el servidor valida contra el
  contexto efectivo — evita la fuga de tenant cuando un superadmin está en "Todos".

## 3. Componentes

### 3.1 Tabla `csl_email_settings` (db-cls, con RLS)

Molde idéntico a `csl_agendapro_credentials`.

| Columna              | Tipo          | Notas                                             |
|----------------------|---------------|---------------------------------------------------|
| `business_id`        | uuid PK       | FK lógica a `businesses`. Un registro por negocio |
| `gmail_user`         | text          | Cuenta remitente (ej. `cibaospalaser@gmail.com`)  |
| `encrypted_password` | text          | base64 de `iv(12)|tag(16)|ciphertext` (encryptSecret) |
| `key_last4`          | text          | Últimos 4 chars de la app password (para `••••abcd`) |
| `from_name`          | text null     | Nombre visible del remitente; default = nombre del negocio |
| `active`             | boolean       | default `true`                                    |
| `created_by`         | uuid null     | user id                                           |
| `updated_by`         | uuid null     | user id                                           |
| `created_at`         | timestamptz   | default `now()`                                   |
| `updated_at`         | timestamptz   | default `now()`                                   |

- **RLS:** habilitada, igual que `csl_agendapro_credentials` (acceso solo por
  `service_role`; la app usa el admin client). Sin políticas para `anon`.
- **DDL:** se aplica a db-cls por el canal habitual (Tailscale SSH →
  `docker exec supabase-db psql -U supabase_admin`), terminando con
  `NOTIFY pgrst, 'reload schema';`.

### 3.2 `lib/server/email-settings.ts` (solo servidor)

Espejo de `agendapro-credentials.ts`. Reusa `encryptSecret/decryptSecret/last4`.

```ts
getEmailSettingsStatus(businessId): Promise<{
  configured: boolean
  gmailUser: string
  keyLast4: string
  fromName: string | null
  active: boolean
  updatedAt: string | null
}>   // NUNCA incluye la clave

saveEmailSettings(args: {
  businessId: string
  gmailUser: string
  appPassword: string   // si viene vacío y ya existe fila → NO cambia la clave
  fromName?: string | null
  userId: string
}): Promise<EmailSettingsStatus>

resolveGmailCredentialsForBusiness(businessId: string):
  Promise<{ user: string; pass: string; fromName: string } | null>
  // Aislado por tenant. null si el negocio no está configurado.
```

Reglas:
- `saveEmailSettings` normaliza la app password quitando espacios
  (`replace(/\s+/g, "")`) — Google la muestra en grupos de 4.
- Si `appPassword` está vacío y existe registro, solo actualiza
  `gmail_user`/`from_name`/`updated_*` y conserva la clave cifrada previa.
- `resolveGmailCredentialsForBusiness` devuelve `null` (no lanza) si no hay
  registro o si el descifrado falla.

### 3.3 `lib/server/gmail-transport.ts` (solo servidor)

```ts
sendGmail(
  input: { to: string; subject: string; html: string; replyTo?: string },
  creds: { user: string; pass: string; fromName: string },
): Promise<{ ok: true; id: string } | { ok: false; error: string }>
```

- `nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true,
  auth: { user, pass } })`.
- `from: "<fromName> <user>"`, `replyTo` = `input.replyTo ?? user`.
- Nunca lanza: captura y devuelve `{ ok: false, error }`.
- **Dependencia nueva:** `nodemailer` + `@types/nodemailer` (dev). Rutas que la
  usen: `export const runtime = "nodejs"`.

### 3.4 Helper central y refactor de envío

Nuevo helper en `csl-email.ts` (exportable, reusable por `dermo-server.ts`):

```ts
sendBusinessEmail(
  businessId: string,
  msg: { to: string[]; subject: string; html: string; replyTo?: string },
  resendFallback: () => Promise<{ sent: boolean; warning?: string }>,
): Promise<{ sent: boolean; warning?: string; via: "gmail" | "resend" }>
```

Flujo:
1. `resolveGmailCredentialsForBusiness(businessId)`.
2. Si hay credenciales → **un** `sendGmail` con `to` = la lista completa de
   destinatarios (comportamiento idéntico al Resend actual, que ya envía
   `to: recipients` en un solo correo) → `via: "gmail"`.
3. Si `null` (o el envío Gmail falla) → ejecuta `resendFallback()` → `via:
   "resend"`.

Se enchufa en las **4 funciones del alcance** resolviendo el negocio con
`row.business_id`. **El HTML y la lista de destinatarios no cambian.** Las
funciones de RR.HH./reportes quedan intactas (Resend).

> Nota: `resolveBusinessNameForEmail(row)` ya existe en `csl-email.ts` y mapea
> `business_id → nombre`; se reutiliza para `fromName` cuando no hay `from_name`
> guardado.

### 3.5 API REST (patrón AgendaPro)

- `GET  /api/settings/email`  → estado del negocio activo (sin la clave).
- `PUT  /api/settings/email`  → guarda/cifra la app password.
- `POST /api/settings/email/test`  → envía correo de prueba al destinatario dado.

Cada ruta:
- `export const runtime = "nodejs"`, `dynamic = "force-dynamic"`.
- `requireAuthenticatedUser(request)` → 401 si falla.
- `resolveEffectiveBusinessContext(user.id, body.activeBusinessId)` → 403 si no
  hay contexto.
- Gating: `ctx.isAdmin || ctx.isSuperadmin` (sin permiso granular nuevo).
- `test`: usa `resolveGmailCredentialsForBusiness`; si `null` → 503 con
  `{ notConfigured: true }` y mensaje "guarda la contraseña primero".
- Nunca devuelve la clave; responde con el estado enmascarado.

### 3.6 UI: tarjeta "Correo" en Sistema → Configuración

Card dentro de `components/config-page.tsx` (patrón de "Configurar AgendaPro"),
que replica el mockup:

- Encabezado: **Correo (envío a clientes y consentimientos)** + subtítulo.
- Badge **Configurado ••••last4** cuando `configured`.
- Input **Cuenta de Gmail (remitente)**.
- Input **Contraseña de aplicación** (`placeholder: "•••••••••••• (deja vacío para
  no cambiarla)"`) + ayuda con enlace a `myaccount.google.com/apppasswords`.
- Botón **Guardar** (PUT).
- Separador + **Enviar correo de prueba**: input (prefill con el Gmail actual) +
  botón **Enviar prueba** (POST test).
- Opera sobre el **negocio activo**. Si el filtro está en "Todos" (superadmin),
  muestra "Selecciona un negocio para configurar su correo" y deshabilita el
  formulario. Envía `activeBusinessId` en cada request.

## 4. Seguridad

- App password cifrada AES-256-GCM; la clave de cifrado se deriva de
  `SUPABASE_SERVICE_ROLE_KEY` (o `BI_FINANCE_ENC_KEY` si se define). **Ninguna env
  var nueva obligatoria.**
- La app password se ingresa **solo en la UI**, nunca en env ni en logs.
- El resolver está aislado por tenant (sin fallback cruzado).

## 5. Versionado y despliegue

- Instalar `nodemailer` + `@types/nodemailer`.
- Bump de versión (SemVer, p.ej. `v0.73.0`) + entrada en `CHANGELOG.md`.
- Push a Gitea `ARB/csl-app` + GitHub, luego `vercel --prod --yes`
  (política de auto-deploy).

## 6. Verificación

- `pnpm build` verde (sin errores de tipos).
- Prueba manual:
  1. Configurar el Gmail de un negocio + "Enviar prueba" → llega el correo desde
     esa cuenta.
  2. Registrar un consentimiento/ficha real de ese negocio → el correo sale
     **desde el Gmail del negocio** (revisar `from` y que las respuestas lleguen
     al buzón).
  3. Verificar que el otro negocio, sin Gmail configurado, **cae a Resend** y
     sigue enviando.
  4. Confirmar que Cibao y Depicenter usan cuentas distintas (nunca cruzadas).

## 7. Riesgos y notas

- **Gmail SMTP desde Vercel:** ya probado en producción en DermaLand
  (`server/services/email/gmail.ts`) y AlojaControl (v0.158.0). Requiere
  Verificación en 2 pasos + "contraseña de aplicación" en la cuenta Gmail.
- **db-cls DDL:** requiere acceso SSH a la infra (el MCP de Supabase apunta a
  otro proyecto, no a csl-app).
- **Límites de Gmail:** ~500 correos/día por cuenta gratuita; suficiente para el
  volumen actual de consentimientos/fichas.

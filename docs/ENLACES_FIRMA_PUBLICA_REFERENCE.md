# Enlaces públicos de firma (WhatsApp / token) — Referencia (para otro sistema)

Cómo generar un **enlace temporal de un solo uso** para que el cliente **llene y firme**
un formulario (ficha/consentimiento) desde su teléfono, **sin login**, enviado por
WhatsApp. Verificado contra `public-form-links.ts`.

---

## 1. Idea general
1. El personal genera un **link** para un cliente y un tipo de formulario.
2. Se envía el link por **WhatsApp** (o cualquier canal).
3. El cliente abre `https://tu-dominio/formulario-publico/{token}` → ve el formulario
   **pre-llenado** con sus datos → firma → envía.
4. El token es **de un solo uso** y **expira** (default 12 h). Al enviarse, se "consume".

```
[Personal] --crea link--> token (una vez) --WhatsApp--> [Cliente abre /formulario-publico/{token}]
   --llena y firma--> submit --claim atómico del token--> guarda ficha/consentimiento
```

---

## 2. Seguridad del token (clave)
- **Token plano:** 32 bytes aleatorios en **base64url** (~43 chars, URL-safe).
  Se muestra **una sola vez** (dentro del link); **no se guarda** en la DB.
- **En la DB solo se guarda el SHA-256 (hex, 64 chars)** del token. Si la base se
  filtra, **no se pueden forjar** URLs (invertir SHA-256 es inviable).
- **Un solo uso, atómico:** al enviar el formulario se hace un `UPDATE ... WHERE
  token_hash=? AND usado=false AND cancelado=false AND expira_en>now() RETURNING`.
  Si devuelve 1 fila → se consumió y se guarda el formulario. Si 0 → se rechaza
  (ya usado / expirado / cancelado / carrera).
- **Aislado por negocio** (`business_id`) y con **TTL** (default 12 h, configurable).

```js
import { createHash, randomBytes } from "node:crypto"
const generateToken = () => randomBytes(32).toString("base64url")
const hashToken     = (t) => createHash("sha256").update(t, "utf8").digest("hex")
```

---

## 3. Tipos de formulario soportados
| `form_type` | Etiqueta |
|---|---|
| `ficha_dermatologica` | Ficha Dermatológica |
| `consentimiento_masajes` | Consentimiento de Masajes |
| `consentimiento_peeling` | Consentimiento Informado para Peeling |
| `consentimiento_tatuajes_cejas` | Eliminación de Tatuajes y Cejas |
| `consentimiento_depilacion_laser` | Consentimiento de Depilación Láser |
| `solicitud_empleo` | Solicitud de empleo |

---

## 4. Tabla (una fila por link)
```sql
create table public_form_links (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null,          -- tenant
  token_hash          text not null unique,   -- SHA-256 del token (NO el token)
  form_type           text not null,          -- ver §3
  cliente_nombre      text,
  cliente_telefono    text,
  creado_por          text,                   -- usuario que generó el link
  usado               boolean not null default false,
  usado_en            timestamptz,
  expira_en           timestamptz not null,   -- TTL
  cancelado           boolean not null default false,
  submitted_record_id text,                   -- id del registro creado al enviar
  prefill_payload     jsonb,                  -- datos para pre-llenar (ver §6)
  created_at          timestamptz default now()
);
-- Índice por token_hash; RLS por tenant; escritura solo service role.
```

---

## 5. Crear un link
```
createPublicFormLink({ businessId, formType, createdBy, clienteNombre?,
                       clienteTelefono?, prefillPayload?, ttlHours = 12 })
  token   = generateToken()
  expira  = now + ttlHours h
  INSERT { business_id, token_hash: sha256(token), form_type, cliente_*,
           creado_por, expira_en, prefill_payload }
  return { token, link }   // el `token` se usa para armar la URL, y NO se vuelve a ver
```
- **Auto-cancela** links previos **vivos** del mismo cliente + `form_type` (evita que
  circulen dos URLs válidas: "el cliente no abrió el primero, mando otro").
- La URL final: `https://tu-dominio/formulario-publico/{token}` → se manda por WhatsApp.

---

## 6. Pre-llenado (`prefill_payload`)
Objeto opcional con datos para hidratar el formulario al abrir (solo strings no vacíos):
`nombre`, `telefono`, `documento`, `correo`, `direccion`, `sucursal`, `especialista`,
`motivoConsulta`, `servicio`, `clienteId`, … Así el cliente no re-teclea sus datos.

---

## 7. Verificar (solo lectura, al abrir el link)
```
verifyPublicFormLink(token) -> {
  status: "valido" | "usado" | "expirado" | "cancelado" | "invalido",
  formType, clienteNombre, clienteTelefono, prefillPayload, expiraEn
}
```
- `valido` → renderiza el formulario pre-llenado.
- `usado`/`expirado`/`cancelado`/`invalido` → muestra el mensaje correspondiente.

---

## 8. Enviar (consumir el token)
Al enviar el formulario:
1. **Claim atómico** del token (`claimPublicFormLink(token, submittedRecordId)`):
   marca `usado=true`, `usado_en=now`, `submitted_record_id=…` **solo si sigue válido**.
2. Si el claim devuelve el link → **INSERT** del formulario (ficha/consentimiento) con
   el `business_id` del link (nunca confíes en un `business_id` que venga del cliente).
3. Si el claim devuelve null → rechaza (ya usado / expirado / carrera).

> Orden recomendado: **claim → insert**. Si el insert falla, NO reviertas el claim:
> el cliente pide un link nuevo (evita dobles envíos por reintentos).

---

## 9. Rutas públicas (sin login)
- Página: `GET /formulario-publico/{token}` (pública).
- API: `GET /api/public-form-links/{token}` (verifica) · `POST /api/public-form-links/{token}/submit` (envía).
- **Estas rutas deben estar EXENTAS del middleware de autenticación** (son públicas por diseño).
  En Next.js: agregar el prefijo a la lista de rutas públicas del `middleware`/`proxy`.

---

## 10. Buenas prácticas
- TTL corto (12 h por defecto) + un solo uso.
- Nunca registres el token plano en logs; solo el hash.
- Rate-limit en el submit y validación **server-side** de todos los campos.
- Enlace por WhatsApp: `https://wa.me/{telefono}?text=` + mensaje con el link.

---

*Referencia basada en la implementación real de CSL (`public-form-links.ts`: token
base64url + SHA-256 en DB, claim atómico de un solo uso, TTL 12 h, pre-llenado,
auto-cancelación de links previos). Sin datos reales.*

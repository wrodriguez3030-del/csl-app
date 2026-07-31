# CSL — Kit de integración (referencia completa)

Documentación técnica para **replicar la funcionalidad de CSL en otro sistema**:
AgendaPro (pagos/clientes), envío de correo por Gmail, consentimientos (email + PDF
legal con firma) y enlaces públicos de firma por WhatsApp. Todo verificado contra la
implementación real. Sin credenciales ni datos de clientes reales.

## Índice
1. **API de AgendaPro** — traer pagos y clientes por API pública (Basic Auth).
2. **Envío de correo** — Gmail SMTP + App Password (Node/PHP/Python), guardado cifrado.
3. **Consentimientos por correo** — contenido, destinatarios y campos de cada email.
4. **PDF de consentimientos** — generación con `pdf-lib`, texto legal fijo, firma embebida.
5. **Enlaces públicos de firma** — token de un solo uso (SHA-256), TTL, WhatsApp.

> Cada sección es autocontenida. Orden sugerido de implementación: 2 → 4 → 3 → 5 → 1.



<div style="page-break-after:always"></div>



===============================================================================

# AgendaPro — Referencia de la API Pública (para integrar en otro sistema)

Guía práctica y **verificada con datos reales** para conectarte a la API pública
de AgendaPro y traer **pagos, clientes, reservas y servicios**. Pensada para
integrar AgendaPro en cualquier sistema (Node, PHP, Python, etc.).

> Documentación oficial: <https://developers.agendapro.com/reference/getting-started-with-your-api>
> Ayuda: <https://ayuda.agendapro.com/es/articles/6541935-api-publica-para-que-y-como-usarla>

---

## 1. Base URL y autenticación

- **Base URL:** `https://agendapro.com/api/public/v1`
- **Autenticación:** **HTTP Basic Auth** — `Authorization: Basic base64(usuario:contraseña)`
- **Credenciales:** están en AgendaPro → **Configuración → Integraciones → API Pública**
  (campos `USER` y `PASSWORD`). Las MISMAS credenciales sirven para consultar la API
  y para recibir webhooks.
- **Siempre HTTPS.**

```bash
# Ejemplo con curl (reemplaza USUARIO y PASSWORD)
curl -u "USUARIO:PASSWORD" \
  "https://agendapro.com/api/public/v1/payments?filters[start_date]=2026-07-01&filters[end_date]=2026-07-27&page=1&per_page=100"
```

```js
// Node (fetch)
const auth = Buffer.from(`${USER}:${PASSWORD}`).toString("base64")
const res = await fetch(
  "https://agendapro.com/api/public/v1/payments?filters[start_date]=2026-07-01&filters[end_date]=2026-07-27&page=1&per_page=100",
  { headers: { Accept: "application/json", Authorization: `Basic ${auth}` } },
)
const data = await res.json()
```

### Límites (rate limit)
- **1.000 consultas por día por local** (plan Pro). Cada llamada cuenta.
- Recomendación: consultar por rango de fecha corto y **saltar lo ya procesado**
  para no gastar cuota (ver "Receta de integración").

---

## 2. Endpoints principales

| Acción | Método | Endpoint | Doc |
|---|---|---|---|
| **Listar pagos** | GET | `/payments` | [ver-pagos](https://developers.agendapro.com/reference/ver-pagos) |
| **Ver un pago** | GET | `/payments/{id}` | [ver-un-pago](https://developers.agendapro.com/reference/ver-un-pago) |
| **Crear un pago** | POST | `/payments` | [crear-un-pago](https://developers.agendapro.com/reference/crear-un-pago) |
| **Listar clientes** | GET | `/clients` (o `/clients?search=`) | — |
| **Listar reservas** | GET | `/bookings` | [ver-reservas](https://developers.agendapro.com/reference/ver-reservas) |
| **Servicios por prestador** | GET | `/providers/{id}/services` | [listar-servicios](https://developers.agendapro.com/reference/listar-servicios-para-un-prestador) |
| **Horas disponibles** | GET | (según servicio) | [horas-disponibles](https://developers.agendapro.com/reference/listar-horas-disponibles-para-un-servicio) |

> Los paths exactos de reservas/servicios pueden variar por versión; confírmalos en la
> doc oficial. **Pagos y clientes están verificados.**

---

## 3. Pagos — Listar (`GET /payments`)

### Parámetros (query string)
| Parámetro | Tipo | Descripción |
|---|---|---|
| `filters[start_date]` | `YYYY-MM-DD` | Fecha inicial del rango |
| `filters[end_date]` | `YYYY-MM-DD` | Fecha final del rango |
| `filters[location_id]` | número | Filtrar por local/sucursal |
| `filters[client_id]` | número | Filtrar por cliente |
| `filters[provider_id]` | número | Filtrar por prestador |
| `filters[service_id]` | número | Filtrar por servicio |
| `filters[status_id]` | número | Filtrar por estado |
| `page` | número | Página (default 1) |
| `per_page` | número | Resultados por página (default 20, **máx 100**) |

> **Nota:** el formato `filters[campo]=valor` (estilo Rails) está **verificado** —
> es el que usa nuestra integración funcionando.

La respuesta es un arreglo (o un objeto que lo envuelve, p. ej. `{ "payments": [...] }`).
Cada elemento es un **objeto Pago** (ver §5). Para el detalle completo y garantizado,
pide `GET /payments/{id}`.

---

## 4. Pagos — Ver uno (`GET /payments/{id}`)

Devuelve el **objeto Pago completo** (misma forma que §5). Es la fuente autoritativa.

---

## 5. Estructura del objeto **Pago** (verificada con datos reales)

```jsonc
{
  "id": 58431059,                       // ID único del pago (idempotencia)
  "payment_date": "2026-05-05T18:33:00.000Z", // UTC (ISO 8601)
  "location_id": 3586,                  // sucursal (mapea a tu sucursal interna)
  "location_name": "Cibao Spa Laser  Av. Rafael Vidal ",
  "amount": 2000,
  "paid_amount": 2000,
  "change_amount": 0,
  "employee_code_id": null,
  "employee_code_name": "",

  "client": {
    "id": 44453171,
    "first_name": "NOMBRE",
    "last_name": "APELLIDO",
    "email": "correo@ejemplo.com",
    "identification_number": "00000000000", // cédula
    "phone": "+18290000000",
    "second_phone": "",
    "age": 22,
    "birth_day": 10, "birth_month": 3, "birth_year": 2003,
    "record_number": "8290000000",
    "address": "DIRECCIÓN",
    "district": "SANTIAGO",
    "city": "SANTIAGO"
  },

  // El servicio comprado puede venir en CUALQUIERA de estos arreglos:
  "bookings": [],        // reservas/citas reales
  "mock_bookings": [     // servicios comprados SIN reserva previa (¡muy común!)
    {
      "service": "Depilación Láser  1 sesión",
      "price": 2000,
      "discount": 0,
      "provider": null,
      "payment_id": 58431059,
      "receipt_id": 68886125
    }
  ],
  "memberships": [],     // planes/membresías
  "products": [          // productos de venta (ej. cremas)
    // { "name": "RADIOCARE CREMA", "price": 900, ... }
  ],
  "giftcards": [],       // gift cards

  "down_payments": [     // formas de pago (puede haber varias transacciones)
    {
      "payment_transactions": [
        {
          "number": "2105",
          "amount": 2000,
          "installments": 0,
          "payment_method": "Tarjeta ",
          "payment_method_type": "",
          "bank": ""
        }
      ]
    }
  ],

  "receipts": [          // comprobantes (facturas/recibos)
    {
      "id": 68886125,
      "amount": 2000,
      "date": "2026-05-05",
      "number": "B020000005810",
      "receipt_type": "Factura"
    }
  ]
}
```

### Reglas importantes al parsear
- **El servicio NO siempre está en `bookings`.** Si `bookings` está vacío, el
  servicio suele estar en **`mock_bookings[].service`** (venta sin cita). Combina
  siempre: `bookings + mock_bookings + memberships + products + giftcards`.
- **Nombres de servicio con espacios dobles y acentos** → normaliza (minúsculas,
  quitar acentos, colapsar espacios, trim) antes de comparar/mapear.
- **`receipt_id`** en el item enlaza con `receipts[].id` para obtener nº de factura
  y tipo de comprobante.
- **Método de pago** viene en `down_payments[].payment_transactions[].payment_method`
  (puede haber varias transacciones; la suma debe cuadrar con `paid_amount`).
- **Fechas** en UTC → convierte a tu zona (RD = `America/Santo_Domingo`, UTC-4).

---

## 6. Clientes (`GET /clients`)

- `GET /clients?search={término}` — búsqueda por nombre/teléfono/etc.
- `GET /clients` — listado (paginado).
- Campos del cliente: los mismos del objeto `client` de §5 (`id`, `first_name`,
  `last_name`, `email`, `identification_number`, `phone`, `second_phone`,
  `birth_day/month/year`, `address`, `district`, `city`, `record_number`).

---

## 7. Receta de integración recomendada (pull de pagos)

AgendaPro tiene webhooks, **pero pueden no dispararse de forma fiable** para todos
los tipos de pago. El método robusto es **jalar por API**:

1. **Listar** los pagos del rango: `GET /payments?filters[start_date]=…&filters[end_date]=…&page=1&per_page=100`. Pagina hasta que una página traiga < `per_page`.
2. Por cada pago, si **ya lo procesaste** (guarda los `payment.id` procesados), **sáltalo** (no gastes cuota en el detalle).
3. Si es nuevo, pide el detalle: `GET /payments/{id}`.
4. **Idempotencia:** usa `payment.id` como clave única. Reenviar/reprocesar el mismo pago NO debe duplicar nada. Recomendado: `UNIQUE (tenant_id, payment_id)`.
5. **Multi-negocio:** resuelve el tenant/sucursal por **`location_id`** (mapea `location_id` → tu sucursal). Nunca mezcles negocios por nombre.
6. **No consumas sesiones al pagar.** Un pago = compra; la sesión se consume cuando se realiza el tratamiento.
7. **Automatiza** con un cron cada X minutos (ventana ayer+hoy) o un botón manual.

### Truco útil: "N sesiones" en el nombre
Servicios como `Depilación Láser N sesiones` traen la cantidad en el nombre.
Extrae el número con `/(\d+)\s*sesion/i` y úsalo como sesiones compradas — así no
tienes que mapear cada variante (1, 2, 4, 5, 10, 20, 50, 100…).

---

## 8. Webhooks (alternativa/complemento)

AgendaPro → **Integraciones → Webhooks → Crear Webhook** → pega una URL (el campo
ya trae `https://`). Enviará POST con el payload de §5. Doc:
<https://developers.agendapro.com/reference/getting-started-with-your-api-1>

Seguridad recomendada en tu receptor: secreto compartido en la URL o header,
validación de tamaño/content-type, idempotencia por `payment.id`, y **responder
rápido** (200) para que AgendaPro no reintente.

> Si ves que el webhook **no llega** (0 solicitudes con pagos reales), usa el
> **pull por API** de §7 — no dependes de que AgendaPro dispare.

---

## 9. Códigos de respuesta típicos
- `200` OK · `401` credenciales inválidas · `404` no encontrado · `422` parámetros inválidos · `429` límite de cuota.

---

*Referencia construida y verificada contra datos reales de la API de pagos de
AgendaPro (julio 2026). Los ejemplos usan valores genéricos — sin datos reales de
clientes.*


<div style="page-break-after:always"></div>



===============================================================================

# Envío de correo desde el Gmail del negocio — Referencia (para otro sistema)

Cómo enviar correos a clientes (fichas, consentimientos, notificaciones) **desde la
cuenta de Gmail del propio negocio**, vía **SMTP + Contraseña de aplicación**, con
las credenciales **cifradas** y aisladas por negocio. Incluye un respaldo por API
transaccional (Resend) opcional.

Verificado contra la implementación real de CSL (`gmail-transport.ts`,
`email-settings.ts`, `csl-email.ts`).

---

## 1. Idea general

- El correo sale **DESDE la cuenta Gmail del negocio** (ej. `negocio.consentimientos@gmail.com`).
  El cliente ve ese remitente y **sus respuestas llegan a ese mismo buzón**.
- Se usa **SMTP de Gmail** con una **"Contraseña de aplicación"** (NO la contraseña normal).
- Cada negocio guarda **su propia** cuenta → nunca se mezclan (multi-tenant).
- Si un negocio no tiene Gmail configurado → **respaldo** por una API transaccional
  (Resend) — opcional.

```
[Tu sistema] --SMTP 465--> smtp.gmail.com  --> Cliente (From: Gmail del negocio)
       └── (respaldo opcional) --> API Resend
```

---

## 2. Preparar Gmail (una vez por cuenta)

1. La cuenta Gmail debe tener **Verificación en 2 pasos** activa.
2. Crear una **Contraseña de aplicación**: <https://myaccount.google.com/apppasswords>
   - Google la muestra en **4 grupos de 4 letras** (ej. `abcd efgh ijkl mnop`).
   - Al usarla en el código, **quita los espacios** → `abcdefghijklmnop`.
3. Esa contraseña de aplicación es la que se guarda (cifrada) y se usa como `pass` en SMTP.

> Límite de envío de Gmail: ~**500 correos/día** (Gmail normal) · ~**2.000/día**
> (Google Workspace). Para volúmenes mayores, usar una API transaccional.

---

## 3. Configuración SMTP

| Parámetro | Valor |
|---|---|
| Host | `smtp.gmail.com` |
| Puerto | `465` |
| Seguro (TLS) | `true` (SSL directo) |
| Usuario | la cuenta Gmail (ej. `negocio@gmail.com`) |
| Contraseña | la **App Password** (sin espacios) |
| From | `Nombre del Negocio <negocio@gmail.com>` |
| Reply-To | la misma cuenta Gmail (para recibir respuestas) |

*(Alternativa: puerto `587` con `secure:false` + STARTTLS.)*

---

## 4. Enviar — Node.js (nodemailer)

```js
import nodemailer from "nodemailer"

async function sendGmail({ to, subject, html, replyTo, attachments }, creds) {
  const user = creds.user
  const pass = String(creds.pass || "").replace(/\s+/g, "") // quita espacios de la app password
  const fromName = creds.fromName || user

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  })

  const info = await transporter.sendMail({
    from: `${fromName} <${user}>`,
    to,                       // array de destinatarios
    subject,
    html,
    replyTo: replyTo ?? user, // respuestas al buzón del negocio
    attachments,              // [{ filename, content: Buffer }]  ej. un PDF
  })
  return { ok: true, id: info.messageId }
}
```

## 5. Enviar — PHP (PHPMailer)

```php
$mail = new PHPMailer\PHPMailer\PHPMailer(true);
$mail->isSMTP();
$mail->Host = 'smtp.gmail.com';
$mail->SMTPAuth = true;
$mail->Username = $gmailUser;
$mail->Password = preg_replace('/\s+/', '', $appPassword); // sin espacios
$mail->SMTPSecure = PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_SMTPS; // SSL
$mail->Port = 465;
$mail->setFrom($gmailUser, $fromName);
$mail->addReplyTo($gmailUser);
$mail->addAddress($to);
$mail->isHTML(true);
$mail->Subject = $subject;
$mail->Body = $html;
// $mail->addStringAttachment($pdfBytes, 'documento.pdf');
$mail->send();
```

## 6. Enviar — Python (smtplib)

```python
import smtplib, ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

msg = MIMEMultipart()
msg["From"] = f"{from_name} <{gmail_user}>"
msg["To"] = ", ".join(recipients)
msg["Reply-To"] = gmail_user
msg["Subject"] = subject
msg.attach(MIMEText(html, "html"))

app_password = app_password.replace(" ", "")  # sin espacios
with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context()) as s:
    s.login(gmail_user, app_password)
    s.sendmail(gmail_user, recipients, msg.as_string())
```

---

## 7. Guardar las credenciales de forma SEGURA (multi-tenant)

**Regla:** la App Password **NUNCA** se guarda en texto plano ni se muestra en la UI.
Se guarda **cifrada** (recomendado **AES-256-GCM**) y solo se descifra en el servidor
al momento de enviar.

### Tabla sugerida (una fila por negocio)
```sql
create table email_settings (
  business_id        uuid primary key,     -- 1 config por negocio
  gmail_user         text not null,        -- la cuenta remitente
  encrypted_password text not null,        -- App Password CIFRADA (AES-256-GCM)
  key_last4          text,                 -- últimos 4 (para mostrar "••••uppk")
  from_name          text,                 -- nombre visible del remitente
  active             boolean not null default true,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);
-- Con RLS por tenant y acceso de escritura solo desde el servidor (service role).
```

### Reglas de guardado (como en CSL)
- Al **editar**, si el campo de contraseña viene **vacío**, NO se cambia la clave
  (solo se actualiza `gmail_user`/`from_name`). Así se edita el remitente sin re-pegar
  la contraseña.
- Validar formato del correo antes de guardar.
- Para la UI: mostrar solo **estado** (`Configurado`), el correo **enmascarado**
  (`us***@gmail.com`) y los **últimos 4** de la clave. **Nunca** la clave completa.

### Resolver para enviar (servidor)
```
resolveGmailCredentials(businessId):
  row = SELECT ... WHERE business_id = businessId AND active
  if !row or !row.encrypted_password: return null   // → cae al respaldo
  pass = decryptAES256GCM(row.encrypted_password)
  return { user: row.gmail_user, pass, fromName: row.from_name }
```

---

## 8. Respaldo por API transaccional (opcional — Resend)

Si un negocio no tiene Gmail configurado (o el envío Gmail falla), se puede caer a
una API como **Resend**:

```js
await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    from: `${businessName} <onboarding@resend.dev>`, // o tu dominio verificado
    to: recipients,
    subject, html,
    attachments: [{ filename: "documento.pdf", content: pdfBase64 }], // base64
  }),
})
```

Patrón recomendado (`sendBusinessEmail`): **1º Gmail del negocio → si falla, Resend**.
Nunca lanzar excepción: devolver `{ sent, warning }` para no perder el guardado del registro.

---

## 9. Adjuntos (PDF)
- **Gmail/nodemailer:** `attachments: [{ filename, content: Buffer }]` (binario).
- **Resend:** `attachments: [{ filename, content: base64 }]`.
- Genera el PDF sin bloquear el envío: si la generación falla, **manda el correo igual**.

## 10. Correo de prueba
Antes de enviar a clientes, ofrece un **"Enviar prueba"** que manda un correo simple
a la propia cuenta configurada. Confirma credenciales + conectividad SMTP.

---

## 11. Errores comunes
- **`Invalid login` / `Username and Password not accepted`** → no es App Password, o
  falta Verificación en 2 pasos, o quedaron espacios en la clave.
- **`Must issue a STARTTLS command first`** → usa 465 `secure:true`, o 587 con STARTTLS.
- **No llegan / van a spam** → el From es el Gmail real (bien); evita enlaces sospechosos;
  para volumen alto usa API con dominio verificado (SPF/DKIM).
- **Límite diario** → Gmail corta ~500/día; para más, API transaccional.

---

*Referencia basada en la implementación real de CSL (nodemailer + `smtp.gmail.com:465`
+ App Password cifrada AES-256-GCM por negocio, con respaldo Resend). Sin credenciales
reales — usa placeholders.*


<div style="page-break-after:always"></div>



===============================================================================

# Consentimientos enviados por correo — Referencia (para otro sistema)

Documenta los **correos de consentimiento** que envía CSL: cuándo se disparan, a
quién, con qué asunto/adjunto y la **estructura HTML** de cada uno. Verificado contra
`csl-email.ts` + `_handlers.ts`.

> Depende del mecanismo de envío descrito en `ENVIO_CORREO_REFERENCE.md`
> (Gmail del negocio por SMTP + respaldo Resend).

---

## 1. Tipos de consentimiento que se envían

| Consentimiento | Asunto del correo | PDF adjunto |
|---|---|---|
| **Masajes** | `Consentimiento Masajes · {cliente}` | `consentimiento-masajes-{cliente}.pdf` |
| **Eliminación Tatuajes / Cejas** | `Consentimiento Tatuajes/Cejas · {cliente}` | `consentimiento-tatuajes-cejas-{cliente}.pdf` |
| **Peeling** | `Consentimiento Peeling · {cliente}` | `consentimiento-peeling-{cliente}.pdf` |
| **Depilación Láser** | `Consentimiento Depilación Láser · {cliente}` | `consentimiento-depilacion-laser-{cliente}.pdf` |

*(La Ficha Dermatológica usa la misma infraestructura de envío.)*

---

## 2. Cuándo se envía (trigger)

Al **guardar/registrar** el consentimiento (acción de guardado en el backend):
1. Se hace `upsert` del consentimiento en su tabla (`csl_consent_masajes`, `_peeling`,
   `_tatuajes_cejas`, `_depilacion_laser`).
2. Se sincroniza la ficha del cliente.
3. Se **envía el correo** con el resumen + PDF.

> El envío **nunca rompe el guardado**: si el correo falla, se captura el error y se
> devuelve un `warning` al frontend (el consentimiento queda guardado igual).

---

## 3. Destinatarios (`to`)

Por tenant (Cibao ≠ Depicenter). Se combinan, sin duplicados:
1. **Buzón interno del negocio** = la cuenta Gmail configurada del negocio
   (`csl_email_settings.gmail_user`). Si no hay, el correo de contacto de marca del tenant.
2. **Correo del cliente** (`row.correo`), si es un email válido.

- **From:** el Gmail del negocio (`Nombre del Negocio <negocio@gmail.com>`).
- **Reply-To:** la misma cuenta (las respuestas del cliente llegan al negocio).

---

## 4. Estructura HTML (plantilla común)

Todos comparten el mismo diseño con la marca del negocio:

```html
<!doctype html><html><body style="font-family:Arial,sans-serif;color:#102A3A;background:#F7FAFC;padding:24px">
  <div style="max-width:760px;margin:0 auto;background:#FFF;border:1px solid #E1ECF2;border-radius:14px;overflow:hidden">
    <!-- Encabezado con degradado turquesa de marca -->
    <div style="background:linear-gradient(90deg,#14B7B0,#22C7C9);padding:18px 22px;color:#FFF">
      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;opacity:.9">{NOMBRE DEL NEGOCIO}</div>
      <h1 style="margin:4px 0 0;font-size:22px">{TÍTULO DEL CONSENTIMIENTO}</h1>
    </div>
    <!-- Cuerpo: tabla de campos (label + valor) -->
    <div style="padding:18px 22px">
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="font-weight:700;color:#0B3442;padding:7px;width:200px">Campo</td>
            <td style="padding:7px;color:#102A3A">Valor</td></tr>
        <!-- ...un <tr> por cada campo (ver §5)... -->
      </table>
      <!-- Firma del cliente (imagen data-URL) -->
      <div><img src="{firma_cliente}" style="max-width:320px;border:1px solid #E1ECF2;padding:6px;border-radius:8px" /></div>
    </div>
    <!-- Pie -->
    <div style="padding:14px 22px;background:#F7FAFC;border-top:1px solid #E1ECF2;font-size:11px;color:#64748B">
      Notificación generada automáticamente por el Sistema Integral.
    </div>
  </div>
</body></html>
```

**Detalles:**
- **Escapar** todos los valores (HTML escape) para evitar inyección.
- Las **listas/checklists** (contraindicaciones, cuidados, riesgos, políticas) se
  renderizan como `<ul><li>` cuando el campo es un arreglo.
- Campos **Sí/No con nota** se muestran como `Sí · {nota}`.
- La **firma** del cliente es una imagen `data:image/png;base64,...` embebida.
- Colores de marca: turquesa `#14B7B0`/`#22C7C9`, texto `#102A3A`, títulos `#0B3442`.

---

## 5. Campos por consentimiento

**Comunes a todos:** ID · Fecha · Sucursal · Estado · Cliente · Documento · Teléfono ·
Correo · Especialista · **Firma del cliente**.

### 5.1 Masajes — *"Consentimiento de Masajes registrado"*
- Tipo de masaje · Zona a tratar · Presión preferida · Embarazo (Sí·nota) · Alergias (Sí·nota)
- Checklists: Instrucciones marcadas · Contraindicaciones marcadas · Políticas aceptadas
- Observaciones médicas · Observaciones especialista
- Declaración aceptada (Sí/No) · Autorización aceptada (Sí/No)

### 5.2 Eliminación Tatuajes / Cejas
- Tipo de procedimiento · Zona a tratar · Tipo de pigmento · Colores · Antigüedad aprox. · Tamaño aprox.
- Sesiones previas (Sí·cantidad) · Reacción previa al láser · Embarazo/Lactancia (Sí·nota) ·
  Alergias (Sí·nota) · Medicamentos (Sí·nota) · Exposición solar reciente (Sí·nota) ·
  Antecedentes de queloides (Sí·nota)
- Observaciones del pigmento · Observaciones del especialista
- Checklists: Instrucciones · Cuidados después · Riesgos aceptados · Políticas aceptadas
- Declaración sobre resultados · Autorización fotográfica · Autorización del procedimiento

### 5.3 Peeling — *"Consentimiento Informado para Peeling"*
- Tipo de peeling · Zona a tratar · Observaciones médicas · Observaciones especialista
- Checklists: Contraindicaciones declaradas · Cuidados antes · Cuidados después · Riesgos aceptados · Políticas aceptadas
- Acepta procedimiento (Sí/No) · Acepta riesgos · Acepta políticas · Acepta protección de datos

### 5.4 Depilación Láser — *"Consentimiento Informado para Depilación Láser"*
- Tipo de depilación · Zona a tratar · Fototipo · Tipo de vello · Observaciones médicas · Observaciones especialista
- Checklists: Contraindicaciones declaradas · Cuidados antes · Cuidados después · Riesgos aceptados · Políticas aceptadas
- Acepta procedimiento (Sí/No) · Acepta riesgos · Acepta políticas · Acepta protección de datos

---

## 6. Adjunto (PDF formal)

- Se genera el **PDF formal del consentimiento** (el mismo que descarga el navegador)
  y se adjunta.
- Nombre: `consentimiento-{tipo}-{slug-del-cliente}.pdf`.
- Si la generación del PDF falla, **el correo se envía igual** (sin adjunto).
- Formato del adjunto: binario (`Buffer`) por Gmail; base64 por Resend.

---

## 7. Origen de los datos

Cada campo se lee de **dos fuentes**, en este orden:
1. **Columnas dedicadas** de la tabla del consentimiento (`tipo_masaje`, `zona_tratar`,
   `firma_cliente`, `estado`, `correo`, etc.).
2. **`payload_json`** — donde viajan los campos nuevos: listas (`contraindicacionesList`,
   `instruccionesAntes`, `cuidadosDespuesList`, `riesgosAceptadosList`, `politicasAceptadas`),
   Sí/No con notas, y aceptaciones (`aceptaProcedimiento`, `autorizacionFotograficaAceptada`…).

---

## 8. Pseudocódigo del envío (por tipo)

```
guardarConsentimiento(tipo, row, businessId):
  upsert(tabla_del_tipo, row)
  sincronizarFichaCliente(row.cliente)
  try:
    to      = [buzonInternoDelNegocio(businessId), row.correo válido]  (dedup)
    subject = "Consentimiento {tipo} · {row.cliente_nombre}"
    html    = plantilla(row)                     // §4 + campos §5
    pdf     = generarPdfConsentimiento(row)       // opcional; si falla, sin adjunto
    enviarCorreoDelNegocio(businessId, { to, subject, html, adjunto: pdf },
                           respaldoResend)         // Gmail → si falla, Resend
  catch (e):
    // nunca romper el guardado; devolver warning
    return { guardado: true, correo: { enviado:false, warning: e.message } }
```

---

*Referencia basada en la implementación real de CSL (4 consentimientos: Masajes,
Tatuajes/Cejas, Peeling, Depilación Láser). Emails HTML con marca del negocio, tabla
de campos, firma del cliente y PDF adjunto; enviados al guardar, al buzón del negocio +
correo del cliente. Sin datos reales.*


<div style="page-break-after:always"></div>



===============================================================================

# Generación de PDF de consentimientos — Referencia (para otro sistema)

Cómo se generan los **PDF formales de consentimiento** (con datos del cliente,
texto legal fijo y **firma embebida**), en el servidor y **sin navegador headless**.
Verificado contra `consent-depilacion-pdf.ts` (motor genérico reusado por los 4 tipos).

---

## 1. Idea general
- Librería: **`pdf-lib`** (JS puro; no requiere Chromium/Puppeteer).
- El **cuerpo legal es FIJO** por tipo de consentimiento; solo cambian los **datos
  del cliente** y la **firma**.
- El mismo documento se **adjunta al correo** y/o se descarga.
- Multi-marca: el texto dice "Cibao Spa Laser" y se **reemplaza** por el nombre del
  negocio (Cibao/Depicenter) al generar.

---

## 2. Formato de página
| Parámetro | Valor |
|---|---|
| Tamaño | **US Letter** 612 × 792 pt |
| Margen | 42 pt |
| Fuentes | Helvetica + Helvetica-Bold (estándar PDF) |
| Color marca (teal) | `rgb(0, 0.537, 0.482)` (#00897B) |
| Texto | `rgb(0.07, 0.09, 0.11)` · Apagado `rgb(0.4,0.45,0.5)` |

---

## 3. Estructura del documento (de arriba a abajo)
1. **Encabezado:** nombre del negocio (centrado, teal, 16pt) · título (`CONSENTIMIENTO
   INFORMADO`) · subtítulo teal opcional · `Fecha de firma: … · Ref: {consent_id}` · línea teal.
2. **Datos del cliente** (banner teal "DATOS DEL CLIENTE" + tabla a **2 columnas**):
   Nombre · Teléfono · Cédula/Doc · Correo · Dirección (fila completa) · Sucursal · Especialista.
3. **Secciones legales** (cada una: banner teal en mayúsculas + párrafos con
   *word-wrap* + listas con viñeta `-` o numeradas). El contenido es fijo (ver §5).
4. **Caja de aceptación** opcional (ej. `[X] ACEPTO LAS POLÍTICAS DE LA EMPRESA`).
5. **Firma del cliente:** recuadro con la **imagen de la firma embebida** + leyenda
   `Firma del cliente - {nombre}`.
6. **Pie de página** en cada hoja: `{Negocio} - {etiqueta} - Ref {consent_id}`.

Salto de página automático cuando el contenido no cabe.

---

## 4. Motor genérico (reusable por los 4 consentimientos)

```
buildConsentPdf(row, businessName, cfg) -> Buffer(PDF)

cfg = {
  title:            "CONSENTIMIENTO INFORMADO",
  subtitle:         "PROCEDIMIENTO: ELIMINACIÓN DEL VELLO NO DESEADO",  // opcional
  especialistaLabel:"Especialista",                                     // opcional
  footerLabel:      "Consentimiento Depilación Láser",
  acceptBox:        "[X] ACEPTO LAS POLÍTICAS DE LA EMPRESA",           // opcional
  sections: [ { title, blocks: [ {kind:"p", runs}, {kind:"list", ordered?, items} ] } ]
}
```

- `runs` = arreglo de trozos de texto con **negrita opcional**: `[{s:"CONFIRMO", b:true}, {s:" que..."}]`.
  Helpers: `lead(bold, rest)` (item con intro en negrita) · `plain(text)` · `bullets(items)`.
- Cada tipo (Masajes/Peeling/Tatuajes/Depilación) llama a `buildConsentPdf` con su `cfg`.

---

## 5. Contenido legal (fijo, por tipo)

El texto legal va **hardcodeado** en un arreglo de secciones. Para **Depilación Láser**
son (ejemplo real):
Descripción del procedimiento · Confirmación del cliente · Instrucciones antes ·
Cuidados después · Consideraciones generales · Beneficios · Probabilidad de éxito ·
Riesgos y posibles complicaciones · Contraindicaciones · Declaraciones finales ·
Políticas y procedimientos · Protección de datos · Autorización.

> Cada consentimiento (Masajes, Peeling, Tatuajes/Cejas) tiene su propio juego de
> secciones legales, con el mismo motor. La **validez legal** se apoya en la firma
> electrónica del cliente (en RD, Ley 126-02 de Comercio Electrónico, Documentos y
> Firmas Digitales; y Ley 172-13 de protección de datos personales).

---

## 6. Firma embebida

```js
// row.firma_cliente = "data:image/png;base64,...."  (o image/jpeg)
const [, base64] = dataUrl.split(",", 2)
const bytes = Uint8Array.from(Buffer.from(base64, "base64"))
const img = dataUrl.includes("image/jpeg")
  ? await pdfDoc.embedJpg(bytes)
  : await pdfDoc.embedPng(bytes)
// escalar para caber en el recuadro de firma y dibujar centrada
```
Si la firma falla o no existe, el recuadro sale vacío (el PDF se genera igual).

---

## 7. Seguridad de codificación (importante con pdf-lib + Helvetica)
Las fuentes estándar solo codifican **WinAnsi/Latin-1**. Antes de dibujar, sanea:
- Conserva ASCII + Latin-1 (acentos `á é í ó ú ñ ü`); descarta lo no codificable.
- Reemplaza comillas tipográficas `“ ” ‘ ’` → `" '`, guiones `– —` → `-`,
  viñetas `• ·` → `-`, elipsis `…` → `...`, checks `☑ ✓ ✔` → `[X]`.
- Reemplaza el nombre de marca del texto por el negocio actual.

```js
function keepEncodable(s){ let o=""; for(const ch of s){ const c=ch.charCodeAt(0);
  if((c>=0x20&&c<=0x7e)||(c>=0xa0&&c<=0xff)) o+=ch; else if(/\s/.test(ch)) o+=" "; } return o }
```

---

## 8. Salida y uso
- `buildConsentPdf(...)` devuelve un **`Buffer`**.
- **Adjuntar al correo:** Gmail → `content: Buffer`; Resend → `content: buffer.toString("base64")`.
- **Descargar:** responder con `Content-Type: application/pdf`.
- Nombre sugerido: `consentimiento-{tipo}-{slug-del-cliente}.pdf`.

---

## 9. Datos que consume (de la fila del consentimiento)
`consent_id` · `fecha_registro`/`fecha` · `cliente_nombre` · `telefono` · `documento` ·
`correo` · `direccion` · `sucursal` · `especialista_nombre` · **`firma_cliente`**
(data-URL) · + los campos específicos del tipo (tipo, zona, fototipo, etc.).

---

*Referencia basada en la implementación real de CSL (`pdf-lib`, motor genérico
`buildConsentPdf` reusado por los 4 consentimientos, con firma embebida y texto legal
fijo). Sin datos reales.*


<div style="page-break-after:always"></div>



===============================================================================

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

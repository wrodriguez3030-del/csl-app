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

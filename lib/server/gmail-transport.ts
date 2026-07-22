import "server-only"
import nodemailer from "nodemailer"
import type { GmailCredentials } from "@/lib/server/email-settings"

/**
 * Envío de correo transaccional DESDE la cuenta Gmail del negocio vía SMTP +
 * "Contraseña de aplicación" de Google. El remitente REAL es la cuenta Gmail, así
 * que el cliente ve el correo del negocio y sus respuestas llegan a ese buzón.
 *
 * Las credenciales se resuelven fuera (`resolveGmailCredentialsForBusiness`,
 * aislado por tenant). Aquí solo se envía. Nunca lanza: captura y devuelve el
 * error para que el flujo principal (guardado del registro) nunca se pierda.
 */

export interface GmailAttachment {
  filename: string
  /** Contenido binario del adjunto (p.ej. un PDF). */
  content: Buffer
}

export interface SendGmailInput {
  to: string[]
  subject: string
  html: string
  replyTo?: string
  attachments?: GmailAttachment[]
}

export type SendGmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string }

export async function sendGmail(
  input: SendGmailInput,
  creds: GmailCredentials,
): Promise<SendGmailResult> {
  const user = creds.user
  const pass = (creds.pass || "").replace(/\s+/g, "")
  const fromName = creds.fromName || user

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass },
    })

    const info = await transporter.sendMail({
      from: `${fromName} <${user}>`,
      to: input.to,
      subject: input.subject,
      html: input.html,
      replyTo: input.replyTo ?? user,
      attachments: input.attachments,
    })

    return { ok: true, id: info.messageId ?? "" }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo enviar el correo por Gmail" }
  }
}

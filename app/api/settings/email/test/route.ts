/**
 * POST /api/settings/email/test  → envía un correo de PRUEBA al destinatario
 * indicado usando el Gmail configurado del NEGOCIO ACTIVO. Solo admin/superadmin.
 * Sirve para validar la configuración antes de enviar consentimientos reales.
 */

import { NextResponse } from "next/server"
import { requireAuthenticatedUser } from "@/lib/server/supabase"
import { resolveEffectiveBusinessContext } from "@/lib/server/integration-auth"
import { resolveGmailCredentialsForBusiness } from "@/lib/server/email-settings"
import { sendGmail } from "@/lib/server/gmail-transport"
import { getBusinessBranding } from "@/lib/business"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const runtime = "nodejs"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request) {
  let user
  try {
    user = await requireAuthenticatedUser(request)
  } catch {
    return json({ ok: false, error: "No autenticado" }, 401)
  }

  let body: { activeBusinessId?: string; to?: string } = {}
  try {
    const raw = await request.text()
    body = raw ? JSON.parse(raw) : {}
  } catch {
    body = {}
  }

  const ctx = await resolveEffectiveBusinessContext(user.id, body.activeBusinessId)
  if (!ctx) return json({ ok: false, error: "Contexto de negocio no encontrado." }, 403)
  if (!(ctx.isAdmin || ctx.isSuperadmin)) {
    return json({ ok: false, error: "Solo un administrador puede enviar la prueba." }, 403)
  }

  const to = String(body.to || "").trim()
  if (!EMAIL_RE.test(to)) return json({ ok: false, error: "Ingresa un correo válido." }, 422)

  const creds = await resolveGmailCredentialsForBusiness(ctx.businessId, ctx.businessSlug)
  if (!creds) {
    return json({
      ok: false,
      notConfigured: true,
      error: "Aún no hay contraseña de aplicación configurada para este negocio. Guárdala primero y vuelve a probar.",
    }, 503)
  }

  const brand = getBusinessBranding(ctx.businessSlug)
  const nombre = brand.name || creds.fromName
  const primary = brand.primaryColor || "#14B7B0"
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:Arial,sans-serif;color:#111827">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:100%;background:#fff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden">
        <tr><td style="background:${primary};padding:18px 24px;color:#fff;font-size:18px;font-weight:bold">${nombre}</td></tr>
        <tr><td style="padding:24px;font-size:15px">
          <p style="margin:0 0 10px;font-weight:bold">✅ Correo de prueba</p>
          <p style="margin:0">La configuración de correo de <b>${nombre}</b> funciona correctamente. Ya puedes enviar los consentimientos y fichas por correo desde el sistema.</p>
          <p style="margin:14px 0 0;font-size:12px;color:#6b7280">Enviado desde ${creds.user}</p>
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`

  const result = await sendGmail(
    { to: [to], subject: `Correo de prueba · ${nombre}`, html },
    creds,
  )
  if (!result.ok) return json({ ok: false, error: result.error }, 502)
  return json({ ok: true, message: `Correo de prueba enviado a ${to} desde ${creds.user}.` })
}

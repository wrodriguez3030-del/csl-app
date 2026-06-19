/**
 * POST /api/public/webauthn/register-verify
 * Verifica la respuesta de creación de la passkey y guarda la credencial.
 *
 * body: { qr_token, response (RegistrationResponseJSON), device_label? }
 */
import { NextResponse } from "next/server"
import { verifyRegistrationResponse } from "@simplewebauthn/server"
import { isoBase64URL } from "@simplewebauthn/server/helpers"
import { getSupabaseAdmin } from "@/lib/server/supabase"
import { rpFromRequest, resolveQrEmployee, consumeChallenge } from "@/lib/server/webauthn"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
const json = (d: Record<string, unknown>, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } })

export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch { return json({ ok: false, error: "Cuerpo inválido" }, 400) }
  const emp = await resolveQrEmployee(String(body.qr_token || ""))
  if (!emp) return json({ ok: false, error: "QR inválido o revocado" })

  const expectedChallenge = await consumeChallenge(emp.businessId, emp.employeeId, "register")
  if (!expectedChallenge) return json({ ok: false, error: "El registro expiró. Intenta de nuevo." })

  const { rpID, origin } = rpFromRequest(request)
  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: body.response as Parameters<typeof verifyRegistrationResponse>[0]["response"],
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    })
  } catch (e) {
    return json({ ok: false, error: `No se pudo verificar la biometría: ${e instanceof Error ? e.message : "error"}` })
  }
  if (!verification.verified || !verification.registrationInfo) {
    return json({ ok: false, error: "La biometría no pudo verificarse" })
  }

  const cred = verification.registrationInfo.credential
  const sb = getSupabaseAdmin()
  const transports = Array.isArray((body.response as { response?: { transports?: string[] } })?.response?.transports)
    ? (body.response as { response: { transports: string[] } }).response.transports.join(",")
    : null
  const { error } = await sb.from("hr_webauthn_credentials").upsert({
    business_id: emp.businessId,
    employee_id: emp.employeeId,
    credential_id: cred.id,
    public_key: isoBase64URL.fromBuffer(cred.publicKey),
    counter: cred.counter,
    transports,
    device_label: String(body.device_label || "") || null,
  }, { onConflict: "credential_id" })
  if (error) return json({ ok: false, error: `No se pudo guardar la credencial: ${error.message}` })

  try { await sb.from("hr_audit_logs").insert({ business_id: emp.businessId, module: "ponche", action: "webauthn_register", entity_type: "hr_webauthn_credentials", entity_id: emp.employeeId, new_values: { device_label: body.device_label || null } }) } catch { /* best-effort */ }
  return json({ ok: true })
}

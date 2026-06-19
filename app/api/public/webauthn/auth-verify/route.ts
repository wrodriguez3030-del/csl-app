/**
 * POST /api/public/webauthn/auth-verify
 * Verifica la assertion biométrica. Si es válida, actualiza el counter y emite
 * un TICKET efímero (90 s) que el endpoint de ponche móvil consume como prueba
 * de "verificación biométrica del dispositivo".
 *
 * body: { qr_token, response (AuthenticationResponseJSON) }
 * → { ok, ticket }
 */
import { NextResponse } from "next/server"
import { verifyAuthenticationResponse } from "@simplewebauthn/server"
import { isoBase64URL } from "@simplewebauthn/server/helpers"
import { getSupabaseAdmin } from "@/lib/server/supabase"
import { rpFromRequest, resolveQrEmployee, consumeChallenge, getCredentials } from "@/lib/server/webauthn"
import { randomUUID } from "node:crypto"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
const json = (d: Record<string, unknown>, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } })

export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch { return json({ ok: false, error: "Cuerpo inválido" }, 400) }
  const emp = await resolveQrEmployee(String(body.qr_token || ""))
  if (!emp) return json({ ok: false, error: "QR inválido o revocado" })

  const expectedChallenge = await consumeChallenge(emp.businessId, emp.employeeId, "auth")
  if (!expectedChallenge) return json({ ok: false, error: "La autenticación expiró. Intenta de nuevo." })

  const resp = body.response as { id?: string }
  const creds = await getCredentials(emp.businessId, emp.employeeId)
  const stored = creds.find((c) => c.credential_id === resp?.id)
  if (!stored) return json({ ok: false, error: "Credencial no reconocida" })

  const { rpID, origin } = rpFromRequest(request)
  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response as Parameters<typeof verifyAuthenticationResponse>[0]["response"],
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: stored.credential_id,
        publicKey: isoBase64URL.toBuffer(stored.public_key),
        counter: Number(stored.counter) || 0,
        transports: stored.transports ? (stored.transports.split(",") as AuthenticatorTransport[]) : undefined,
      },
    })
  } catch (e) {
    return json({ ok: false, error: `No se pudo verificar la biometría: ${e instanceof Error ? e.message : "error"}` })
  }
  if (!verification.verified) return json({ ok: false, error: "Biometría no verificada" })

  const sb = getSupabaseAdmin()
  await sb.from("hr_webauthn_credentials")
    .update({ counter: verification.authenticationInfo.newCounter, last_used_at: new Date().toISOString() })
    .eq("id", stored.id)

  // Ticket efímero: el ponche móvil lo exige cuando require_biometric o
  // cuando la modalidad usada es mobile_biometric.
  const ticket = randomUUID()
  const expires = new Date(Date.now() + 90 * 1000).toISOString()
  await sb.from("hr_webauthn_challenges").delete().eq("business_id", emp.businessId).eq("employee_id", emp.employeeId).eq("kind", "punch_ticket")
  await sb.from("hr_webauthn_challenges").insert({ business_id: emp.businessId, employee_id: emp.employeeId, kind: "punch_ticket", challenge: ticket, expires_at: expires })

  return json({ ok: true, ticket })
}

/**
 * POST /api/public/webauthn/auth-options
 * Inicia la autenticación biométrica (assertion) del empleado del QR.
 *
 * body: { qr_token }
 */
import { NextResponse } from "next/server"
import { generateAuthenticationOptions } from "@simplewebauthn/server"
import { rpFromRequest, resolveQrEmployee, saveChallenge, getCredentials } from "@/lib/server/webauthn"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
const json = (d: Record<string, unknown>, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } })

export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch { return json({ ok: false, error: "Cuerpo inválido" }, 400) }
  const emp = await resolveQrEmployee(String(body.qr_token || ""))
  if (!emp) return json({ ok: false, error: "QR inválido o revocado" })

  const creds = await getCredentials(emp.businessId, emp.employeeId)
  if (creds.length === 0) return json({ ok: false, code: "not_enrolled", error: "Este empleado no ha registrado biometría en este celular" })

  const { rpID } = rpFromRequest(request)
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: creds.map((c) => ({
      id: c.credential_id,
      transports: c.transports ? (c.transports.split(",") as AuthenticatorTransport[]) : undefined,
    })),
  })
  await saveChallenge(emp.businessId, emp.employeeId, "auth", options.challenge)
  return json({ ok: true, options })
}

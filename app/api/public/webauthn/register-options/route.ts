/**
 * POST /api/public/webauthn/register-options
 * Inicia el registro de la biometría del celular (passkey) para el empleado
 * identificado por su QR token. Devuelve las opciones de creación.
 *
 * body: { qr_token }
 */
import { NextResponse } from "next/server"
import { generateRegistrationOptions } from "@simplewebauthn/server"
import { RP_NAME, rpFromRequest, resolveQrEmployee, saveChallenge, getCredentials } from "@/lib/server/webauthn"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
const json = (d: Record<string, unknown>, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } })

export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch { return json({ ok: false, error: "Cuerpo inválido" }, 400) }
  const emp = await resolveQrEmployee(String(body.qr_token || ""))
  if (!emp) return json({ ok: false, error: "QR inválido o revocado" })

  const { rpID } = rpFromRequest(request)
  const existing = await getCredentials(emp.businessId, emp.employeeId)
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID: Uint8Array.from(new TextEncoder().encode(emp.employeeId)),
    userName: emp.employeeId,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.credential_id })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
      authenticatorAttachment: "platform", // biometría del propio dispositivo
    },
  })
  await saveChallenge(emp.businessId, emp.employeeId, "register", options.challenge)
  return json({ ok: true, options })
}

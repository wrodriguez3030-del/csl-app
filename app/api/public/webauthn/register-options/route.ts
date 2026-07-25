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
import { clientIp, rateLimit } from "@/lib/rate-limit-server"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
const json = (d: Record<string, unknown>, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } })

// Tope de passkeys por empleado: limita la proliferación de credenciales
// (defensa contra enrolar dispositivos ajenos en masa con un QR filtrado).
const MAX_CREDENTIALS_PER_EMPLOYEE = 5

export async function POST(request: Request) {
  // Rate limit: cada llamada escribe una fila de challenge; frena el flooding
  // de la tabla y el sondeo con QR robados.
  const rl = rateLimit({ key: `webauthn-reg:${clientIp(request)}`, max: 15, windowMs: 10 * 60 * 1000 })
  if (!rl.ok) return json({ ok: false, error: "Demasiados intentos. Espera unos minutos e intenta de nuevo." }, 429)
  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch { return json({ ok: false, error: "Cuerpo inválido" }, 400) }
  const emp = await resolveQrEmployee(String(body.qr_token || ""))
  if (!emp) return json({ ok: false, error: "QR inválido o revocado" })

  const { rpID } = rpFromRequest(request)
  const existing = await getCredentials(emp.businessId, emp.employeeId)
  if (existing.length >= MAX_CREDENTIALS_PER_EMPLOYEE) {
    return json({ ok: false, error: "Este empleado ya alcanzó el máximo de dispositivos biométricos. Pide al administrador que revoque uno antes de registrar otro." })
  }
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

import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { verify } from "otplib"
import {
  CREDENTIALS_ACCESS_COOKIE,
  CREDENTIALS_ACCESS_TTL_SECONDS,
  createAccessCookieValue,
} from "@/lib/credentials-access"

// otplib v13 (functional API) usa HMAC-SHA1 estándar TOTP — runtime nodejs.
export const runtime = "nodejs"

export async function POST(request: Request) {
  const secret = process.env.CREDENTIALS_TOTP_SECRET

  // No exponemos detalles administrativos al cliente si el secret falta.
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Configuración incompleta del sistema" },
      { status: 500 },
    )
  }

  let body: { token?: unknown } = {}
  try {
    body = (await request.json()) as { token?: unknown }
  } catch {
    return NextResponse.json({ ok: false, error: "Petición inválida" }, { status: 400 })
  }

  const token = String(body?.token ?? "").replace(/\s+/g, "")
  if (!/^\d{6}$/.test(token)) {
    return NextResponse.json(
      { ok: false, error: "Código inválido o expirado" },
      { status: 401 },
    )
  }

  let valid = false
  try {
    // epochTolerance: 30s = ±1 step (handles clock skew telefono/server).
    const result = await verify({ secret, token, epochTolerance: 30 })
    valid = Boolean(result?.valid)
  } catch {
    valid = false
  }

  if (!valid) {
    return NextResponse.json(
      { ok: false, error: "Código inválido o expirado" },
      { status: 401 },
    )
  }

  const { value, expiresAt } = createAccessCookieValue()
  const jar = await cookies()
  jar.set({
    name: CREDENTIALS_ACCESS_COOKIE,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: CREDENTIALS_ACCESS_TTL_SECONDS,
  })

  return NextResponse.json({ ok: true, expiresAt })
}

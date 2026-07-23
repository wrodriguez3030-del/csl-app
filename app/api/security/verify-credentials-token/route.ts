import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { verify } from "otplib"
import { requireAuthenticatedUser, getSupabaseAdmin } from "@/lib/server/supabase"
import { clientIp, rateLimit } from "@/lib/rate-limit-server"
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

  // (H-1) Requiere sesión: ya no es un endpoint anónimo. La cookie se liga a
  // ESTE usuario, de modo que un tercero no puede minar el acceso a la vault.
  let user
  try {
    user = await requireAuthenticatedUser(request)
  } catch {
    return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 })
  }

  // (H-1) Rate-limit por usuario + IP para frenar fuerza bruta del código.
  const rl = rateLimit({ key: `totp-cred:${user.id}:${clientIp(request)}`, max: 6, windowMs: 60_000 })
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "Demasiados intentos. Espera un momento e inténtalo de nuevo." },
      { status: 429 },
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

  // (H-1) Anti-replay: no permitir reusar el mismo código (paso TOTP) por
  // usuario. Best-effort en la BD: si la columna aún no existe (pre-migración),
  // se omite sin romper el login a la vault.
  const step = Math.floor(Date.now() / 1000 / 30)
  try {
    const sb = getSupabaseAdmin()
    const { data } = await sb
      .from("csl_user_profiles")
      .select("credenciales_totp_last_step")
      .eq("user_id", user.id)
      .maybeSingle()
    const last = data ? (data as { credenciales_totp_last_step?: number | null }).credenciales_totp_last_step : null
    if (typeof last === "number" && step <= last) {
      return NextResponse.json(
        { ok: false, error: "Ese código ya se usó. Espera al siguiente en tu Authenticator." },
        { status: 401 },
      )
    }
    await sb
      .from("csl_user_profiles")
      .update({ credenciales_totp_last_step: step })
      .eq("user_id", user.id)
  } catch {
    // Columna ausente u otro fallo de BD → seguimos sin anti-replay.
  }

  const { value, expiresAt } = createAccessCookieValue(user.id)
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

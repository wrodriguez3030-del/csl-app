/**
 * GET /api/public/device-activate?token=CSLDEV:xxxx
 *
 * Verifica que el device_token corresponda a un dispositivo de kiosko ACTIVO.
 * Público (sin login): se usa al abrir el link de activación en la tablet.
 * NO expone token_hash ni business_id; solo nombre + sucursal para confirmar.
 */
import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/server/supabase"
import { createHash } from "node:crypto"
import { clientIp, rateLimit } from "@/lib/rate-limit-server"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const runtime = "nodejs"

const sha = (v: string) => createHash("sha256").update(v, "utf8").digest("hex")
const json = (d: Record<string, unknown>, status = 200) => NextResponse.json(d, { status, headers: { "Cache-Control": "no-store" } })

export async function GET(request: Request) {
  // Rate limit: frena el sondeo de tokens de activación (aunque son de alta entropía).
  const rl = rateLimit({ key: `device-activate:${clientIp(request)}`, max: 30, windowMs: 5 * 60 * 1000 })
  if (!rl.ok) return json({ ok: false, code: "rate_limited", error: "Demasiados intentos. Espera un momento." }, 429)
  const token = new URL(request.url).searchParams.get("token") || ""
  if (!token) return json({ ok: false, code: "no_token", error: "Falta el token de activación" }, 400)
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("hr_punch_devices")
      .select("device_name, sucursal, active")
      .eq("device_token_hash", sha(token))
      .maybeSingle()
    if (error) { if ((error as { code?: string }).code === "42P01") return json({ ok: false, code: "table_missing", error: "Migración pendiente en db-cls" }); throw error }
    if (!data) return json({ ok: false, code: "not_found", error: "Token de activación inválido o revocado" })
    const dev = data as { device_name: string; sucursal: string | null; active: boolean }
    if (!dev.active) return json({ ok: false, code: "inactive", error: "Este dispositivo está inactivo. Pide al administrador que lo reactive." })
    return json({ ok: true, device_name: dev.device_name, sucursal: dev.sucursal })
  } catch (e) {
    return json({ ok: false, code: "db_error", error: `Error de base de datos: ${e instanceof Error ? e.message : "desconocido"}` }, 500)
  }
}

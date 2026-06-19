/**
 * WebAuthn / Passkeys — helpers de servidor para el ponche móvil biométrico.
 *
 * El empleado registra la biometría de SU celular (huella / Face ID) como
 * passkey ligada a su employee_id. Luego, para ponchar, autentica con esa
 * biometría (assertion) y el servidor lo verifica criptográficamente.
 *
 * RP ID y origin se derivan del request para funcionar igual en localhost y
 * en el dominio de producción sin configuración manual.
 */
import { getSupabaseAdmin } from "@/lib/server/supabase"
import { createHash } from "node:crypto"

export const RP_NAME = "Cibao Spa Láser · Ponche"

/** Deriva rpID (hostname sin puerto) y origin (esquema+host) del request. */
export function rpFromRequest(request: Request): { rpID: string; origin: string } {
  const url = new URL(request.url)
  // Detrás de proxy (Vercel) el host real viene en x-forwarded-host.
  const fwdHost = request.headers.get("x-forwarded-host")
  const host = fwdHost || url.host
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "")
  const rpID = host.split(":")[0]
  const origin = `${proto}://${host}`
  return { rpID, origin }
}

export const sha256 = (v: string) => createHash("sha256").update(v, "utf8").digest("hex")

/** register/auth = retos WebAuthn; punch_ticket = autorización efímera de
 *  ponche tras una verificación biométrica exitosa (la consume mobile-punch). */
export type ChallengeKind = "register" | "auth" | "punch_ticket"

export type QrEmployee = { businessId: string; employeeId: string; sucursal: string | null }

/** Resuelve business + empleado a partir del token del QR (igual que el kiosko). */
export async function resolveQrEmployee(qrToken: string): Promise<QrEmployee | null> {
  if (!qrToken) return null
  const sb = getSupabaseAdmin()
  const { data } = await sb
    .from("hr_employee_qr_tokens")
    .select("business_id, employee_id, active")
    .eq("token_hash", sha256(qrToken))
    .maybeSingle()
  const q = data as { business_id: string; employee_id: string; active: boolean } | null
  if (!q || !q.active) return null
  return { businessId: q.business_id, employeeId: q.employee_id, sucursal: null }
}

/** Guarda el reto efímero (5 min) para verificarlo en el paso "verify". */
export async function saveChallenge(businessId: string, employeeId: string, kind: ChallengeKind, challenge: string) {
  const sb = getSupabaseAdmin()
  // Limpia retos previos del mismo alcance para no acumular.
  await sb.from("hr_webauthn_challenges").delete().eq("business_id", businessId).eq("employee_id", employeeId).eq("kind", kind)
  const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString()
  await sb.from("hr_webauthn_challenges").insert({ business_id: businessId, employee_id: employeeId, kind, challenge, expires_at: expires })
}

/** Recupera y CONSUME (borra) el reto. Devuelve null si no existe o expiró. */
export async function consumeChallenge(businessId: string, employeeId: string, kind: ChallengeKind): Promise<string | null> {
  const sb = getSupabaseAdmin()
  const { data } = await sb
    .from("hr_webauthn_challenges")
    .select("id, challenge, expires_at")
    .eq("business_id", businessId).eq("employee_id", employeeId).eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle()
  const c = data as { id: string; challenge: string; expires_at: string } | null
  if (!c) return null
  await sb.from("hr_webauthn_challenges").delete().eq("id", c.id)
  if (new Date(c.expires_at).getTime() < Date.now()) return null
  return c.challenge
}

export interface StoredCredential {
  id: string
  credential_id: string
  public_key: string
  counter: number
  transports: string | null
}

export async function getCredentials(businessId: string, employeeId: string): Promise<StoredCredential[]> {
  const sb = getSupabaseAdmin()
  const { data } = await sb
    .from("hr_webauthn_credentials")
    .select("id, credential_id, public_key, counter, transports")
    .eq("business_id", businessId).eq("employee_id", employeeId)
  return (data || []) as StoredCredential[]
}

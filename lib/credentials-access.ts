import crypto from "node:crypto"

/**
 * Cookie helpers para gatear el menú Credenciales con TOTP.
 *
 * Diseño:
 *  - Validamos TOTP server-side (en /api/security/verify-credentials-token).
 *  - Si es válido, emitimos una cookie httpOnly cuyo valor es
 *      `<exp_unix>.<user_id>.<hmac_base64url>`
 *    firmada con HMAC-SHA256 usando una clave derivada de
 *    CREDENTIALS_TOTP_SECRET. Así no necesitamos un secreto extra solo
 *    para firmar la cookie.
 *  - **La cookie va LIGADA al `user_id`** (defensa contra reuso por otra
 *    cuenta): la verificación exige que el `user_id` firmado coincida con el
 *    usuario autenticado que hace la petición.
 *  - El cliente nunca ve el TOTP secret ni la HMAC key.
 *  - La verificación de la cookie hace timingSafeEqual para evitar
 *    ataques basados en timing al comparar la firma.
 */

const COOKIE_NAME = "csl_credentials_access"
const TTL_SECONDS = 15 * 60 // 15 minutos

function getHmacKey(): Buffer {
  const totpSecret = process.env.CREDENTIALS_TOTP_SECRET
  if (!totpSecret) {
    throw new Error("CREDENTIALS_TOTP_SECRET is not configured")
  }
  // Derivamos la HMAC key del TOTP secret + un sufijo de dominio para no
  // reutilizar literalmente el secret en otro contexto.
  return crypto.createHash("sha256").update(`${totpSecret}:access:v2`).digest()
}

function sign(payload: string, key: Buffer): string {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url")
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

/** Emite el valor de la cookie de acceso ligada a `userId`. */
export function createAccessCookieValue(userId: string): { value: string; expiresAt: number } {
  const uid = String(userId || "").trim()
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS
  const key = getHmacKey()
  const payload = `${exp}.${uid}`
  const sig = sign(payload, key)
  return { value: `${payload}.${sig}`, expiresAt: exp }
}

/**
 * Verifica la cookie de acceso. Si `expectedUserId` se pasa, exige además que
 * el `user_id` firmado coincida con el usuario autenticado (anti-reuso).
 */
export function verifyAccessCookieValue(
  cookieValue: string | undefined,
  expectedUserId?: string,
): { active: boolean; expiresAt?: number; userId?: string } {
  if (!cookieValue) return { active: false }
  const parts = cookieValue.split(".")
  if (parts.length !== 3) return { active: false }
  const [expStr, uid, sig] = parts
  const exp = Number(expStr)
  if (!Number.isFinite(exp)) return { active: false }
  const nowSec = Math.floor(Date.now() / 1000)
  if (exp <= nowSec) return { active: false }
  try {
    const key = getHmacKey()
    const expected = sign(`${expStr}.${uid}`, key)
    if (!safeEqual(sig, expected)) return { active: false }
    if (expectedUserId !== undefined && String(expectedUserId).trim() !== uid) {
      return { active: false }
    }
    return { active: true, expiresAt: exp, userId: uid }
  } catch {
    return { active: false }
  }
}

export const CREDENTIALS_ACCESS_COOKIE = COOKIE_NAME
export const CREDENTIALS_ACCESS_TTL_SECONDS = TTL_SECONDS

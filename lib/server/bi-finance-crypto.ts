/**
 * BI FINANCIERO IA — Cifrado de credenciales (AES-256-GCM), SOLO servidor.
 *
 * La API key de OpenAI se guarda cifrada en `bi_finance_ai_secrets`. La clave de
 * cifrado se deriva de un secreto del servidor: `BI_FINANCE_ENC_KEY` si existe,
 * si no se deriva de `SUPABASE_SERVICE_ROLE_KEY` (siempre presente en el entorno).
 * Así el cifrado funciona sin exigir una variable de entorno nueva, pero puede
 * endurecerse configurando `BI_FINANCE_ENC_KEY`.
 *
 * NUNCA importar desde el cliente. NUNCA registrar la clave en claro ni el
 * texto descifrado en logs.
 */
import crypto from "node:crypto"

function encKey(): Buffer {
  const base = (process.env.BI_FINANCE_ENC_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "csl-bi-finance-fallback-key").trim()
  // Deriva 32 bytes determinísticos a partir del secreto del servidor.
  return crypto.createHash("sha256").update(`bi-finance:${base}`).digest()
}

/** Cifra un texto → base64 de `iv(12) | tag(16) | ciphertext`. */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString("base64")
}

/** Descifra el payload producido por `encryptSecret`. Devuelve null si falla. */
export function decryptSecret(payload: string): string | null {
  try {
    const raw = Buffer.from(payload, "base64")
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(12, 28)
    const ct = raw.subarray(28)
    const decipher = crypto.createDecipheriv("aes-256-gcm", encKey(), iv)
    decipher.setAuthTag(tag)
    const pt = Buffer.concat([decipher.update(ct), decipher.final()])
    return pt.toString("utf8")
  } catch {
    return null
  }
}

/** Últimos 4 caracteres de una key, para mostrar `sk-****abcd` sin exponerla. */
export function last4(key: string): string {
  const k = String(key || "").trim()
  return k.length >= 4 ? k.slice(-4) : "****"
}

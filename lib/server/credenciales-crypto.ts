/**
 * Cifrado de los secretos del módulo Credenciales (`contrasena`, `pin`).
 *
 * SOLO servidor. Reutiliza `encryptSecret`/`decryptSecret` (AES-256-GCM) de
 * `bi-finance-crypto`. Los valores cifrados se guardan con el prefijo `enc1:`
 * para que la migración sea idempotente y compatible con filas legadas en texto
 * plano (sin prefijo → se devuelven tal cual, y se cifran en el próximo guardado).
 */
import { encryptSecret, decryptSecret } from "@/lib/server/bi-finance-crypto"

const PREFIX = "enc1:"

/** Cifra un secreto de credencial. Vacío → vacío. Idempotente por prefijo. */
export function encCredField(value: unknown): string {
  const v = String(value ?? "")
  if (!v) return ""
  if (v.startsWith(PREFIX)) return v // ya cifrado
  return PREFIX + encryptSecret(v)
}

/** Descifra un secreto de credencial. Legado sin prefijo → se devuelve tal cual. */
export function decCredField(value: unknown): string {
  const v = String(value ?? "")
  if (!v.startsWith(PREFIX)) return v // texto plano legado
  const dec = decryptSecret(v.slice(PREFIX.length))
  return dec ?? ""
}

export const CRED_ENC_PREFIX = PREFIX

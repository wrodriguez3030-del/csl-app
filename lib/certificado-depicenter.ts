/**
 * Firma y URL de validación para certificados DEPICENTER.
 *
 * Patrón paralelo a `lib/certificado-regalo.ts` (Cibao Spa Laser), pero
 * separado para que la marca quede explícita y los certificados de cada
 * marca puedan validarse de forma independiente sin colisión de códigos.
 *
 * La firma es un hash FNV-1a corto sobre los campos del certificado +
 * la "sal" `DEPICENTER-SKIN-LASER`. NO es criptografía seria — su único
 * objetivo es evitar que alguien tipee una URL falsa y vea su propio
 * certificado-fantasma como "válido". Para validación real, el QR
 * además contiene el `codigo` y la página `/validar-depicenter`
 * consulta el backend para corroborar contra la base.
 */

export type CertificadoDepicenterData = {
  codigo: string
  otorgadoA: string
  cortesiaDe: string
  validoPor: string
  fecha: string
}

export const DEPICENTER_BRAND = "DEPICENTER-SKIN-LASER"

export function normalizeDepicenterText(value: string) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase()
}

export function depicenterSignature(data: CertificadoDepicenterData) {
  const text = [
    data.codigo,
    normalizeDepicenterText(data.otorgadoA),
    normalizeDepicenterText(data.cortesiaDe),
    normalizeDepicenterText(data.validoPor),
    data.fecha,
    DEPICENTER_BRAND,
  ].join("|")
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).toUpperCase()
}

/**
 * URL pública de validación que se incrusta en el QR.
 *
 * - `origin` se inyecta desde el cliente con `window.location.origin`
 *   (en SSR/preview usamos un placeholder).
 * - Sólo viaja información no sensible: código + datos visibles del
 *   certificado + firma. El destinatario del QR ve la misma página que
 *   abre cualquier validador externo, sin necesidad de login.
 */
export function depicenterValidationUrl(origin: string, data: CertificadoDepicenterData) {
  const params = new URLSearchParams({
    c: data.codigo,
    o: normalizeDepicenterText(data.otorgadoA),
    d: normalizeDepicenterText(data.cortesiaDe),
    v: normalizeDepicenterText(data.validoPor),
    f: data.fecha,
    s: depicenterSignature(data),
  })
  // El path tiene marca explícita para que no se confunda con el validador
  // de Cibao Spa Laser.
  return `${origin}/validar-depicenter?${params.toString()}`
}

/**
 * Helpers de formato para teléfono y cédula dominicanos.
 * Fuente única — usar en formularios, modales, PDFs y tablas.
 *
 * Reglas:
 *   - Teléfono dominicano: 10 dígitos → 829-714-1974 (3-3-4)
 *   - Cédula dominicana: 11 dígitos → 031-0327422-2 (3-7-1)
 *   - Documentos extranjeros / pasaportes: si el valor no es 11 dígitos
 *     numéricos puros, se devuelve tal cual (no se rompe formato).
 *   - Búsqueda y dedupe deben usar `digitsOnly` para comparar.
 */

/** Devuelve solo los dígitos de la cadena de entrada. */
export function digitsOnly(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "")
}

/**
 * Formatea un teléfono mientras el usuario escribe. Limita a 10 dígitos
 * y aplica patrón 3-3-4. Para valores parciales devuelve lo mejor posible
 * sin romper el cursor del input.
 */
export function formatPhone(value: unknown): string {
  const digits = digitsOnly(value).slice(0, 10)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
}

/**
 * Formatea una cédula mientras el usuario escribe. Limita a 11 dígitos
 * y aplica patrón 3-7-1. Si el valor original tiene letras (pasaporte u
 * otro documento extranjero), devuelve tal cual sin forzar formato.
 */
export function formatCedula(value: unknown): string {
  const raw = String(value ?? "")
  // Si tiene letras y no parece cédula dominicana, no forzar formato.
  if (/[A-Za-z]/.test(raw)) return raw
  const digits = digitsOnly(raw).slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 10) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 10)}-${digits.slice(10)}`
}

/**
 * Versión "display only" — para mostrar en tablas/PDF un teléfono que
 * vino sin formato desde DB. Si ya tiene formato (con guiones) o no es
 * 10 dígitos exactos, lo devuelve sin tocar.
 */
export function displayPhone(value: unknown): string {
  const raw = String(value ?? "").trim()
  if (!raw) return ""
  const digits = digitsOnly(raw)
  if (digits.length === 10) return formatPhone(digits)
  return raw
}

/**
 * Versión "display only" — para mostrar en tablas/PDF una cédula que
 * vino sin formato desde DB. Solo aplica formato si son 11 dígitos puros.
 */
export function displayDocumento(value: unknown): string {
  const raw = String(value ?? "").trim()
  if (!raw) return ""
  // Si tiene letras, es pasaporte u otro documento — mostrar tal cual.
  if (/[A-Za-z]/.test(raw)) return raw
  const digits = digitsOnly(raw)
  if (digits.length === 11) return formatCedula(digits)
  return raw
}

/** Versión normalizada para búsqueda / dedupe — solo dígitos. */
export const normalizePhone = digitsOnly
export const normalizeDocument = digitsOnly

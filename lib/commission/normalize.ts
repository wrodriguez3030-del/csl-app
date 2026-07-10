/**
 * Normalización de datos del importador (sección 6). Funciones puras y
 * reutilizables. Los sinónimos de sucursal/pago son CONFIGURABLES (no se
 * hardcodean empleados). "Nunca mezclar negocios": la normalización de
 * sucursal es por catálogo del negocio activo.
 */

/** Quita acentos para comparación (NFD + strip diacríticos). */
export function stripAccents(v: string): string {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "")
}

/** Normaliza un nombre: sin acentos, espacios colapsados, MAYÚSCULAS. */
export function normalizeName(v: unknown): string {
  return stripAccents(String(v ?? "")).replace(/\s+/g, " ").trim().toUpperCase()
}

/** Sinónimos de sucursal de Cibao (configurable/ampliable desde catálogo). */
export const CIBAO_BRANCH_SYNONYMS: Record<string, string[]> = {
  "LOS JARDINES": ["JARDINES", "LOS JARDINES"],
  "RAFAEL VIDAL": ["R VIDAL", "RAFAEL VIDAL", "PLAZA MEDITERRANEA"],
  "VILLA OLGA": ["VILLA OLGA"],
}

/** Normaliza una sucursal a su nombre canónico según el mapa de sinónimos. */
export function normalizeBranch(v: unknown, synonyms: Record<string, string[]> = CIBAO_BRANCH_SYNONYMS): string {
  const n = normalizeName(v)
  for (const [canon, aliases] of Object.entries(synonyms)) {
    if (aliases.some((a) => normalizeName(a) === n)) return canon
  }
  return n
}

export type PaymentMethod = "TARJETA" | "EFECTIVO" | "TRANSFERENCIA" | "CHEQUE" | "ONLINE" | "OTROS"

/** Normaliza la forma de pago al catálogo canónico (agrupa variantes/espacios). */
export function normalizePayment(v: unknown): PaymentMethod {
  const n = normalizeName(v)
  if (!n) return "OTROS"
  if (/TARJETA|CARD|CREDITO|DEBITO|VISA|MASTER|POS\b/.test(n)) return "TARJETA"
  if (/EFECTIVO|CASH/.test(n)) return "EFECTIVO"
  if (/TRANSFER/.test(n)) return "TRANSFERENCIA"
  if (/CHEQUE/.test(n)) return "CHEQUE"
  if (/ONLINE|STRIPE/.test(n)) return "ONLINE"
  return "OTROS"
}

/**
 * Parsea un monto en distintos formatos ("RD$1,234.56", "1.234,56", 1234.56).
 * Detecta el separador decimal por la última aparición de "," o ".".
 */
export function parseMoney(v: unknown): number {
  if (typeof v === "number") return isFinite(v) ? v : 0
  let s = String(v ?? "").trim().replace(/[^\d.,-]/g, "")
  if (!s) return 0
  const lastComma = s.lastIndexOf(",")
  const lastDot = s.lastIndexOf(".")
  const decSep = lastComma > lastDot ? "," : "."
  const thouSep = decSep === "," ? "." : ","
  s = s.split(thouSep).join("")
  if (decSep === ",") s = s.replace(",", ".")
  const n = parseFloat(s)
  return isFinite(n) ? n : 0
}

/**
 * Parsea una fecha a ISO "YYYY-MM-DD". Soporta ISO, y DD/MM/YYYY o MM/DD/YYYY
 * (por defecto día primero, convención RD; configurable). Devuelve "" si falla.
 */
export function parseDateISO(v: unknown, dayFirst = true): string {
  if (v == null || v === "") return ""
  const s = String(v).trim()
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const parts = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/)
  if (parts) {
    const a = Number(parts[1])
    const b = Number(parts[2])
    let y = Number(parts[3])
    if (y < 100) y += 2000
    let day = dayFirst ? a : b
    let month = dayFirst ? b : a
    // Corrección: si el "mes" > 12 pero el "día" <= 12, están invertidos.
    if (month > 12 && day <= 12) {
      const t = day
      day = month
      month = t
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return ""
    return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  }
  return ""
}

/** Resuelve un prestador a su employee_id vía alias (sección 7). */
export function resolveEmployeeAlias(
  aliases: { alias: string; employeeId: string; active?: boolean }[],
  provider: unknown,
): string | null {
  const n = normalizeName(provider)
  const hit = aliases.find((a) => a.active !== false && normalizeName(a.alias) === n)
  return hit ? hit.employeeId : null
}

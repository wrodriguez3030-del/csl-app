/**
 * Normalización canónica de sucursal y operadora para PulseControl.
 *
 * Usar makeAgendaMatchKey en AMBOS lados de cualquier comparación entre
 * fuentes distintas (AgendaPro, Excel equipos, entrada manual).
 *
 * Reglas:
 *   - Resultado siempre en MAYÚSCULAS, sin acentos.
 *   - Sucursal: nombres comerciales y prefijos de marca → nombre interno.
 *   - Operadora: aliases para nombres que varían entre fuentes.
 */

function removeAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "")
}

function cleanUpper(s: string): string {
  return removeAccents(String(s || ""))
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim()
}

// Prefijos de marca a eliminar (con o sin guion posterior).
// "Cibao Spa Láser - Los Jardines" → "Los Jardines"
// "Cibao Spa Laser Villa Olga"     → "Villa Olga"  (sin guion)
const BRAND_PREFIX_RE =
  /^(?:cibao\s+spa\s+l[aá]ser|cibao\s+spa\s+laser|depicenter|csl)\s*[-–—]?\s*/i

/**
 * Normaliza sucursal a forma canónica (MAYÚSCULAS, sin prefijo de marca).
 *
 * Entradas soportadas:
 *   "Cibao Spa Láser - Los Jardines"  → "LOS JARDINES"
 *   "JARDINES"                         → "LOS JARDINES"
 *   "Los Jardines"                     → "LOS JARDINES"
 *   "Cibao Spa Láser - Plaza Mediterránea" → "RAFAEL VIDAL"
 *   "Plaza Mediterránea"               → "RAFAEL VIDAL"
 *   "Rafael Vidal" / "R VIDAL"         → "RAFAEL VIDAL"
 *   "Cibao Spa Laser Villa Olga"       → "VILLA OLGA"
 *   "Villa Olga" / "V OLGA"            → "VILLA OLGA"
 *   "La Vega"                          → "LA VEGA"
 */
export function normalizeSucursal(value: unknown): string {
  const s = String(value || "").trim()
  if (!s) return ""
  const stripped = s.replace(BRAND_PREFIX_RE, "").trim() || s
  const up = cleanUpper(stripped)
  if (up.includes("JARDINES")) return "LOS JARDINES"
  if (
    up === "R VIDAL" ||
    up.includes("RAFAEL") ||
    up.includes("VIDAL") ||
    up.includes("PLAZA") ||
    up.includes("MEDITERR")
  ) return "RAFAEL VIDAL"
  if ((up.includes("VILLA") && up.includes("OLGA")) || up === "V OLGA") return "VILLA OLGA"
  if (up.includes("LA VEGA")) return "LA VEGA"
  if (up === "DEPICENTER") return "LA VEGA"
  return up
}

/**
 * Aliases de operadora: nombre en fuente externa → nombre canónico.
 * Clave: normalizada (sin acentos, mayúsculas).
 */
const OPERADORA_ALIASES: Record<string, string> = {
  KATHERINE: "KATHERIN",
  EMELY: "EMELI",
  RIQUELMI: "ROQUELMI",
  YESICA: "YESSICA",
  SAOMY: "SAHOMY",
}

/** Valores que no representan personas reales — se ignoran en el match. */
const OPERADORA_SKIP = new Set(["SISTEMA", "SYSTEM", "ADMIN"])

/**
 * Normaliza operadora a forma canónica (MAYÚSCULAS + aliases).
 *
 * Entradas soportadas:
 *   "NAYELI" / "Nayeli"    → "NAYELI"
 *   "YAMILKA" / "Yamilka"  → "YAMILKA"
 *   "Katherine"            → "KATHERIN"
 *   "Emely" / "EMELY"      → "EMELI"
 *   "Riquelmi" / "RIQUELMI"→ "ROQUELMI"
 *   "Yesica"               → "YESSICA"
 *   "Saomy" / "SAOMY"      → "SAHOMY"
 *   "SAHOMY" / "Sahomy"    → "SAHOMY"
 *   "Sistema" / "SISTEMA"  → ""  (se ignora)
 */
export function normalizeOperadora(value: unknown): string {
  const up = cleanUpper(String(value || ""))
  if (!up || OPERADORA_SKIP.has(up)) return ""
  return OPERADORA_ALIASES[up] ?? up
}

/**
 * Clave canónica para el match AgendaPro ↔ Excel equipos.
 *
 * Formato: "SUCURSAL_CANÓNICA|OPERADORA_CANÓNICA"
 *
 * Usar en AMBOS lados de la comparación:
 *   makeAgendaMatchKey("Cibao Spa Láser - Plaza Mediterránea", "Riquelmi")
 *   → "RAFAEL VIDAL|ROQUELMI"
 *
 *   makeAgendaMatchKey("Rafael Vidal", "Roquelmi")
 *   → "RAFAEL VIDAL|ROQUELMI"  → MATCH ✓
 */
export function makeAgendaMatchKey(sucursal: unknown, operadora: unknown): string {
  return `${normalizeSucursal(sucursal)}|${normalizeOperadora(operadora)}`
}

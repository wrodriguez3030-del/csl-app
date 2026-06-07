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

/** Strings de cabecera o no-personas que NUNCA son sucursales/operadoras reales. */
const HEADER_SKIP = new Set([
  "SUCURSAL", "OPERADORA", "OPERADOR", "EQUIPO", "EQUIPOID",
  "CABINA", "PULSOS", "ESTADO", "FALLAS", "SERIAL", "SEMANA",
  "FECHA", "CLIENTE", "TRATAMIENTO", "POTENCIA", "SPOT", "DISPAROS",
  "SECUENCIAL", "CONTACTO", "TOTAL", "TOTALES",
])

/**
 * Normaliza sucursal a forma canónica (MAYÚSCULAS, sin prefijo de marca).
 * Devuelve "" si el valor es un encabezado / fila basura.
 *
 * Entradas soportadas (multi-tenant):
 *   CIBAO:
 *     "Cibao Spa Láser - Los Jardines"  → "LOS JARDINES"
 *     "JARDINES" / "Los Jardines"        → "LOS JARDINES"
 *     "Cibao Spa Láser - Plaza Mediterránea" → "RAFAEL VIDAL"
 *     "Plaza Mediterránea" / "Rafael Vidal" / "R VIDAL" → "RAFAEL VIDAL"
 *     "Cibao Spa Laser Villa Olga"       → "VILLA OLGA"
 *     "Villa Olga" / "V OLGA"            → "VILLA OLGA"
 *     "La Vega"                          → "LA VEGA"
 *   DEPICENTER:
 *     "Depicenter"                       → "DEPICENTER"
 *     "Depicenter Skin Láser"            → "DEPICENTER"
 *     "Skin Láser" / "SKIN LASER"        → "DEPICENTER"
 *
 *   "SUCURSAL" (cabecera)                → ""
 *
 * Nota: los keys se usan dentro del scope de un business_id (filtrado en
 * backend), así que no colisionan entre tenants. Por eso "DEPICENTER"
 * puede coexistir como key canónico sin ambigüedad.
 */
export function normalizeSucursal(value: unknown): string {
  const s = String(value || "").trim()
  if (!s) return ""
  const upRaw = cleanUpper(s)
  if (!upRaw || HEADER_SKIP.has(upRaw)) return ""

  // ── DEPICENTER: detectar ANTES de strip de brand prefix porque
  // "Depicenter" ES el nombre canónico de la sucursal (no un prefijo
  // a quitar como en Cibao Spa Láser).
  if (upRaw.includes("DEPICENTER")) return "DEPICENTER"
  if (upRaw.includes("SKIN") && upRaw.includes("LASER")) return "DEPICENTER"

  // ── CIBAO: stripear brand prefix y mapear sucursal interna
  const stripped = s.replace(BRAND_PREFIX_RE, "").trim() || s
  const up = cleanUpper(stripped)
  if (!up || HEADER_SKIP.has(up)) return ""
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
  return up
}

/**
 * Aliases de operadora: nombre en fuente externa → nombre canónico.
 * Clave: normalizada (sin acentos, mayúsculas).
 */
// Variantes de escritura (Excel/AgendaPro) → nombre OFICIAL en csl_operadoras.
// Los oficiales son KATHERINE / EMELY / RIQUELMI (verificado en db-cls); las
// variantes deben mapear HACIA esos, no al revés (si no, quedan "sin match").
const OPERADORA_ALIASES: Record<string, string> = {
  KATHERIN: "KATHERINE",
  EMELI: "EMELY",
  ROQUELMI: "RIQUELMI",
  YESICA: "YESSICA",
  SAOMY: "SAHOMY",
}

/** Valores que no representan personas reales — se ignoran en el match. */
const OPERADORA_SKIP = new Set([
  "SISTEMA", "SYSTEM", "ADMIN",
  // Strings de cabecera que pueden filtrarse si el Excel viene mal formado
  "OPERADORA", "OPERADOR", "EQUIPO", "EQUIPOID", "SUCURSAL",
])

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
 *
 * Devuelve "" cuando cualquiera de los dos componentes sale vacío (cabecera o
 * fila basura). El caller debe descartar esa clave para no acumular ruido.
 */
export function makeAgendaMatchKey(sucursal: unknown, operadora: unknown): string {
  const suc = normalizeSucursal(sucursal)
  const op = normalizeOperadora(operadora)
  if (!suc || !op) return ""
  return `${suc}|${op}`
}

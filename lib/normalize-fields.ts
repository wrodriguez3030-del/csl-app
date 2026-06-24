/**
 * Normalización de presentación/persistencia para CABINA y OPERADORA.
 *
 * Regla de negocio única en TODO el sistema (Cibao + Depicenter):
 * ambos campos SIEMPRE se muestran y se guardan en MAYÚSCULA.
 *
 * No se quitan acentos (eso alteraría la identidad del dato, no solo el case)
 * ni se reordena nada — es un upper-case + colapso de espacios:
 *   "cabina 5" → "CABINA 5"   "Cabina 1" → "CABINA 1"
 *   "Backup"   → "BACKUP"     "Taller"   → "TALLER"
 *   "rosa"     → "ROSA"       "Madelin"  → "MADELIN"
 *
 * Usar en AMBOS lados de cada flujo: al LEER de la DB (display) y al
 * ESCRIBIR (persistencia), además de en los parsers de import/export.
 */

/** MAYÚSCULA + trim + colapso de espacios. "" para null/undefined/vacío. */
export function toUpperField(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value).trim().replace(/\s+/g, " ").toUpperCase()
}

/**
 * Igual que toUpperField pero devuelve null cuando queda vacío — para
 * columnas nullable de la DB (no escribir "" donde antes había NULL).
 */
export function toUpperFieldOrNull(value: unknown): string | null {
  const v = toUpperField(value)
  return v ? v : null
}

/**
 * Variantes ortográficas conocidas de operadoras → forma CANÓNICA oficial.
 * Evita que el mismo nombre se guarde de dos maneras (ej. "RIQUELMI" vs
 * "ROQUELMI") y rompa el cruce cabina→operadora y los reportes.
 */
const OPERADORA_SYNONYMS: Record<string, string> = {
  EMELY: "EMELI",
  KATHERINE: "KATHERIN",
  KATERIN: "KATHERIN",
  RIQUELMI: "ROQUELMI",
  ROQUELMY: "ROQUELMI",
  YESICA: "YESSICA",
  JESSICA: "YESSICA",
}

/**
 * Normaliza un nombre de operadora a su forma canónica oficial (MAYÚSCULA +
 * sinónimos resueltos). Nombres desconocidos se conservan en MAYÚSCULA (no se
 * pierden). "" para vacío. Usar en AMBOS lados: selección en la UI y
 * persistencia en el backend.
 */
export function normalizeOperadora(value: unknown): string {
  const up = toUpperField(value)
  if (!up) return ""
  return OPERADORA_SYNONYMS[up] ?? up
}

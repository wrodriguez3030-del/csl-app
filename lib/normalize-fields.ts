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

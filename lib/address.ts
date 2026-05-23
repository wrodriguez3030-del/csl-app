/**
 * Helpers para limpiar texto de direcciones que viene de DB con duplicados,
 * errores de captura o casing inconsistente.
 *
 * Caso real visto: un cliente con dirección
 *   "santiago, santiago, santaigo, santiago"
 * proveniente de capturas históricas donde recepción tipeaba la misma ciudad
 * varias veces. normalizeAddress() lo deja en "Santiago".
 *
 * Se aplica SOLO a la presentación (pre-fill al generar link, render).
 * NO modifica los datos en DB para no perder información histórica.
 */

// Typos comunes observados en datos reales. Comparar siempre en lowercase.
const TYPO_FIXES: Record<string, string> = {
  santaigo: "santiago",
  santiao: "santiago",
  santigao: "santiago",
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/(\s+)/)
    .map((word) => (word.length > 0 && /[a-záéíóúñ]/.test(word[0]) ? word[0].toUpperCase() + word.slice(1) : word))
    .join("")
}

/**
 * Limpia una dirección compuesta por partes separadas por coma:
 *  - trim de cada parte
 *  - corrige typos conocidos ("santaigo" → "santiago")
 *  - elimina duplicados case-insensitive, preservando el primer orden
 *  - aplica Title Case a la salida
 *  - colapsa espacios múltiples internos
 */
export function normalizeAddress(input: string | null | undefined): string {
  if (!input) return ""
  const raw = String(input)
  const parts = raw
    .split(",")
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((p) => {
      const lower = p.toLowerCase()
      const fixed = TYPO_FIXES[lower]
      return fixed ? fixed : p
    })

  const seen = new Set<string>()
  const result: string[] = []
  for (const part of parts) {
    const key = part.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(toTitleCase(part))
  }
  return result.join(", ")
}

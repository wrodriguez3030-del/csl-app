/**
 * Normalización canónica de ESPECIALISTAS / OPERADORAS de cosmiatría, fichas
 * dermatológicas y consentimientos (masajes, peeling, tatuajes/cejas).
 *
 * Problema que resuelve: los selectores fusionan la fuente limpia
 * (`csl_operadoras`, ya en MAYÚSCULAS) con valores históricos guardados en los
 * registros con mayúsculas/minúsculas mezcladas (p.ej. "Eidylee" vs "EIDYLEE",
 * "Johely" vs "JOHELY"). Sin normalizar, el dropdown muestra la misma persona
 * dos veces. Este helper colapsa cada nombre a una sola forma canónica.
 *
 * ⚠️ ESTE MÓDULO NO APLICA AL LADO LÁSER (PulseControl). Ahí la operadora sale
 * del catálogo `csl_equipos` y su nombre canónico es **ROQUELMI** (ver
 * `lib/normalize-pulse.ts`). En el lado dermatología/cosmiatría el nombre
 * oficial es **RIQUELMI**. Son sistemas separados: no mezclar las dos tablas
 * de alias ni importar este helper en las pantallas de Pulsos.
 */

/** Lista oficial de especialistas de CSL (cosmiatría/fichas/consentimientos). */
export const ESPECIALISTAS_OFICIALES_CSL = [
  "BENITA",
  "DIANA",
  "EIDYLEE",
  "EMELI",
  "JOHELY",
  "KATHERIN",
  "LILIAN",
  "MADELIN",
  "NAYELI",
  "RIQUELMI",
  "ROSA",
  "SAHOMY",
  "YAMILKA",
  "YESSICA",
] as const

/**
 * Alias de variantes → nombre canónico (clave ya en MAYÚSCULAS sin acentos).
 * La mayoría de duplicados se resuelven solo con upper+strip de acentos
 * (Eidylee→EIDYLEE, Johely→JOHELY, Benita→BENITA, Dayhana→DAYHANA); aquí solo
 * van las variantes que NO colapsan por sí solas.
 */
const ALIAS_ESPECIALISTA: Record<string, string> = {
  EMELY: "EMELI",
  KATHERINE: "KATHERIN",
  YESICA: "YESSICA",
  SAOMY: "SAHOMY",
}

/** MAYÚSCULAS, sin acentos, espacios colapsados. Clave de comparación. */
function canonicalKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase()
}

/**
 * Devuelve el nombre canónico (MAYÚSCULAS) de una especialista/operadora.
 * Cadena vacía → "". No fuerza ninguna lista blanca: nombres de otro tenant
 * (p.ej. Depicenter: CLARIBEL, EVELINA…) pasan normalizados a MAYÚSCULAS.
 */
export function normalizeEspecialista(name: string | null | undefined): string {
  const key = canonicalKey(String(name ?? ""))
  if (!key) return ""
  return ALIAS_ESPECIALISTA[key] ?? key
}

/**
 * Normaliza y deduplica una lista de nombres por su forma canónica,
 * ordenada alfabéticamente (es). Garantiza una sola entrada por persona.
 */
export function dedupeEspecialistas(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values) {
    const canonical = normalizeEspecialista(raw)
    if (!canonical || seen.has(canonical)) continue
    seen.add(canonical)
    out.push(canonical)
  }
  return out.sort((a, b) => a.localeCompare(b, "es"))
}

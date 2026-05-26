/**
 * Lista oficial de categorías técnicas usadas en Inventario, Piezas,
 * Catálogo y Consulta código errores. Fuente única para evitar
 * duplicados visuales (ENERGIA / Energía, OPTICA / Óptica, etc.).
 *
 * Reglas:
 *   - Cualquier dropdown de categoría en el sistema debe leer esta lista.
 *   - Al cargar/guardar/importar registros, pasarlos por `normalizeCategoria`
 *     para reducir variantes a una versión canónica.
 *   - Valores legacy que no mapeen a la lista oficial caen a "Sin categoría".
 */

export const CATEGORIAS_TECNICAS = [
  "Base del sistema",
  "Cabezal láser / cavidad",
  "Consumibles principales",
  "Energía",
  "Hidráulica / agua",
  "Medición de energía",
  "Óptica",
  "Sistema de enfriamiento",
  "Sistema de entrega del disparo",
  "Sistema de seguridad y operación",
  "Sistema eléctrico",
  "Sistema eléctrico de disparo",
  "Sistema hidráulico / agua",
  "Sin categoría",
] as const

export type CategoriaTecnica = (typeof CATEGORIAS_TECNICAS)[number]

const CATEGORIA_SET: ReadonlySet<string> = new Set(CATEGORIAS_TECNICAS)

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
}

/**
 * Mapa de aliases conocidos hacia la categoría canónica. Las claves se
 * comparan con `stripAccents(value).replace(/\s+/g," ")`.
 */
const ALIAS_MAP: Record<string, CategoriaTecnica> = {
  "energia": "Energía",
  "energía": "Energía",
  "optica": "Óptica",
  "opticas": "Óptica",
  "óptica": "Óptica",
  "ópticas": "Óptica",
  "sistema hidraulico / agua": "Sistema hidráulico / agua",
  "sistema hidraulico/agua": "Sistema hidráulico / agua",
  "sistema hidráulico/agua": "Sistema hidráulico / agua",
  "hidraulica / agua": "Hidráulica / agua",
  "hidraulica/agua": "Hidráulica / agua",
  "hidráulica/agua": "Hidráulica / agua",
  "sistema electrico": "Sistema eléctrico",
  "sistema electrico de disparo": "Sistema eléctrico de disparo",
  "sistema eléctrico de disparo": "Sistema eléctrico de disparo",
  "base del sistema": "Base del sistema",
  "cabezal laser / cavidad": "Cabezal láser / cavidad",
  "cabezal laser/cavidad": "Cabezal láser / cavidad",
  "cabezal láser/cavidad": "Cabezal láser / cavidad",
  "consumibles principales": "Consumibles principales",
  "medicion de energia": "Medición de energía",
  "medición de energia": "Medición de energía",
  "medicion de energía": "Medición de energía",
  "sistema de enfriamiento": "Sistema de enfriamiento",
  "sistema de entrega del disparo": "Sistema de entrega del disparo",
  "sistema de seguridad y operacion": "Sistema de seguridad y operación",
  "sistema de seguridad y operación": "Sistema de seguridad y operación",
  "sin categoria": "Sin categoría",
  "sin categoría": "Sin categoría",
}

/**
 * Devuelve la versión canónica de la categoría. Si el valor no coincide
 * con ninguna alias ni con un valor oficial, devuelve "Sin categoría".
 *
 * Pasar siempre el valor del usuario por aquí antes de:
 *   - guardarlo en DB,
 *   - mostrarlo en un dropdown,
 *   - usarlo como llave de agrupación.
 */
export function normalizeCategoria(value: unknown): CategoriaTecnica {
  const raw = String(value ?? "").trim()
  if (!raw) return "Sin categoría"
  if (CATEGORIA_SET.has(raw)) return raw as CategoriaTecnica
  const key = stripAccents(raw).replace(/\s+/g, " ")
  const mapped = ALIAS_MAP[key]
  if (mapped) return mapped
  // Búsqueda case/acento-insensitive contra la lista oficial.
  for (const canonical of CATEGORIAS_TECNICAS) {
    if (stripAccents(canonical) === key) return canonical
  }
  return "Sin categoría"
}

/**
 * Aplica `normalizeCategoria` a una lista, deduplica y mantiene el orden
 * canónico de `CATEGORIAS_TECNICAS`. Útil para construir dropdowns de
 * filtros que tomen el universo real de datos sin variantes duplicadas.
 */
export function uniqueNormalizedCategorias(values: Iterable<unknown>): CategoriaTecnica[] {
  const present = new Set<CategoriaTecnica>()
  for (const v of values) present.add(normalizeCategoria(v))
  return CATEGORIAS_TECNICAS.filter((c) => present.has(c))
}

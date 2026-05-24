/**
 * Búsqueda de clientes — helpers únicos reutilizados en TODO el sistema
 * (Clientes, Ficha Dermatológica, Consentimientos Masajes, Consentimientos
 * Tatuajes/Cejas, modal "Enviar link a cliente").
 *
 * Reemplaza implementaciones divergentes que existían en cada pantalla. La
 * lógica:
 *
 *   1. `normalizeSearchText` — lowercase + strip-acentos + colapsa espacios.
 *      Comparación tolerante a "WILLIAN" vs "willian", "Análisis" vs "analisis",
 *      espacios dobles, etc.
 *
 *   2. `normalizeDigits` — solo dígitos. Búsqueda de teléfono/documento que
 *      tolera "829-714-1975" vs "8297141975" vs "(829) 714-1975".
 *
 *   3. `clientMatchesSearch` — true si el query matchea por texto normalizado
 *      O por dígitos normalizados (cuando el query es numérico).
 *
 *   4. `searchClients` — wrapper conveniente con limit + minChars +
 *      emptyReturns para los call-sites más comunes.
 *
 * El tipo `SearchableClient` es estructural — admite tanto `ClienteCosmiatria`
 * (PascalCase del frontend) como cualquier objeto con esos campos opcionales.
 * NO filtra por business_id: el caller ya recibió la lista filtrada por
 * tenant del backend (loadBusinessContext + AsyncLocalStorage).
 */

export interface SearchableClient {
  Nombre?: string
  Apellido?: string
  Telefono?: string
  Telefono2?: string
  Email?: string
  DocumentoIdentidad?: string
  NumeroCliente?: string
  Sucursal?: string
}

/** Lowercase + strip-acentos + colapsa whitespace. Idempotente. */
export function normalizeSearchText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** Solo dígitos — para matching de teléfono / cédula sin formato. */
export function normalizeDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "")
}

/**
 * Construye los dos "haystacks" de un cliente:
 *   - text: nombre + apellido + nombre completo + correo + tel + doc + sucursal
 *           (todo normalizado: lowercase + sin acentos).
 *   - digits: solo dígitos de tel + doc — para queries numéricas.
 */
function buildHaystack(client: SearchableClient): { text: string; digits: string } {
  const fullName = `${client.Nombre || ""} ${client.Apellido || ""}`.trim()
  const text = normalizeSearchText(
    [
      client.Nombre,
      client.Apellido,
      fullName,
      client.Email,
      client.Telefono,
      client.Telefono2,
      client.DocumentoIdentidad,
      client.NumeroCliente,
      client.Sucursal,
    ]
      .filter((value): value is string => Boolean(value && String(value).trim()))
      .join(" "),
  )
  const digits = normalizeDigits(
    [client.Telefono, client.Telefono2, client.DocumentoIdentidad, client.NumeroCliente]
      .filter(Boolean)
      .join(" "),
  )
  return { text, digits }
}

/**
 * `true` si `client` matchea el `query`:
 *   - Match por texto (case + acentos insensibles).
 *   - O match por dígitos si el query trae dígitos (ej. "8297141975" matchea
 *     "829-714-1975").
 *
 * Query vacío → `false` (el caller decide qué hacer con la lista vacía).
 */
export function clientMatchesSearch(client: SearchableClient, query: string): boolean {
  const needle = normalizeSearchText(query)
  if (!needle) return false
  const { text, digits } = buildHaystack(client)
  if (text.includes(needle)) return true
  const needleDigits = normalizeDigits(query)
  if (needleDigits && digits.includes(needleDigits)) return true
  return false
}

export interface SearchClientsOptions<T extends SearchableClient = SearchableClient> {
  /** Máximo de resultados a devolver. Default: 20. */
  limit?: number
  /** Mínimo de caracteres en query antes de filtrar. Default: 1. */
  minChars?: number
  /**
   * Qué devolver cuando el query es vacío o más corto que `minChars`:
   *   - "empty" (default): array vacío. Usado en pickers de modal que
   *     no muestran lista hasta que el usuario escribe algo.
   *   - "all": los primeros `limit` clientes sin filtrar. Usado en
   *     pantallas tipo listado donde el campo es opcional.
   */
  emptyReturns?: "empty" | "all"
  /**
   * Filtro adicional pre-search. Útil para excluir inactivos en pickers o
   * dejarlos visibles en la pantalla principal de Clientes. Tipado al
   * mismo `T` del array para que el caller pueda acceder a campos
   * específicos (ej. `Estado` de `ClienteCosmiatria`) sin cast.
   */
  filter?: (client: T) => boolean
}

/**
 * Filtra una lista de clientes en memoria. Wrapper conveniente alrededor de
 * `clientMatchesSearch`.
 *
 * El caller mantiene control sobre la lista (carga inicial, paginación,
 * orden); este helper solo se encarga del matching.
 */
export function searchClients<T extends SearchableClient>(
  clients: T[],
  query: string,
  options: SearchClientsOptions<T> = {},
): T[] {
  const { limit = 20, minChars = 1, emptyReturns = "empty", filter } = options
  const baseList = filter ? clients.filter(filter) : clients
  const needle = normalizeSearchText(query)
  if (!needle || needle.length < minChars) {
    return emptyReturns === "all" ? baseList.slice(0, limit) : []
  }
  return baseList.filter((client) => clientMatchesSearch(client, query)).slice(0, limit)
}

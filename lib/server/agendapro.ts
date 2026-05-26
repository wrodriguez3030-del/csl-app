/**
 * Cliente AgendaPro — solo lectura de clientes para sincronizarlos hacia
 * csl_cosmiatria_clientes. NO traemos citas, ventas, pagos ni servicios.
 *
 * Configuración por env vars (server-only):
 *   AGENDAPRO_SYNC_ENABLED       'true' para habilitar; cualquier otro valor
 *                                deshabilita el sync (botón muestra error claro).
 *   AGENDAPRO_API_BASE_URL       e.g. https://api.agendapro.com
 *   AGENDAPRO_API_USER           usuario de API Pública (Basic Auth)
 *   AGENDAPRO_API_PASSWORD       password
 *   AGENDAPRO_API_CLIENTS_PATH   path del endpoint de clientes (opcional;
 *                                default '/api/v1/clients'). DEJADO CONFIGURABLE
 *                                hasta confirmar la doc oficial de AgendaPro.
 *   AGENDAPRO_WEBHOOK_SECRET     token requerido en ?token=... para webhook.
 *
 * Multi-tenant: la integración SOLO está hookeada al business CSL por ahora.
 * Cuando se integre Depicenter, habrá que añadir un segundo set de credenciales
 * (AGENDAPRO_API_USER_DEPICENTER, etc.) y un selector de tenant.
 */

import { getSupabaseAdmin } from "@/lib/server/supabase"
import { resolveClienteId } from "@/lib/server/csl-crud"
import { digitsOnly } from "@/lib/formatters"

export interface AgendaProConfig {
  enabled: boolean
  baseUrl: string
  user: string
  password: string
  clientsPath: string
  webhookSecret: string
}

export function getAgendaProConfig(): AgendaProConfig {
  return {
    enabled: String(process.env.AGENDAPRO_SYNC_ENABLED || "").toLowerCase() === "true",
    baseUrl: String(process.env.AGENDAPRO_API_BASE_URL || "").trim().replace(/\/$/, ""),
    user: String(process.env.AGENDAPRO_API_USER || "").trim(),
    password: String(process.env.AGENDAPRO_API_PASSWORD || "").trim(),
    clientsPath: String(process.env.AGENDAPRO_API_CLIENTS_PATH || "/api/v1/clients").trim(),
    webhookSecret: String(process.env.AGENDAPRO_WEBHOOK_SECRET || "").trim(),
  }
}

/** Detecta placeholders ("pendiente_confirmar", "todo", "tbd", strings que
 *  no parecen una URL real). Útil mientras la integración está pre-aprobación. */
function isPlaceholderValue(value: string): boolean {
  const v = value.toLowerCase().trim()
  if (!v) return true
  if (v.includes("pendiente")) return true
  if (v.includes("placeholder")) return true
  if (v.includes("todo")) return true
  if (v.includes("tbd")) return true
  if (v.startsWith("valor_") || v.startsWith("token_")) return true
  return false
}

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch { return false }
}

/** Validación previa — devuelve mensaje si falta algo crítico. */
export function validateAgendaProConfig(cfg: AgendaProConfig, requireWebhook = false): string | null {
  if (!cfg.enabled) return "AgendaPro sync deshabilitado (AGENDAPRO_SYNC_ENABLED no es 'true')."
  if (!cfg.baseUrl || isPlaceholderValue(cfg.baseUrl) || !isValidHttpUrl(cfg.baseUrl)) {
    return "Falta configurar endpoint oficial de clientes de AgendaPro."
  }
  if (!cfg.user || isPlaceholderValue(cfg.user)) return "Falta AGENDAPRO_API_USER."
  if (!cfg.password || isPlaceholderValue(cfg.password)) return "Falta AGENDAPRO_API_PASSWORD."
  if (requireWebhook && (!cfg.webhookSecret || isPlaceholderValue(cfg.webhookSecret))) {
    return "Falta AGENDAPRO_WEBHOOK_SECRET."
  }
  return null
}

/** Forma flexible — AgendaPro puede devolver distintas claves según versión. */
export interface AgendaProClientRaw {
  id?: string | number
  client_id?: string | number
  uuid?: string
  name?: string
  first_name?: string
  last_name?: string
  nombre?: string
  apellido?: string
  full_name?: string
  phone?: string
  mobile?: string
  telefono?: string
  email?: string
  correo?: string
  document?: string
  document_number?: string
  identification_number?: string
  dni?: string
  cedula?: string
  documento?: string
  address?: string
  direccion?: string
  city?: string
  ciudad?: string
  birth_date?: string
  birthday?: string
  fecha_nacimiento?: string
  location_name?: string
  branch?: string
  sucursal?: string
  [key: string]: unknown
}

export interface MappedCliente {
  ClienteID: string
  Nombre: string
  Apellido: string
  Telefono: string
  Telefono2: string
  DocumentoIdentidad: string
  Email: string
  Direccion: string
  Ciudad: string
  FechaNacimiento: string
  Genero: string
  Sucursal: string
  agendapro_client_id: string
  origen: string
  Estado: "Activo"
}

/** Componer fecha YYYY-MM-DD desde birth_day / birth_month / birth_year si vienen separados. */
function composeBirthDate(raw: AgendaProClientRaw): string {
  const d = raw.birth_day || (raw as Record<string, unknown>).day
  const m = raw.birth_month || (raw as Record<string, unknown>).month
  const y = raw.birth_year || (raw as Record<string, unknown>).year
  if (d && m && y) {
    const dd = String(d).padStart(2, "0")
    const mm = String(m).padStart(2, "0")
    const yyyy = String(y).padStart(4, "0")
    return `${yyyy}-${mm}-${dd}`
  }
  return String(raw.birth_date || raw.birthday || raw.fecha_nacimiento || "").trim()
}

/**
 * Convierte un raw de AgendaPro al shape interno que entiende
 * csl_cosmiatria_clientes (vía clienteCosmiatriaToDb).
 *
 * Campos confirmados de AgendaPro Public API v1:
 *   id, first_name, last_name, phone, second_phone, email, gender,
 *   birth_day, birth_month, birth_year, identification_number
 *
 * Mantiene fallbacks por si AgendaPro varía formato.
 */
export function mapAgendaProClientToCslClient(raw: AgendaProClientRaw): MappedCliente {
  const agendaproId = String(raw.id ?? raw.client_id ?? raw.uuid ?? "").trim()
  let nombre = String(raw.first_name || raw.nombre || "").trim()
  let apellido = String(raw.last_name || raw.apellido || "").trim()
  if (!nombre && !apellido) {
    const full = String(raw.full_name || raw.name || "").trim()
    if (full) {
      const parts = full.split(/\s+/)
      nombre = parts[0] || ""
      apellido = parts.slice(1).join(" ")
    }
  }
  const telefono = String(raw.phone || raw.mobile || raw.telefono || "").trim()
  const telefono2 = String((raw as Record<string, unknown>).second_phone || raw.telefono || "").trim()
  const email = String(raw.email || raw.correo || "").trim()
  const documento = String(
    raw.identification_number || raw.document_number || raw.document || raw.dni || raw.cedula || raw.documento || "",
  ).trim()
  const direccion = String(raw.address || raw.direccion || "").trim()
  const ciudad = String(raw.city || raw.ciudad || "").trim()
  const fechaNac = composeBirthDate(raw)
  const genero = String((raw as Record<string, unknown>).gender || "").trim()
  const sucursal = String(raw.location_name || raw.branch || raw.sucursal || "").trim()
  return {
    ClienteID: "", // dejamos vacío para que resolveClienteId arme cli_doc_/cli_tel_/etc.
    Nombre: nombre,
    Apellido: apellido,
    Telefono: telefono,
    Telefono2: telefono2 !== telefono ? telefono2 : "",
    DocumentoIdentidad: documento,
    Email: email,
    Direccion: direccion,
    Ciudad: ciudad,
    FechaNacimiento: fechaNac,
    Genero: genero,
    Sucursal: sucursal,
    agendapro_client_id: agendaproId,
    origen: "AgendaPro",
    Estado: "Activo",
  }
}

/** Fetch a AgendaPro con Basic Auth. Devuelve body + headers (para metadata
 *  de paginación tipo X-Total-Count o Link). NO loguea credenciales. */
async function callAgendaPro(cfg: AgendaProConfig, path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: unknown; headers: Record<string, string>; error?: string }> {
  const url = `${cfg.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`
  const auth = Buffer.from(`${cfg.user}:${cfg.password}`).toString("base64")
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": `Basic ${auth}`,
        ...(init.headers || {}),
      },
    })
    const text = await res.text()
    let data: unknown = null
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    const headers: Record<string, string> = {}
    res.headers.forEach((value, key) => { headers[key.toLowerCase()] = value })
    if (!res.ok) {
      return { ok: false, status: res.status, data, headers, error: `AgendaPro ${res.status}: ${typeof data === "string" ? data.slice(0, 200) : "respuesta no JSON"}` }
    }
    return { ok: true, status: res.status, data, headers }
  } catch (fetchError) {
    return { ok: false, status: 0, data: null, headers: {}, error: fetchError instanceof Error ? fetchError.message : "Network error" }
  }
}

/** Ping de conexión — útil para "Test connection" sin traer datos pesados. */
export async function testAgendaProConnection(cfg: AgendaProConfig): Promise<{ ok: boolean; status: number; error?: string }> {
  const result = await callAgendaPro(cfg, cfg.clientsPath, { method: "GET" })
  return { ok: result.ok, status: result.status, error: result.error }
}

/**
 * Lee clientes de AgendaPro. La Public API v1 confirmó:
 *   GET /clients?search={query}   (búsqueda por término)
 *   GET /clients                  (listado completo — comportamiento NO confirmado)
 *
 * Estrategia:
 *   - Si llega `search`, usa `?search=...` (path confirmado).
 *   - Si no, intenta `GET /clients` plano. Si AgendaPro requiere search,
 *     el caller recibe `requiresSearch: true` + mensaje claro.
 */
/** Extrae el array de clientes de un body en cualquiera de las formas que
 *  hemos visto: array directo, { clients: [...] }, { data: [...] }, etc. */
function extractClientsArray(data: unknown): AgendaProClientRaw[] {
  if (Array.isArray(data)) return data as AgendaProClientRaw[]
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>
    if (Array.isArray(obj.clients)) return obj.clients as AgendaProClientRaw[]
    if (Array.isArray(obj.data)) return obj.data as AgendaProClientRaw[]
    if (Array.isArray(obj.records)) return obj.records as AgendaProClientRaw[]
    if (Array.isArray(obj.items)) return obj.items as AgendaProClientRaw[]
    if (Array.isArray(obj.results)) return obj.results as AgendaProClientRaw[]
    if (obj.id || obj.first_name || obj.email) return [obj as AgendaProClientRaw]
  }
  return []
}

/** Mira un body por metadata de paginación (total_pages, next_page, links.next, etc.). */
function detectPaginationMeta(data: unknown, headers: Record<string, string>): { totalPages?: number; currentPage?: number; nextPage?: number; total?: number; hasNext?: boolean } {
  const out: { totalPages?: number; currentPage?: number; nextPage?: number; total?: number; hasNext?: boolean } = {}
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>
    const meta = (obj.meta || obj.pagination || obj.page_info || {}) as Record<string, unknown>
    const links = (obj.links || {}) as Record<string, unknown>
    const tp = Number(meta.total_pages ?? obj.total_pages)
    const cp = Number(meta.current_page ?? obj.current_page ?? meta.page ?? obj.page)
    const np = Number(meta.next_page ?? obj.next_page)
    const total = Number(meta.total ?? obj.total ?? meta.total_count ?? obj.total_count)
    if (Number.isFinite(tp) && tp > 0) out.totalPages = tp
    if (Number.isFinite(cp) && cp > 0) out.currentPage = cp
    if (Number.isFinite(np) && np > 0) out.nextPage = np
    if (Number.isFinite(total) && total > 0) out.total = total
    if (links.next) out.hasNext = true
  }
  // RFC 5988 Link header: <...>; rel="next"
  const linkHeader = headers["link"] || headers["Link"]
  if (linkHeader && /rel="?next"?/i.test(linkHeader)) out.hasNext = true
  // X-Total-Count común
  const xTotal = Number(headers["x-total-count"])
  if (Number.isFinite(xTotal) && xTotal > 0 && !out.total) out.total = xTotal
  return out
}

/**
 * Una sola llamada — para búsqueda (search) y para que el caller arme su
 * propio loop si lo necesita. Acepta page/perPage para que el caller pueda
 * paginar manualmente.
 */
export async function fetchAgendaProClients(cfg: AgendaProConfig, options: { search?: string; page?: number; perPage?: number } = {}): Promise<{ ok: boolean; clients: AgendaProClientRaw[]; meta?: ReturnType<typeof detectPaginationMeta>; nextPage?: number; error?: string; status?: number; requiresSearch?: boolean }> {
  const search = (options.search || "").trim()
  let path = cfg.clientsPath
  const params: string[] = []
  if (search) params.push(`search=${encodeURIComponent(search)}`)
  if (typeof options.page === "number") params.push(`page=${options.page}`)
  if (typeof options.perPage === "number") params.push(`per_page=${options.perPage}`)
  if (params.length > 0) {
    const sep = path.includes("?") ? "&" : "?"
    path = `${path}${sep}${params.join("&")}`
  }
  const result = await callAgendaPro(cfg, path, { method: "GET" })

  if (!result.ok) {
    if (!search && (result.status === 400 || result.status === 422)) {
      return {
        ok: false,
        clients: [],
        status: result.status,
        requiresSearch: true,
        error: "AgendaPro requiere búsqueda por cliente. Falta confirmar endpoint de listado completo.",
      }
    }
    return { ok: false, clients: [], error: result.error, status: result.status }
  }

  const arr = extractClientsArray(result.data)
  const meta = detectPaginationMeta(result.data, result.headers)
  return { ok: true, clients: arr, meta }
}

/**
 * Pagina TODOS los clientes hasta llegar al final. Estrategia:
 *   1. Llama con ?page=N&per_page=PER_PAGE.
 *   2. Si la response trae metadata (total_pages, next_page, links.next,
 *      X-Total-Count) la usa.
 *   3. Si no, detecta fin cuando:
 *      - array vacío,
 *      - tamaño < per_page,
 *      - O todos los IDs ya fueron vistos en páginas anteriores (señal
 *        clara de que AgendaPro ignora el param ?page y devuelve siempre
 *        los mismos N clientes).
 *   4. Salvaguarda: maxPages = 500.
 */
export async function fetchAllAgendaProClients(cfg: AgendaProConfig, options: { perPage?: number; maxPages?: number } = {}): Promise<{
  ok: boolean
  clients: AgendaProClientRaw[]
  pagesRead: number
  error?: string
  requiresSearch?: boolean
  diagnostic: { perPage: number; pageSizeObserved?: number; lastMeta?: ReturnType<typeof detectPaginationMeta>; ignoredPagination?: boolean }
}> {
  // AgendaPro Public API v1 ignora ?per_page y devuelve 30 fijo. Mantenemos
  // perPage como hint pero NO lo usamos para detectar fin (el batch siempre
  // viene en su tamaño nativo). Las únicas condiciones de fin son:
  //   1. batch vacío
  //   2. todos los IDs del batch ya fueron vistos (AgendaPro empezó a
  //      wrappear / ignoró ?page)
  //   3. metadata explícita (rara en AgendaPro v1)
  //   4. maxPages safety
  const perPage = options.perPage ?? Number(process.env.AGENDAPRO_API_PER_PAGE || 100)
  const maxPages = options.maxPages ?? 500
  const seen = new Set<string>()
  const all: AgendaProClientRaw[] = []
  let pagesRead = 0
  let lastMeta: ReturnType<typeof detectPaginationMeta> | undefined
  let ignoredPagination = false
  let pageSizeObserved: number | undefined

  for (let page = 1; page <= maxPages; page++) {
    const t0 = Date.now()
    const res = await fetchAgendaProClients(cfg, { page, perPage })
    pagesRead++
    // Log progresivo a Vercel function logs (no incluye PII ni credenciales)
    // eslint-disable-next-line no-console
    console.log(`[agendapro-sync] page=${page} count=${res.clients?.length ?? 0} ok=${res.ok} ms=${Date.now() - t0}`)
    if (!res.ok) {
      if (res.requiresSearch) {
        return {
          ok: false,
          clients: all,
          pagesRead,
          requiresSearch: true,
          error: res.error,
          diagnostic: { perPage, pageSizeObserved, lastMeta, ignoredPagination },
        }
      }
      return {
        ok: false,
        clients: all,
        pagesRead,
        error: res.error || "Error desconocido al paginar",
        diagnostic: { perPage, pageSizeObserved, lastMeta, ignoredPagination },
      }
    }
    lastMeta = res.meta
    const batch = res.clients
    if (pageSizeObserved === undefined && batch.length > 0) pageSizeObserved = batch.length
    if (batch.length === 0) break

    // Contar IDs nuevos vs ya vistos.
    let newIds = 0
    for (const c of batch) {
      const id = String(c.id ?? c.client_id ?? c.uuid ?? "")
      if (id && !seen.has(id)) {
        seen.add(id)
        newIds++
        all.push(c)
      } else if (!id) {
        // Sin ID confiable — agregamos igual; el dedupe en DB ya resuelve.
        all.push(c)
      }
    }
    if (page > 1 && newIds === 0) {
      // AgendaPro está repitiendo IDs (ignora ?page o ya wrap-around). Fin.
      ignoredPagination = true
      break
    }

    // Condiciones explícitas de fin via metadata (raro en AgendaPro v1)
    if (lastMeta?.totalPages && page >= lastMeta.totalPages) break
    if (lastMeta?.currentPage && lastMeta?.totalPages && lastMeta.currentPage >= lastMeta.totalPages) break
    if (lastMeta?.hasNext === false) break
    // NO usamos "batch.length < perPage" como condición de fin porque
    // AgendaPro ignora ?per_page — siempre devuelve su tamaño nativo (30).
  }

  return {
    ok: true,
    clients: all,
    pagesRead,
    diagnostic: { perPage, pageSizeObserved, lastMeta, ignoredPagination },
  }
}

export interface SyncSummary {
  total: number
  created: number
  updated: number
  skipped: number
  duplicates: number
  errors: number
  errorDetails: Array<{ agendaproId?: string; error: string }>
}

/**
 * Sincroniza una lista de clientes AgendaPro hacia csl_cosmiatria_clientes
 * dentro del business_id dado. Usa el mismo resolveClienteId del sistema
 * para que dedupe por documento/teléfono/email aplique igual que en otros
 * paths. No crea duplicados.
 */
export async function syncAgendaProClients(args: {
  clients: AgendaProClientRaw[]
  businessId: string
}): Promise<SyncSummary> {
  const supabase = getSupabaseAdmin()
  const summary: SyncSummary = { total: args.clients.length, created: 0, updated: 0, skipped: 0, duplicates: 0, errors: 0, errorDetails: [] }

  for (const raw of args.clients) {
    try {
      const mapped = mapAgendaProClientToCslClient(raw)
      // Validación mínima — sin nombre Y sin teléfono Y sin documento, skip.
      if (!mapped.Nombre && !mapped.Telefono && !mapped.DocumentoIdentidad) {
        summary.skipped++
        continue
      }

      // Resolver cliente_id estable (mismo helper que el sistema usa en otros flujos).
      const clienteId = await resolveClienteId({
        ClienteID: mapped.agendapro_client_id ? `cli_apro_${mapped.agendapro_client_id}` : "",
        Nombre: mapped.Nombre,
        Apellido: mapped.Apellido,
        Telefono: mapped.Telefono,
        DocumentoIdentidad: mapped.DocumentoIdentidad,
        Email: mapped.Email,
        FechaNacimiento: mapped.FechaNacimiento,
      })

      // Buscar si ya existe en el business actual
      const { data: existing } = await supabase
        .from("csl_cosmiatria_clientes")
        .select("cliente_id, nombre, apellido, telefono, documento_identidad, email, agendapro_client_id")
        .eq("cliente_id", clienteId)
        .eq("business_id", args.businessId)
        .maybeSingle()

      // Si está fusionado, no actualizamos — ya está archivado.
      if (existing && (existing as Record<string, unknown>).agendapro_client_id && (existing as Record<string, unknown>).agendapro_client_id !== mapped.agendapro_client_id) {
        summary.duplicates++
        continue
      }

      const row: Record<string, unknown> = {
        cliente_id: clienteId,
        business_id: args.businessId,
        nombre: mapped.Nombre,
        apellido: mapped.Apellido,
        telefono: mapped.Telefono,
        documento_identidad: mapped.DocumentoIdentidad,
        email: mapped.Email,
        direccion: mapped.Direccion,
        ciudad: mapped.Ciudad,
        fecha_nacimiento: mapped.FechaNacimiento || null,
        sucursal: mapped.Sucursal,
        estado: "Activo",
        agendapro_client_id: mapped.agendapro_client_id || null,
        agendapro_synced_at: new Date().toISOString(),
        origen: existing ? (existing as Record<string, unknown>).origen || "AgendaPro" : "AgendaPro",
        updated_at: new Date().toISOString(),
      }
      if (!existing) {
        row.created_at = new Date().toISOString()
      }

      const upsertRes = await supabase
        .from("csl_cosmiatria_clientes")
        .upsert(row, { onConflict: "cliente_id" })
      if (upsertRes.error) {
        summary.errors++
        summary.errorDetails.push({ agendaproId: mapped.agendapro_client_id, error: upsertRes.error.message })
        continue
      }
      if (existing) summary.updated++
      else summary.created++
    } catch (rowError) {
      summary.errors++
      summary.errorDetails.push({
        agendaproId: String(raw.id ?? raw.client_id ?? ""),
        error: rowError instanceof Error ? rowError.message : "Error desconocido",
      })
    }
  }
  return summary
}

/** Para el webhook: si AgendaPro manda un payload de cita/venta, extrae el cliente. */
export function extractClientFromWebhookPayload(payload: unknown): AgendaProClientRaw | null {
  if (!payload || typeof payload !== "object") return null
  const obj = payload as Record<string, unknown>
  // Payload directo de cliente
  if (obj.id && (obj.name || obj.first_name || obj.full_name || obj.nombre)) {
    return obj as AgendaProClientRaw
  }
  // Anidado: { client: {...} } o { customer: {...} } o { cliente: {...} }
  const nested = (obj.client || obj.customer || obj.cliente) as Record<string, unknown> | undefined
  if (nested && typeof nested === "object") return nested as AgendaProClientRaw
  // Anidado en data.client
  const data = obj.data as Record<string, unknown> | undefined
  if (data && typeof data === "object") {
    const inner = (data.client || data.customer || data.cliente) as Record<string, unknown> | undefined
    if (inner) return inner as AgendaProClientRaw
  }
  return null
}

/** Para logs — no expone password ni service role. */
export function safeConfigSummary(cfg: AgendaProConfig): Record<string, unknown> {
  return {
    enabled: cfg.enabled,
    baseUrl: cfg.baseUrl,
    clientsPath: cfg.clientsPath,
    userMasked: cfg.user ? `${cfg.user.slice(0, 3)}***` : "",
    passwordSet: Boolean(cfg.password),
    webhookSecretSet: Boolean(cfg.webhookSecret),
  }
}

/** Dedupe util re-exportado para callers internos. */
export { digitsOnly }

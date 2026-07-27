/**
 * Sincronización de PAGOS desde la API pública de AgendaPro (Camino B).
 *
 * En vez de depender de que AgendaPro dispare el webhook, aquí CONSULTAMOS su
 * API pública y traemos los pagos nosotros:
 *   - Listar:  GET {base}/payments?filters[start_date]=&filters[end_date]=&page=&per_page=
 *   - Detalle: GET {base}/payments/{id}
 *   (Basic Auth con las credenciales de la "API Pública" de AgendaPro.)
 * Ref.: https://developers.agendapro.com/reference/ver-pagos
 *       https://developers.agendapro.com/reference/ver-un-pago
 *
 * Cada pago se pasa por `processAgendaProPayment` (ya existente): idempotente por
 * payment.id, tenant por location_id, crea paquete + consentimiento pendiente y
 * NUNCA consume la sesión. Reutiliza toda la lógica probada del webhook.
 */

import { getAgendaProConfig } from "@/lib/server/agendapro"
import { resolveAgendaProConfigForBusiness } from "@/lib/server/agendapro-credentials"
import { getSupabaseAdmin } from "@/lib/server/supabase"
import { createSupabaseRepo, processAgendaProPayment } from "@/lib/server/agendapro-payments"

/** Base de la API pública de AgendaPro (documentada). Configurable por si cambia. */
function publicApiBase(): string {
  return (process.env.AGENDAPRO_API_PUBLIC_BASE_URL || "https://agendapro.com/api/public/v1")
    .trim()
    .replace(/\/$/, "")
}

interface ApiCreds {
  user: string
  password: string
}

/** Resuelve las credenciales Basic Auth del tenant (DB cifrada) con fallback a env. */
async function resolveCreds(businessId: string): Promise<ApiCreds | null> {
  // El resolver necesita el slug del negocio (para el fallback a env vars, que
  // solo aplica al negocio dueño). Lo tomamos de la tabla businesses.
  let slug = ""
  try {
    const { data } = await getSupabaseAdmin().from("businesses").select("slug").eq("id", businessId).maybeSingle()
    slug = (data as { slug?: string } | null)?.slug || ""
  } catch { /* seguimos con slug vacío */ }

  try {
    const cfg = await resolveAgendaProConfigForBusiness(businessId, slug)
    if (cfg?.user && cfg?.password) return { user: cfg.user, password: cfg.password }
  } catch {
    /* cae al fallback de env */
  }
  const env = getAgendaProConfig()
  if (env.user && env.password) return { user: env.user, password: env.password }
  return null
}

async function apiGet(creds: ApiCreds, path: string): Promise<{ ok: boolean; status: number; data: unknown; error?: string }> {
  const url = `${publicApiBase()}${path.startsWith("/") ? "" : "/"}${path}`
  const auth = Buffer.from(`${creds.user}:${creds.password}`).toString("base64")
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Basic ${auth}` },
    })
    const text = await res.text()
    let data: unknown = null
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    if (!res.ok) {
      return { ok: false, status: res.status, data, error: `AgendaPro ${res.status}` }
    }
    return { ok: true, status: res.status, data }
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e instanceof Error ? e.message : "Network error" }
  }
}

/** Extrae el array de pagos de cualquier forma razonable de respuesta. */
function extractPaymentsArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[]
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>
    for (const k of ["payments", "data", "results", "records", "items"]) {
      if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[]
    }
  }
  return []
}

/** El detalle de un pago puede venir envuelto ({ payment: {...} }) o plano. */
function unwrapPayment(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null
  const o = data as Record<string, unknown>
  if (o.payment && typeof o.payment === "object") return o.payment as Record<string, unknown>
  if (o.data && typeof o.data === "object" && !Array.isArray(o.data)) return o.data as Record<string, unknown>
  if (o.id != null) return o
  return null
}

export interface SyncPaymentsResult {
  ok: boolean
  fetched: number
  processed: number
  already: number
  requiresMapping: number
  invalid: number
  errors: number
  error?: string
  details: { payment_id: unknown; status: string }[]
}

export interface SyncPaymentsOptions {
  businessId: string
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  locationId?: number
  maxPages?: number // tope de seguridad
}

/**
 * Trae los pagos del rango, procesa cada uno y devuelve el resumen.
 * Idempotente: reprocesar el mismo rango no duplica nada (lo garantiza
 * processAgendaProPayment por payment.id).
 */
export async function syncAgendaProPayments(opts: SyncPaymentsOptions): Promise<SyncPaymentsResult> {
  const result: SyncPaymentsResult = {
    ok: false, fetched: 0, processed: 0, already: 0, requiresMapping: 0, invalid: 0, errors: 0, details: [],
  }

  const creds = await resolveCreds(opts.businessId)
  if (!creds) {
    result.error = "No hay credenciales de la API de AgendaPro para este negocio."
    return result
  }

  const repo = createSupabaseRepo(getSupabaseAdmin())
  const perPage = 100
  const maxPages = opts.maxPages ?? 20

  const qsBase =
    `filters[start_date]=${encodeURIComponent(opts.startDate)}` +
    `&filters[end_date]=${encodeURIComponent(opts.endDate)}` +
    (opts.locationId ? `&filters[location_id]=${opts.locationId}` : "")

  for (let page = 1; page <= maxPages; page++) {
    const listRes = await apiGet(creds, `/payments?${qsBase}&page=${page}&per_page=${perPage}`)
    if (!listRes.ok) {
      result.error = `Error listando pagos (página ${page}): ${listRes.error}`
      result.errors++
      return result
    }
    const rows = extractPaymentsArray(listRes.data)
    if (rows.length === 0) break

    for (const row of rows) {
      result.fetched++
      const id = row.id
      // Traer el detalle completo (misma forma que el webhook). Si el listado ya
      // trae la forma completa, igual el detalle es la fuente autoritativa.
      let payload: Record<string, unknown> | null = row
      if (id != null) {
        const detRes = await apiGet(creds, `/payments/${id}`)
        if (detRes.ok) {
          const unwrapped = unwrapPayment(detRes.data)
          if (unwrapped) payload = unwrapped
        }
      }

      try {
        const r = await processAgendaProPayment(payload, repo, { storePayload: true })
        switch (r.status) {
          case "processed": result.processed++; break
          case "already_processed": result.already++; break
          case "requires_mapping": result.requiresMapping++; break
          case "invalid": result.invalid++; break
          default: result.errors++; break
        }
        result.details.push({ payment_id: id, status: r.status })
      } catch (e) {
        result.errors++
        result.details.push({ payment_id: id, status: "error" })
        console.error("[agendapro payments-sync] error procesando pago", id, e instanceof Error ? e.message : e)
      }
    }

    if (rows.length < perPage) break // última página
  }

  result.ok = true
  return result
}

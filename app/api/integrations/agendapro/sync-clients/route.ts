/**
 * POST /api/integrations/agendapro/sync-clients
 *
 * Sincronización manual de clientes AgendaPro → csl_cosmiatria_clientes.
 * Solo admin/superadmin. Multi-tenant: usa business_id del profile del
 * usuario (CSL para hoy). Registra resumen en csl_agendapro_sync_logs.
 *
 * No trae citas, ventas, pagos ni servicios. Solo clientes.
 */

import { NextResponse } from "next/server"
import { requireAuthenticatedUser, getSupabaseAdmin } from "@/lib/server/supabase"
import { getProfile, loadBusinessContext } from "@/lib/server/csl-crud"
import { runWithBusinessContext } from "@/lib/server/business-context"
import {
  fetchAgendaProClients,
  fetchAllAgendaProClients,
  getAgendaProConfig,
  syncAgendaProClients,
  validateAgendaProConfig,
} from "@/lib/server/agendapro"

export const dynamic = "force-dynamic"
export const revalidate = 0
// Vercel Function: sync puede tardar varios minutos si hay cientos/miles de
// clientes (cada pagina AgendaPro = ~1s + upsert por cliente). Subimos a 300s
// (Pro plan permite 300s; Hobby lo clampea a 60s — si es Hobby, considerar
// chunked-sync por frontend).
export const maxDuration = 300
export const runtime = "nodejs"

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request) {
  let user
  try {
    user = await requireAuthenticatedUser(request)
  } catch {
    return json({ ok: false, error: "No autenticado" }, 401)
  }

  // Sin gate por rol — cualquier usuario autenticado puede disparar el sync.
  // La integración AgendaPro es solo-lectura desde la perspectiva de AgendaPro
  // (no creamos garbage allá) y los clientes traídos quedan en el tenant CSL
  // (hardcoded — AgendaPro solo está integrado con la cuenta CSL hoy).
  const profile = await getProfile(user.id)
  if (!profile) {
    return json({ ok: false, error: "Perfil no encontrado." }, 403)
  }

  const cfg = getAgendaProConfig()
  const cfgError = validateAgendaProConfig(cfg)
  if (cfgError) {
    return json({ ok: false, error: cfgError }, 400)
  }

  const ctx = await loadBusinessContext(user.id)
  if (!ctx) return json({ ok: false, error: "Contexto de negocio no encontrado." }, 403)
  return runWithBusinessContext(ctx, async () => {
    const supabase = getSupabaseAdmin()
    const businessId = ctx.businessId

    // Abrir log en estado "running"
    const logInsert = await supabase
      .from("csl_agendapro_sync_logs")
      .insert({
        business_id: businessId,
        source: "manual",
        triggered_by: user.id,
        status: "running",
      })
      .select("sync_id")
      .single()
    const syncId = (logInsert.data as { sync_id?: string } | null)?.sync_id || null

    try {
      // Body opcional:
      //   { search }                       → búsqueda puntual (una página de resultados)
      //   { page, pagesPerTick? }          → fetch desde `page` por `pagesPerTick`
      //                                      páginas consecutivas (auto-sync incremental).
      //                                      Si pagesPerTick no viene, default = 1.
      //   {} (vacío)                       → listado completo paginado
      let body: { search?: string; page?: number; pagesPerTick?: number } = {}
      try {
        const raw = await request.text()
        body = raw ? JSON.parse(raw) : {}
      } catch { body = {} }
      const search = (body.search || "").trim()
      const singlePage = typeof body.page === "number" && body.page > 0 ? body.page : undefined
      const pagesPerTick = typeof body.pagesPerTick === "number" && body.pagesPerTick > 0
        ? Math.min(body.pagesPerTick, 10) // safety cap
        : 1

      let clients: Array<Record<string, unknown>> = []
      let pagesRead = 0
      let lastPageWithData = 0
      let diagnostic: Record<string, unknown> = {}

      if (search) {
        const fetchResult = await fetchAgendaProClients(cfg, { search })
        if (!fetchResult.ok) {
          if (fetchResult.requiresSearch) {
            return json({ ok: false, code: "requires_search", error: fetchResult.error || "AgendaPro requiere búsqueda por cliente." }, 400)
          }
          throw new Error(fetchResult.error || `Error AgendaPro status ${fetchResult.status}`)
        }
        clients = fetchResult.clients as Array<Record<string, unknown>>
        pagesRead = 1
      } else if (singlePage) {
        // Modo páginas consecutivas — para auto-sync incremental
        for (let i = 0; i < pagesPerTick; i++) {
          const currentPage = singlePage + i
          const fetchResult = await fetchAgendaProClients(cfg, { page: currentPage, perPage: 100 })
          if (!fetchResult.ok) {
            throw new Error(fetchResult.error || `Error AgendaPro status ${fetchResult.status} en página ${currentPage}`)
          }
          const batch = fetchResult.clients as Array<Record<string, unknown>>
          pagesRead++
          if (batch.length === 0) {
            // AgendaPro ya no tiene más datos — paramos acá.
            break
          }
          lastPageWithData = currentPage
          clients.push(...batch)
        }
        diagnostic = { startPage: singlePage, pagesPerTick, pagesRead, lastPageWithData }
      } else {
        const pagedResult = await fetchAllAgendaProClients(cfg)
        pagesRead = pagedResult.pagesRead
        diagnostic = pagedResult.diagnostic as unknown as Record<string, unknown>
        if (!pagedResult.ok) {
          if (pagedResult.requiresSearch) {
            return json({ ok: false, code: "requires_search", error: pagedResult.error || "AgendaPro requiere búsqueda por cliente.", pagesRead, diagnostic }, 400)
          }
          throw new Error(pagedResult.error || "Error paginando AgendaPro")
        }
        clients = pagedResult.clients as Array<Record<string, unknown>>
      }

      const summary = await syncAgendaProClients({ clients, businessId })

      if (syncId) {
        const errorDetails: Array<Record<string, unknown>> = [...summary.errorDetails]
        if (pagesRead > 0 || Object.keys(diagnostic).length > 0) {
          errorDetails.push({ kind: "pagination_info", pagesRead, diagnostic, search })
        }
        await supabase
          .from("csl_agendapro_sync_logs")
          .update({
            finished_at: new Date().toISOString(),
            total: summary.total,
            created: summary.created,
            updated: summary.updated,
            skipped: summary.skipped,
            duplicates: summary.duplicates,
            errors: summary.errors,
            error_details: errorDetails.length > 0 ? errorDetails : null,
            status: summary.errors === 0 ? "ok" : "ok_with_errors",
          })
          .eq("sync_id", syncId)
      }

      return json({
        ok: true,
        pagesRead,
        lastPageWithData,
        diagnostic,
        totalAgendaPro: summary.total,
        created: summary.created,
        updated: summary.updated,
        skipped: summary.skipped,
        duplicates: summary.duplicates,
        errors: summary.errors,
        errorDetails: summary.errorDetails,
      })
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : "Error desconocido en sync"
      if (syncId) {
        await supabase
          .from("csl_agendapro_sync_logs")
          .update({
            finished_at: new Date().toISOString(),
            status: "failed",
            error_details: [{ error: message }],
            errors: 1,
          })
          .eq("sync_id", syncId)
      }
      return json({ ok: false, error: message }, 500)
    }
  })
}

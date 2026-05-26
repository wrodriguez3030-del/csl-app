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
  getAgendaProConfig,
  syncAgendaProClients,
  validateAgendaProConfig,
} from "@/lib/server/agendapro"

export const dynamic = "force-dynamic"
export const revalidate = 0

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

  const profile = await getProfile(user.id)
  if (!profile?.is_admin && !profile?.is_superadmin) {
    return json({ ok: false, error: "Solo admin o superadmin pueden ejecutar la sincronización." }, 403)
  }
  const businessId = String(profile.business_id || "")
  if (!businessId) {
    return json({ ok: false, error: "Tu perfil no tiene business_id asignado." }, 400)
  }

  const cfg = getAgendaProConfig()
  const cfgError = validateAgendaProConfig(cfg)
  if (cfgError) {
    return json({ ok: false, error: cfgError }, 400)
  }

  const ctx = await loadBusinessContext(user.id)
  return runWithBusinessContext(ctx, async () => {
    const supabase = getSupabaseAdmin()

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
      // Aceptar body opcional con { search: "..." } para sync por término.
      // Si no llega search, intentamos GET /clients (puede que AgendaPro
      // requiera search explícito — la función lo señala con requiresSearch).
      let body: { search?: string } = {}
      try {
        const raw = await request.text()
        body = raw ? JSON.parse(raw) : {}
      } catch { body = {} }
      const search = (body.search || "").trim()

      const fetchResult = await fetchAgendaProClients(cfg, search ? { search } : {})
      if (!fetchResult.ok) {
        if (fetchResult.requiresSearch) {
          return json({
            ok: false,
            code: "requires_search",
            error: fetchResult.error || "AgendaPro requiere búsqueda por cliente.",
          }, 400)
        }
        throw new Error(fetchResult.error || `Error AgendaPro status ${fetchResult.status}`)
      }

      const summary = await syncAgendaProClients({ clients: fetchResult.clients, businessId })

      if (syncId) {
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
            error_details: summary.errorDetails.length > 0 ? summary.errorDetails : null,
            status: summary.errors === 0 ? "ok" : "ok_with_errors",
          })
          .eq("sync_id", syncId)
      }

      return json({
        ok: true,
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

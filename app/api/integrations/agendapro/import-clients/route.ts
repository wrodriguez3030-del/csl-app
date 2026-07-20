/**
 * POST /api/integrations/agendapro/import-clients
 *
 * Recibe un array de clientes ya parseados (desde Excel AgendaPro) y los
 * sincroniza con csl_cosmiatria_clientes usando el business_id real del
 * usuario autenticado (multi-tenant correcto).
 *
 * No requiere credenciales de AgendaPro — los datos vienen del frontend.
 * Registra el sync en csl_agendapro_sync_logs con source = "excel".
 */

import { NextResponse } from "next/server"
import { requireAuthenticatedUser, getSupabaseAdmin } from "@/lib/server/supabase"
import { runWithBusinessContext } from "@/lib/server/business-context"
import { resolveEffectiveBusinessContext, readActiveBusinessId } from "@/lib/server/integration-auth"
import { syncAgendaProClients, type AgendaProClientRaw } from "@/lib/server/agendapro"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const maxDuration = 60
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

  // Negocio de destino = negocio ACTIVO del switcher (aislamiento por tenant).
  const activeBusinessId = await readActiveBusinessId(request)
  const ctx = await resolveEffectiveBusinessContext(user.id, activeBusinessId)
  if (!ctx) return json({ ok: false, error: "Contexto de negocio no encontrado." }, 403)

  return runWithBusinessContext(ctx, async () => {
    const supabase = getSupabaseAdmin()

    let body: { clients?: unknown } = {}
    try { body = await request.json() } catch { /* empty body */ }

    if (!body.clients || !Array.isArray(body.clients) || body.clients.length === 0) {
      return json({ ok: false, error: "Se requiere un array de clientes no vacío." }, 400)
    }

    const clients = body.clients as AgendaProClientRaw[]
    const businessId = ctx.businessId

    // Registrar sync en logs
    const logRes = await supabase
      .from("csl_agendapro_sync_logs")
      .insert({ business_id: businessId, source: "excel", triggered_by: user.id, status: "running" })
      .select("sync_id")
      .single()
    const syncId = (logRes.data as { sync_id?: string } | null)?.sync_id || null

    try {
      const summary = await syncAgendaProClients({ clients, businessId })

      if (syncId) {
        await supabase.from("csl_agendapro_sync_logs").update({
          finished_at: new Date().toISOString(),
          total: summary.total,
          created: summary.created,
          updated: summary.updated,
          skipped: summary.skipped,
          duplicates: summary.duplicates,
          errors: summary.errors,
          error_details: summary.errorDetails.length > 0 ? summary.errorDetails : null,
          status: summary.errors === 0 ? "ok" : "ok_with_errors",
        }).eq("sync_id", syncId)
      }

      return json({ ok: true, ...summary })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido"
      if (syncId) {
        await supabase.from("csl_agendapro_sync_logs").update({
          finished_at: new Date().toISOString(),
          status: "failed",
          error_details: [{ error: message }],
          errors: 1,
        }).eq("sync_id", syncId)
      }
      return json({ ok: false, error: message }, 500)
    }
  })
}

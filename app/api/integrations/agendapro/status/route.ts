/**
 * GET /api/integrations/agendapro/status?activeBusinessId=...
 *
 * Estado de la integración AgendaPro del NEGOCIO ACTIVO:
 *   - configurado sí/no + origen (db/env/none) + usuario enmascarado + ****last4
 *   - última sincronización
 *   - historial reciente (10 últimos)
 * No expone credenciales.
 */

import { NextResponse } from "next/server"
import { requireAuthenticatedUser, getSupabaseAdmin } from "@/lib/server/supabase"
import { resolveEffectiveBusinessContext } from "@/lib/server/integration-auth"
import { getAgendaProCredentialStatus } from "@/lib/server/agendapro-credentials"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const runtime = "nodejs"

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  let user
  try {
    user = await requireAuthenticatedUser(request)
  } catch {
    return json({ ok: false, error: "No autenticado" }, 401)
  }

  const activeBusinessId = new URL(request.url).searchParams.get("activeBusinessId")
  const ctx = await resolveEffectiveBusinessContext(user.id, activeBusinessId)
  if (!ctx) return json({ ok: false, error: "Contexto de negocio no encontrado." }, 403)

  const credentials = await getAgendaProCredentialStatus(ctx.businessId, ctx.businessSlug)

  let logs: Array<Record<string, unknown>> = []
  try {
    const { data } = await getSupabaseAdmin()
      .from("csl_agendapro_sync_logs")
      .select("sync_id, source, status, started_at, finished_at, total, created, updated, skipped, duplicates, errors")
      .eq("business_id", ctx.businessId)
      .order("started_at", { ascending: false })
      .limit(10)
    logs = (data as Array<Record<string, unknown>>) || []
  } catch {
    logs = []
  }

  return json({
    ok: true,
    businessId: ctx.businessId,
    businessSlug: ctx.businessSlug,
    canConfigure: ctx.isAdmin || ctx.isSuperadmin || (ctx.permissions || []).includes("integrations.agendapro.configure"),
    credentials,
    lastSync: logs[0] || null,
    logs,
  })
}

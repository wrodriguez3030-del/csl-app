/**
 * GET /api/integrations/agendapro/cron
 *
 * Endpoint para Vercel Cron — sincronización incremental automática de AgendaPro.
 * Configurado en vercel.json con schedule */5 * * * * (cada 5 min).
 *
 * Estrategia: solo fetch página 1 (AgendaPro devuelve descendente por id, los
 * clientes nuevos siempre aparecen ahí). El dedupe vía resolveClienteId
 * asegura que no se duplican los que ya están en csl_cosmiatria_clientes.
 *
 * Auth: Vercel firma con Authorization: Bearer ${CRON_SECRET}. Si CRON_SECRET
 * no está configurada, el endpoint refuse (503) — no queremos exponer sync
 * sin auth al público.
 */

import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/server/supabase"
import {
  fetchAgendaProClients,
  getAgendaProConfig,
  syncAgendaProClients,
  validateAgendaProConfig,
} from "@/lib/server/agendapro"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const maxDuration = 60
export const runtime = "nodejs"

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  const cronSecret = (process.env.CRON_SECRET || "").trim()
  if (!cronSecret) {
    return json({ ok: false, error: "CRON_SECRET no configurada — cron rechazado por seguridad." }, 503)
  }
  const auth = request.headers.get("authorization") || ""
  if (auth !== `Bearer ${cronSecret}`) {
    return json({ ok: false, error: "Unauthorized" }, 401)
  }

  const cfg = getAgendaProConfig()
  const cfgErr = validateAgendaProConfig(cfg)
  if (cfgErr) {
    return json({ ok: false, error: cfgErr }, 503)
  }

  const supabase = getSupabaseAdmin()
  // Cron es always-CSL — no hay contexto de usuario para multi-tenant.
  const businessRow = await supabase
    .from("businesses")
    .select("id")
    .eq("slug", "csl")
    .maybeSingle()
  const businessId = (businessRow.data as { id?: string } | null)?.id
  if (!businessId) {
    return json({ ok: false, error: "Business CSL no encontrado en businesses." }, 500)
  }

  const logRes = await supabase
    .from("csl_agendapro_sync_logs")
    .insert({
      business_id: businessId,
      source: "cron",
      triggered_by: null,
      status: "running",
    })
    .select("sync_id")
    .single()
  const syncId = (logRes.data as { sync_id?: string } | null)?.sync_id || null

  try {
    // Solo page 1 — los más nuevos en AgendaPro. Los antiguos se cubren con
    // la sincronización manual / auto-sync incremental cuando recepción lo
    // dispara. Esto da un sync rápido que captura nuevos clientes con
    // latencia de 5 minutos.
    const fetchResult = await fetchAgendaProClients(cfg, { page: 1, perPage: 100 })
    if (!fetchResult.ok) {
      throw new Error(fetchResult.error || `Error AgendaPro status ${fetchResult.status}`)
    }
    const summary = await syncAgendaProClients({
      clients: fetchResult.clients as Array<Record<string, unknown>>,
      businessId,
    })
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
    // eslint-disable-next-line no-console
    console.log("[agendapro-cron]", JSON.stringify({
      total: summary.total, created: summary.created, updated: summary.updated,
      skipped: summary.skipped, duplicates: summary.duplicates, errors: summary.errors,
    }))
    return json({ ok: true, summary })
  } catch (cronError) {
    const message = cronError instanceof Error ? cronError.message : "Error desconocido"
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
    // eslint-disable-next-line no-console
    console.error("[agendapro-cron] error:", message)
    return json({ ok: false, error: message }, 500)
  }
}

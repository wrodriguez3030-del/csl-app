/**
 * POST /api/integrations/agendapro/webhook?token=...
 *
 * Recibe eventos desde AgendaPro. Solo procesamos cliente (NO citas, NO
 * ventas, NO pagos). Si el payload trae cliente embebido en un evento de
 * cita/venta, lo extraemos y sincronizamos solo eso.
 *
 * Autenticación: query param ?token=... que debe coincidir con
 * AGENDAPRO_WEBHOOK_SECRET. Si más adelante AgendaPro firma con HMAC
 * (header X-AgendaPro-Signature), aquí se valida en su lugar.
 *
 * Multi-tenant: por ahora SIEMPRE asigna al business CSL (slug 'csl').
 */

import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/server/supabase"
import {
  extractClientFromWebhookPayload,
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
  const cfg = getAgendaProConfig()
  // Para webhook exigimos el secret aunque sync esté deshabilitado — si llega
  // tráfico sin secret correcto es ataque/mal config.
  if (!cfg.webhookSecret) {
    return json({ ok: false, error: "Webhook AgendaPro no configurado (AGENDAPRO_WEBHOOK_SECRET faltante)." }, 503)
  }
  const url = new URL(request.url)
  const token = url.searchParams.get("token") || ""
  if (token !== cfg.webhookSecret) {
    return json({ ok: false, error: "Token inválido" }, 401)
  }

  const cfgError = validateAgendaProConfig(cfg)
  if (cfgError) {
    return json({ ok: false, error: cfgError }, 400)
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return json({ ok: false, error: "Body inválido (JSON esperado)" }, 400)
  }

  // Extraer SOLO el cliente del payload. Si AgendaPro mandó una cita/venta,
  // tomamos el cliente embebido. Si no hay cliente, no hacemos nada.
  const client = extractClientFromWebhookPayload(payload)
  if (!client) {
    return json({ ok: true, ignored: true, reason: "Payload sin cliente reconocible — evento ignorado." })
  }

  // Resolver business_id de CSL (slug 'csl').
  const supabase = getSupabaseAdmin()
  const businessRow = await supabase
    .from("businesses")
    .select("id")
    .eq("slug", "csl")
    .maybeSingle()
  const businessId = (businessRow.data as { id?: string } | null)?.id
  if (!businessId) {
    return json({ ok: false, error: "No se encontró el business CSL en businesses." }, 500)
  }

  const logRes = await supabase
    .from("csl_agendapro_sync_logs")
    .insert({
      business_id: businessId,
      source: "webhook",
      triggered_by: null,
      status: "running",
    })
    .select("sync_id")
    .single()
  const syncId = (logRes.data as { sync_id?: string } | null)?.sync_id || null

  try {
    const summary = await syncAgendaProClients({ clients: [client], businessId })
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
    return json({ ok: true, summary })
  } catch (syncError) {
    const message = syncError instanceof Error ? syncError.message : "Error desconocido"
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
}

/** Permitir GET para health-check (responde info segura, sin secrets). */
export async function GET() {
  const cfg = getAgendaProConfig()
  return json({
    ok: true,
    endpoint: "/api/integrations/agendapro/webhook",
    enabled: cfg.enabled,
    webhookConfigured: Boolean(cfg.webhookSecret),
  })
}

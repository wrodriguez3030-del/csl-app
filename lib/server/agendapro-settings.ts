/**
 * Interruptor de AgendaPro operable desde la UI (Administración → Integración
 * AgendaPro), sin tocar variables de entorno en Vercel.
 *
 * Es un AND con las env vars AGENDAPRO_SYNC_ENABLED / AGENDAPRO_WEBHOOK_ENABLED
 * (ver lib/server/agendapro.ts y agendapro-webhook.ts): ambas capas deben
 * permitir la operación. Sin fila en `csl_agendapro_settings` (o si la lectura
 * falla), el default es "encendido" — igual que las env vars por defecto.
 *
 * Global, no por business_id: hoy el webhook/cron de AgendaPro es siempre-CSL.
 */

import { getSupabaseAdmin } from "@/lib/server/supabase"

const SETTINGS_ROW_ID = "global"

export interface AgendaProToggle {
  syncEnabled: boolean
  webhookEnabled: boolean
  updatedAt: string | null
}

export async function getAgendaProToggle(): Promise<AgendaProToggle> {
  const { data } = await getSupabaseAdmin()
    .from("csl_agendapro_settings")
    .select("sync_enabled, webhook_enabled, updated_at")
    .eq("id", SETTINGS_ROW_ID)
    .maybeSingle()
  const row = data as { sync_enabled?: boolean; webhook_enabled?: boolean; updated_at?: string } | null
  return {
    syncEnabled: row?.sync_enabled ?? true,
    webhookEnabled: row?.webhook_enabled ?? true,
    updatedAt: row?.updated_at ?? null,
  }
}

export async function setAgendaProToggle(
  patch: Partial<{ syncEnabled: boolean; webhookEnabled: boolean }>,
  updatedBy: string | null,
): Promise<AgendaProToggle> {
  const current = await getAgendaProToggle()
  const row = {
    id: SETTINGS_ROW_ID,
    sync_enabled: patch.syncEnabled ?? current.syncEnabled,
    webhook_enabled: patch.webhookEnabled ?? current.webhookEnabled,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  }
  const { error } = await getSupabaseAdmin().from("csl_agendapro_settings").upsert(row, { onConflict: "id" })
  if (error) throw new Error(`No se pudo actualizar el interruptor de AgendaPro: ${error.message}`)
  return { syncEnabled: row.sync_enabled, webhookEnabled: row.webhook_enabled, updatedAt: row.updated_at }
}

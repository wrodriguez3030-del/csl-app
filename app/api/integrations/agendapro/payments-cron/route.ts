/**
 * GET /api/integrations/agendapro/payments-cron
 *
 * Cron de Vercel: sincroniza los PAGOS de AgendaPro automáticamente (Camino B),
 * sin depender del webhook. Configurado en vercel.json cada 3 minutos.
 *
 * Ventana: ayer + hoy (hora RD) — cubre el borde de medianoche con una sola
 * llamada de listado por corrida. El sync salta los pagos ya procesados sin
 * gastar cuota de la API (pre-chequeo en DB), así correrlo seguido es barato.
 *
 * Auth: Vercel firma con `Authorization: Bearer CRON_SECRET`. Sin CRON_SECRET,
 * el endpoint se rechaza (503). Always-CSL (el cron no tiene sesión de usuario).
 */

import crypto from "node:crypto"
import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/server/supabase"
import { syncAgendaProPayments } from "@/lib/server/agendapro-payments-sync"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const maxDuration = 60
export const runtime = "nodejs"

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status })
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

/** Fecha (YYYY-MM-DD) en hora de República Dominicana, con desfase en días. */
function drDate(offsetDays: number): string {
  const d = new Date(Date.now() - offsetDays * 24 * 60 * 60 * 1000)
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santo_Domingo",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d)
}

export async function GET(request: Request) {
  const cronSecret = (process.env.CRON_SECRET || "").trim()
  if (!cronSecret) {
    return json({ ok: false, error: "CRON_SECRET no configurada — cron rechazado por seguridad." }, 503)
  }
  const auth = request.headers.get("authorization") || ""
  if (!safeEqual(auth, `Bearer ${cronSecret}`)) {
    return json({ ok: false, error: "Unauthorized" }, 401)
  }

  const supabase = getSupabaseAdmin()
  const businessRow = await supabase.from("businesses").select("id").eq("slug", "csl").maybeSingle()
  const businessId = (businessRow.data as { id?: string } | null)?.id
  if (!businessId) {
    return json({ ok: false, error: "Business CSL no encontrado en businesses." }, 500)
  }

  try {
    const result = await syncAgendaProPayments({
      businessId,
      startDate: drDate(1), // ayer
      endDate: drDate(0),   // hoy
    })
    return json({ ...result })
  } catch (err) {
    console.error("[agendapro payments-cron] error:", err instanceof Error ? err.message : err)
    return json({ ok: false, error: "Error interno en el cron de pagos." }, 500)
  }
}

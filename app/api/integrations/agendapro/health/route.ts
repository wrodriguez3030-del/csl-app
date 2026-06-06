/**
 * GET /api/integrations/agendapro/health
 *
 * Diagnóstico admin-only. NO devuelve credenciales — solo flags y meta.
 *
 * Soporta ?probe=1 → pega a AgendaPro varias veces con distintos params
 * para confirmar si pagina o no. NO descarga clientes completos — solo
 * cuenta, primer/último id, y headers de paginación.
 */

import { NextResponse } from "next/server"
import { requireAuthenticatedUser, getSupabaseAdmin } from "@/lib/server/supabase"
import { loadBusinessContext } from "@/lib/server/csl-crud"
import { fetchAgendaProClients, getAgendaProConfig, safeConfigSummary, validateAgendaProConfig } from "@/lib/server/agendapro"

export const dynamic = "force-dynamic"
export const revalidate = 0

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status })
}

function summarize(arr: Array<Record<string, unknown>>): { count: number; firstId?: string; lastId?: string; sampleKeys?: string[] } {
  const count = arr.length
  const first = arr[0]
  const last = arr[count - 1]
  const firstId = first ? String(first.id ?? first.client_id ?? "") : undefined
  const lastId = last ? String(last.id ?? last.client_id ?? "") : undefined
  const sampleKeys = first ? Object.keys(first).slice(0, 30) : undefined
  return { count, firstId, lastId, sampleKeys }
}

export async function GET(request: Request) {
  let user
  try {
    user = await requireAuthenticatedUser(request)
  } catch {
    return json({ ok: false, error: "No autenticado" }, 401)
  }
  const cfg = getAgendaProConfig()
  const configError = validateAgendaProConfig(cfg)
  const url = new URL(request.url)
  const probe = url.searchParams.get("probe") === "1"

  // Última sincronización del tenant activo (no expone credenciales).
  let lastSync: Record<string, unknown> | null = null
  try {
    const ctx = await loadBusinessContext(user.id)
    if (ctx?.businessId) {
      const { data } = await getSupabaseAdmin()
        .from("csl_agendapro_sync_logs")
        .select("started_at, finished_at, status, total_fetched, created_count, updated_count, skipped_count, error_count, error_message")
        .eq("business_id", ctx.businessId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      lastSync = (data as Record<string, unknown> | null) ?? null
    }
  } catch { /* tabla de logs no disponible */ }

  const baseResult: Record<string, unknown> = {
    ok: true,
    ready: configError === null,
    pending: configError,
    config: safeConfigSummary(cfg),
    perPage: Number(process.env.AGENDAPRO_API_PER_PAGE || 100),
    lastSync,
  }
  if (!probe || configError) return json(baseResult)

  // Probe: pega a AgendaPro con distintos params, devuelve diagnostic sin
  // listar clientes completos. NO loguea Authorization. Body de AgendaPro
  // se procesa pero solo extraemos count/firstId/lastId/sampleKeys/meta.
  const probes: Array<{ label: string; opts: { page?: number; perPage?: number } }> = [
    { label: "plain", opts: {} },
    { label: "page=1&per_page=100", opts: { page: 1, perPage: 100 } },
    { label: "page=2&per_page=100", opts: { page: 2, perPage: 100 } },
    { label: "page=1&per_page=200", opts: { page: 1, perPage: 200 } },
    { label: "page=3&per_page=100", opts: { page: 3, perPage: 100 } },
  ]
  const results: Array<Record<string, unknown>> = []
  for (const p of probes) {
    const r = await fetchAgendaProClients(cfg, p.opts)
    if (!r.ok) {
      results.push({ label: p.label, ok: false, status: r.status, error: r.error, requiresSearch: r.requiresSearch })
      continue
    }
    results.push({
      label: p.label,
      ok: true,
      summary: summarize(r.clients as Array<Record<string, unknown>>),
      meta: r.meta,
    })
  }

  // Detectar si AgendaPro ignora ?page: comparar firstId de page=1 vs page=2.
  const p1 = results.find((r) => r.label === "page=1&per_page=100") as Record<string, unknown> | undefined
  const p2 = results.find((r) => r.label === "page=2&per_page=100") as Record<string, unknown> | undefined
  const ignoresPage = !!(p1 && p2
    && (p1.summary as Record<string, unknown>)?.firstId
    && (p1.summary as Record<string, unknown>)?.firstId === (p2.summary as Record<string, unknown>)?.firstId)

  return json({
    ...baseResult,
    probe: {
      probes: results,
      analysis: {
        ignoresPage,
        recommendation: ignoresPage
          ? "AgendaPro ignora ?page. Confirmar con soporte el parámetro de paginación oficial (puede ser cursor, ?next=, ?from_id=, etc.)."
          : "AgendaPro respeta ?page — el listado completo debería funcionar con paginación normal.",
      },
    },
  })
}

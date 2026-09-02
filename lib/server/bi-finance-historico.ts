/**
 * Histórico anual de ventas para el tablero (2017 → hoy).
 *
 * Une la REFERENCIA (`sales_history_monthly`, sembrada desde el Excel) con la
 * venta REAL (`sales_commission_sales` vía el RPC mensual). La referencia solo
 * cuenta para los meses anteriores a la primera venta real. Siempre es
 * consolidado: el histórico del Excel no distingue sucursal.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { exclusiveEnd } from "@/lib/commission/period"
import { fetchMonthlyAggregates } from "@/lib/server/commission"
import { mergeHistorico, type HistoricoYear, type RefMonth } from "@/lib/bi-finance/historico"
import { monthKey } from "@/lib/bi-finance/months"

type Row = Record<string, unknown>
const HISTORY_START = "2000-01-01"

async function loadReference(sb: SupabaseClient, businessId: string): Promise<RefMonth[]> {
  try {
    const { data } = await sb.from("sales_history_monthly").select("year, month, total").eq("business_id", businessId)
    return ((data || []) as Row[]).map((r) => ({ year: Number(r.year), month: Number(r.month), total: Number(r.total) || 0 }))
  } catch { return [] }
}

async function firstRealSaleKey(sb: SupabaseClient, businessId: string): Promise<string> {
  const { data } = await sb.from("sales_commission_sales").select("sale_date").eq("business_id", businessId)
    .not("sale_date", "is", null).order("sale_date", { ascending: true }).limit(1).maybeSingle()
  return String((data as Row | null)?.sale_date || "").slice(0, 7)
}

export async function loadHistoricoAnual(
  sb: SupabaseClient, businessId: string, anchor: { anchorYear: number; anchorMonth: number; to: string },
): Promise<HistoricoYear[]> {
  const [ref, real, firstKey] = await Promise.all([
    loadReference(sb, businessId),
    fetchMonthlyAggregates(businessId, HISTORY_START, exclusiveEnd(anchor.to), null, null).catch(() => []),
    firstRealSaleKey(sb, businessId).catch(() => ""),
  ])
  const realByMonth = real.reduce<Record<string, number>>((acc, r) => {
    const key = monthKey(r.y, r.m)
    return { ...acc, [key]: (acc[key] || 0) + (Number(r.gross) || 0) }
  }, {})
  const realRows = Object.entries(realByMonth).map(([key, total]) => ({ key, total }))
  return mergeHistorico(ref, realRows, firstKey, anchor)
}

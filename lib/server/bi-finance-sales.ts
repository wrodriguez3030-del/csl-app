/**
 * Ventas por CATEGORÍA (servicio) en un rango, para el summary del BI.
 * Camino rápido: RPC `sc_sales_by_category` (≤ 30 filas en un viaje).
 * Respaldo: paginar `sales_commission_sales` y agrupar aquí (mismo patrón que
 * `fetchMonthlyAggregates` en commission.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { CategoryAgg } from "@/lib/bi-finance/categorias"

type Row = Record<string, unknown>
const PAGE = 1000

export async function fetchCategoryAggregates(
  sb: SupabaseClient, businessId: string, fromISO: string, toEx: string, branch: string | null,
): Promise<CategoryAgg[]> {
  const { data, error } = await sb.rpc("sc_sales_by_category", {
    p_business: businessId, p_from: fromISO, p_to_ex: toEx, p_branch: branch,
  })
  if (!error) {
    return ((data || []) as Row[]).map((r) => ({
      category: String(r.category || "OTROS"), branch: String(r.branch || "(sin sucursal)"), gross: Number(r.gross) || 0,
    }))
  }
  return fetchCategoryAggregatesPaged(sb, businessId, fromISO, toEx, branch)
}

async function fetchCategoryAggregatesPaged(
  sb: SupabaseClient, businessId: string, fromISO: string, toEx: string, branch: string | null,
): Promise<CategoryAgg[]> {
  const agg = new Map<string, CategoryAgg>()
  for (let offset = 0; ; offset += PAGE) {
    let q = sb.from("sales_commission_sales").select("category, branch, gross_amount")
      .eq("business_id", businessId).gte("sale_date", fromISO).lt("sale_date", toEx)
      .order("id", { ascending: true }).range(offset, offset + PAGE - 1)
    if (branch) q = q.eq("branch", branch)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    for (const r of (data || []) as Row[]) {
      const category = String(r.category || "OTROS"), b = String(r.branch || "(sin sucursal)")
      const key = `${category}|${b}`
      const prev = agg.get(key) || { category, branch: b, gross: 0 }
      agg.set(key, { ...prev, gross: (Number(prev.gross) || 0) + (Number(r.gross_amount) || 0) })
    }
    if (!data || data.length < PAGE) break
  }
  return [...agg.values()]
}

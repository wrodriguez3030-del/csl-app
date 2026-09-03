/**
 * REPORTE MENSUAL DEL NEGOCIO — una sola llamada, un solo archivo.
 *
 * Nace de un problema real: el libro de Excel que se llevaba a mano tenía 22
 * hojas, 240 filas por mes y fórmulas que se copiaban de un mes al siguiente.
 * Corregir un dato arriba no llegaba abajo, y meses enteros acababan siendo
 * copia del anterior sin que nadie lo notara.
 *
 * Aquí se reúne, ya calculado y cuadrado, todo lo que ese libro intentaba
 * llevar: qué se vendió, qué se gastó, cuánto cobra cada quien y cómo va el año.
 * Nada se teclea, así que nada se puede desalinear.
 */
import { getSupabaseAdmin } from "@/lib/server/supabase"
import { getBusinessContext, requireAnyPermission } from "@/lib/server/business-context"
import { getBiFinanceSummary } from "@/lib/server/bi-finance"
import { monthBounds, exclusiveEnd } from "@/lib/commission/period"
import type { ActionParams } from "./csl-types"

type Row = Record<string, unknown>
const n2 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100
const num = (p: ActionParams, k: string) => Number((p as Record<string, unknown>)[k]) || 0

export interface FilaLiquidacion {
  persona: string; sucursal: string
  unidades: number; producto: number; servicios: number
  pacientes: number; laser: number; limpieza: number; neto: number
  detalleServicios: string
}

export async function getReporteMensual(params: ActionParams) {
  requireAnyPermission(["sales_commission.view", "bi_finance.view"])
  const business_id = getBusinessContext()?.businessId
  if (!business_id) throw new Error("Selecciona un negocio activo")
  const month = num(params, "month"), year = num(params, "year")
  if (!month || !year) throw new Error("Selecciona mes y año")
  const { from, to } = monthBounds(year, month)
  const endEx = exclusiveEnd(to)
  const sb = getSupabaseAdmin()

  const [resumen, { data: items }, { data: gastos }] = await Promise.all([
    getBiFinanceSummary({ month, year }),
    sb.from("sales_commission_run_items")
      .select("collaborator_name,branch,product_units,product_incentive,service_incentive_adjusted,patients,laser_total,cleaning_contribution,net_total,service_breakdown,run_id,sales_commission_runs!inner(period_month,period_year,status,deleted_at)")
      .eq("business_id", business_id)
      .eq("sales_commission_runs.period_month", month)
      .eq("sales_commission_runs.period_year", year)
      .is("sales_commission_runs.deleted_at", null)
      .neq("sales_commission_runs.status", "anulado"),
    sb.from("expenses").select("expense_date,branch,concept,category,account,amount")
      .eq("business_id", business_id).is("deleted_at", null)
      .gte("expense_date", from).lt("expense_date", endEx)
      .order("expense_date"),
  ])

  const liquidacion: FilaLiquidacion[] = ((items || []) as Row[]).map((r) => {
    const sb2 = (r.service_breakdown || {}) as Record<string, { base: number; pct: number; amount: number }>
    return {
      persona: String(r.collaborator_name || ""), sucursal: String(r.branch || ""),
      unidades: Number(r.product_units) || 0, producto: n2(r.product_incentive),
      servicios: n2(r.service_incentive_adjusted), pacientes: Number(r.patients) || 0,
      laser: n2(r.laser_total), limpieza: n2(r.cleaning_contribution), neto: n2(r.net_total),
      detalleServicios: Object.entries(sb2)
        .map(([k, v]) => `${k} ${Number(v.base).toLocaleString("en-US")} × ${Math.round(Number(v.pct) * 100)}% = ${Number(v.amount).toFixed(2)}`)
        .join(" · "),
    }
  }).sort((a, b) => b.neto - a.neto)

  const detalleGastos = ((gastos || []) as Row[]).map((g) => ({
    fecha: String(g.expense_date || "").slice(0, 10), sucursal: String(g.branch || ""),
    concepto: String(g.concept || ""), categoria: String(g.category || "Otros"),
    cuenta: g.account == null ? "" : String(g.account), monto: n2(g.amount),
  }))
  const porCategoria = detalleGastos.reduce<Record<string, number>>(
    (acc, g) => ({ ...acc, [g.categoria]: n2((acc[g.categoria] || 0) + g.monto) }), {})

  const totalIncentivos = n2(liquidacion.reduce((s, r) => s + r.neto, 0))
  return {
    ok: true as const,
    negocio: resumen.business, periodo: resumen.period,
    resumen: {
      ...resumen.resumen,
      incentivos: totalIncentivos,
      // Lo que de verdad queda: el margen ya descontados los incentivos, que el
      // libro viejo nunca mostraba junto.
      utilidadTrasIncentivos: n2(resumen.resumen.utilidadNeta - totalIncentivos),
    },
    ventas: { porServicio: resumen.ingresos.porServicio, porSucursal: resumen.ingresos.byBranch },
    rentabilidad: resumen.rentabilidad,
    historicoAnual: resumen.historicoAnual ?? [],
    liquidacion, gastos: { detalle: detalleGastos, porCategoria, total: n2(resumen.gastos?.gastosGenerales ?? 0) },
  }
}

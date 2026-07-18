/**
 * BI FINANCIERO IA — Agregador financiero central (fuente única).
 *
 * Construye una foto financiera AGREGADA y por SUCURSAL a partir de datos
 * REALES del sistema, reutilizando las agregaciones ya probadas del módulo de
 * comisión (ventas) y consultando directamente las tablas de gastos. NO crea
 * tablas paralelas de ingresos/gastos ni inventa números.
 *
 * Todo corre dentro de `runWithBusinessContext`, por lo que:
 *   - `getBusinessContext()` da el business activo (aislamiento por tenant), y
 *   - las funciones de comisión reutilizadas ya filtran por ese business_id.
 *
 * Este objeto alimenta tanto el Dashboard financiero como el CONTEXTO que se
 * envía al asistente IA (nunca se envían filas crudas ni PII de clientes).
 *
 * Modelo P&L (anti doble-conteo):
 *   ingresos   = Σ ventas brutas (sales_commission_sales.gross_amount)
 *   gastos     = facturas de proveedores + gastos generales + gastos menores
 *                + pagos recurrentes del mes + nómina (neto)
 *   utilidad   = ingresos − gastos ;  margen = utilidad / ingresos
 * `materiales` se reporta de forma INFORMATIVA (compras de materiales por
 *   requisición) y NO se suma al total, porque esas compras normalmente ya
 *   entran como facturas de proveedores (evita inflar el gasto).
 */
import { getBusinessContext } from "@/lib/server/business-context"
import { getSupabaseAdmin } from "@/lib/server/supabase"
import { normalizeSucursal } from "@/lib/normalize-pulse"
import { orderCommissionBranches, getBusinessBranding } from "@/lib/business"
import {
  getCommissionByBranch,
  getCommissionExecutiveDashboard,
  getCommissionPatients,
} from "@/lib/server/commission"

const NO_BRANCH = "(sin sucursal)"
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

function bizId(): string {
  const id = getBusinessContext()?.businessId
  if (!id) throw new Error("Selecciona un negocio activo para el BI financiero")
  return id
}

function monthBounds(year: number, month: number): { from: string; to: string } {
  const mm = String(month).padStart(2, "0")
  const d = new Date(Date.UTC(year, month, 0)) // día 0 del mes siguiente = último día del mes
  const last = String(d.getUTCDate()).padStart(2, "0")
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${last}` }
}

/** Lista de meses (year/month) para la tendencia, terminando en el ancla. */
function trailingMonths(anchorYear: number, anchorMonth: number, count: number) {
  const out: { year: number; month: number; key: string; label: string }[] = []
  let y = anchorYear
  let m = anchorMonth
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
  for (let i = 0; i < count; i++) {
    out.unshift({ year: y, month: m, key: `${y}-${String(m).padStart(2, "0")}`, label: `${MESES[m - 1]} ${y}` })
    m--
    if (m < 1) { m = 12; y-- }
  }
  return out
}

function canonBranch(raw: unknown): string {
  const n = normalizeSucursal(String(raw ?? ""))
  return n || NO_BRANCH
}

type BranchAgg = Record<string, number>
function addTo(map: BranchAgg, branch: string, amount: number) {
  map[branch] = round2((map[branch] || 0) + (Number(amount) || 0))
}

export interface BiFinanceParams {
  month?: number
  year?: number
  branch?: string | null
}

/**
 * Foto financiera del período. `month`/`year` por defecto = mes actual.
 * Si `branch` se especifica, los totales se acotan a esa sucursal (los
 * cortes por sucursal siempre reflejan el mismo filtro).
 */
export async function getBiFinanceSummary(params: BiFinanceParams = {}) {
  const business_id = bizId()
  const ctx = getBusinessContext()
  const slug = ctx?.businessSlug || "csl"
  const branding = getBusinessBranding(slug)

  const now = new Date()
  const year = params.year || now.getUTCFullYear()
  const month = params.month || now.getUTCMonth() + 1
  const branchFilter = params.branch ? normalizeSucursal(params.branch) : null
  const { from: mStart, to: mEnd } = monthBounds(year, month)

  const sb = getSupabaseAdmin()

  // ── INGRESOS (reutiliza agregación probada del módulo comisión) ──────────
  const salesParams: Record<string, string | number> = { month, year }
  if (branchFilter) salesParams.branch = branchFilter
  const [byBranchRes, execRes, patientsRes] = await Promise.all([
    getCommissionByBranch(salesParams).catch(() => ({ ok: false, branches: [] as Array<Record<string, number | string>> })),
    getCommissionExecutiveDashboard(salesParams).catch(() => null),
    getCommissionPatients(salesParams).catch(() => ({ total: 0, rows: [] as Array<Record<string, unknown>> })),
  ])
  const salesBranches = (byBranchRes as { branches?: Array<Record<string, number | string>> }).branches || []
  const ingresosByBranch: BranchAgg = {}
  const categoryByBranch: Record<string, { producto: number; servicio: number; laser: number }> = {}
  let ingresosTotal = 0
  let catProducto = 0, catServicio = 0, catLaser = 0
  let transacciones = 0
  for (const b of salesBranches) {
    const branch = canonBranch(b.branch)
    const gross = Number(b.gross) || 0
    addTo(ingresosByBranch, branch, gross)
    ingresosTotal = round2(ingresosTotal + gross)
    catProducto = round2(catProducto + (Number(b.producto) || 0))
    catServicio = round2(catServicio + (Number(b.servicio) || 0))
    catLaser = round2(catLaser + (Number(b.laser) || 0))
    transacciones += Number(b.count) || 0
    const c = categoryByBranch[branch] || { producto: 0, servicio: 0, laser: 0 }
    c.producto = round2(c.producto + (Number(b.producto) || 0))
    c.servicio = round2(c.servicio + (Number(b.servicio) || 0))
    c.laser = round2(c.laser + (Number(b.laser) || 0))
    categoryByBranch[branch] = c
  }
  const ticketPromedio = transacciones ? round2(ingresosTotal / transacciones) : 0
  const exec = execRes as Awaited<ReturnType<typeof getCommissionExecutiveDashboard>> | null

  // ── GASTOS (consultas directas, acotadas por business_id / sucursal) ─────
  const facturasByBranch: BranchAgg = {}
  const generalesByBranch: BranchAgg = {}
  const menoresByBranch: BranchAgg = {}
  const recurrentesByBranch: BranchAgg = {}
  const nominaByBranch: BranchAgg = {}
  const materialesByBranch: BranchAgg = {}

  const matchBranch = (raw: unknown) => {
    const b = canonBranch(raw)
    return !branchFilter || b === normalizeSucursal(branchFilter) || b === branchFilter
  }

  // Facturas de proveedores (total facturado del mes)
  try {
    const { data } = await sb.from("purchase_invoices")
      .select("total, branch, invoice_date, status, deleted_at")
      .eq("business_id", business_id).is("deleted_at", null).neq("status", "anulada")
      .gte("invoice_date", mStart).lte("invoice_date", mEnd)
    for (const r of (data || []) as Array<Record<string, unknown>>) {
      if (!matchBranch(r.branch)) continue
      addTo(facturasByBranch, canonBranch(r.branch), Number(r.total) || 0)
    }
  } catch { /* fuente opcional */ }

  // Gastos generales
  try {
    const { data } = await sb.from("expenses")
      .select("amount, branch, expense_date, status, deleted_at")
      .eq("business_id", business_id).is("deleted_at", null).neq("status", "anulado")
      .gte("expense_date", mStart).lte("expense_date", mEnd)
    for (const r of (data || []) as Array<Record<string, unknown>>) {
      if (!matchBranch(r.branch)) continue
      addTo(generalesByBranch, canonBranch(r.branch), Number(r.amount) || 0)
    }
  } catch { /* fuente opcional */ }

  // Gastos menores (caja chica aprobada/pagada)
  try {
    const { data } = await sb.from("petty_expenses")
      .select("amount, branch, expense_date, status, deleted_at")
      .eq("business_id", business_id).is("deleted_at", null)
      .gte("expense_date", mStart).lte("expense_date", mEnd)
    for (const r of (data || []) as Array<Record<string, unknown>>) {
      if (!["aprobado", "pagado"].includes(String(r.status))) continue
      if (!matchBranch(r.branch)) continue
      addTo(menoresByBranch, canonBranch(r.branch), Number(r.amount) || 0)
    }
  } catch { /* fuente opcional */ }

  // Pagos recurrentes efectivamente pagados en el mes (history) + branch del recurrente
  try {
    const { data: hist } = await sb.from("recurring_payment_history")
      .select("recurring_id, amount, paid_date")
      .eq("business_id", business_id).gte("paid_date", mStart).lte("paid_date", mEnd)
    const recIds = [...new Set((hist || []).map((h) => (h as Record<string, unknown>).recurring_id).filter(Boolean))]
    const branchByRec: Record<string, unknown> = {}
    if (recIds.length) {
      const { data: recs } = await sb.from("recurring_payments").select("id, branch").in("id", recIds as string[])
      for (const r of (recs || []) as Array<Record<string, unknown>>) branchByRec[String(r.id)] = r.branch
    }
    for (const h of (hist || []) as Array<Record<string, unknown>>) {
      const branchRaw = branchByRec[String(h.recurring_id)]
      if (!matchBranch(branchRaw)) continue
      addTo(recurrentesByBranch, canonBranch(branchRaw), Number(h.amount) || 0)
    }
  } catch { /* fuente opcional */ }

  // Nómina (neto) por sucursal del empleado, para runs anclados en el mes
  try {
    const { data: runs } = await sb.from("hr_payroll_runs")
      .select("id, period_start")
      .eq("business_id", business_id).gte("period_start", mStart).lte("period_start", mEnd)
    const runIds = (runs || []).map((r) => (r as Record<string, unknown>).id).filter(Boolean)
    if (runIds.length) {
      const { data: items } = await sb.from("hr_payroll_items")
        .select("employee_id, neto").eq("business_id", business_id).in("run_id", runIds as string[])
      const empIds = [...new Set((items || []).map((i) => (i as Record<string, unknown>).employee_id).filter(Boolean))]
      const sucByEmp: Record<string, unknown> = {}
      if (empIds.length) {
        const { data: emps } = await sb.from("csl_empleados").select("empleado_id, sucursal").in("empleado_id", empIds as string[])
        for (const e of (emps || []) as Array<Record<string, unknown>>) sucByEmp[String(e.empleado_id)] = e.sucursal
      }
      for (const it of (items || []) as Array<Record<string, unknown>>) {
        const branchRaw = sucByEmp[String(it.employee_id)]
        if (!matchBranch(branchRaw)) continue
        addTo(nominaByBranch, canonBranch(branchRaw), Number(it.neto) || 0)
      }
    }
  } catch { /* fuente opcional */ }

  // Materiales comprados por requisición (INFORMATIVO — no suma al total)
  try {
    const { data: reqs } = await sb.from("material_requisitions")
      .select("id, branch, requested_at")
      .eq("business_id", business_id).gte("requested_at", `${mStart}T00:00:00`).lte("requested_at", `${mEnd}T23:59:59`)
    const reqIds = (reqs || []).map((r) => (r as Record<string, unknown>).id).filter(Boolean)
    const branchByReq: Record<string, unknown> = {}
    for (const r of (reqs || []) as Array<Record<string, unknown>>) branchByReq[String(r.id)] = r.branch
    if (reqIds.length) {
      const { data: items } = await sb.from("material_requisition_items")
        .select("requisition_id, purchased_cost").eq("business_id", business_id).in("requisition_id", reqIds as string[])
      for (const it of (items || []) as Array<Record<string, unknown>>) {
        const branchRaw = branchByReq[String(it.requisition_id)]
        if (!matchBranch(branchRaw)) continue
        addTo(materialesByBranch, canonBranch(branchRaw), Number(it.purchased_cost) || 0)
      }
    }
  } catch { /* fuente opcional */ }

  const sumMap = (m: BranchAgg) => round2(Object.values(m).reduce((s, v) => s + v, 0))
  const facturas = sumMap(facturasByBranch)
  const gastosGenerales = sumMap(generalesByBranch)
  const gastosMenores = sumMap(menoresByBranch)
  const recurrentes = sumMap(recurrentesByBranch)
  const nomina = sumMap(nominaByBranch)
  const materiales = sumMap(materialesByBranch)
  const gastosTotal = round2(facturas + gastosGenerales + gastosMenores + recurrentes + nomina)

  const utilidadNeta = round2(ingresosTotal - gastosTotal)
  const margenNeto = ingresosTotal > 0 ? round2((utilidadNeta / ingresosTotal) * 100) : 0

  // ── Rentabilidad por sucursal ────────────────────────────────────────────
  const branchSet = new Set<string>([
    ...Object.keys(ingresosByBranch), ...Object.keys(facturasByBranch),
    ...Object.keys(generalesByBranch), ...Object.keys(menoresByBranch),
    ...Object.keys(recurrentesByBranch), ...Object.keys(nominaByBranch),
  ])
  branchSet.delete(NO_BRANCH)
  const orderedBranches = orderCommissionBranches(slug, [...branchSet])
  if (ingresosByBranch[NO_BRANCH] || facturasByBranch[NO_BRANCH]) orderedBranches.push(NO_BRANCH)

  const rentabilidad = orderedBranches.map((branch) => {
    const ingresos = round2(ingresosByBranch[branch] || 0)
    const g = round2(
      (facturasByBranch[branch] || 0) + (generalesByBranch[branch] || 0) +
      (menoresByBranch[branch] || 0) + (recurrentesByBranch[branch] || 0) +
      (nominaByBranch[branch] || 0),
    )
    const utilidad = round2(ingresos - g)
    const margen = ingresos > 0 ? round2((utilidad / ingresos) * 100) : 0
    return {
      branch, ingresos, gastos: g, utilidadNeta: utilidad, margenNeto: margen,
      desglose: {
        facturas: round2(facturasByBranch[branch] || 0),
        gastosGenerales: round2(generalesByBranch[branch] || 0),
        gastosMenores: round2(menoresByBranch[branch] || 0),
        recurrentes: round2(recurrentesByBranch[branch] || 0),
        nomina: round2(nominaByBranch[branch] || 0),
        materiales: round2(materialesByBranch[branch] || 0),
      },
      categorias: categoryByBranch[branch] || { producto: 0, servicio: 0, laser: 0 },
    }
  })

  // ── Tendencia 6 meses (ingresos vs gastos vs utilidad) ───────────────────
  const months = trailingMonths(year, month, 6)
  const trendFrom = monthBounds(months[0].year, months[0].month).from
  const trendTo = mEnd
  // Ingresos por mes: reusar la tendencia bruta del ejecutivo si está.
  const ingresosByMonth: Record<string, number> = {}
  if (exec?.trend) {
    for (const t of exec.trend) ingresosByMonth[`${t.year}-${String(t.month).padStart(2, "0")}`] = Number(t.sales) || 0
  }
  // Gastos por mes: una sola pasada por cada fuente en la ventana de 6 meses.
  const gastosByMonth: Record<string, number> = {}
  const bucket = (dateStr: unknown, amount: number) => {
    const key = String(dateStr || "").slice(0, 7)
    if (!key) return
    gastosByMonth[key] = round2((gastosByMonth[key] || 0) + (Number(amount) || 0))
  }
  try {
    const { data } = await sb.from("purchase_invoices").select("total, invoice_date, branch, status, deleted_at")
      .eq("business_id", business_id).is("deleted_at", null).neq("status", "anulada")
      .gte("invoice_date", trendFrom).lte("invoice_date", trendTo)
    for (const r of (data || []) as Array<Record<string, unknown>>) { if (matchBranch(r.branch)) bucket(r.invoice_date, Number(r.total) || 0) }
  } catch { /* opcional */ }
  try {
    const { data } = await sb.from("expenses").select("amount, expense_date, branch, status, deleted_at")
      .eq("business_id", business_id).is("deleted_at", null).neq("status", "anulado")
      .gte("expense_date", trendFrom).lte("expense_date", trendTo)
    for (const r of (data || []) as Array<Record<string, unknown>>) { if (matchBranch(r.branch)) bucket(r.expense_date, Number(r.amount) || 0) }
  } catch { /* opcional */ }
  try {
    const { data } = await sb.from("petty_expenses").select("amount, expense_date, branch, status, deleted_at")
      .eq("business_id", business_id).is("deleted_at", null)
      .gte("expense_date", trendFrom).lte("expense_date", trendTo)
    for (const r of (data || []) as Array<Record<string, unknown>>) {
      if (["aprobado", "pagado"].includes(String(r.status)) && matchBranch(r.branch)) bucket(r.expense_date, Number(r.amount) || 0)
    }
  } catch { /* opcional */ }

  const trend = months.map((m) => {
    const ingresos = round2(ingresosByMonth[m.key] || 0)
    const gastos = round2(gastosByMonth[m.key] || 0)
    return { key: m.key, label: m.label, ingresos, gastos, utilidad: round2(ingresos - gastos) }
  })

  // ── Deltas mes vs mes (de ingresos, del ejecutivo) ───────────────────────
  const ingresosDeltaPct = exec?.deltas?.salesTotal ?? null

  const patients = patientsRes as { total?: number } | null

  return {
    ok: true as const,
    business: { slug, name: branding.name },
    period: { month, year, label: monthLabelEs(month, year), from: mStart, to: mEnd },
    branchFilter: branchFilter || null,
    resumen: {
      ingresos: ingresosTotal,
      gastos: gastosTotal,
      utilidadNeta,
      margenNeto,
      ticketPromedio,
      transacciones,
      pacientes: Number(patients?.total) || 0,
      ingresosDeltaPct,
    },
    ingresos: {
      total: ingresosTotal,
      porCategoria: { producto: catProducto, servicio: catServicio, laser: catLaser },
      byBranch: ingresosByBranch,
    },
    gastos: {
      total: gastosTotal,
      facturas, gastosGenerales, gastosMenores, recurrentes, nomina,
      materiales, // informativo (no incluido en total)
      byBranch: {
        facturas: facturasByBranch, gastosGenerales: generalesByBranch,
        gastosMenores: menoresByBranch, recurrentes: recurrentesByBranch, nomina: nominaByBranch,
      },
    },
    rentabilidad,
    trend,
    fuentes: {
      ventas: "sales_commission_sales (bruto)",
      gastos: "purchase_invoices + expenses + petty_expenses + recurring_payment_history + hr_payroll_items",
      materiales: "material_requisition_items.purchased_cost (informativo)",
      pacientes: "sales_commission_patient_counts",
    },
  }
}

export type BiFinanceSummary = Awaited<ReturnType<typeof getBiFinanceSummary>>

function monthLabelEs(month: number, year: number): string {
  const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
  return `${MESES[month - 1] || ""} ${year}`
}

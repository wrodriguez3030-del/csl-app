/**
 * Gastos operativos POR MES (y por mes × sucursal) para las series del BI.
 *
 * Extraído del bucle de tendencia de `bi-finance.ts`: las mismas cinco fuentes
 * y los mismos filtros que el P&L del período, en una sola pasada sobre una
 * ventana de meses. Cada fuente es opcional (try/catch): si una tabla no existe
 * en el tenant, simplemente no suma.
 *
 * Diferencia respecto al bucle antiguo: los pagos recurrentes ahora sí respetan
 * el filtro de sucursal (se resuelve la sucursal del recurrente, como hace el
 * P&L del período); antes la tendencia los sumaba sin filtrar.
 */
import type { SupabaseClient } from "@supabase/supabase-js"

type Row = Record<string, unknown>
export type MonthMap = Readonly<Record<string, number>>
export type MonthBranchMap = Readonly<Record<string, Readonly<Record<string, number>>>>

export interface MonthlyExpenses { byMonth: MonthMap; byMonthBranch: MonthBranchMap }

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100
const monthOf = (d: unknown): string => String(d || "").slice(0, 7)

interface Hit { month: string; branch: string; amount: number }

function collect(hits: readonly Hit[]): MonthlyExpenses {
  return hits.reduce<MonthlyExpenses>((acc, h) => {
    if (!h.month || h.amount === 0) return acc
    const branchMap = acc.byMonthBranch[h.month] || {}
    return {
      byMonth: { ...acc.byMonth, [h.month]: round2((acc.byMonth[h.month] || 0) + h.amount) },
      byMonthBranch: { ...acc.byMonthBranch, [h.month]: { ...branchMap, [h.branch]: round2((branchMap[h.branch] || 0) + h.amount) } },
    }
  }, { byMonth: {}, byMonthBranch: {} })
}

export interface ExpenseSourceArgs {
  sb: SupabaseClient
  businessId: string
  from: string
  to: string
  /** ¿Cuenta esta sucursal (cruda) según el filtro activo? */
  matchBranch: (raw: unknown) => boolean
  /** Sucursal canónica (o «(sin sucursal)»). */
  canonBranch: (raw: unknown) => string
  /** Etiqueta para lo que no tiene sucursal (nómina). */
  noBranch: string
}

async function bucketInvoices(a: ExpenseSourceArgs): Promise<Hit[]> {
  const { data } = await a.sb.from("purchase_invoices").select("total, invoice_date, branch")
    .eq("business_id", a.businessId).is("deleted_at", null).neq("status", "anulada")
    .gte("invoice_date", a.from).lte("invoice_date", a.to)
  return ((data || []) as Row[]).filter((r) => a.matchBranch(r.branch))
    .map((r) => ({ month: monthOf(r.invoice_date), branch: a.canonBranch(r.branch), amount: Number(r.total) || 0 }))
}

async function bucketExpenses(a: ExpenseSourceArgs): Promise<Hit[]> {
  const { data } = await a.sb.from("expenses").select("amount, expense_date, branch")
    .eq("business_id", a.businessId).is("deleted_at", null).neq("status", "anulado")
    .gte("expense_date", a.from).lte("expense_date", a.to)
  return ((data || []) as Row[]).filter((r) => a.matchBranch(r.branch))
    .map((r) => ({ month: monthOf(r.expense_date), branch: a.canonBranch(r.branch), amount: Number(r.amount) || 0 }))
}

async function bucketPetty(a: ExpenseSourceArgs): Promise<Hit[]> {
  const { data } = await a.sb.from("petty_expenses").select("amount, expense_date, branch, status")
    .eq("business_id", a.businessId).is("deleted_at", null)
    .gte("expense_date", a.from).lte("expense_date", a.to)
  return ((data || []) as Row[])
    .filter((r) => ["aprobado", "pagado"].includes(String(r.status)) && a.matchBranch(r.branch))
    .map((r) => ({ month: monthOf(r.expense_date), branch: a.canonBranch(r.branch), amount: Number(r.amount) || 0 }))
}

async function bucketRecurring(a: ExpenseSourceArgs): Promise<Hit[]> {
  const { data: hist } = await a.sb.from("recurring_payment_history").select("recurring_id, amount, paid_date")
    .eq("business_id", a.businessId).gte("paid_date", a.from).lte("paid_date", a.to)
  const rows = (hist || []) as Row[]
  const ids = [...new Set(rows.map((h) => h.recurring_id).filter(Boolean))] as string[]
  const branchByRec: Record<string, unknown> = {}
  if (ids.length) {
    const { data: recs } = await a.sb.from("recurring_payments").select("id, branch").in("id", ids)
    for (const r of (recs || []) as Row[]) branchByRec[String(r.id)] = r.branch
  }
  return rows.filter((h) => a.matchBranch(branchByRec[String(h.recurring_id)]))
    .map((h) => ({ month: monthOf(h.paid_date), branch: a.canonBranch(branchByRec[String(h.recurring_id)]), amount: Number(h.amount) || 0 }))
}

async function bucketPayroll(a: ExpenseSourceArgs): Promise<Hit[]> {
  const { data: runs } = await a.sb.from("hr_payroll_runs").select("id, period_start")
    .eq("business_id", a.businessId).gte("period_start", a.from).lte("period_start", a.to)
  const rlist = (runs || []) as Row[]
  if (!rlist.length) return []
  const { data: items } = await a.sb.from("hr_payroll_items").select("run_id, neto")
    .eq("business_id", a.businessId).in("run_id", rlist.map((r) => r.id) as string[])
  const monthByRun: Record<string, string> = {}
  for (const r of rlist) monthByRun[String(r.id)] = monthOf(r.period_start)
  return ((items || []) as Row[])
    .map((it) => ({ month: monthByRun[String(it.run_id)] || "", branch: a.noBranch, amount: Number(it.neto) || 0 }))
}

const safe = async (p: Promise<Hit[]>): Promise<Hit[]> => { try { return await p } catch { return [] } }

/** Gastos operativos por mes (y por mes × sucursal) en [from, to]. */
export async function monthlyExpenses(a: ExpenseSourceArgs): Promise<MonthlyExpenses> {
  const parts = await Promise.all([
    safe(bucketInvoices(a)), safe(bucketExpenses(a)), safe(bucketPetty(a)), safe(bucketRecurring(a)), safe(bucketPayroll(a)),
  ])
  return collect(parts.flat())
}

/**
 * Flujo de efectivo — núcleo PURO (sin base de datos).
 *
 *   egresos = gastos operativos + inversiones + retiros de socios
 *   neto    = ingresos − egresos
 *
 * Las inversiones salen de `bi_finance_investments` (branch null = inversión
 * general del negocio) y los retiros de `bi_finance_partner_withdrawals`.
 * Ninguna función modifica sus entradas: todo se construye con objetos nuevos.
 */
import type { MonthPoint } from "./months"

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100

/** Decide si una fila cuenta según su sucursal (`null` = del negocio). */
export type BranchKeep = (branchRaw: string | null) => boolean

export interface InvestmentRow { branch?: string | null; monto_inversion?: number | string | null; fecha_inicio?: string | null }
export interface WithdrawalRow { kind?: string | null; amount?: number | string | null; withdrawal_date?: string | null; branch?: string | null }

export interface Flujo {
  ingresos: number
  egresosOperativos: number
  inversiones: number
  retiros: number
  egresos: number
  neto: number
}

export interface Inversiones { total: number; general: number; byBranch: Readonly<Record<string, number>> }
export interface Retiros { total: number; dividendos: number; cuentas: number }

export interface FlujoMes {
  key: string
  label: string
  short: string
  ventas: number
  gastosOperativos: number
  inversionGeneral: number
  inversionByBranch: Readonly<Record<string, number>>
  retiros: number
  egresos: number
  neto: number
}

const monthOf = (iso: unknown): string => String(iso || "").slice(0, 7)
const branchOf = (r: { branch?: string | null }): string | null => (r.branch ? String(r.branch) : null)

export function buildFlujo(p: { ingresos: number; egresosOperativos: number; inversiones: number; retiros: number }): Flujo {
  const egresos = round2(p.egresosOperativos + p.inversiones + p.retiros)
  return {
    ingresos: round2(p.ingresos),
    egresosOperativos: round2(p.egresosOperativos),
    inversiones: round2(p.inversiones),
    retiros: round2(p.retiros),
    egresos,
    neto: round2(p.ingresos - egresos),
  }
}

/** Suma inversiones separando la general (sin sucursal) de las de cada sucursal. */
export function sumInversiones(rows: readonly InvestmentRow[], keep: BranchKeep): Inversiones {
  return rows.reduce<Inversiones>((acc, r) => {
    const branch = branchOf(r)
    const amount = Number(r.monto_inversion) || 0
    if (!keep(branch) || amount <= 0) return acc
    if (!branch) return { ...acc, total: round2(acc.total + amount), general: round2(acc.general + amount) }
    return {
      ...acc,
      total: round2(acc.total + amount),
      byBranch: { ...acc.byBranch, [branch]: round2((acc.byBranch[branch] || 0) + amount) },
    }
  }, { total: 0, general: 0, byBranch: {} })
}

/** Suma retiros de socios por tipo (dividendo / cuenta). */
export function sumRetiros(rows: readonly WithdrawalRow[], keep: BranchKeep): Retiros {
  return rows.reduce<Retiros>((acc, r) => {
    const amount = Number(r.amount) || 0
    if (!keep(branchOf(r)) || amount <= 0) return acc
    const esDividendo = String(r.kind || "dividendo") !== "cuenta"
    return {
      total: round2(acc.total + amount),
      dividendos: round2(acc.dividendos + (esDividendo ? amount : 0)),
      cuentas: round2(acc.cuentas + (esDividendo ? 0 : amount)),
    }
  }, { total: 0, dividendos: 0, cuentas: 0 })
}

/**
 * Serie mensual del flujo: una fila por mes de `months`, cruzando ventas y
 * gastos (ya agrupados por «YYYY-MM») con las filas de inversiones y retiros.
 * Un mes sin datos sale en ceros, nunca en `undefined`.
 */
export function buildFlujoMensual(p: {
  months: readonly MonthPoint[]
  ventasByMonth: Readonly<Record<string, number>>
  gastosByMonth: Readonly<Record<string, number>>
  invRows: readonly InvestmentRow[]
  retRows: readonly WithdrawalRow[]
  keep: BranchKeep
}): FlujoMes[] {
  return p.months.map((m) => {
    const inv = sumInversiones(p.invRows.filter((r) => monthOf(r.fecha_inicio) === m.key), p.keep)
    const ret = sumRetiros(p.retRows.filter((r) => monthOf(r.withdrawal_date) === m.key), p.keep)
    const ventas = round2(p.ventasByMonth[m.key] || 0)
    const gastosOperativos = round2(p.gastosByMonth[m.key] || 0)
    const flujo = buildFlujo({ ingresos: ventas, egresosOperativos: gastosOperativos, inversiones: inv.total, retiros: ret.total })
    return {
      key: m.key, label: m.label, short: m.short,
      ventas, gastosOperativos,
      inversionGeneral: inv.general,
      inversionByBranch: inv.byBranch,
      retiros: ret.total,
      egresos: flujo.egresos,
      neto: flujo.neto,
    }
  })
}

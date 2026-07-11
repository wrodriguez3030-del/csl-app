/**
 * Motor de cálculo (PURO, sin efectos de I/O) de Incentivos de Ventas.
 * Todas las funciones reciben los valores desde reglas/inputs — nada hardcodeado.
 * Es el "gate" del módulo: reproduce el modelo de referencia (RD$25,815.11).
 */
import { round2, sumMoney } from "./money"
import type { EmployeeLiquidation, EmployeeLiquidationInput, MonthlyTotals, ReconStatus } from "./types"

// ── Cálculos unitarios (secciones 9-14) ──────────────────────────────────────

/** Incentivo por productos: unidades × monto unitario configurable. */
export function productIncentive(units: number, unitAmount: number): number {
  return round2((Number(units) || 0) * (Number(unitAmount) || 0))
}

/** Resultado ADMINISTRATIVO sobre ventas con tarjeta (NO es comisión personal). */
export function cardResult(cardTotal: number, percentage: number): number {
  return round2((Number(cardTotal) || 0) * (Number(percentage) || 0))
}

/** Comisión por categoría de servicio: venta atribuible × %. */
export function categoryCommission(sales: number, percentage: number): number {
  return round2((Number(sales) || 0) * (Number(percentage) || 0))
}

export interface LaserScaleRow {
  threshold: number
  percentage: number
}

/** Tramo del MAYOR umbral alcanzado (regla de aplicación inicial, sección 13). */
export function laserTramo(sales: number, scale: LaserScaleRow[]): LaserScaleRow | null {
  const s = Number(sales) || 0
  const reached = scale.filter((t) => s >= t.threshold).sort((a, b) => b.threshold - a.threshold)
  return reached[0] ?? null
}

/** Fondo de incentivo láser: ventas × % del tramo alcanzado. */
export function laserFund(sales: number, scale: LaserScaleRow[]): { tramo: LaserScaleRow | null; fund: number } {
  const tramo = laserTramo(sales, scale)
  return { tramo, fund: tramo ? round2((Number(sales) || 0) * tramo.percentage) : 0 }
}

export interface PatientParticipationRow {
  employeeId: string
  patients: number
  participation: number // fracción 0..1 (4 decimales)
  percentageLabel: string // "21.81%"
}

/**
 * Participación por pacientes con manejo explícito de redondeo (sección 14):
 * devuelve además el total y la diferencia de redondeo (Σ% − 100).
 */
export function patientParticipation(
  counts: { employeeId: string; patients: number }[],
): { rows: PatientParticipationRow[]; total: number; roundingDiff: number } {
  const total = counts.reduce((s, c) => s + (Number(c.patients) || 0), 0)
  const rows = counts.map((c) => {
    const frac = total > 0 ? (Number(c.patients) || 0) / total : 0
    const pct = Math.round(frac * 10000) / 100 // % con 2 decimales
    return {
      employeeId: c.employeeId,
      patients: Number(c.patients) || 0,
      participation: Math.round(frac * 10000) / 10000,
      percentageLabel: pct.toFixed(2) + "%",
    }
  })
  const sumPct = round2(rows.reduce((s, r) => s + parseFloat(r.percentageLabel), 0))
  return { rows, total, roundingDiff: round2(sumPct - 100) }
}

// ── Liquidación (secciones 17-22) ────────────────────────────────────────────

/**
 * Liquidación de un empleado.
 * neto = (incentivo_productos + incentivos_servicios) + bono − aporte_limpieza.
 * El aporte se guarda POSITIVO y se resta una sola vez (convención única).
 */
export function liquidateEmployee(input: EmployeeLiquidationInput, productUnitAmount: number): EmployeeLiquidation {
  const productInc = productIncentive(input.productUnits, productUnitAmount)
  const serviceInc = sumMoney((input.serviceIncentives || []).map((d) => d.amount))
  const subtotal = round2(productInc + serviceInc)
  const bonus = round2(input.bonusExtra || 0)
  const gross = round2(subtotal + bonus)
  const cleaning = round2(input.cleaningContribution || 0)
  const net = round2(gross - cleaning)
  return {
    employeeId: input.employeeId,
    employeeName: input.employeeName,
    branch: input.branch,
    productUnits: input.productUnits,
    productIncentive: productInc,
    serviceIncentive: serviceInc,
    subtotal,
    bonusExtra: bonus,
    grossTotal: gross,
    cleaningContribution: cleaning,
    netTotal: net,
    serviceBreakdown: input.serviceIncentives || [],
  }
}

/** Totales generales del período a partir de las liquidaciones individuales. */
export function monthlyTotals(rows: EmployeeLiquidation[]): MonthlyTotals {
  const t = (f: (r: EmployeeLiquidation) => number) => sumMoney(rows.map(f))
  const productIncentive = t((r) => r.productIncentive)
  const serviceIncentive = t((r) => r.serviceIncentive)
  const subtotal = round2(productIncentive + serviceIncentive)
  const bonusExtra = t((r) => r.bonusExtra)
  const grossTotal = round2(subtotal + bonusExtra)
  const cleaningContribution = t((r) => r.cleaningContribution)
  const netTotal = round2(grossTotal - cleaningContribution)
  return { productIncentive, serviceIncentive, subtotal, bonusExtra, grossTotal, cleaningContribution, netTotal }
}

// ── Conciliación (sección 29) ────────────────────────────────────────────────

/** Conciliación de productos: total por detalle (filas) vs declarado en fuente. */
export function reconcileProducts(
  unitsByRows: number,
  declaredInSource: number | null | undefined,
): { unitsByRows: number; declaredInSource: number | null; difference: number; status: ReconStatus } {
  const rows = Number(unitsByRows) || 0
  const declared = declaredInSource == null ? null : Number(declaredInSource) || 0
  const difference = declared == null ? 0 : rows - declared
  const status: ReconStatus =
    declared == null ? "sin_declarado" : difference === 0 ? "cuadrado" : "advertencia"
  return { unitsByRows: rows, declaredInSource: declared, difference, status }
}

/** Semáforo de conciliación de montos (|diferencia| en pesos). */
export function reconStatus(difference: number, warnThreshold = 0.01, critThreshold = 100): ReconStatus {
  const d = Math.abs(round2(difference))
  if (d <= warnThreshold) return "cuadrado"
  if (d <= critThreshold) return "advertencia"
  return "critico"
}

/**
 * Asignación PURA del fondo láser a los cálculos de liquidación de UN MES.
 * El reparto (getCommissionLaser) da un monto por prestador; aquí se decide
 * qué fila de `sales_commission_calculations` recibe cada monto:
 *  - un prestador puede tener varias filas (una por sucursal) → el monto COMPLETO
 *    va a UNA sola (la de mayor bruto editable) y las demás quedan en 0, para
 *    no duplicar el fondo;
 *  - filas en estado pagado/cerrado NUNCA se tocan (se reportan como bloqueadas);
 *  - prestadores del reparto sin cálculo se reportan como no vinculados;
 *  - es idempotente: re-aplicar con el mismo reparto no produce cambios.
 */
import { round2 } from "./money"

export interface LaserDistributionRow {
  provider: string
  amount: number
}

export interface LaserCalcRow {
  id: string
  provider: string
  branch: string
  status: string
  laserIncentive: number
  grossTotal: number
}

export interface LaserAssignment {
  id: string
  provider: string
  laserIncentive: number
}

export interface LaserApplyPlan {
  /** Solo filas cuyo láser CAMBIA (incluye puestas a 0). */
  assignments: LaserAssignment[]
  /** Prestadores con fondo asignado pero sin fila de cálculo en el mes. */
  unmatched: { provider: string; amount: number }[]
  /** Filas pagadas/cerradas cuyo láser debería cambiar pero no se tocan. */
  locked: { provider: string; status: string; current: number; target: number }[]
  /** Total efectivamente asignado a filas editables. */
  appliedTotal: number
}

const LOCKED_STATUSES = new Set(["pagado", "cerrado"])
const key = (name: string) => String(name || "").trim().toUpperCase()

export function assignLaserToCalcs(
  distribution: LaserDistributionRow[],
  calcs: LaserCalcRow[],
): LaserApplyPlan {
  const targetByProvider = new Map<string, number>()
  for (const d of distribution) {
    const k = key(d.provider)
    if (!k) continue
    targetByProvider.set(k, round2((targetByProvider.get(k) || 0) + (Number(d.amount) || 0)))
  }

  const byProvider = new Map<string, LaserCalcRow[]>()
  for (const c of calcs) {
    const k = key(c.provider)
    byProvider.set(k, [...(byProvider.get(k) || []), c])
  }

  const assignments: LaserAssignment[] = []
  const locked: LaserApplyPlan["locked"] = []
  let appliedTotal = 0

  for (const [prov, rows] of byProvider) {
    const target = targetByProvider.get(prov) || 0
    // La fila principal recibe el monto completo: la editable de mayor bruto;
    // si todas están bloqueadas, la bloqueada de mayor bruto (solo para reporte).
    const sorted = [...rows].sort((a, b) => b.grossTotal - a.grossTotal)
    const primary = sorted.find((r) => !LOCKED_STATUSES.has(r.status)) ?? sorted[0] ?? null
    for (const r of rows) {
      const want = r === primary ? target : 0
      if (LOCKED_STATUSES.has(r.status)) {
        if (round2(r.laserIncentive) !== round2(want)) {
          locked.push({ provider: r.provider, status: r.status, current: round2(r.laserIncentive), target: round2(want) })
        }
        continue
      }
      if (round2(r.laserIncentive) !== round2(want)) {
        assignments.push({ id: r.id, provider: r.provider, laserIncentive: round2(want) })
      }
    }
    if (primary && !LOCKED_STATUSES.has(primary.status)) appliedTotal = round2(appliedTotal + target)
  }

  const unmatched = [...targetByProvider.entries()]
    .filter(([prov, amount]) => amount > 0 && !byProvider.has(prov))
    .map(([prov, amount]) => ({ provider: prov, amount }))

  return { assignments, unmatched, locked, appliedTotal }
}

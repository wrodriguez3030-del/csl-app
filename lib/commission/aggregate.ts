/**
 * Agregación del importador: convierte ventas crudas (Produccion) en registros
 * normalizados y los agrega por empleado/categoría/sucursal, aplicando las
 * reglas configurables (motor). Puro y testeable contra el archivo real.
 */
import { classifyItem, classifyProvider, type ClassificationRule, type SaleCategory } from "./classification"
import { normalizeBranch, normalizeName, normalizePayment, type PaymentMethod } from "./normalize"
import { categoryCommission, laserFund, productIncentive, type LaserScaleRow } from "./engine"
import { round2, sumMoney } from "./money"

export interface RawSaleInput {
  date?: unknown
  branch?: unknown
  customer?: unknown
  provider?: unknown
  itemType?: unknown
  itemName?: unknown
  quantity?: unknown
  amount?: unknown
  paymentMethod?: unknown
}

export interface SaleRecord {
  date: string
  branch: string
  customer: string
  provider: string
  providerRole: string
  commissionable: boolean
  itemType: string
  itemName: string
  category: SaleCategory
  quantity: number
  amount: number
  paymentMethod: PaymentMethod
}

/** Categorías de servicio que comisionan con % plano (láser va por fondo/escala). */
export const FLAT_COMMISSION_CATEGORIES: SaleCategory[] = [
  "FACIALES", "HOLLYWOOD_AQUA_PEEL", "TATUAJES", "HIFU", "MASAJES",
]

/** Normaliza + clasifica una fila cruda en un SaleRecord. */
export function toSaleRecord(raw: RawSaleInput, classification?: ClassificationRule[]): SaleRecord {
  const p = classifyProvider(raw.provider)
  return {
    date: String(raw.date ?? ""),
    branch: normalizeBranch(raw.branch),
    customer: normalizeName(raw.customer),
    provider: p.name,
    providerRole: p.role,
    commissionable: p.commissionable,
    itemType: String(raw.itemType ?? ""),
    itemName: String(raw.itemName ?? ""),
    category: classifyItem(String(raw.itemType ?? ""), String(raw.itemName ?? ""), classification),
    quantity: Number(raw.quantity) || 0,
    amount: Number(raw.amount) || 0,
    paymentMethod: normalizePayment(raw.paymentMethod),
  }
}

export interface AggregateConfig {
  productUnitAmount: number
  categoryPct: Partial<Record<SaleCategory, number>>
  laserScale: LaserScaleRow[]
  classification?: ClassificationRule[]
}

export interface EmployeeAgg {
  provider: string
  branch: string
  productUnits: number
  productAmount: number
  productIncentive: number
  categorySales: Record<string, number>
  categoryCommission: Record<string, number>
  serviceCommissionTotal: number
  laserSales: number
  patients: number
}

export interface AggregateResult {
  rows: number
  totalGross: number
  byCategory: Record<string, { sales: number; count: number }>
  perEmployee: EmployeeAgg[]
  unassigned: { count: number; gross: number; laserSales: number }
  laser: { totalSales: number; byBranch: Record<string, number>; tramoPct: number; fund: number }
  branches: Record<string, { gross: number; count: number }>
}

/** Agrega los SaleRecord aplicando la configuración de reglas. */
export function aggregateSales(records: SaleRecord[], cfg: AggregateConfig): AggregateResult {
  const byCategory: Record<string, { sales: number; count: number }> = {}
  const branches: Record<string, { gross: number; count: number }> = {}
  const emp = new Map<string, EmployeeAgg & { _patients: Set<string> }>()
  const unassigned = { count: 0, gross: 0, laserSales: 0 }
  let totalGross = 0
  let laserTotal = 0
  const laserByBranch: Record<string, number> = {}

  for (const r of records) {
    totalGross = round2(totalGross + r.amount)
    byCategory[r.category] = byCategory[r.category] || { sales: 0, count: 0 }
    byCategory[r.category].sales = round2(byCategory[r.category].sales + r.amount)
    byCategory[r.category].count += 1
    branches[r.branch] = branches[r.branch] || { gross: 0, count: 0 }
    branches[r.branch].gross = round2(branches[r.branch].gross + r.amount)
    branches[r.branch].count += 1
    if (r.category === "DEPILACION_LASER") {
      laserTotal = round2(laserTotal + r.amount)
      laserByBranch[r.branch] = round2((laserByBranch[r.branch] || 0) + r.amount)
    }

    if (!r.commissionable || !r.provider) {
      unassigned.count += 1
      unassigned.gross = round2(unassigned.gross + r.amount)
      if (r.category === "DEPILACION_LASER") unassigned.laserSales = round2(unassigned.laserSales + r.amount)
      continue
    }

    const key = r.provider
    let e = emp.get(key)
    if (!e) {
      e = {
        provider: r.provider, branch: r.branch, productUnits: 0, productAmount: 0, productIncentive: 0,
        categorySales: {}, categoryCommission: {}, serviceCommissionTotal: 0, laserSales: 0, patients: 0,
        _patients: new Set<string>(),
      }
      emp.set(key, e)
    }
    if (r.customer) e._patients.add(r.customer)
    if (r.category === "PRODUCTO") {
      e.productUnits = round2(e.productUnits + r.quantity)
      e.productAmount = round2(e.productAmount + r.amount)
    } else if (r.category === "DEPILACION_LASER") {
      e.laserSales = round2(e.laserSales + r.amount)
      e.categorySales.DEPILACION_LASER = round2((e.categorySales.DEPILACION_LASER || 0) + r.amount)
    } else {
      e.categorySales[r.category] = round2((e.categorySales[r.category] || 0) + r.amount)
    }
  }

  // Cálculos con reglas
  const laserTramo = pickTramo(laserTotal, cfg.laserScale)
  const perEmployee: EmployeeAgg[] = []
  for (const e of emp.values()) {
    e.productIncentive = productIncentive(e.productUnits, cfg.productUnitAmount)
    let svcTotal = 0
    for (const cat of FLAT_COMMISSION_CATEGORIES) {
      const sales = e.categorySales[cat] || 0
      const pct = cfg.categoryPct[cat] || 0
      const com = categoryCommission(sales, pct)
      if (com) e.categoryCommission[cat] = com
      svcTotal = round2(svcTotal + com)
    }
    e.serviceCommissionTotal = svcTotal
    e.patients = e._patients.size
    const { _patients, ...rest } = e
    perEmployee.push(rest)
  }
  perEmployee.sort((a, b) => b.serviceCommissionTotal + b.productIncentive - (a.serviceCommissionTotal + a.productIncentive))

  const laser = laserFund(laserTotal, cfg.laserScale)
  return {
    rows: records.length,
    totalGross,
    byCategory,
    perEmployee,
    unassigned,
    laser: { totalSales: laserTotal, byBranch: laserByBranch, tramoPct: laserTramo?.percentage || 0, fund: laser.fund },
    branches,
  }
}

function pickTramo(sales: number, scale: LaserScaleRow[]): LaserScaleRow | null {
  const reached = scale.filter((t) => sales >= t.threshold).sort((a, b) => b.threshold - a.threshold)
  return reached[0] ?? null
}

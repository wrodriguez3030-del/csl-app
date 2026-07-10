/**
 * MODELO DE REFERENCIA de la especificación (secciones 10, 15, 20, 21, 22).
 * Sirve como prueba de aceptación del motor: liquidar estos inputs debe
 * producir exactamente RD$25,815.11 neto, y detectar la discrepancia 67 vs 86
 * de productos como control de calidad de fuente.
 *
 * NOTA: la fuente sólo entrega el TOTAL de incentivos de servicios por empleado
 * (no el detalle por categoría/láser), por lo que aquí se representa como un
 * único componente de servicios por empleado. En producción ese total se
 * DERIVA del motor por categoría/láser/fijo/ajuste a partir de las ventas.
 */
import { liquidateEmployee, monthlyTotals, patientParticipation, laserFund, reconcileProducts } from "./engine"
import type { EmployeeLiquidationInput, ServiceIncentiveDetail } from "./types"

export const REFERENCE_PRODUCT_UNIT_AMOUNT = 100
export const REFERENCE_CLEANING_AMOUNT = 400
/** Total de unidades declarado en la fila de total de la fuente (vs 86 por filas). */
export const REFERENCE_PRODUCTS_DECLARED = 67

interface Row {
  id: string
  name: string
  units: number
  service: number
  bonus?: number
  cleaning?: number
}

/** Filas del modelo (productos, incentivo de servicios total, bono, limpieza). */
const ROWS: Row[] = [
  { id: "luisa", name: "LUISA", units: 19, service: 1810.01, cleaning: 400 },
  { id: "yanibel", name: "YANIBEL", units: 18, service: 1810.01, cleaning: 400 },
  { id: "riquelmi", name: "RIQUELMI", units: 7, service: 1973.69, cleaning: 0 },
  { id: "rosa", name: "ROSA", units: 12, service: 1540.44, bonus: 4000, cleaning: 400 },
  { id: "diana", name: "DIANA", units: 10, service: 1652.76, cleaning: 400 },
  { id: "madeline", name: "MADELINE", units: 1, service: 1957.64, cleaning: 400 },
  { id: "emely", name: "EMELY", units: 1, service: 1925.55, cleaning: 400 },
  { id: "karla", name: "KARLA", units: 18, service: 1810.01, cleaning: 400 },
  { id: "dayhana", name: "DAYHANA", units: 0, service: 1535.0, cleaning: 0 },
  { id: "isaury", name: "ISAURY", units: 0, service: 0, cleaning: 0 },
  { id: "mariela", name: "MARIELA", units: 0, service: 0, cleaning: 0 },
]

const serviceDetail = (employeeId: string, amount: number): ServiceIncentiveDetail[] =>
  amount > 0
    ? [{ employeeId, source: "AJUSTE_MANUAL", base: 0, amount, note: "Total de servicios del modelo de referencia" }]
    : []

export const REFERENCE_INPUTS: EmployeeLiquidationInput[] = ROWS.map((r) => ({
  employeeId: r.id,
  employeeName: r.name,
  productUnits: r.units,
  serviceIncentives: serviceDetail(r.id, r.service),
  bonusExtra: r.bonus || 0,
  cleaningContribution: r.cleaning || 0,
}))

/** Valores esperados del modelo (secciones 21-22). */
export const REFERENCE_EXPECTED = {
  productIncentive: 8600,
  serviceIncentive: 16015.11,
  subtotal: 24615.11,
  bonusExtra: 4000,
  grossTotal: 28615.11,
  cleaningContribution: 2800,
  netTotal: 25815.11,
  productUnitsByRows: 86,
  productUnitsDeclared: 67,
  productDifference: 19,
  perEmployeeNet: {
    luisa: 3310.01, yanibel: 3210.01, riquelmi: 2673.69, rosa: 6340.44, diana: 2252.76,
    madeline: 1657.64, emely: 1625.55, karla: 3210.01, dayhana: 1535.0, isaury: 0, mariela: 0,
  } as Record<string, number>,
}

/** Modelo de pacientes atendidos (sección 14) para validar participación. */
export const REFERENCE_PATIENTS = [
  { employeeId: "riquelmi", patients: 246 },
  { employeeId: "rosa", patients: 192 },
  { employeeId: "diana", patients: 206 },
  { employeeId: "madeline", patients: 244 },
  { employeeId: "emely", patients: 240 },
]

/** Ejecuta el modelo completo y devuelve resultados + comparación con lo esperado. */
export function runReferenceReconciliation() {
  const liquidations = REFERENCE_INPUTS.map((i) => liquidateEmployee(i, REFERENCE_PRODUCT_UNIT_AMOUNT))
  const totals = monthlyTotals(liquidations)
  const perEmployeeNet = Object.fromEntries(liquidations.map((l) => [l.employeeId, l.netTotal]))
  const unitsByRows = REFERENCE_INPUTS.reduce((s, i) => s + i.productUnits, 0)
  const productsRecon = reconcileProducts(unitsByRows, REFERENCE_PRODUCTS_DECLARED)
  const participation = patientParticipation(REFERENCE_PATIENTS)
  const laserExample = laserFund(650000, [
    { threshold: 260000, percentage: 0.02 },
    { threshold: 600000, percentage: 0.03 },
    { threshold: 800000, percentage: 0.04 },
    { threshold: 2000000, percentage: 0.05 },
  ])

  // Comparación campo a campo contra REFERENCE_EXPECTED.
  const checks: { name: string; expected: number; got: number; ok: boolean }[] = []
  const cmp = (name: string, expected: number, got: number) =>
    checks.push({ name, expected, got, ok: Math.abs(expected - got) < 0.005 })
  cmp("productIncentive", REFERENCE_EXPECTED.productIncentive, totals.productIncentive)
  cmp("serviceIncentive", REFERENCE_EXPECTED.serviceIncentive, totals.serviceIncentive)
  cmp("subtotal", REFERENCE_EXPECTED.subtotal, totals.subtotal)
  cmp("bonusExtra", REFERENCE_EXPECTED.bonusExtra, totals.bonusExtra)
  cmp("grossTotal", REFERENCE_EXPECTED.grossTotal, totals.grossTotal)
  cmp("cleaningContribution", REFERENCE_EXPECTED.cleaningContribution, totals.cleaningContribution)
  cmp("netTotal", REFERENCE_EXPECTED.netTotal, totals.netTotal)
  for (const [id, net] of Object.entries(REFERENCE_EXPECTED.perEmployeeNet)) {
    cmp(`net:${id}`, net, perEmployeeNet[id] ?? NaN)
  }
  cmp("productDifference(86-67)", REFERENCE_EXPECTED.productDifference, productsRecon.difference)
  cmp("laser650k→3%", 19500, laserExample.fund)

  const allOk = checks.every((c) => c.ok)
  return { totals, perEmployeeNet, productsRecon, participation, laserExample, checks, allOk }
}

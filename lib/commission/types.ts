/**
 * Tipos del dominio de Comisión de Ventas. Sin dependencias de runtime:
 * importable por cliente y servidor. Los VALORES (porcentajes, montos, escalas,
 * empleados) NUNCA se hardcodean en la lógica: viven en reglas configurables
 * (`CommissionRule`) versionadas por fecha efectiva.
 */

export type RuleType =
  | "card_percentage"        // % administrativo sobre ventas con tarjeta
  | "product_unit_incentive" // monto fijo por unidad de producto vendida
  | "category_commission"    // % por categoría de servicio
  | "laser_scale"            // tramo de la escala de depilación láser
  | "cleaning_contribution"  // aporte de limpieza (se descuenta)
  | "fixed_incentive"        // incentivo fijo por empleado
  | "laser_split"            // (legacy) fracción del fondo láser por pacientes
  | "laser_weight_personas"  // % del fondo láser repartido por cantidad de personas
  | "laser_weight_pacientes" // % del fondo láser repartido por pacientes atendidos
  | "laser_zero_patients_fixed"        // flag (fixed 1/0): 0 pacientes recibe parte fija
  | "laser_card_discount_before_scale" // flag (fixed 1/0): descontar tarjeta antes de la escala
  | "laser_split_mode"                 // flag (fixed 1/0): 1 = equitativo (cuadro), 0 = pesos

/** Origen de cada peso de incentivo de servicios (trazabilidad, sección 16). */
export type ServiceIncentiveSource =
  | "FACIALES"
  | "HOLLYWOOD_AQUA_PEEL"
  | "TATUAJES"
  | "HIFU"
  | "MASAJES"
  | "DEPILACION_LASER"
  | "INCENTIVO_FIJO"
  | "AJUSTE_MANUAL"

export const SERVICE_CATEGORIES: ServiceIncentiveSource[] = [
  "FACIALES", "HOLLYWOOD_AQUA_PEEL", "TATUAJES", "HIFU", "MASAJES",
]

export type PeriodStatus =
  | "borrador" | "importado" | "calculado" | "en_revision"
  | "aprobado" | "pagado" | "cerrado" | "anulado"

export interface CommissionRule {
  id: string
  businessId: string
  name: string
  ruleType: RuleType
  category?: string | null
  employeeId?: string | null
  branch?: string | null
  minAmount?: number | null
  maxAmount?: number | null
  percentage?: number | null // fracción: 27% => 0.27
  fixedAmount?: number | null
  priority: number
  active: boolean
  effectiveFrom: string // ISO date "YYYY-MM-DD"
  effectiveTo?: string | null
}

export interface ServiceIncentiveDetail {
  employeeId: string
  source: ServiceIncentiveSource
  base: number // base sobre la que se calculó (venta atribuible / fondo)
  percentage?: number // fracción, si aplica
  amount: number // monto del incentivo
  ruleId?: string | null
  note?: string
}

export interface EmployeeLiquidationInput {
  employeeId: string
  employeeName: string
  branch?: string
  productUnits: number
  serviceIncentives: ServiceIncentiveDetail[] // desglose por origen
  bonusExtra?: number // positivo
  cleaningContribution?: number // positivo; se resta
}

export interface EmployeeLiquidation {
  employeeId: string
  employeeName: string
  branch?: string
  productUnits: number
  productIncentive: number
  serviceIncentive: number
  subtotal: number
  bonusExtra: number
  grossTotal: number
  cleaningContribution: number
  netTotal: number
  serviceBreakdown: ServiceIncentiveDetail[]
}

export interface MonthlyTotals {
  productIncentive: number
  serviceIncentive: number
  subtotal: number
  bonusExtra: number
  grossTotal: number
  cleaningContribution: number
  netTotal: number
}

export type ReconStatus = "cuadrado" | "advertencia" | "critico" | "sin_declarado"

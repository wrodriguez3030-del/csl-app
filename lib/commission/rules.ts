/**
 * Reglas de comisión: SEMILLA de valores por defecto (configurables/editables)
 * + resolución de la regla vigente por tipo/categoría/fecha efectiva. Ningún
 * valor está hardcodeado en la lógica de cálculo: todo entra como `CommissionRule`.
 */
import type { CommissionRule, RuleType } from "./types"

/**
 * Reglas iniciales sugeridas por la especificación (sección 9-13). Se usan
 * para SEMBRAR la tabla `sales_commission_rules` la primera vez; luego se
 * editan desde la UI. Cambiar una regla futura NO altera períodos ya calculados
 * (cada cálculo guarda su propio snapshot de reglas).
 */
export function defaultCommissionRules(businessId: string, effectiveFrom = "2000-01-01"): CommissionRule[] {
  let n = 0
  const mk = (r: Partial<CommissionRule> & { name: string; ruleType: RuleType }): CommissionRule => ({
    id: `seed-${businessId}-${++n}`,
    businessId,
    priority: 100,
    category: null,
    employeeId: null,
    branch: null,
    minAmount: null,
    maxAmount: null,
    percentage: null,
    fixedAmount: null,
    active: true,
    effectiveFrom,
    effectiveTo: null,
    ...r,
  })
  return [
    mk({ name: "Porcentaje sobre ventas con tarjeta", ruleType: "card_percentage", percentage: 0.27 }),
    mk({ name: "Incentivo por unidad de producto", ruleType: "product_unit_incentive", fixedAmount: 100 }),
    mk({ name: "Comisión Faciales", ruleType: "category_commission", category: "FACIALES", percentage: 0.2 }),
    mk({ name: "Comisión Hollywood / Aqua Peel", ruleType: "category_commission", category: "HOLLYWOOD_AQUA_PEEL", percentage: 0.1 }),
    mk({ name: "Comisión Tatuajes", ruleType: "category_commission", category: "TATUAJES", percentage: 0.1 }),
    mk({ name: "Comisión HIFU", ruleType: "category_commission", category: "HIFU", percentage: 0.1 }),
    mk({ name: "Comisión Masajes", ruleType: "category_commission", category: "MASAJES", percentage: 0.2 }),
    // Escala láser: un registro por tramo (minAmount = umbral).
    mk({ name: "Láser tramo 2%", ruleType: "laser_scale", minAmount: 260000, percentage: 0.02, priority: 1 }),
    mk({ name: "Láser tramo 3%", ruleType: "laser_scale", minAmount: 600000, percentage: 0.03, priority: 2 }),
    mk({ name: "Láser tramo 4%", ruleType: "laser_scale", minAmount: 800000, percentage: 0.04, priority: 3 }),
    mk({ name: "Láser tramo 5%", ruleType: "laser_scale", minAmount: 2000000, percentage: 0.05, priority: 4 }),
    mk({ name: "Aporte de limpieza", ruleType: "cleaning_contribution", fixedAmount: 400 }),
    // Reparto del fondo láser: por cantidad de personas + por pacientes (suman 100%).
    mk({ name: "Reparto láser: % por cantidad de personas", ruleType: "laser_weight_personas", percentage: 0.5 }),
    mk({ name: "Reparto láser: % por pacientes atendidos", ruleType: "laser_weight_pacientes", percentage: 0.5 }),
    // Banderas (fixedAmount 1 = Sí, 0 = No).
    mk({ name: "Láser: empleado con 0 pacientes recibe parte fija", ruleType: "laser_zero_patients_fixed", fixedAmount: 1 }),
    mk({ name: "Láser: descontar tarjeta antes de la escala", ruleType: "laser_card_discount_before_scale", fixedAmount: 1 }),
    // Modo de reparto: 1 = EQUITATIVO (cuadro oficial: cuota fondo/N a los de 0
    // pacientes y el resto por pacientes); 0 = PESOS (usa los % de arriba).
    mk({ name: "Láser: reparto equitativo por persona (modo cuadro)", ruleType: "laser_split_mode", fixedAmount: 1 }),
  ]
}

/** Reglas activas y vigentes en una fecha dada. */
export function rulesEffectiveOn(rules: CommissionRule[], onDateISO: string): CommissionRule[] {
  return rules.filter(
    (r) => r.active && r.effectiveFrom <= onDateISO && (!r.effectiveTo || r.effectiveTo >= onDateISO),
  )
}

/**
 * Regla ganadora de un tipo (y categoría opcional) para una fecha:
 * prefiere reglas específicas de empleado/sucursal, luego mayor prioridad,
 * luego `effectiveFrom` más reciente.
 */
export function resolveRule(
  rules: CommissionRule[],
  q: { ruleType: RuleType; category?: string; onDateISO: string; employeeId?: string; branch?: string },
): CommissionRule | undefined {
  const cands = rulesEffectiveOn(rules, q.onDateISO).filter(
    (r) =>
      r.ruleType === q.ruleType &&
      (q.category == null || (r.category ?? null) === q.category) &&
      (r.employeeId == null || r.employeeId === q.employeeId) &&
      (r.branch == null || r.branch === q.branch),
  )
  const spec = (r: CommissionRule) => (r.employeeId ? 2 : 0) + (r.branch ? 1 : 0)
  return cands.sort((a, b) => {
    if (spec(b) !== spec(a)) return spec(b) - spec(a)
    if (b.priority !== a.priority) return b.priority - a.priority
    return b.effectiveFrom.localeCompare(a.effectiveFrom)
  })[0]
}

/** Extrae la escala láser (umbral/porcentaje) ordenada, desde las reglas. */
export function laserScaleFromRules(
  rules: CommissionRule[],
  onDateISO: string,
): { threshold: number; percentage: number }[] {
  return rulesEffectiveOn(rules, onDateISO)
    .filter((r) => r.ruleType === "laser_scale" && r.minAmount != null && r.percentage != null)
    .map((r) => ({ threshold: Number(r.minAmount), percentage: Number(r.percentage) }))
    .sort((a, b) => a.threshold - b.threshold)
}

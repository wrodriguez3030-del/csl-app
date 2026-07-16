/**
 * Exclusiones de incentivo — FUENTE ÚNICA.
 *
 * Reglas de negocio (Cibao Spa Láser) sobre qué NO genera incentivo. Se usa
 * tanto en el motor de liquidación (`run-engine`) como en el reporte y en los
 * deltas de asignación manual, para que el MISMO criterio aplique en todos los
 * cálculos (lo que se paga y lo que se muestra).
 *
 * 1. Prestadores excluidos: personas que nunca cobran incentivo (p. ej.
 *    administradores locales), aunque tengan ventas asignadas manualmente.
 * 2. Ítems sin incentivo: insumos/consumibles que se le cobran al cliente pero
 *    no comisionan (rasuradoras, anestesia en cualquier presentación). Se
 *    comparan por nombre normalizado (sin acentos, MAYÚSCULAS) como subcadena.
 *
 * Las ventas excluidas SÍ siguen contando en la facturación/ingreso del negocio
 * (reporte por sucursal, medios de pago): la exclusión aplica solo al incentivo.
 */
import { normalizeName } from "./normalize"

/** Prestadores (nombre normalizado) que NUNCA cobran incentivo. */
export const EXCLUDED_PROVIDERS = ["CARLOS ARIAS"] as const

/** Patrones de nombre de ítem (servicio/producto) que NO generan incentivo. */
export const NON_INCENTIVE_ITEM_PATTERNS = ["RASURADORA", "ANESTESIA"] as const

/** ¿Este prestador está excluido de todo incentivo? */
export function isExcludedProvider(name: unknown): boolean {
  const n = normalizeName(name)
  if (!n) return false
  return EXCLUDED_PROVIDERS.some((p) => {
    const pN = normalizeName(p)
    return n === pN || n.includes(pN)
  })
}

/** ¿Este ítem (por su nombre) es un insumo que NO genera incentivo? */
export function isNonIncentiveItem(serviceName: unknown): boolean {
  const n = normalizeName(serviceName)
  if (!n) return false
  return NON_INCENTIVE_ITEM_PATTERNS.some((p) => n.includes(normalizeName(p)))
}

/**
 * Exclusiones de incentivo — FUENTE ÚNICA, POR TENANT.
 *
 * Qué NO genera incentivo. Se usa en el motor de liquidación (`run-engine`), en
 * el reporte y en los deltas de asignación manual, para que el MISMO criterio
 * aplique en todos los cálculos (lo que se paga y lo que se muestra).
 *
 * 1. Prestadores excluidos: personas que nunca cobran incentivo (p. ej.
 *    administradores locales), aunque tengan ventas asignadas manualmente.
 * 2. Ítems sin incentivo: insumos/servicios que se le cobran al cliente pero no
 *    comisionan (rasuradoras y el SERVICIO de "aplicación de anestesia"). Se
 *    comparan por nombre normalizado (sin acentos, MAYÚSCULAS) como subcadena.
 *    OJO: los PRODUCTOS anestésicos (ANESTESIA ENCAIN / ZK-INA) SÍ pagan
 *    incentivo — solo se excluye la aplicación (el servicio), no el producto.
 *
 * Las ventas excluidas SÍ siguen contando en la facturación/ingreso del negocio
 * (reporte por sucursal, medios de pago): la exclusión aplica solo al incentivo.
 *
 * ── NUNCA MEZCLAR TENANTS ───────────────────────────────────────────────────
 * Estas son reglas de NEGOCIO, no del sistema: "CARLOS ARIAS" y las rasuradoras
 * son decisiones de Cibao Spa Láser y no tienen por qué valer en Depicenter.
 * Por eso el slug del tenant es un parámetro OBLIGATORIO: `tsc --noEmit` falla
 * si un llamador lo olvida. Un slug desconocido NO cae a las reglas de CSL:
 * devuelve conjunto vacío.
 */
import { normalizeName } from "./normalize"

export interface TenantExclusions {
  /** Prestadores (nombre normalizado) que NUNCA cobran incentivo. */
  providers: readonly string[]
  /** Patrones de nombre de ítem (servicio/producto) que NO generan incentivo. */
  itemPatterns: readonly string[]
}

/**
 * Exclusiones por tenant. Tenant ausente = sin exclusiones (todo comisiona).
 *
 * `csl`: "APLICACION DE ANESTESIA" es el servicio de aplicación; NO incluye los
 * productos "ANESTESIA ENCAIN"/"ANESTESIA ZK-INA", que sí comisionan.
 *
 * `depicenter`: sin exclusiones. Verificado contra sus datos (julio 2026): no
 * tiene ninguna venta que coincida con las reglas de CSL, así que declararlo
 * vacío no cambia ningún cálculo — solo impide que las herede por accidente.
 */
export const EXCLUSIONS_BY_TENANT: Record<string, TenantExclusions> = {
  csl: {
    providers: ["CARLOS ARIAS"],
    itemPatterns: ["RASURADORA", "APLICACION DE ANESTESIA"],
  },
  depicenter: {
    providers: [],
    itemPatterns: [],
  },
}

const EMPTY: TenantExclusions = { providers: [], itemPatterns: [] }

/** Exclusiones del tenant. Slug desconocido → vacío (nunca hereda de otro). */
export function exclusionsForTenant(tenant: string): TenantExclusions {
  return EXCLUSIONS_BY_TENANT[String(tenant || "").trim().toLowerCase()] ?? EMPTY
}

/** ¿Este prestador está excluido de todo incentivo EN ESTE TENANT? */
export function isExcludedProvider(name: unknown, tenant: string): boolean {
  const n = normalizeName(name)
  if (!n) return false
  return exclusionsForTenant(tenant).providers.some((p) => {
    const pN = normalizeName(p)
    return n === pN || n.includes(pN)
  })
}

/** ¿Este ítem (por su nombre) es un insumo que NO genera incentivo EN ESTE TENANT? */
export function isNonIncentiveItem(serviceName: unknown, tenant: string): boolean {
  const n = normalizeName(serviceName)
  if (!n) return false
  return exclusionsForTenant(tenant).itemPatterns.some((p) => n.includes(normalizeName(p)))
}

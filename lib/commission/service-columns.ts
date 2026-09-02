/**
 * Abre la comisión de SERVICIOS de la liquidación en una columna por categoría.
 *
 * La pantalla mostraba «Inc. servicios» como un solo número que mezclaba las
 * comisiones por categoría, el fondo láser, el incentivo fijo y el ajuste
 * manual: no se veía de dónde salía. Aquí se decide qué columnas mostrar (solo
 * las categorías con importe en el período) y se indexa el desglose por
 * persona Y sucursal — la misma persona puede cobrar en dos sucursales.
 */

export interface ServiceDetailRow {
  provider: string
  branch: string
  category: string
  base?: number
  pct?: number
  amount?: number | string
}

/** Columnas fijas que completan el total de «servicios» de la liquidación. */
export const SERVICE_EXTRA_COLS = [
  { key: "laserIncentive", label: "Fondo láser" },
  { key: "fixedIncentive", label: "Fijo" },
  { key: "manualAdjustment", label: "Ajuste" },
] as const

export const cellKey = (provider: string, branch: string): string => `${provider}|${branch}`

/** Categorías con importe, de mayor a menor total. */
export function serviceColumns(rows: readonly ServiceDetailRow[]): string[] {
  const totals = rows.reduce<Record<string, number>>((acc, r) => {
    const amount = Number(r.amount) || 0
    return amount === 0 ? acc : { ...acc, [r.category]: (acc[r.category] || 0) + amount }
  }, {})
  return Object.keys(totals).sort((a, b) => totals[b] - totals[a])
}

/** Desglose por persona y sucursal: «NOMBRE|SUCURSAL» → { categoría: importe }. */
export function serviceCellsBy(rows: readonly ServiceDetailRow[]): Map<string, Record<string, number>> {
  return rows.reduce((acc, r) => {
    const amount = Number(r.amount) || 0
    if (amount === 0) return acc
    const k = cellKey(r.provider, r.branch)
    const prev = acc.get(k) || {}
    acc.set(k, { ...prev, [r.category]: Math.round(((prev[r.category] || 0) + amount) * 100) / 100 })
    return acc
  }, new Map<string, Record<string, number>>())
}

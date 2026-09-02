/**
 * Histórico anual de ventas — núcleo PURO.
 *
 * Dos fuentes:
 *   · REFERENCIA — `sales_history_monthly` (sembrada desde la hoja «Historico
 *     ventas» del Excel). Solo vale para los meses ANTERIORES a la primera
 *     venta real; a partir de ahí se ignora aunque el mes real esté en cero.
 *   · REAL — `sales_commission_sales` agrupada por mes.
 */

export interface RefMonth { year: number; month: number; total: number | string | null }
export interface RealMonth { key: string; total: number | string | null }
export interface HistoricoYear {
  year: number
  ventas: number
  /** % contra el año anterior; `null` si no hay año anterior con ventas. */
  crecimientoPct: number | null
  /** El año en curso aún no cerró (ancla antes de diciembre). */
  parcial: boolean
}

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100
const keyOf = (year: number, month: number): string => `${year}-${String(month).padStart(2, "0")}`

/** Crecimiento % con 1 decimal; sin base (prev ≤ 0) no hay crecimiento. */
export function growthPct(current: number, previous: number): number | null {
  const prev = Number(previous) || 0
  if (prev <= 0) return null
  return Math.round(((Number(current) || 0) - prev) / prev * 1000) / 10
}

/** Suma por año de una lista de meses («YYYY-MM» → total). Devuelve un objeto nuevo. */
export function yearlyTotals(rows: readonly { key: string; total: number }[]): Readonly<Record<number, number>> {
  return rows.reduce<Record<number, number>>((acc, r) => {
    const year = Number(r.key.slice(0, 4))
    if (!year) return acc
    return { ...acc, [year]: round2((acc[year] || 0) + (Number(r.total) || 0)) }
  }, {})
}

/**
 * Une referencia y real en totales anuales ascendentes. La referencia cuenta
 * solo si su mes es estrictamente anterior a `firstRealKey`; el real siempre.
 */
export function mergeHistorico(
  ref: readonly RefMonth[],
  real: readonly RealMonth[],
  firstRealKey: string,
  anchor: { anchorYear: number; anchorMonth: number },
): HistoricoYear[] {
  const refRows = ref
    .map((r) => ({ key: keyOf(r.year, r.month), total: Number(r.total) || 0 }))
    .filter((r) => !firstRealKey || r.key < firstRealKey)
  const realRows = real.map((r) => ({ key: r.key, total: Number(r.total) || 0 }))
  const totals = yearlyTotals([...refRows, ...realRows])
  const years = Object.keys(totals).map(Number).sort((a, b) => a - b)
  return years.map((year) => ({
    year,
    ventas: totals[year],
    crecimientoPct: totals[year - 1] != null ? growthPct(totals[year], totals[year - 1]) : null,
    parcial: year === anchor.anchorYear && anchor.anchorMonth < 12,
  }))
}

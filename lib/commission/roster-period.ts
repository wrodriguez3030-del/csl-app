/**
 * Roster POR PERÍODO — lógica pura.
 *
 * El roster guardaba `start_date` / `end_date` pero nadie los miraba: el cálculo
 * usaba siempre la foto de HOY. Con eso, recalcular un mes viejo aplicaba el
 * personal actual — y desde que el cálculo se corre solo al importar, eso pasaba
 * sin que nadie lo pidiera. Aquí se decide quién estaba en la sucursal en el mes
 * que se está calculando.
 *
 * El mes cuenta ENTERO: quien entra el 15 de septiembre cuenta en septiembre, y
 * quien se va el 10 de agosto cuenta en agosto. Es como se paga el incentivo,
 * que es mensual. Sin fechas, la persona cuenta siempre (comportamiento previo).
 */

export interface RosterPeriod { year: number; month: number }
export interface RosterDates { startDate?: string | null; endDate?: string | null }

const monthKey = (year: number, month: number): string => `${year}-${String(month).padStart(2, "0")}`

/** «2026-09-01» → «2026-09»; `null` si no es una fecha utilizable. */
function monthOf(iso: unknown): string | null {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})/)
  if (!m) return null
  const month = Number(m[2])
  return month >= 1 && month <= 12 ? `${m[1]}-${m[2]}` : null
}

/** ¿Esta persona estaba en la sucursal durante el período? */
export function activeInPeriod(dates: RosterDates, period: RosterPeriod | null | undefined): boolean {
  if (!period) return true
  const key = monthKey(period.year, period.month)
  const start = monthOf(dates.startDate)
  const end = monthOf(dates.endDate)
  if (start && key < start) return false
  if (end && key > end) return false
  return true
}

/** Deja solo a quienes estaban en el período. Devuelve una lista nueva. */
export function filterRosterForPeriod<T extends RosterDates>(roster: readonly T[], period: RosterPeriod | null | undefined): T[] {
  return roster.filter((r) => activeInPeriod(r, period))
}

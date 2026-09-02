/**
 * Ventana de meses para las series del BI (tendencia y flujo mensual).
 * Lógica PURA: sin base de datos ni React.
 */
import { lastMonths } from "@/lib/commission/period"

const MESES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const

export interface MonthPoint {
  year: number
  month: number
  /** «YYYY-MM» — clave para agrupar por mes. */
  key: string
  /** «ene 2026» — etiqueta larga (la que ya usaba la tendencia de 6 meses). */
  label: string
  /** «Ene» / «Ene 26» — etiqueta corta para ejes de 12 puntos: el año solo se
   *  escribe donde cambia (enero) y en el primer punto. */
  short: string
}

export const monthKey = (year: number, month: number): string => `${year}-${String(month).padStart(2, "0")}`

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Los `count` meses que terminan en (`anchorYear`, `anchorMonth`), del más viejo
 * al más nuevo, con las etiquetas listas para pintar.
 */
export function trailingMonths(anchorYear: number, anchorMonth: number, count: number): MonthPoint[] {
  return lastMonths(anchorYear, anchorMonth, count).map(({ year, month }, i) => {
    const corto = capitalize(MESES_CORTO[month - 1] || "")
    return {
      year, month,
      key: monthKey(year, month),
      label: `${MESES_CORTO[month - 1] || ""} ${year}`,
      short: i === 0 || month === 1 ? `${corto} ${String(year).slice(2)}` : corto,
    }
  })
}

/**
 * Helpers PUROS de período para Comisión de Ventas (testeables).
 * Zona horaria del negocio: America/Santo_Domingo — "hoy" se calcula en esa TZ
 * para que una venta del día 31 a las 8pm no caiga en el mes siguiente por UTC.
 * Rangos SIEMPRE inclusivos: [from, to] con `to` incluido (el backend consulta
 * con `< to + 1 día`).
 */

export const BUSINESS_TZ = "America/Santo_Domingo"

export type QuickPeriod =
  | "todo" | "hoy" | "semana" | "mes_actual" | "mes_anterior" | "ultimos_30"
  | "trimestre" | "ano_actual" | "personalizado"

export const QUICK_OPTIONS: { id: QuickPeriod; label: string }[] = [
  { id: "todo", label: "Todo (todos los meses)" },
  { id: "hoy", label: "Hoy" },
  { id: "semana", label: "Esta semana" },
  { id: "mes_actual", label: "Mes actual" },
  { id: "mes_anterior", label: "Mes anterior" },
  { id: "ultimos_30", label: "Últimos 30 días" },
  { id: "trimestre", label: "Trimestre actual" },
  { id: "ano_actual", label: "Año actual" },
  { id: "personalizado", label: "Personalizado" },
]

export interface PeriodRange {
  from: string // ISO YYYY-MM-DD (inclusivo)
  to: string   // ISO YYYY-MM-DD (inclusivo)
  year: number
  month: number // mes representativo (del `from`)
}

/** Fecha "hoy" (ISO) en la zona horaria del negocio. */
export function todayInTz(now: Date = new Date(), tz: string = BUSINESS_TZ): string {
  return now.toLocaleDateString("en-CA", { timeZone: tz })
}

const pad = (n: number) => String(n).padStart(2, "0")

/** Último día del mes (maneja febrero/bisiestos). */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Límites inclusivos de un mes. */
export function monthBounds(year: number, month: number): PeriodRange {
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(lastDayOfMonth(year, month))}`, year, month }
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

/** Límite EXCLUSIVO para queries: día siguiente a `to` (incluye todo el día 31). */
export function exclusiveEnd(toISO: string): string {
  return addDaysISO(toISO, 1)
}

/** Rango de un período rápido, calculado en la TZ del negocio. */
export function quickRange(quick: QuickPeriod, now: Date = new Date(), tz: string = BUSINESS_TZ): PeriodRange {
  const today = todayInTz(now, tz)
  const [y, m, d] = today.split("-").map(Number)
  switch (quick) {
    case "todo":
      // Sin restricción de fechas: el backend no aplica filtro de período.
      return { from: "", to: "", year: y, month: m }
    case "hoy":
      return { from: today, to: today, year: y, month: m }
    case "semana": {
      // Lunes a domingo de la semana actual.
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7 // 1=lunes … 7=domingo
      const from = addDaysISO(today, -(dow - 1))
      return { from, to: addDaysISO(from, 6), year: y, month: m }
    }
    case "mes_actual":
      return monthBounds(y, m)
    case "mes_anterior": {
      const py = m === 1 ? y - 1 : y
      const pm = m === 1 ? 12 : m - 1
      return monthBounds(py, pm)
    }
    case "ultimos_30":
      return { from: addDaysISO(today, -29), to: today, year: y, month: m }
    case "trimestre": {
      const qStart = m - ((m - 1) % 3)
      const qEnd = qStart + 2
      return { from: `${y}-${pad(qStart)}-01`, to: `${y}-${pad(qEnd)}-${pad(lastDayOfMonth(y, qEnd))}`, year: y, month: qStart }
    }
    case "ano_actual":
      return { from: `${y}-01-01`, to: `${y}-12-31`, year: y, month: 1 }
    case "personalizado":
    default:
      return monthBounds(y, m)
  }
}

/** Meses "YYYY-M" (sin cero) cubiertos por un rango inclusivo — para filtrar
 *  cálculos/conteos almacenados por period_month/period_year. */
export function monthsCovered(fromISO: string, toISO: string): Set<string> {
  const out = new Set<string>()
  if (!fromISO || !toISO) return out
  let [y, m] = fromISO.split("-").map(Number)
  const [ty, tm] = toISO.split("-").map(Number)
  let guard = 0
  while ((y < ty || (y === ty && m <= tm)) && guard++ < 240) {
    out.add(`${y}-${m}`)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

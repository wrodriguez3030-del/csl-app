/**
 * Cálculo central de horas trabajadas semanales a partir del horario del
 * empleado (hr_employee_schedule_days). Reutilizado por la tarjeta de empleado
 * y el modal de horario para evitar drift.
 *
 * Regla por día: horas = salida − entrada − almuerzo. El almuerzo es el real
 * almacenado en el día (ventana lunch_start/lunch_end, o break_minutes), de
 * modo que un turno corrido (p.ej. entrada 12:30 PM, sin almuerzo) cuenta sus
 * horas completas. Día libre = 0. Soporta cruce de medianoche.
 */

export const WEEKLY_HOURS_LIMIT = 44

export interface ScheduleDay {
  day_of_week: number
  is_working_day: boolean
  start_time?: string | null
  end_time?: string | null
  break_minutes?: number | null
  lunch_start?: string | null
  lunch_end?: string | null
}

export interface WeeklyWorkResult {
  totalHours: number
  dailyHours: number[]        // índice = day_of_week (0=Dom … 6=Sáb)
  hasSchedule: boolean
  exceeds44: boolean
  status: "ok" | "over" | "none"
}

function toMin(t: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ""))
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** Minutos de almuerzo del día: ventana inicio/fin si existe, si no break_minutes. */
export function lunchMinutes(d: ScheduleDay): number {
  const ls = toMin(d.lunch_start), le = toMin(d.lunch_end)
  if (ls != null && le != null && le > ls) return le - ls
  return Number(d.break_minutes) || 0
}

/** Horas netas trabajadas de un día (salida − entrada − almuerzo). */
export function dayWorkedHours(d: ScheduleDay): number {
  if (!d.is_working_day) return 0
  const s = toMin(d.start_time), e = toMin(d.end_time)
  if (s == null || e == null) return 0
  let mins = e - s
  if (mins <= 0) mins += 24 * 60 // cruce de medianoche
  return Math.max(0, (mins - lunchMinutes(d)) / 60)
}

/**
 * Suma semanal de horas trabajadas. `days` puede venir vacío/null cuando el
 * empleado no tiene horario asignado → hasSchedule=false (no es 0 h "válido").
 */
export function calculateWeeklyWorkedHours(days: ScheduleDay[] | null | undefined): WeeklyWorkResult {
  const list = Array.isArray(days) ? days : []
  const hasSchedule = list.length > 0
  const dailyHours = [0, 0, 0, 0, 0, 0, 0]
  let total = 0
  for (const d of list) {
    const dow = Number(d.day_of_week)
    const h = dayWorkedHours(d)
    if (dow >= 0 && dow <= 6) dailyHours[dow] = h
    total += h
  }
  const totalHours = Math.round(total * 100) / 100
  const exceeds44 = hasSchedule && totalHours > WEEKLY_HOURS_LIMIT
  return {
    totalHours,
    dailyHours,
    hasSchedule,
    exceeds44,
    status: !hasSchedule ? "none" : exceeds44 ? "over" : "ok",
  }
}

/** Formato de horas: máx. 1 decimal, sin ceros sobrantes ("44", "46.5"). */
export function fmtHours(n: number): string {
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

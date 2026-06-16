/**
 * Cálculo central de horas trabajadas a partir del horario del empleado.
 * Reutilizado por la tarjeta de empleado, el modal de horario, el ponche y la
 * asistencia para evitar drift.
 *
 * REGLA OFICIAL ÚNICA: el almuerzo es SIEMPRE 60 minutos (1 hora) por cada día
 * trabajado. Día libre = 0 (sin almuerzo). No es variable ni se lee de la BD:
 * `DEFAULT_LUNCH_MINUTES` es la única fuente de verdad.
 *
 *   Horas brutas = salida − entrada
 *   Horas netas  = horas brutas − 1 h de almuerzo
 *   Descansos semanales = (días trabajados) × 1 h
 */

export const DEFAULT_LUNCH_MINUTES = 60
/** Alias semántico de la constante de almuerzo. */
export const LUNCH_MINUTES = DEFAULT_LUNCH_MINUTES
export const WEEKLY_HOURS_LIMIT = 44

/**
 * Turnos CORRIDOS (sin hora de almuerzo): el personal que ENTRA a estas horas
 * trabaja seguido y no se le descuenta almuerzo. Regla oficial del negocio.
 * Hoy: solo entrada 12:30 PM. (Si en el futuro se suman 1:00/1:30 PM, agregar
 * aquí "13:00"/"13:30" — es el único punto a tocar.)
 */
export const NO_LUNCH_START_TIMES: string[] = ["12:30"]

/** Minutos de almuerzo que aplican a un turno según su hora de ENTRADA. */
export function lunchMinutesForShift(startTime: string | null | undefined, isDayOff = false): number {
  if (isDayOff) return 0
  const m = /^(\d{1,2}):(\d{2})/.exec(String(startTime ?? ""))
  const hm = m ? `${m[1].padStart(2, "0")}:${m[2]}` : ""
  return NO_LUNCH_START_TIMES.includes(hm) ? 0 : DEFAULT_LUNCH_MINUTES
}

export interface ScheduleDay {
  day_of_week: number
  is_working_day: boolean
  start_time?: string | null
  end_time?: string | null
  break_minutes?: number | null
  lunch_start?: string | null
  lunch_end?: string | null
}

export interface DailyWorkResult {
  grossHours: number
  lunchMinutes: number
  lunchHours: number
  netHours: number
}

export interface WeeklyWorkResult {
  totalHours: number          // horas netas semanales
  grossHours: number          // horas brutas semanales
  restHours: number           // descansos = díasTrabajados × 1 h
  workedDays: number
  freeDays: number
  avgHours: number            // promedio neto por día trabajado
  dailyHours: number[]        // netas por día (índice = day_of_week, 0=Dom … 6=Sáb)
  hasSchedule: boolean
  exceeds44: boolean
  status: "ok" | "over" | "none"
}

function toMin(t: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ""))
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/**
 * Horas trabajadas de un día. Almuerzo fijo 60 min si es día trabajado; 0 si
 * es día libre. Soporta cruce de medianoche. Fuente única de la regla.
 */
export function calculateDailyWorkedHours(input: {
  startTime?: string | null
  endTime?: string | null
  isDayOff?: boolean
}): DailyWorkResult {
  if (input.isDayOff) return { grossHours: 0, lunchMinutes: 0, lunchHours: 0, netHours: 0 }
  const s = toMin(input.startTime), e = toMin(input.endTime)
  if (s == null || e == null) return { grossHours: 0, lunchMinutes: 0, lunchHours: 0, netHours: 0 }
  let mins = e - s
  if (mins <= 0) mins += 24 * 60 // cruce de medianoche
  const grossHours = mins / 60
  // Almuerzo 60 min, salvo turno corrido (entrada 12:30 → sin almuerzo).
  const lunchMin = lunchMinutesForShift(input.startTime, false)
  const netHours = Math.max(0, grossHours - lunchMin / 60)
  return { grossHours, lunchMinutes: lunchMin, lunchHours: lunchMin / 60, netHours }
}

/** Horas netas trabajadas de un día del horario (compatibilidad). */
export function dayWorkedHours(d: ScheduleDay): number {
  return calculateDailyWorkedHours({ startTime: d.start_time, endTime: d.end_time, isDayOff: !d.is_working_day }).netHours
}

/**
 * Suma semanal. `days` vacío/null → hasSchedule=false (no es 0 h "válido").
 * Descansos = díasTrabajados × 1 h (almuerzo fijo de 60 min).
 */
export function calculateWeeklyWorkedHours(days: ScheduleDay[] | null | undefined): WeeklyWorkResult {
  const list = Array.isArray(days) ? days : []
  const hasSchedule = list.length > 0
  const dailyHours = [0, 0, 0, 0, 0, 0, 0]
  let net = 0, gross = 0, lunch = 0, workedDays = 0
  for (const d of list) {
    if (!d.is_working_day) continue
    const r = calculateDailyWorkedHours({ startTime: d.start_time, endTime: d.end_time, isDayOff: false })
    const dow = Number(d.day_of_week)
    if (dow >= 0 && dow <= 6) dailyHours[dow] = r.netHours
    net += r.netHours
    gross += r.grossHours
    lunch += r.lunchHours
    workedDays++
  }
  const totalHours = Math.round(net * 100) / 100
  const grossHours = Math.round(gross * 100) / 100
  const restHours = Math.round(lunch * 100) / 100
  const exceeds44 = hasSchedule && totalHours > WEEKLY_HOURS_LIMIT
  return {
    totalHours,
    grossHours,
    restHours,
    workedDays,
    freeDays: hasSchedule ? Math.max(0, 7 - workedDays) : 0,
    avgHours: workedDays > 0 ? totalHours / workedDays : 0,
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

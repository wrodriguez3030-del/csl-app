/**
 * Semana operativa del negocio: LUNES a SÁBADO (Cibao no opera domingo).
 *
 * getOperationalWeek("2026-05-20")
 *   → { period_start: "2026-05-18", period_end: "2026-05-23", ... }
 *
 * Reglas:
 *   - Lunes → sábado: cae en SU MISMA semana
 *   - Domingo: cae en la SEMANA SIGUIENTE (lunes del día +1)
 *     · Decisión: si un domingo trae datos por error, se asigna al lunes
 *       que arranca al día siguiente. Esto evita perder datos.
 *
 * Las funciones aceptan ISO "YYYY-MM-DD" o Date.
 */

const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

const MONTHS_ES_SHORT = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
]

export interface OperationalWeek {
  /** Lunes en ISO YYYY-MM-DD. */
  period_start: string
  /** Sábado en ISO YYYY-MM-DD. */
  period_end: string
  /** Etiqueta legible: "18 may 2026 — 23 may 2026". */
  period_label: string
  /** Etiqueta corta: "18 may - 23 may". */
  period_label_short: string
}

function toDate(input: string | Date): Date {
  if (input instanceof Date) return new Date(input.getFullYear(), input.getMonth(), input.getDate())
  const s = String(input).slice(0, 10)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return new Date(NaN)
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function toIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function formatPretty(start: Date, end: Date): string {
  const s = `${start.getDate().toString().padStart(2, "0")} ${MONTHS_ES_SHORT[start.getMonth()]} ${start.getFullYear()}`
  const e = `${end.getDate().toString().padStart(2, "0")} ${MONTHS_ES_SHORT[end.getMonth()]} ${end.getFullYear()}`
  return `${s} — ${e}`
}

function formatShort(start: Date, end: Date): string {
  const s = `${start.getDate().toString().padStart(2, "0")} ${MONTHS_ES_SHORT[start.getMonth()]}`
  const e = `${end.getDate().toString().padStart(2, "0")} ${MONTHS_ES_SHORT[end.getMonth()]}`
  return `${s} - ${e}`
}

/**
 * Devuelve el lunes de la semana operativa que contiene la fecha dada.
 * Domingo cae en la semana SIGUIENTE (al lunes de mañana).
 */
function getMonday(d: Date): Date {
  const dow = d.getDay() // 0=Dom, 1=Lun, ..., 6=Sab
  const result = new Date(d)
  if (dow === 0) {
    // Domingo: lunes del día siguiente
    result.setDate(result.getDate() + 1)
  } else {
    // Lunes-Sábado: lunes de esta semana
    result.setDate(result.getDate() - (dow - 1))
  }
  return result
}

/**
 * Para una fecha ISO o Date, devuelve la semana operativa (lunes-sábado) en
 * que cae. Si la fecha es inválida, retorna null.
 */
export function getOperationalWeek(input: string | Date): OperationalWeek | null {
  const d = toDate(input)
  if (isNaN(d.getTime())) return null
  const monday = getMonday(d)
  const saturday = new Date(monday)
  saturday.setDate(saturday.getDate() + 5)
  return {
    period_start: toIso(monday),
    period_end: toIso(saturday),
    period_label: formatPretty(monday, saturday),
    period_label_short: formatShort(monday, saturday),
  }
}

/**
 * Para un rango [start, end], devuelve todas las semanas operativas que lo
 * cubren. Útil para previsualizar el AgendaPro grande antes de bucketear.
 */
export function listOperationalWeeksInRange(
  start: string | Date,
  end: string | Date,
): OperationalWeek[] {
  const s = toDate(start)
  const e = toDate(end)
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return []
  const out: OperationalWeek[] = []
  const seen = new Set<string>()
  // Avanzar día a día, generando la semana de cada uno (Set evita duplicados).
  const cursor = new Date(s)
  while (cursor <= e) {
    const w = getOperationalWeek(cursor)
    if (w && !seen.has(w.period_start)) {
      seen.add(w.period_start)
      out.push(w)
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

/**
 * Inicio (lunes ISO) de la semana operativa que contiene la fecha. Función
 * COMPARTIDA para que Auditoría/IA y Registro de servicios agrupen por la misma
 * semana (lunes-sábado). Si la fecha es inválida, devuelve el string original.
 */
export function operationalWeekStart(input: string | Date): string {
  const w = getOperationalWeek(input)
  if (w) return w.period_start
  return typeof input === "string" ? input : ""
}

/**
 * Etiqueta "Del DD mmm al DD mmm de YYYY" de la semana operativa (lunes-sábado)
 * que contiene la fecha. Fuente ÚNICA del rótulo de semana en PulseControl, para
 * que Auditoría/IA y Registro de servicios muestren EXACTAMENTE el mismo rango.
 */
export function operationalWeekRangeLabel(input: string | Date): string {
  const w = getOperationalWeek(input)
  if (!w) return typeof input === "string" ? input : ""
  const s = toDate(w.period_start)
  const e = toDate(w.period_end)
  const fs = `${s.getDate().toString().padStart(2, "0")} ${MONTHS_ES_SHORT[s.getMonth()]}`
  const fe = `${e.getDate().toString().padStart(2, "0")} ${MONTHS_ES_SHORT[e.getMonth()]} de ${e.getFullYear()}`
  return `Del ${fs} al ${fe}`
}

/** Helper: formato bonito de ISO date para UI. */
export function formatIsoDateEs(iso: string): string {
  const d = toDate(iso)
  if (isNaN(d.getTime())) return iso
  return `${d.getDate().toString().padStart(2, "0")} ${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`
}

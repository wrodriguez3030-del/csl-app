/** Meses en español para los libros de incentivos (hojas ENERO…DICIEMBRE). */

export const MESES_ES = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
] as const

const stripAccents = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "")

/**
 * «ENERO», «ene», « Sept », «DIC» → 1…12 por las tres primeras letras; `null`
 * si no es un mes. Tolera acentos, espacios y mayúsculas/minúsculas.
 */
export function monthFromLabel(v: unknown): number | null {
  const s = stripAccents(String(v ?? "").trim().toUpperCase())
  if (s.length < 3) return null
  const idx = MESES_ES.findIndex((m) => m.slice(0, 3) === s.slice(0, 3))
  return idx >= 0 ? idx + 1 : null
}

/** «Enero 2026». */
export function monthLabel(month: number, year: number): string {
  const m = MESES_ES[month - 1] || ""
  return `${m.charAt(0)}${m.slice(1).toLowerCase()} ${year}`.trim()
}

export const firstDayISO = (year: number, month: number): string => `${year}-${String(month).padStart(2, "0")}-01`
export const yearMonthKey = (year: number, month: number): string => `${year}-${String(month).padStart(2, "0")}`

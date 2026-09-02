/**
 * Lectura tolerante de celdas ExcelJS (compartida por los importadores).
 *
 * ExcelJS entrega valores «envueltos»: fechas como `Date`, fórmulas como
 * `{ formula, result }`, hipervínculos como `{ text }`, texto enriquecido como
 * `{ richText: [...] }`. Una fórmula compartida SIN resultado calculado
 * (`{ sharedFormula }`) se trata como celda vacía: el libro no guardó el valor.
 */

export interface CellLike { value: unknown }
export interface WorksheetLike {
  name: string
  rowCount: number
  getCell: (address: string) => CellLike
}
export interface WorkbookLike {
  worksheets: WorksheetLike[]
  getWorksheet: (name: string) => WorksheetLike | undefined
}

/** Desenvuelve el valor de una celda a un primitivo (o `null` si no hay valor). */
export function flat(v: unknown): unknown {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString()
  if (typeof v === "object") {
    const o = v as Record<string, unknown>
    if (o.result !== undefined && o.result !== null) return flat(o.result)
    if (o.text !== undefined) return o.text
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join("")
    if (o.error !== undefined) return null
    return null // fórmula sin resultado, objeto desconocido
  }
  return v
}

/** «AA» → 27. */
export function colIndex(letters: string): number {
  return letters.toUpperCase().split("").reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0)
}

/** 27 → «AA». */
export function colLetters(index: number): string {
  let n = index, out = ""
  while (n > 0) { const m = (n - 1) % 26; out = String.fromCharCode(65 + m) + out; n = Math.floor((n - 1) / 26) }
  return out
}

export function cellRaw(ws: WorksheetLike, address: string): unknown {
  try { return flat(ws.getCell(address).value) } catch { return null }
}

export function cellStr(ws: WorksheetLike, address: string): string {
  const v = cellRaw(ws, address)
  return v == null ? "" : String(v).trim()
}

/** Número o `null` si la celda está vacía / sin valor calculado. Acepta «RD$3,849.85». */
export function cellNum(ws: WorksheetLike, address: string): number | null {
  const v = cellRaw(ws, address)
  if (v == null || v === "") return null
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  const s = String(v).replace(/[^\d.,-]/g, "")
  if (!s || !/\d/.test(s)) return null
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".")
  const dec = lastComma > lastDot ? "," : "."
  const norm = s.split(dec === "," ? "." : ",").join("").replace(",", ".")
  const n = parseFloat(norm)
  return Number.isFinite(n) ? n : null
}

/** ¿El monto vino como TEXTO («RD$3,849.85»)? Excel no lo suma en sus totales. */
export function isTextAmount(v: unknown): boolean {
  const f = flat(v)
  return typeof f === "string" && /\d/.test(f)
}

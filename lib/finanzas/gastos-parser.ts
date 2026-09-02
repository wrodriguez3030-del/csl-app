/**
 * Parser PURO del libro de gastos por sucursal (`reportes de incentivo YYYY.xlsx`).
 *
 * Cada hoja mensual (ENERO…DICIEMBRE) lleva cuatro bloques lado a lado con
 * columnas `NO. | FECHA | GASTOS (concepto) | MONTO | RET. CTA`, filas 5–124:
 *   R VIDAL (W..AA) · LOS JARDINES (AC..AG) · NACO (AI..AM) · VILLA OLGA (AO..AS)
 * El rótulo del bloque va en la fila 3 (AE3/AK3/AQ3; R VIDAL no lo lleva) y el
 * RESUMEN por sucursal en Y129..Z132 (fallback: la celda SUM de la fila 125).
 *
 * Reglas que vienen del propio Excel (verificadas contra el libro real):
 *   · Los montos escritos como TEXTO («RD$3,849.85») NO entran en el SUM de
 *     Excel: se importan igual, pero la conciliación se hace con la suma numérica.
 *   · «NACO» no es sucursal: se omite, SALVO que sus filas lleven sufijo de
 *     sucursal (`R-1`/`J-1`/`V-1`) por mayoría — en JULIO ese bloque trae las
 *     filas de Villa Olga y el RESUMEN las cuenta como Villa Olga.
 *   · Sin fecha válida → día 1 del mes de la hoja (con aviso).
 */
import { cellRaw, cellStr, cellNum, isTextAmount, type WorkbookLike, type WorksheetLike } from "@/lib/commission/xlsx-cell"
import { parseMoney, parseDateISO, normalizeName } from "@/lib/commission/normalize"
import { fnvHex } from "@/lib/commission/hash"
import { normalizeSucursal, sucursalesForTenant } from "@/lib/normalize-pulse"
import { monthFromLabel, firstDayISO, yearMonthKey } from "./meses"
import { lastDayOfMonth } from "@/lib/commission/period"
import { inferCategoria } from "./gasto-categorias"

export const ROW_FIRST = 5
export const ROW_LAST = 124
export const RESUMEN_ROWS = [129, 130, 131, 132] as const

export const BLOQUES = [
  { key: "RV", label: "R VIDAL", cols: { no: "W", fecha: "X", concepto: "Y", monto: "Z", cta: "AA" }, ctrl125: "Z125" },
  { key: "JA", label: "LOS JARDINES", cols: { no: "AC", fecha: "AD", concepto: "AE", monto: "AF", cta: "AG" }, ctrl125: "AF125" },
  { key: "NA", label: "NACO", cols: { no: "AI", fecha: "AJ", concepto: "AK", monto: "AL", cta: "AM" }, ctrl125: "AL125" },
  { key: "VO", label: "VILLA OLGA", cols: { no: "AO", fecha: "AP", concepto: "AQ", monto: "AR", cta: "AS" }, ctrl125: "AR125" },
] as const
export type BlockKey = (typeof BLOQUES)[number]["key"]

const SUFFIX_BRANCH: Readonly<Record<string, string>> = { R: "RAFAEL VIDAL", J: "LOS JARDINES", V: "VILLA OLGA" }
const SUFFIX_MAJORITY = 0.8

export interface GastoRow {
  sheet: string; excelRow: number; blockKey: BlockKey
  no: string; date: string; branch: string; concept: string
  amount: number; amountWasText: boolean; account: string | null; category: string
  suffixBranch: string | null; rowHash: string
}
export interface BlockSummary {
  sheet: string; blockKey: BlockKey; blockLabel: string; branch: string | null
  rows: number; numericTotal: number; textTotal: number; skippedZero: number; reason: "label" | "suffix" | "skip"
}
export interface BranchControl {
  sheet: string; branch: string; rows: number; numericTotal: number; textTotal: number
  control: number | null; controlSource: "resumen" | "fila125" | null
}
export interface SheetResult {
  sheet: string; month: number; rows: GastoRow[]; blocks: BlockSummary[]; controls: BranchControl[]; warnings: string[]; empty: boolean
}
export interface GastosParseResult {
  sheets: SheetResult[]; rows: GastoRow[]; year: number | null; yearSource: "ledger" | "filename" | null
  periods: string[]; minDate: string; maxDate: string
  totalsByBranch: Readonly<Record<string, { rows: number; total: number }>>
  warnings: string[]; errors: string[]
}

interface RawRow { excelRow: number; no: string; dateISO: string; concept: string; amountRaw: unknown; cta: string }
interface RawBlock { block: (typeof BLOQUES)[number]; label: string; rows: RawRow[]; skippedZero: number }

const round2 = (n: number): number => Math.round(n * 100) / 100
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

/** Sufijo de sucursal en el concepto: «… R-1», «… J-1», «… V-1» o un « R» final. */
export function detectSuffix(concept: string): string | null {
  const s = String(concept || "").toUpperCase()
  const m = s.match(/\b([RJV])\s*-\s*\d\b/) || s.match(/\s([RJV])\s*$/)
  return m ? SUFFIX_BRANCH[m[1]] || null : null
}

/** Sucursal de un bloque: por rótulo si es una sucursal del tenant; si no (NACO), por mayoría de sufijo. */
export function resolveBlockBranch(label: string, suffixes: readonly (string | null)[], slug = "csl"): { branch: string | null; reason: "label" | "suffix" | "skip" } {
  const canon = normalizeSucursal(label)
  const allowed = sucursalesForTenant(slug)
  if (canon && allowed.includes(canon)) return { branch: canon, reason: "label" }
  const present = suffixes.filter((s): s is string => Boolean(s))
  if (present.length && suffixes.length && present.length / suffixes.length >= SUFFIX_MAJORITY) {
    const counts = present.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s]: (acc[s] || 0) + 1 }), {})
    const [top, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
    if (n / present.length >= SUFFIX_MAJORITY && allowed.includes(top)) return { branch: top, reason: "suffix" }
  }
  return { branch: null, reason: "skip" }
}

/** Clave estable de la fila (sin `NO.`, que cambia entre exportaciones). */
export function gastoRowHash(r: { date: string; branch: string; concept: string; amount: number }, occurrence = 1): string {
  const base = fnvHex(["EXP", r.date, r.branch, normalizeName(r.concept), r.amount.toFixed(2)].join("|"))
  return occurrence > 1 ? fnvHex(`${base}#${occurrence}`) : base
}

function readBlock(ws: WorksheetLike, block: (typeof BLOQUES)[number]): RawBlock {
  const label = cellStr(ws, `${block.cols.concepto}3`) || block.label
  const rows: RawRow[] = []
  let skippedZero = 0
  for (let r = ROW_FIRST; r <= ROW_LAST; r++) {
    const concept = cellStr(ws, `${block.cols.concepto}${r}`)
    const amountRaw = cellRaw(ws, `${block.cols.monto}${r}`)
    if (!concept && (amountRaw == null || amountRaw === "")) continue
    if (parseMoney(amountRaw) <= 0) { skippedZero++; continue }
    rows.push({
      excelRow: r, no: cellStr(ws, `${block.cols.no}${r}`), dateISO: parseDateISO(cellRaw(ws, `${block.cols.fecha}${r}`)),
      concept, amountRaw, cta: cellStr(ws, `${block.cols.cta}${r}`),
    })
  }
  return { block, label, rows, skippedZero }
}

function readControls(ws: WorksheetLike, slug: string): Record<string, { value: number; source: "resumen" | "fila125" }> {
  const byResumen = RESUMEN_ROWS.reduce<Record<string, { value: number; source: "resumen" | "fila125" }>>((acc, r) => {
    const branch = normalizeSucursal(cellStr(ws, `Y${r}`))
    const value = cellNum(ws, `Z${r}`)
    return branch && value != null && sucursalesForTenant(slug).includes(branch) ? { ...acc, [branch]: { value, source: "resumen" } } : acc
  }, {})
  return BLOQUES.reduce((acc, b) => {
    const branch = normalizeSucursal(b.label)
    const value = cellNum(ws, b.ctrl125)
    return acc[branch] || value == null || !sucursalesForTenant(slug).includes(branch) ? acc : { ...acc, [branch]: { value, source: "fila125" as const } }
  }, byResumen)
}

function modeYear(blocks: readonly RawBlock[]): number | null {
  const counts = blocks.flatMap((b) => b.rows).map((r) => Number(r.dateISO.slice(0, 4))).filter((y) => y > 2000)
    .reduce<Record<number, number>>((acc, y) => ({ ...acc, [y]: (acc[y] || 0) + 1 }), {})
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return top ? Number(top[0]) : null
}

function toGastoRows(sheet: string, month: number, year: number, rb: RawBlock, branch: string, blockReason: string, warnings: string[]): GastoRow[] {
  return rb.rows.map((r) => {
    const suffixBranch = detectSuffix(r.concept)
    if (blockReason === "label" && suffixBranch && suffixBranch !== branch) warnings.push(`${sheet} fila ${r.excelRow}: el concepto dice ${suffixBranch} dentro del bloque ${branch} («${r.concept.slice(0, 40)}»)`)
    // La HOJA manda sobre el mes: el Excel suma la fila en el total de ESA hoja,
    // así que una fecha de otro mes es un error de tecleo. Se conserva el día.
    let date = r.dateISO
    if (!date) { date = firstDayISO(year, month); warnings.push(`${sheet} fila ${r.excelRow}: sin fecha válida, se usa ${date}`) }
    else if (date.slice(0, 7) !== yearMonthKey(year, month)) {
      const day = Math.min(Number(date.slice(8, 10)) || 1, lastDayOfMonth(year, month))
      const fixed = `${yearMonthKey(year, month)}-${String(day).padStart(2, "0")}`
      warnings.push(`${sheet} fila ${r.excelRow}: la fecha dice ${date} pero está en la hoja ${sheet}; se corrige a ${fixed}`)
      date = fixed
    }
    const amount = round2(parseMoney(r.amountRaw))
    const account = /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .]{1,}$/i.test(r.cta) ? r.cta.toUpperCase() : null
    return {
      sheet, excelRow: r.excelRow, blockKey: rb.block.key, no: r.no, date, branch, concept: r.concept,
      amount, amountWasText: isTextAmount(r.amountRaw), account, category: inferCategoria(r.concept), suffixBranch, rowHash: "",
    }
  })
}

function parseSheet(ws: WorksheetLike, month: number, year: number, slug: string): SheetResult {
  const warnings: string[] = []
  const raw = BLOQUES.map((b) => readBlock(ws, b))
  const blocks: BlockSummary[] = []
  const rows = raw.flatMap((rb) => {
    const suffixes = rb.rows.map((r) => detectSuffix(r.concept))
    const { branch, reason } = resolveBlockBranch(rb.label, suffixes, slug)
    const numericTotal = round2(rb.rows.filter((r) => !isTextAmount(r.amountRaw)).reduce((s, r) => s + parseMoney(r.amountRaw), 0))
    const textTotal = round2(rb.rows.filter((r) => isTextAmount(r.amountRaw)).reduce((s, r) => s + parseMoney(r.amountRaw), 0))
    blocks.push({ sheet: ws.name, blockKey: rb.block.key, blockLabel: rb.label, branch, rows: rb.rows.length, numericTotal, textTotal, skippedZero: rb.skippedZero, reason })
    if (!branch) {
      if (rb.rows.length) warnings.push(`${ws.name}: bloque «${rb.label}» omitido (${rb.rows.length} filas, RD$${numericTotal.toLocaleString("en-US")}) — no es una sucursal`)
      return []
    }
    if (reason === "suffix") warnings.push(`${ws.name}: bloque «${rb.label}» asignado a ${branch} por el sufijo de sus conceptos`)
    return toGastoRows(ws.name, month, year, rb, branch, reason, warnings)
  })
  const ctrl = readControls(ws, slug)
  const branches = [...new Set(rows.map((r) => r.branch))]
  const controls: BranchControl[] = branches.map((branch) => {
    const mine = rows.filter((r) => r.branch === branch)
    return {
      sheet: ws.name, branch, rows: mine.length,
      numericTotal: round2(mine.filter((r) => !r.amountWasText).reduce((s, r) => s + r.amount, 0)),
      textTotal: round2(mine.filter((r) => r.amountWasText).reduce((s, r) => s + r.amount, 0)),
      control: ctrl[branch]?.value ?? null, controlSource: ctrl[branch]?.source ?? null,
    }
  })
  const empty = raw.every((rb) => rb.rows.length === 0)
  if (empty) warnings.push(`${ws.name}: hoja sin gastos (se omite)`)
  return { sheet: ws.name, month, rows, blocks, controls, warnings, empty }
}

/** Desambigua filas idénticas dentro del archivo (misma fecha/sucursal/concepto/monto). */
function withRowHashes(rows: readonly GastoRow[]): GastoRow[] {
  const seen = new Map<string, number>()
  return rows.map((r) => {
    const base = gastoRowHash(r, 1)
    const n = (seen.get(base) || 0) + 1
    seen.set(base, n)
    return { ...r, rowHash: gastoRowHash(r, n) }
  })
}

export function parseGastosWorkbook(wb: WorkbookLike, filename: string, slug = "csl"): GastosParseResult {
  const monthSheets = wb.worksheets.map((ws) => ({ ws, month: monthFromLabel(ws.name) })).filter((x): x is { ws: WorksheetLike; month: number } => x.month != null)
  if (!monthSheets.length) return { sheets: [], rows: [], year: null, yearSource: null, periods: [], minDate: "", maxDate: "", totalsByBranch: {}, warnings: [], errors: ["El libro no tiene hojas mensuales (ENERO…DICIEMBRE)."] }
  const rawAll = monthSheets.map(({ ws }) => BLOQUES.map((b) => readBlock(ws, b)))
  const ledgerYear = modeYear(rawAll.flat())
  const fileYear = Number((filename.match(/20\d\d/) || [])[0]) || null
  const year = ledgerYear ?? fileYear
  const errors: string[] = []
  if (!year) errors.push("No se pudo determinar el año: el libro no tiene fechas y el nombre del archivo no lo indica.")
  const sheets = year ? monthSheets.map(({ ws, month }) => parseSheet(ws, month, year, slug)) : []
  const rows = withRowHashes(sheets.flatMap((s) => s.rows))
  const allowed = sucursalesForTenant(slug)
  for (const b of [...new Set(rows.map((r) => r.branch))]) if (!allowed.includes(b)) errors.push(`Sucursal no válida para el negocio: ${b}`)
  const dates = rows.map((r) => r.date).sort()
  const totalsByBranch = rows.reduce<Record<string, { rows: number; total: number }>>((acc, r) => {
    const prev = acc[r.branch] || { rows: 0, total: 0 }
    return { ...acc, [r.branch]: { rows: prev.rows + 1, total: round2(prev.total + r.amount) } }
  }, {})
  return {
    sheets, rows, year, yearSource: ledgerYear ? "ledger" : fileYear ? "filename" : null,
    periods: year ? [...new Set(sheets.filter((s) => !s.empty).map((s) => yearMonthKey(year, s.month)))].sort() : [],
    minDate: dates[0] || "", maxDate: dates[dates.length - 1] || "",
    totalsByBranch, warnings: sheets.flatMap((s) => s.warnings), errors,
  }
}

/** Etiqueta de un período «2026-01» → «Enero 2026» (para avisos y notas). */
export function periodLabel(key: string): string {
  const [y, m] = key.split("-").map(Number)
  const names = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
  return `${cap(names[m - 1] || "")} ${y}`
}

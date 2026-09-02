/**
 * Parser PURO de la hoja «Historico ventas»: ventas mensuales 2017→ de referencia.
 *
 * Cabecera en la fila donde A = «AÑO» (B efectivo, C tarjeta, D total). Debajo,
 * una fila por AÑO (`2017`, con el total anual) seguida de sus meses («abr»,
 * «may»…). Termina en «Total general». Solo se devuelven los meses ANTERIORES a
 * `beforeYM` (la primera venta real del sistema): el resto ya existe de verdad.
 */
import { cellStr, cellNum, type WorkbookLike, type WorksheetLike } from "@/lib/commission/xlsx-cell"
import { monthFromLabel, yearMonthKey } from "./meses"

export const HISTORICO_SHEET = "Historico ventas"
const MAX_ROWS = 400

export interface HistoricoRow { year: number; month: number; efectivo: number; tarjeta: number; total: number }
export interface HistoricoYearControl { year: number; excelTotal: number; sumMonths: number; ok: boolean }
export interface HistoricoResult { found: boolean; rows: HistoricoRow[]; yearControls: HistoricoYearControl[]; warnings: string[] }

const round2 = (n: number): number => Math.round(n * 100) / 100

function findHeaderRow(ws: WorksheetLike): number | null {
  for (let r = 1; r <= 12; r++) if (cellStr(ws, `A${r}`).toUpperCase().startsWith("AÑO") || cellStr(ws, `A${r}`).toUpperCase() === "ANO") return r
  return null
}

function readTable(ws: WorksheetLike, headerRow: number): { rows: HistoricoRow[]; totals: Record<number, number> } {
  const rows: HistoricoRow[] = []
  const totals: Record<number, number> = {}
  let year: number | null = null
  for (let r = headerRow + 1; r <= Math.min(ws.rowCount, headerRow + MAX_ROWS); r++) {
    const a = cellStr(ws, `A${r}`)
    if (!a) continue
    if (/^total/i.test(a)) break
    if (/^\d{4}$/.test(a)) { year = Number(a); totals[year] = cellNum(ws, `D${r}`) ?? 0; continue }
    const month = monthFromLabel(a)
    if (!month || !year) continue
    rows.push({
      year, month, efectivo: round2(cellNum(ws, `B${r}`) ?? 0), tarjeta: round2(cellNum(ws, `C${r}`) ?? 0), total: round2(cellNum(ws, `D${r}`) ?? 0),
    })
  }
  return { rows, totals }
}

export function parseHistorico(wb: WorkbookLike, beforeYM = "2020-05"): HistoricoResult {
  const ws = wb.getWorksheet(HISTORICO_SHEET)
  if (!ws) return { found: false, rows: [], yearControls: [], warnings: [`El libro no tiene hoja «${HISTORICO_SHEET}».`] }
  const headerRow = findHeaderRow(ws)
  if (!headerRow) return { found: true, rows: [], yearControls: [], warnings: ["Historico ventas: no se encontró la cabecera «AÑO»."] }
  const { rows: all, totals } = readTable(ws, headerRow)
  const yearControls = Object.entries(totals).map(([y, excelTotal]) => {
    const year = Number(y)
    const sumMonths = round2(all.filter((r) => r.year === year).reduce((s, r) => s + r.total, 0))
    return { year, excelTotal, sumMonths, ok: Math.abs(sumMonths - excelTotal) <= 1 }
  })
  const warnings = yearControls.filter((c) => !c.ok).map((c) => `Historico ventas ${c.year}: los meses suman ${c.sumMonths} y el total anual dice ${c.excelTotal}`)
  const rows = all.filter((r) => yearMonthKey(r.year, r.month) < beforeYM)
  if (!rows.length) warnings.push(`Historico ventas: ningún mes anterior a ${beforeYM}.`)
  return { found: true, rows, yearControls, warnings }
}

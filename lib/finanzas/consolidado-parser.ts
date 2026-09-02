/**
 * Parser PURO de la hoja «consolidado»: inversiones y retiros de socios por mes.
 *
 * Cabecera en la fila 27, meses en las filas 28..39:
 *   Z MES | AA GASTOS | AB INVERSION | AC INVERSION VILLA OLGA |
 *   AD INVERSION CASA LOS JARDINES | AE RETIRO DIVIDENDO SOCIOS |
 *   AF RETIRO CTAS (= SUM(AA:AE), es el TOTAL de egresos, no un retiro) |
 *   AH VENTAS | AI FLUJO EFECTIVO
 * Celdas de fórmula sin resultado calculado (meses aún no cerrados) = vacías.
 */
import { cellStr, cellNum, type WorkbookLike, type WorksheetLike } from "@/lib/commission/xlsx-cell"
import { fnvHex } from "@/lib/commission/hash"
import { monthFromLabel, monthLabel, firstDayISO, yearMonthKey } from "./meses"

export const CONSOLIDADO_SHEET = "consolidado"
export const CONSOLIDADO_HEADER_ROW = 27
export const CONSOLIDADO_FIRST_ROW = 28
export const CONSOLIDADO_LAST_ROW = 39

export interface ConsolidadoMonth {
  month: number; year: number
  gastos: number | null; inversion: number | null; inversionVO: number | null; inversionJardines: number | null
  retiroDividendo: number | null; totalEgresos: number | null; ventas: number | null; flujo: number | null
  sumCheckOk: boolean | null
}
export interface InvestmentIn { year: number; month: number; branch: string | null; amount: number; nombre: string; fechaInicio: string; rowHash: string }
export interface WithdrawalIn { year: number; month: number; kind: "dividendo"; amount: number; date: string; rowHash: string }
export interface ConsolidadoResult { found: boolean; months: ConsolidadoMonth[]; investments: InvestmentIn[]; withdrawals: WithdrawalIn[]; warnings: string[] }

const INVESTMENT_BUCKETS = [
  { field: "inversion", branch: null, tag: "consolidado" },
  { field: "inversionVO", branch: "VILLA OLGA", tag: "Villa Olga" },
  { field: "inversionJardines", branch: "LOS JARDINES", tag: "Los Jardines" },
] as const

const round2 = (n: number): number => Math.round(n * 100) / 100

function headerOk(ws: WorksheetLike, warnings: string[]): boolean {
  const z = cellStr(ws, `Z${CONSOLIDADO_HEADER_ROW}`).toUpperCase()
  const ab = cellStr(ws, `AB${CONSOLIDADO_HEADER_ROW}`).toUpperCase()
  const ae = cellStr(ws, `AE${CONSOLIDADO_HEADER_ROW}`).toUpperCase()
  const ok = z.startsWith("MES") && ab.startsWith("INVERSION") && ae.includes("RETIRO") && ae.includes("DIVIDENDO")
  if (!ok) warnings.push(`consolidado: cabecera inesperada en la fila ${CONSOLIDADO_HEADER_ROW} (Z=«${z}», AB=«${ab}», AE=«${ae}»)`)
  return ok
}

function readMonth(ws: WorksheetLike, row: number, year: number): ConsolidadoMonth | null {
  const month = monthFromLabel(cellStr(ws, `Z${row}`))
  if (!month) return null
  const n = (col: string) => cellNum(ws, `${col}${row}`)
  const m = {
    month, year, gastos: n("AA"), inversion: n("AB"), inversionVO: n("AC"), inversionJardines: n("AD"),
    retiroDividendo: n("AE"), totalEgresos: n("AF"), ventas: n("AH"), flujo: n("AI"),
  }
  const parts = [m.gastos, m.inversion, m.inversionVO, m.inversionJardines, m.retiroDividendo]
  const sum = parts.reduce<number>((s, v) => s + (v || 0), 0)
  const sumCheckOk = m.totalEgresos == null ? null : Math.abs(sum - m.totalEgresos) <= 1
  return { ...m, sumCheckOk }
}

export function investmentsFrom(months: readonly ConsolidadoMonth[]): InvestmentIn[] {
  return months.flatMap((m) => INVESTMENT_BUCKETS.flatMap((b) => {
    const amount = m[b.field]
    if (!amount || amount <= 0) return []
    return [{
      year: m.year, month: m.month, branch: b.branch, amount: round2(amount),
      nombre: `Inversión ${monthLabel(m.month, m.year)} (${b.tag})`,
      fechaInicio: firstDayISO(m.year, m.month),
      rowHash: fnvHex(`INV|${yearMonthKey(m.year, m.month)}|${b.branch || ""}`),
    }]
  }))
}

export function withdrawalsFrom(months: readonly ConsolidadoMonth[]): WithdrawalIn[] {
  return months.flatMap((m) => {
    const amount = m.retiroDividendo
    if (!amount || amount <= 0) return []
    return [{
      year: m.year, month: m.month, kind: "dividendo" as const, amount: round2(amount),
      date: firstDayISO(m.year, m.month), rowHash: fnvHex(`RET|dividendo|${yearMonthKey(m.year, m.month)}`),
    }]
  })
}

export function parseConsolidado(wb: WorkbookLike, year: number): ConsolidadoResult {
  const warnings: string[] = []
  const ws = wb.getWorksheet(CONSOLIDADO_SHEET)
  if (!ws) return { found: false, months: [], investments: [], withdrawals: [], warnings: ["El libro no tiene hoja «consolidado»: sin inversiones ni retiros."] }
  if (!headerOk(ws, warnings)) return { found: true, months: [], investments: [], withdrawals: [], warnings }
  const months: ConsolidadoMonth[] = []
  for (let r = CONSOLIDADO_FIRST_ROW; r <= CONSOLIDADO_LAST_ROW; r++) {
    const m = readMonth(ws, r, year)
    if (m) months.push(m)
  }
  for (const m of months) {
    if (m.sumCheckOk === false) warnings.push(`consolidado ${monthLabel(m.month, m.year)}: gastos+inversiones+retiros (${round2((m.gastos || 0) + (m.inversion || 0) + (m.inversionVO || 0) + (m.inversionJardines || 0) + (m.retiroDividendo || 0))}) no cuadra con RETIRO CTAS (${m.totalEgresos})`)
  }
  const pendientes = months.filter((m) => m.gastos == null && m.inversion == null && m.ventas == null).map((m) => monthLabel(m.month, m.year))
  if (pendientes.length) warnings.push(`consolidado: sin valores en ${pendientes.join(", ")} (meses pendientes)`)
  return { found: true, months, investments: investmentsFrom(months), withdrawals: withdrawalsFrom(months), warnings }
}

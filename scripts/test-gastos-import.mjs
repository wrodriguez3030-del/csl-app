/**
 * Pruebas del importador del libro de gastos (Incentivos › Importador › Gastos).
 * Ejecutar:  pnpm test:gastos
 * Con el libro real:  GASTOS_XLSX="/ruta/reportes de incentivo 2026.xlsx" pnpm test:gastos
 */
import { existsSync } from "node:fs"
import ExcelJS from "exceljs"

const { parseGastosWorkbook, detectSuffix, resolveBlockBranch, gastoRowHash } = await import("../lib/finanzas/gastos-parser.ts")
const { parseConsolidado } = await import("../lib/finanzas/consolidado-parser.ts")
const { parseHistorico } = await import("../lib/finanzas/historico-parser.ts")
const { inferCategoria } = await import("../lib/finanzas/gasto-categorias.ts")
const { monthFromLabel } = await import("../lib/finanzas/meses.ts")
const { expenseImportSchema } = await import("../lib/finanzas/expense-import-schema.ts")

let pass = 0, fail = 0
const t = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${extra}`) }
}
const near = (a, b, eps = 0.01) => Math.abs(Number(a) - Number(b)) <= eps
const D = (y, m, d) => new Date(Date.UTC(y, m - 1, d))

// ── Fixture en memoria ───────────────────────────────────────────────────────
function buildFixture() {
  const wb = new ExcelJS.Workbook()
  const ene = wb.addWorksheet("ENERO")
  ene.getCell("S2").value = "ENERO"
  ene.getCell("AE3").value = "LOS JARDINES "; ene.getCell("AK3").value = "NACO"; ene.getCell("AQ3").value = "VILLA OLGA"
  for (const [c, v] of [["W", "NO."], ["X", "FECHA"], ["Y", "GASTOS "], ["Z", "MONTO"], ["AA", "RET. CTA "]]) ene.getCell(`${c}4`).value = v
  const put = (cols, r, no, date, concept, amount, cta) => {
    const [cNo, cF, cC, cM, cA] = cols
    ene.getCell(`${cNo}${r}`).value = no; ene.getCell(`${cF}${r}`).value = date; ene.getCell(`${cC}${r}`).value = concept
    ene.getCell(`${cM}${r}`).value = amount; if (cta) ene.getCell(`${cA}${r}`).value = cta
  }
  const RV = ["W", "X", "Y", "Z", "AA"], JA = ["AC", "AD", "AE", "AF", "AG"], NA = ["AI", "AJ", "AK", "AL", "AM"], VO = ["AO", "AP", "AQ", "AR", "AS"]
  put(RV, 5, 1, D(2026, 1, 2), "CAJA CHICA R VIDAL R-1", 1000, "POPULAR")
  put(RV, 6, 2, D(2026, 1, 13), "NOMINA R VIDAL  R-1", 107143.58)
  put(RV, 7, 3, D(2026, 1, 8), "Claro/Codetel R VIDAL R-1", "RD$3,849.85")
  put(RV, 8, 4, D(2026, 1, 8), "INCENTIVOS R VIDAL R-1", 0)
  put(RV, 9, 5, D(2026, 1, 22), "INTERNET LOS JARDINES J-1", 3403)
  put(RV, 10, 6, null, "SABANAS R VIDAL R-1", 500)
  put(RV, 11, 7, D(2025, 1, 25), "EXFOLIENTE MAL TECLEADO R-1", 250)
  put(JA, 5, 1, D(2026, 1, 13), "NOMINA LOS JARDINES J-1", 200000, "BHD")
  put(NA, 5, 1, D(2026, 1, 5), "YANIRE CASANOVA", 11000)
  put(NA, 6, 2, D(2026, 1, 5), "CAROLIN LUGO", 10000)
  put(VO, 5, 1, D(2026, 1, 7), "ALQUILER VILLA OLGA V-1", 129000)
  ene.getCell("Z125").value = { formula: "SUM(Z5:Z124)", result: 112296.58 }
  ene.getCell("AF125").value = { formula: "SUM(AF5:AF124)", result: 200000 }
  ene.getCell("AL125").value = { formula: "SUM(AL5:AL124)", result: 21000 }
  ene.getCell("AR125").value = { formula: "SUM(AR5:AR124)", result: 129000 }
  ene.getCell("Y129").value = " R VIDAL "; ene.getCell("Z129").value = { formula: "Z125", result: 112296.58 }
  ene.getCell("Y130").value = "JARDINES "; ene.getCell("Z130").value = { formula: "AF125", result: 200000 }
  ene.getCell("Y131").value = "NACO "; ene.getCell("Z131").value = { formula: "AL125", result: 21000 }
  ene.getCell("Y132").value = "VILLA OLGA "; ene.getCell("Z132").value = { formula: "AR125", result: 129000 }

  // JULIO: las filas de Villa Olga viven en el bloque «NACO»; el bloque VO está vacío.
  const jul = wb.addWorksheet("JULIO")
  jul.getCell("S2").value = "JULIO"; jul.getCell("AK3").value = "NACO"
  for (const [c, v] of [["W", "NO."], ["X", "FECHA"], ["Y", "GASTOS "], ["Z", "MONTO"]]) jul.getCell(`${c}4`).value = v
  jul.getCell("W5").value = 1; jul.getCell("X5").value = D(2026, 7, 13); jul.getCell("Y5").value = "NOMINA R VIDAL R-1"; jul.getCell("Z5").value = 100000
  jul.getCell("AI5").value = 1; jul.getCell("AJ5").value = D(2026, 7, 3); jul.getCell("AK5").value = "ALQUILER VILLA OLGA V-1"; jul.getCell("AL5").value = 129000
  jul.getCell("AI6").value = 2; jul.getCell("AJ6").value = D(2026, 7, 13); jul.getCell("AK6").value = "NOMINA VILLA OLGA V-1"; jul.getCell("AL6").value = 73000
  jul.getCell("Z125").value = 100000; jul.getCell("AL125").value = 202000
  jul.getCell("Y129").value = "R VIDAL"; jul.getCell("Z129").value = 100000
  jul.getCell("Y132").value = "VILLA OLGA"; jul.getCell("Z132").value = { formula: "AL125", result: 202000 }

  const agosto = wb.addWorksheet("AGOSTO") // vacía
  agosto.getCell("S2").value = "AGOSTO"

  const cons = wb.addWorksheet("consolidado")
  const H = { Z: "MES ", AA: "GASTOS ", AB: "INVERSION ", AC: "INVERSION VILLA OLGA", AD: "INVERSION CASA LOS JARDINES", AE: "RETIRO DIVIDENDO SOCIOS", AF: "RETIRO  CTAS", AH: "VENTAS", AI: "FLUJO EFECTIVO" }
  for (const [c, v] of Object.entries(H)) cons.getCell(`${c}27`).value = v
  const row = (r, mes, vals) => { cons.getCell(`Z${r}`).value = mes; for (const [c, v] of Object.entries(vals)) cons.getCell(`${c}${r}`).value = v }
  row(28, "ENERO", { AA: 1436572.7975, AB: 403117.98, AC: 484243.2, AD: 0, AE: 0, AF: { formula: "SUM(AA28:AE28)", result: 2323933.9775 }, AH: 1691000, AI: -632933.9775 })
  row(30, "MARZO ", { AA: 1900979.3346, AB: 378424.68, AC: 111511.66, AD: 500000, AE: 315000, AF: 3205915.6746, AH: 2060266, AI: -1145649.6746 })
  row(33, "JUNIO", { AC: { sharedFormula: "AC32" } })
  row(39, "DIC", {})

  const hist = wb.addWorksheet("Historico ventas")
  hist.getCell("A3").value = "AÑO"; hist.getCell("B3").value = " EFECTIVO"; hist.getCell("C3").value = " TARJETA"; hist.getCell("D3").value = " MONTO TOTAL"
  const hrow = (r, a, b, c, d) => { hist.getCell(`A${r}`).value = a; hist.getCell(`B${r}`).value = b; hist.getCell(`C${r}`).value = c; hist.getCell(`D${r}`).value = d }
  hrow(4, 2017, 136800, 304300, 441100); hrow(5, "abr", 16000, 26000, 42000); hrow(6, "may", 120800, 278300, 399100)
  hrow(7, 2018, 68140, 183590, 251730); hrow(8, "ene", 68140, 183590, 251730)
  hrow(9, 2020, 0, 0, 30); hrow(10, "abr", 0, 10, 10); hrow(11, "may", 0, 20, 20)
  hrow(12, "Total general", 0, 0, 722860)
  return wb
}

console.log("── Meses y sufijos (§53)")
{
  t("monthFromLabel: ENERO/ene/Sept/DIC", monthFromLabel("ENERO") === 1 && monthFromLabel(" ene") === 1 && monthFromLabel("Sept") === 9 && monthFromLabel("DIC") === 12)
  t("monthFromLabel: no-mes → null", monthFromLabel("consolidado") === null && monthFromLabel("") === null)
  t("detectSuffix R-1/J-1/V-1", detectSuffix("NOMINA R VIDAL R-1") === "RAFAEL VIDAL" && detectSuffix("INTERNET J-1") === "LOS JARDINES" && detectSuffix("ALQUILER V-1") === "VILLA OLGA")
  t("detectSuffix: « R» final", detectSuffix("REDES SOCIALES LARISSA  R") === "RAFAEL VIDAL")
  t("detectSuffix: sin sufijo → null", detectSuffix("YANIRE CASANOVA") === null)
  t("resolveBlockBranch: rótulo de sucursal", resolveBlockBranch("LOS JARDINES ", [null, null]).branch === "LOS JARDINES")
  t("resolveBlockBranch: NACO con ≥80 % de filas V-1 → VILLA OLGA", resolveBlockBranch("NACO", ["VILLA OLGA", "VILLA OLGA", "VILLA OLGA", "VILLA OLGA", null]).reason === "suffix")
  t("resolveBlockBranch: NACO con solo 75 % de sufijos → skip (no se reasigna a la ligera)", resolveBlockBranch("NACO", ["VILLA OLGA", "VILLA OLGA", "VILLA OLGA", null]).branch === null)
  t("resolveBlockBranch: NACO sin sufijo → skip", resolveBlockBranch("NACO", [null, null]).branch === null)
}

console.log("── Categorías (§54)")
{
  const cases = [["NOMINA R VIDAL  R-1", "Nómina"], ["TSS R VIDAL R-1", "Cargas sociales"], ["PAGO ALQ. CIBAO SPA MOD H1", "Alquiler"], ["EDENORTE R VIDAL R-1", "Electricidad"],
    ["Claro/Codetel R VIDAL R-1", "Internet"], ["Redes oferta láser  R VIDAL", "Publicidad"], ["INCENTIVOS R VIDAL R-1", "Incentivos"], ["CAJA CHICA R VIDAL R-1", "Caja chica"],
    ["MANT . CASA JARABNACOA R-1", "Mantenimiento"], ["NCF GASOLINA R-1", "Combustible"], ["PAPEL CAMILLA R-1", "Suministros"], ["YANIRE CASANOVA", "Otros"]]
  t("12 conceptos reales", cases.every(([c, e]) => inferCategoria(c) === e), `(${cases.filter(([c, e]) => inferCategoria(c) !== e).map(([c]) => `${c}→${inferCategoria(c)}`).join("; ")})`)
  t("vacío → Otros", inferCategoria("") === "Otros" && inferCategoria(null) === "Otros")
}

console.log("── Libro de gastos: fixture (§55)")
{
  const res = parseGastosWorkbook(buildFixture(), "reportes de incentivo 2026.xlsx")
  t("sin errores", res.errors.length === 0, `(${res.errors})`)
  t("año por las fechas del libro", res.year === 2026 && res.yearSource === "ledger")
  t("3 hojas mensuales leídas (ENERO, JULIO, AGOSTO vacía)", res.sheets.length === 3 && res.sheets.find((s) => s.sheet === "AGOSTO").empty)
  t("períodos solo de hojas con datos", res.periods.join(",") === "2026-01,2026-07", `(${res.periods})`)
  const ene = res.sheets.find((s) => s.sheet === "ENERO")
  const rv = ene.rows.filter((r) => r.branch === "RAFAEL VIDAL")
  t("ENERO R VIDAL: 6 filas (la de monto 0 se omite)", rv.length === 6, `(${rv.length})`)
  t("monto en texto «RD$3,849.85» se importa", rv.some((r) => r.amountWasText && near(r.amount, 3849.85)))
  t("fila sin fecha → día 1 con aviso", rv.some((r) => r.date === "2026-01-01") && ene.warnings.some((w) => /sin fecha/.test(w)))
  t("aviso de sufijo cruzado (J-1 dentro de R VIDAL)", ene.warnings.some((w) => /LOS JARDINES dentro del bloque RAFAEL VIDAL/.test(w)))
  t("RET. CTA alfabética → account", rv.find((r) => r.concept.startsWith("CAJA CHICA")).account === "POPULAR")
  t("categoría inferida por fila", rv.find((r) => r.concept.startsWith("NOMINA")).category === "Nómina")
  const ctlRV = ene.controls.find((c) => c.branch === "RAFAEL VIDAL")
  t("control R VIDAL por RESUMEN = 112.046,58 (suma numérica; el texto va aparte)", ctlRV.controlSource === "resumen" && near(ctlRV.control, 112296.58) && near(ctlRV.numericTotal, 112296.58) && near(ctlRV.textTotal, 3849.85), `(${JSON.stringify(ctlRV)})`)
  t("NACO omitido con aviso", ene.rows.every((r) => r.branch !== "NACO") && ene.warnings.some((w) => /NACO.*omitido/.test(w)))
  t("bloque NACO listado como skip con 2 filas", ene.blocks.find((b) => b.blockKey === "NA").reason === "skip" && ene.blocks.find((b) => b.blockKey === "NA").rows === 2)
  t("VILLA OLGA y LOS JARDINES", ene.rows.filter((r) => r.branch === "VILLA OLGA").length === 1 && ene.rows.filter((r) => r.branch === "LOS JARDINES").length === 1)
  const jul = res.sheets.find((s) => s.sheet === "JULIO")
  t("JULIO: bloque NACO → VILLA OLGA por sufijo", jul.rows.filter((r) => r.branch === "VILLA OLGA").length === 2 && jul.blocks.find((b) => b.blockKey === "NA").reason === "suffix")
  t("JULIO: control VILLA OLGA por etiqueta del RESUMEN = 202.000", near(jul.controls.find((c) => c.branch === "VILLA OLGA").control, 202000))
  t("totalsByBranch acumula todas las hojas", near(res.totalsByBranch["RAFAEL VIDAL"].total, 112296.58 + 3849.85 + 100000) && res.totalsByBranch["VILLA OLGA"].rows === 3)
  t("rango de fechas", res.minDate === "2026-01-01" && res.maxDate === "2026-07-13", `(${res.minDate} → ${res.maxDate})`)
  t("fecha de otro mes → se corrige al mes de la hoja conservando el día, con aviso", rv.some((r) => r.date === "2026-01-25" && r.concept.includes("MAL TECLEADO")) && ene.warnings.some((w) => /se corrige a 2026-01-25/.test(w)), `(${rv.map((r) => r.date)})`)
  t("row_hash de 16 hex y todos distintos", res.rows.every((r) => /^[0-9a-f]{16}$/.test(r.rowHash)) && new Set(res.rows.map((r) => r.rowHash)).size === res.rows.length)
  t("row_hash estable y sin NO.", gastoRowHash({ date: "2026-01-02", branch: "RAFAEL VIDAL", concept: "caja  chica", amount: 1000 }) === gastoRowHash({ date: "2026-01-02", branch: "RAFAEL VIDAL", concept: "CAJA CHICA", amount: 1000 }))
  t("row_hash: 2.ª ocurrencia idéntica cambia", gastoRowHash({ date: "2026-01-02", branch: "RAFAEL VIDAL", concept: "X", amount: 1 }, 2) !== gastoRowHash({ date: "2026-01-02", branch: "RAFAEL VIDAL", concept: "X", amount: 1 }, 1))
  const empty = new ExcelJS.Workbook(); empty.addWorksheet("Hoja1")
  t("libro sin hojas mensuales → error claro", parseGastosWorkbook(empty, "x.xlsx").errors.length === 1)
}

console.log("── consolidado (§56)")
{
  const c = parseConsolidado(buildFixture(), 2026)
  t("hoja encontrada y cabecera válida", c.found && c.months.length >= 2)
  const ene = c.months.find((m) => m.month === 1), mar = c.months.find((m) => m.month === 3), jun = c.months.find((m) => m.month === 6)
  t("enero: gastos/inversión/VO", near(ene.gastos, 1436572.8) && near(ene.inversion, 403117.98) && near(ene.inversionVO, 484243.2))
  t("enero: control AF cuadra", ene.sumCheckOk === true)
  t("junio: fórmula sin resultado → null", jun && jun.inversionVO === null && jun.gastos === null)
  t("«DIC» se reconoce como diciembre", c.months.some((m) => m.month === 12))
  t("inversiones: general + VO + Jardines", c.investments.length === 5 && c.investments.filter((i) => i.branch === "LOS JARDINES").length === 1)
  const invMar = c.investments.filter((i) => i.month === 3)
  t("marzo: 378.424,68 / 111.511,66 / 500.000", near(invMar.find((i) => !i.branch).amount, 378424.68) && near(invMar.find((i) => i.branch === "VILLA OLGA").amount, 111511.66) && near(invMar.find((i) => i.branch === "LOS JARDINES").amount, 500000))
  t("nombre con la convención existente", invMar.find((i) => !i.branch).nombre === "Inversión Marzo 2026 (consolidado)" && invMar.find((i) => i.branch === "VILLA OLGA").nombre === "Inversión Marzo 2026 (Villa Olga)")
  t("retiros: solo AE (dividendo), marzo 315.000; AF NO es retiro", c.withdrawals.length === 1 && c.withdrawals[0].kind === "dividendo" && near(c.withdrawals[0].amount, 315000) && c.withdrawals[0].month === 3)
  t("meses pendientes avisados", c.warnings.some((w) => /pendientes/.test(w)))
  const noCons = new ExcelJS.Workbook(); noCons.addWorksheet("ENERO")
  t("sin hoja consolidado → found=false con aviso", parseConsolidado(noCons, 2026).found === false)
}

console.log("── Historico ventas (§57)")
{
  const h = parseHistorico(buildFixture(), "2020-05")
  t("hoja encontrada", h.found)
  t("solo meses anteriores a 2020-05 (2017-04, 2017-05, 2018-01, 2020-04)", h.rows.length === 4 && !h.rows.some((r) => r.year === 2020 && r.month === 5), `(${h.rows.map((r) => `${r.year}-${r.month}`)})`)
  t("efectivo/tarjeta/total por fila", h.rows[0].efectivo === 16000 && h.rows[0].tarjeta === 26000 && h.rows[0].total === 42000)
  t("controles anuales: 2017 ok, 2018 ok", h.yearControls.find((c) => c.year === 2017).ok && h.yearControls.find((c) => c.year === 2018).ok)
  t("se detiene en «Total general»", !h.rows.some((r) => r.total === 722860))
}

console.log("── Esquema del payload (§58)")
{
  const ok = expenseImportSchema.safeParse({
    import: { filename: "a.xlsx", fileHash: "a".repeat(64), year: 2026, rowsCount: 1, grossTotal: 1, detectedPeriodStart: "2026-01-02", detectedPeriodEnd: "2026-01-02", periods: ["2026-01"], includeHistory: false },
    expenses: [{ date: "2026-01-02", branch: "RAFAEL VIDAL", concept: "X", amount: 1, account: null, category: "Otros", notes: "", rowHash: "0123456789abcdef" }],
    investments: [], withdrawals: [], history: [], rawSummary: null,
  })
  t("payload válido pasa", ok.success, `(${!ok.success ? ok.error.issues[0]?.message : ""})`)
  const bad = expenseImportSchema.safeParse({ import: { filename: "a", fileHash: "x", year: 1999 }, expenses: [] })
  t("payload inválido falla", !bad.success)
}

// ── Libro real (si está disponible) ─────────────────────────────────────────
const REAL = process.env.GASTOS_XLSX || "/Users/willianrodriguez/Library/CloudStorage/OneDrive-Personal/CIBAO SPA LASER/INDICADORES/INCENTIVOS 2026/reportes de incentivo 2026.xlsx"
if (existsSync(REAL)) {
  console.log("── Libro REAL: reportes de incentivo 2026.xlsx (§59)")
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(REAL)
  const res = parseGastosWorkbook(wb, REAL.split("/").pop())
  t("sin errores", res.errors.length === 0, `(${res.errors})`)
  t("año 2026", res.year === 2026)
  const ene = res.sheets.find((s) => s.sheet === "ENERO")
  const ctl = (b) => ene.controls.find((c) => c.branch === b)
  t("ENERO R VIDAL: 30 numéricas = 722.056,39 (+1 en texto 3.849,85)", near(ctl("RAFAEL VIDAL").numericTotal, 722056.39) && near(ctl("RAFAEL VIDAL").control, 722056.39) && near(ctl("RAFAEL VIDAL").textTotal, 3849.85), `(${JSON.stringify(ctl("RAFAEL VIDAL"))})`)
  t("ENERO LOS JARDINES: 505.638,81 numéricas", near(ctl("LOS JARDINES").numericTotal, 505638.81) && near(ctl("LOS JARDINES").control, 505638.81), `(${JSON.stringify(ctl("LOS JARDINES"))})`)
  t("ENERO VILLA OLGA: 208.877,60 numéricas", near(ctl("VILLA OLGA").numericTotal, 208877.6) && near(ctl("VILLA OLGA").control, 208877.6), `(${JSON.stringify(ctl("VILLA OLGA"))})`)
  const naco = ene.blocks.find((b) => b.blockKey === "NA")
  t("ENERO NACO omitido: 18 filas / 77.062", naco.reason === "skip" && naco.rows === 18 && near(naco.numericTotal, 77062), `(${JSON.stringify(naco)})`)
  const jul = res.sheets.find((s) => s.sheet === "JULIO")
  const julVO = jul.rows.filter((r) => r.branch === "VILLA OLGA")
  t("JULIO: Villa Olga vía bloque NACO — 13 filas / 387.934,56", julVO.length === 13 && near(julVO.reduce((s, r) => s + r.amount, 0), 387934.56), `(${julVO.length} / ${julVO.reduce((s, r) => s + r.amount, 0)})`)
  t("MAYO: la fila con fecha 2025 se corrige a mayo 2026", res.rows.every((r) => r.date.startsWith("2026")) && res.warnings.some((w) => /MAYO fila 22.*se corrige a 2026-05-25/.test(w)))
  t("AGOSTO vacío avisado", res.sheets.find((s) => s.sheet === "AGOSTO")?.empty === true)
  t("períodos ENE…JUL", res.periods.join(",") === "2026-01,2026-02,2026-03,2026-04,2026-05,2026-06,2026-07", `(${res.periods})`)
  const c = parseConsolidado(wb, 2026)
  const mar = c.investments.filter((i) => i.month === 3)
  t("consolidado MARZO: 378.424,68 / 111.511,66 / 500.000 / dividendo 315.000", near(mar.find((i) => !i.branch)?.amount, 378424.68) && near(mar.find((i) => i.branch === "VILLA OLGA")?.amount, 111511.66) && near(mar.find((i) => i.branch === "LOS JARDINES")?.amount, 500000) && near(c.withdrawals.find((w) => w.month === 3)?.amount, 315000))
  t("consolidado MARZO: AF = 3.205.915,67 y cuadra", near(c.months.find((m) => m.month === 3).totalEgresos, 3205915.67) && c.months.find((m) => m.month === 3).sumCheckOk === true)
  const h = parseHistorico(wb, "2020-05")
  t("histórico: 36 filas 2017-04 … 2020-03", h.rows.length === 36 && h.rows[0].year === 2017 && h.rows[0].month === 4 && h.rows[35].year === 2020 && h.rows[35].month === 3, `(${h.rows.length})`)
  t("histórico 2017 = 3.219.248", near(h.rows.filter((r) => r.year === 2017).reduce((s, r) => s + r.total, 0), 3219248))
} else console.log("(libro real no disponible — controles §59 omitidos)")

console.log(`\n${pass} pasaron · ${fail} fallaron`)
process.exit(fail ? 1 : 0)

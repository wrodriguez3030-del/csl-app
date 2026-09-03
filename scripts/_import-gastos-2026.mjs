import fs from "node:fs"
import { createHash } from "node:crypto"
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim()
}
const ExcelJS = (await import("exceljs")).default
const { parseGastosWorkbook } = await import("../lib/finanzas/gastos-parser.ts")
const { parseConsolidado } = await import("../lib/finanzas/consolidado-parser.ts")
const { parseHistorico } = await import("../lib/finanzas/historico-parser.ts")
const { runWithBusinessContext } = await import("../lib/server/business-context.ts")
const { commitExpenseImport, checkExpenseImport } = await import("../lib/server/expense-import.ts")

const FILE = process.argv[2]
/** `--only=2026-08` importa SOLO ese mes: el libro trae hojas de meses futuros
 *  copiadas como plantilla (septiembre = agosto con las fechas corridas). */
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1] || null
const CSL = { businessId: "66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6", businessSlug: "csl",
  isSuperadmin: true, isAdmin: true, bypassTenantFilter: false, branchScope: { all: true, branches: [] } }
const USER = { id: null, email: "script:import-gastos" }
const rd = (n) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })

const buf = fs.readFileSync(FILE)
const fileHash = createHash("sha256").update(buf).digest("hex")
const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf)
const filename = FILE.split("/").pop()
const g0 = parseGastosWorkbook(wb, filename)
if (g0.errors.length) { console.error("❌", g0.errors.join(" ")); process.exit(1) }
const inOnly = (ym) => !ONLY || ym === ONLY
const gRows = g0.rows.filter((r) => inOnly(r.date.slice(0, 7)))
if (ONLY && !gRows.length) { console.error(`❌ El libro no trae gastos de ${ONLY}.`); process.exit(1) }
const dates = gRows.map((r) => r.date).sort()
const g = { ...g0, rows: gRows, periods: g0.periods.filter(inOnly), minDate: dates[0], maxDate: dates[dates.length - 1],
  totalsByBranch: gRows.reduce((acc, r) => ({ ...acc, [r.branch]: { rows: (acc[r.branch]?.rows || 0) + 1, total: Math.round(((acc[r.branch]?.total || 0) + r.amount) * 100) / 100 } }), {}) }
const ym = (x) => `${x.year}-${String(x.month).padStart(2, "0")}`
const cons0 = parseConsolidado(wb, g0.year)
const cons = { ...cons0, investments: cons0.investments.filter((i) => inOnly(ym(i))), withdrawals: cons0.withdrawals.filter((w) => inOnly(ym(w))) }
const hist = ONLY ? { rows: [], warnings: [] } : parseHistorico(wb, "2020-05")
const sheetsIn = g0.sheets.filter((sh) => sh.rows.some((r) => inOnly(r.date.slice(0, 7))))
if (ONLY) console.log(`SOLO ${ONLY} · ${g0.rows.length - gRows.length} filas de otros meses descartadas`)

console.log(`ARCHIVO: ${filename}`)
console.log(`  ${g.rows.length} gastos · ${g.minDate} → ${g.maxDate} · períodos: ${g.periods.join(", ")}`)
for (const [b, v] of Object.entries(g.totalsByBranch)) console.log(`    ${b.padEnd(14)} ${String(v.rows).padStart(4)} filas  ${rd(v.total).padStart(16)}`)
console.log(`  inversiones: ${cons.investments.length} · retiros: ${cons.withdrawals.length} · histórico: ${hist.rows.length}`)
const avisos = ONLY ? sheetsIn.flatMap((sh) => sh.warnings) : g.warnings
if (avisos.length) console.log(`  avisos: ${avisos.length} · ${avisos.slice(0, 3).join(" · ")}`)

const payload = {
  import: { filename, fileHash, year: g.year, rowsCount: g.rows.length,
    grossTotal: Math.round(g.rows.reduce((s, r) => s + r.amount, 0) * 100) / 100,
    detectedPeriodStart: g.minDate, detectedPeriodEnd: g.maxDate, periods: g.periods, includeHistory: !ONLY },
  expenses: g.rows.map((r) => ({ date: r.date, branch: r.branch, concept: r.concept, amount: r.amount, account: r.account,
    category: r.category, notes: `Importado de ${filename} · hoja ${r.sheet} · fila ${r.excelRow}`, rowHash: r.rowHash })),
  investments: cons.investments.map(({ year, month, branch, amount, nombre, fechaInicio, rowHash }) => ({ year, month, branch, amount, nombre, fechaInicio, rowHash })),
  withdrawals: cons.withdrawals.map(({ year, month, kind, amount, date, rowHash }) => ({ year, month, kind, amount, date, rowHash })),
  history: hist.rows,
  rawSummary: { controls: sheetsIn.flatMap((s) => s.controls), consolidado: cons.months,
    warnings: [...sheetsIn.flatMap((s) => s.warnings), ...(ONLY ? [] : g.warnings), ...cons.warnings, ...hist.warnings] },
}

await runWithBusinessContext(CSL, async () => {
  const chk = await checkExpenseImport({ fileHash, periods: g.periods.join(",") })
  console.log(`\nPRE-CHECK: duplicado=${chk.exists} · totales mensuales a reemplazar=${chk.aggregates.length} · inversiones ya cargadas=${chk.investments.length}`)
  if (process.argv.includes("--dry")) { console.log("(dry-run: no se escribe)"); return }
  const res = await commitExpenseImport({ importJson: JSON.stringify(payload) }, USER)
  if (res.duplicate) { console.log("⚠️  Archivo ya importado:", res.existing?.filename); return }
  console.log("\n✅ IMPORTADO")
  console.log(`  gastos      ${res.expenses.inserted} nuevos · ${res.expenses.duplicated} omitidos`)
  console.log(`  inversiones ${res.investments.inserted} nuevas · ${res.investments.duplicated} ya cargadas${res.investments.differs.length ? ` · ${res.investments.differs.length} con monto distinto (sin tocar)` : ""}`)
  if (res.investments.differs.length) for (const d of res.investments.differs) console.log(`      ${d.month} ${d.branch || "(general)"}: base ${rd(d.existing)} vs archivo ${rd(d.file)}`)
  console.log(`  retiros     ${res.withdrawals.inserted} nuevos · ${res.withdrawals.duplicated} omitidos`)
  console.log(`  histórico   ${res.history.upserted} meses`)
  console.log(`  reemplazos  ${res.superseded} totales mensuales retirados`)
})

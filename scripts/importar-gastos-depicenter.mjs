/**
 * Importa a db-cls los gastos de DEPICENTER desde su libro de incentivos.
 *
 * Ese libro NO tiene la forma del de csl: los gastos viven en un solo bloque
 * `M4:Q45` de cada hoja mensual (NO. · FECHA · GASTOS · MONTO · RET. CTA), sin
 * columna de sucursal, y el total del mes está en `P46`. Por eso no sirve
 * `gastos-parser.ts` y se lee aquí.
 *
 *   node --import tsx scripts/importar-gastos-depicenter.mjs "<libro.xlsx>" [--dry]
 */
import fs from "node:fs"
import { createHash } from "node:crypto"
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim()
}
const ExcelJS = (await import("exceljs")).default
const { fnvHex } = await import("../lib/commission/hash.ts")
const { inferCategoria } = await import("../lib/finanzas/gasto-categorias.ts")
const { normalizeName } = await import("../lib/commission/normalize.ts")
const { runWithBusinessContext } = await import("../lib/server/business-context.ts")
const { commitExpenseImport, checkExpenseImport } = await import("../lib/server/expense-import.ts")

const FILE = process.argv[2]
const DRY = process.argv.includes("--dry")
const DEPI = { businessId: "03b96698-c5df-4b4b-84df-1160a7ad56b9", businessSlug: "depicenter",
  isSuperadmin: true, isAdmin: true, bypassTenantFilter: false, branchScope: { all: true, branches: [] } }
const SUCURSAL = "LA VEGA"          // única sucursal operativa del negocio
const MESES = ["ENERO","FEBRERO","MARZO","ABRIL","MAYO","JUNIO","JULIO","AGOSTO"]  // SEPT. queda fuera: es plantilla
const ANIO = 2026
const rd = (n) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })

const buf = fs.readFileSync(FILE)
const fileHash = createHash("sha256").update(buf).digest("hex")
const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf)
const filename = FILE.split("/").pop()

/** ExcelJS devuelve las celdas con fórmula como `{formula|sharedFormula, result}`
 *  y el texto con formato como `{richText:[…]}`. Sin desenvolverlas, media hoja
 *  se lee como vacía y el importe no cuadra con el control del mes. */
const crudo = (c) => {
  const v = c?.value
  if (v && typeof v === "object" && !(v instanceof Date)) {
    if ("result" in v) return v.result
    if ("richText" in v) return v.richText.map((t) => t.text).join("")
    if ("text" in v) return v.text
  }
  return v
}
const rows = [], avisos = [], controles = []
for (const [i, nombre] of MESES.entries()) {
  const ws = wb.getWorksheet(nombre)
  if (!ws) { avisos.push(`hoja ${nombre} no encontrada`); continue }
  const mes = i + 1
  let suma = 0, n = 0
  for (let f = 5; f <= 45; f++) {
    const concepto = String(crudo(ws.getCell(`O${f}`)) ?? "").trim()
    const monto = Number(crudo(ws.getCell(`P${f}`)))
    if (!concepto || !Number.isFinite(monto) || monto <= 0) continue
    const cruda = crudo(ws.getCell(`N${f}`))
    let fecha = cruda instanceof Date ? cruda.toISOString().slice(0, 10)
      : (Number.isFinite(Number(cruda)) && Number(cruda) > 20000
          ? new Date(Date.UTC(1899, 11, 30) + Number(cruda) * 86400000).toISOString().slice(0, 10)
          : null)
    // Una fecha fuera del mes de su hoja es un dedazo (JUNIO trae un 2021):
    // se corrige al mismo día del mes correcto y se avisa.
    if (!fecha || !fecha.startsWith(`${ANIO}-${String(mes).padStart(2, "0")}`)) {
      const dia = fecha ? Number(fecha.slice(8, 10)) : 1
      const arreglada = `${ANIO}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`
      avisos.push(`${nombre} fila ${f}: fecha ${fecha ?? "vacía"} → ${arreglada} (${concepto.slice(0, 30)})`)
      fecha = arreglada
    }
    const cuenta = String(crudo(ws.getCell(`Q${f}`)) ?? "").trim() || null
    rows.push({ date: fecha, branch: SUCURSAL, concept: concepto, amount: Math.round(monto * 100) / 100,
      account: cuenta, category: inferCategoria(concepto),
      notes: `Importado de ${filename} · hoja ${nombre} · fila ${f}`,
      rowHash: fnvHex(`EXPDEPI|${fecha}|${SUCURSAL}|${normalizeName(concepto)}|${monto.toFixed(2)}|${f}`) })
    suma += monto; n++
  }
  const control = Number(crudo(ws.getCell("P46")))
  controles.push({ hoja: nombre, filas: n, suma: Math.round(suma * 100) / 100, control })
}

console.log(`ARCHIVO: ${filename}`)
console.log(`${"HOJA".padEnd(9)}${"FILAS".padStart(6)}${"SUMA".padStart(15)}${"CONTROL P46".padStart(15)}   ✓`)
let ok = true
for (const c of controles) {
  const cuadra = Math.abs(c.suma - (c.control || 0)) < 0.01; ok &&= cuadra
  console.log(`${c.hoja.padEnd(9)}${String(c.filas).padStart(6)}${rd(c.suma).padStart(15)}${rd(c.control).padStart(15)}   ${cuadra ? "✓" : "✗"}`)
}
const total = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100
console.log(`${"TOTAL".padEnd(9)}${String(rows.length).padStart(6)}${rd(total).padStart(15)}`)
if (avisos.length) { console.log("\navisos:"); for (const a of avisos) console.log("  ·", a) }
if (!ok) { console.error("\n❌ Algún mes no cuadra con su control: no se importa."); process.exit(1) }

const fechas = rows.map((r) => r.date).sort()
const periodos = [...new Set(rows.map((r) => r.date.slice(0, 7)))].sort()
const payload = {
  import: { filename, fileHash, year: ANIO, rowsCount: rows.length, grossTotal: total,
    detectedPeriodStart: fechas[0], detectedPeriodEnd: fechas[fechas.length - 1],
    periods: periodos, includeHistory: false },
  expenses: rows, investments: [], withdrawals: [], history: [],
  rawSummary: { controles, avisos, origen: "bloque M4:Q45 de cada hoja mensual", sucursal: SUCURSAL },
}

await runWithBusinessContext(DEPI, async () => {
  const chk = await checkExpenseImport({ fileHash, periods: periodos.join(",") })
  console.log(`\nPRE-CHECK: duplicado=${chk.exists} · totales mensuales a reemplazar=${chk.aggregates.length}`)
  if (DRY) { console.log("(dry-run: no se escribe)"); return }
  const res = await commitExpenseImport({ importJson: JSON.stringify(payload) }, { id: null, email: "script:gastos-depicenter" })
  if (res.duplicate) { console.log("⚠️  Archivo ya importado:", res.existing?.filename); return }
  console.log(`\n✅ ${res.expenses.inserted} gastos nuevos · ${res.expenses.duplicated} omitidos`)
})

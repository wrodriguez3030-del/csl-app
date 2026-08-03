/**
 * Confirma la importación de RESERVAS y muestra el cálculo del período, usando
 * los HANDLERS REALES del servidor (no una reimplementación): el resultado es
 * idéntico a pulsar «Confirmar importación» en la interfaz.
 *
 * Corre start → append×N → finalize dentro de `runWithBusinessContext`, igual
 * que /api/csl envuelve cada request.
 *
 * Uso:
 *   node --import tsx scripts/import-reservas-depicenter.mjs <ruta.xlsx> [--save]
 *
 *   sin --save  → importa las reservas y muestra el cálculo SIN guardarlo
 *   con --save  → además guarda el run del período (sales_commission_runs)
 */
import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import fs from "node:fs"

// El .env.local debe estar en process.env ANTES de importar los módulos de
// servidor (getSupabaseAdmin lo lee al construir el cliente).
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim()
}

const ExcelJS = (await import("exceljs")).default
const { parseReservasWorkbook, aggregateAttendance } = await import("../lib/commission/reservations-parser.ts")
const { runWithBusinessContext } = await import("../lib/server/business-context.ts")
const commission = await import("../lib/server/commission.ts")

const DEPICENTER = {
  businessId: "03b96698-c5df-4b4b-84df-1160a7ad56b9",
  businessSlug: "depicenter",
  isSuperadmin: true,
  isAdmin: true,
  bypassTenantFilter: false,
  branchScope: { all: true, branches: [] },
}
const USER = { id: "script:import-reservas", email: "script:import-reservas" }
const CHUNK = 3000

const file = process.argv[2]
const doSave = process.argv.includes("--save")
if (!file) {
  console.error("Falta la ruta del archivo.\n  node --import tsx scripts/import-reservas-depicenter.mjs <ruta.xlsx> [--save]")
  process.exit(1)
}

const money = (n) => "RD$" + Number(n || 0).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const buf = await readFile(file)
const fileHash = createHash("sha256").update(buf).digest("hex")
const wb = new ExcelJS.Workbook()
await wb.xlsx.load(buf)
const parsed = parseReservasWorkbook(wb)
if (parsed.errors.length) { console.error("❌ " + parsed.errors.join(" ")); process.exit(1) }
if (!parsed.rows.length) { console.error("❌ No se encontraron reservas en el archivo."); process.exit(1) }

console.log(`ARCHIVO: ${file.split("/").pop()}`)
console.log(`  ${parsed.totalRows} filas · ${parsed.minDate} → ${parsed.maxDate} · sucursales: ${Object.keys(parsed.byBranch).join(", ")}`)
console.log(`  estados: ${Object.entries(parsed.byStatus).map(([k, v]) => `${k} ${v}`).join(" · ")}`)

const lastPeriod = parsed.periods[parsed.periods.length - 1] || ""
const [py, pm] = lastPeriod ? lastPeriod.split("-").map(Number) : [new Date().getFullYear(), 1]

await runWithBusinessContext(DEPICENTER, async () => {
  // ── Paso 1: abrir la importación ───────────────────────────────────────────
  console.log("\n── Iniciando importación ──")
  const start = await commission.startReservationsImport({
    fileHash, filename: file.split("/").pop(), rowsCount: parsed.totalRows,
    periodStart: parsed.minDate, periodEnd: parsed.maxDate, month: pm, year: py,
    summaryJson: JSON.stringify({ byStatus: parsed.byStatus, byBranch: parsed.byBranch }),
  }, USER)
  if (start?.duplicate) {
    // Ya importado: NO se duplica nada, pero se sigue al cálculo — así este
    // script sirve también para recalcular sin volver a subir el archivo.
    console.log(`ℹ️  El archivo ya estaba importado (${start.existing?.filename}, ${start.existing?.rowsCount} filas). No se duplica nada.`)
  } else {
    if (!start?.ok) throw new Error(start?.error || "No se pudo iniciar")
    const importId = String(start.importId)
    console.log(`  importId ${importId}`)

    // ── Paso 2: insertar en lotes ────────────────────────────────────────────
    let inserted = 0, duplicated = 0
    for (let i = 0; i < parsed.rows.length; i += CHUNK) {
      const part = parsed.rows.slice(i, i + CHUNK)
      const res = await commission.appendReservationsRows(
        { importId, rowsJson: JSON.stringify(part) }, USER)
      if (!res?.ok) throw new Error(res?.error || "Error en un lote")
      inserted += Number(res.inserted) || 0
      duplicated += Number(res.duplicated) || 0
      console.log(`  lote ${Math.floor(i / CHUNK) + 1}: +${res.inserted} nuevas, ${res.duplicated} duplicadas`)
    }

    // ── Paso 3: cerrar y alimentar los conteos de pacientes ──────────────────
    const counts = aggregateAttendance(parsed.rows)
    const fin = await commission.finalizeReservationsImport(
      { importId, countsJson: JSON.stringify(counts), rowsInserted: inserted }, USER)
    if (!fin?.ok) throw new Error("No se pudo finalizar")
    console.log(`✅ Importación confirmada: ${inserted} reservas nuevas, ${duplicated} duplicadas omitidas.`)
    console.log(`   Atenciones por prestador: ${counts.map((c) => `${c.provider} ${c.attended}`).join(" · ")}`)
  }

  // ── Cálculo del período ────────────────────────────────────────────────────
  console.log(`\n── Cálculo de ${String(pm).padStart(2, "0")}/${py} ──`)
  const prev = await commission.getCommissionRunPreview({ month: pm, year: py })
  const results = prev.multi ? prev.results : [{ branch: prev.result.branch, result: prev.result }]
  for (const { branch, result } of results) {
    const L = result.laser
    console.log(`\n  SUCURSAL ${branch}`)
    console.log(`    base láser ${money(L.base)} · tramo ${(L.pct * 100).toFixed(0)}% · fondo ${money(L.fund)}`)
    if (L.cardDiscountBase) console.log(`    descuento por tarjeta: ${money(L.cardDiscountBase)}`)
    console.log(`    pacientes: ${L.patientsSource || "(sin fuente)"}`)
    console.log(`    ${"PRESTADORA".padEnd(12)} ${"PAC".padStart(5)} ${"LÁSER".padStart(12)} ${"SERV".padStart(10)} ${"PROD".padStart(9)} ${"NETO".padStart(12)}`)
    let tot = 0
    for (const it of result.items) {
      console.log(`    ${String(it.name).padEnd(12)} ${String(it.patients ?? 0).padStart(5)} ${money(it.laserTotal).padStart(12)} ${money(it.serviceIncentive).padStart(10)} ${money(it.productIncentive).padStart(9)} ${money(it.netTotal).padStart(12)}`)
      tot += Number(it.netTotal) || 0
    }
    console.log(`    ${"TOTAL".padEnd(12)} ${"".padStart(5)} ${"".padStart(12)} ${"".padStart(10)} ${"".padStart(9)} ${money(tot).padStart(12)}`)
    for (const a of result.alerts || []) console.log(`    ⚠️  ${a}`)

    if (doSave) {
      const saved = await commission.saveCommissionRun({ branch, month: pm, year: py }, USER)
      console.log(`    💾 run guardado: ${saved?.ok ? "OK" : JSON.stringify(saved)}`)
    }
  }
  if (!doSave) console.log("\n(cálculo NO guardado — volver a correr con --save para persistirlo)")
})

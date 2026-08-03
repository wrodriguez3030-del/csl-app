/**
 * Diagnóstico del archivo de RESERVAS que rechaza el importador de Incentivos.
 *
 * Corre el MISMO parser que usa el navegador (lib/commission/reservations-parser)
 * y reporta, en lenguaje claro, por qué el archivo pasa o falla: hojas que trae,
 * fila de encabezados, encabezados detectados, cuáles de los obligatorios faltan
 * y una muestra de filas ya normalizadas.
 *
 * Uso:
 *   node --import tsx scripts/diagnose-reservas-xlsx.mjs <ruta al .xlsx>
 */
import { readFile } from "node:fs/promises"
import ExcelJS from "exceljs"
import { parseReservasWorkbook } from "../lib/commission/reservations-parser.ts"
import { normalizeName } from "../lib/commission/normalize.ts"

const REQUIRED = ["fecha de realizacion", "local", "servicio", "prestador", "estado"]

const file = process.argv[2]
if (!file) {
  console.error("Falta la ruta del archivo.\n  node --import tsx scripts/diagnose-reservas-xlsx.mjs <ruta.xlsx>")
  process.exit(1)
}

const flat = (v) => {
  if (v && typeof v === "object") {
    if (v instanceof Date) return v.toISOString()
    if (v.result !== undefined) return v.result
    if (v.text !== undefined) return v.text
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("")
  }
  return v
}
const str = (v) => String(flat(v) ?? "").trim()

const buf = await readFile(file)
const wb = new ExcelJS.Workbook()
try {
  await wb.xlsx.load(buf)
} catch (e) {
  console.log("❌ ExcelJS no pudo abrir el archivo.")
  console.log("   Motivo:", e instanceof Error ? e.message : String(e))
  console.log("   Causa habitual: el archivo NO es .xlsx real (es .xls antiguo, .csv renombrado o está protegido).")
  process.exit(0)
}

console.log("ARCHIVO:", file, `(${(buf.length / 1024).toFixed(0)} KB)`)
console.log("\n── HOJAS ──")
for (const ws of wb.worksheets) {
  console.log(`  • "${ws.name}" — ${ws.rowCount} filas × ${ws.columnCount} columnas`)
}

const ws = wb.getWorksheet("Reservas") || wb.worksheets[0]
if (!ws) {
  console.log("\n❌ El libro no tiene ninguna hoja legible.")
  process.exit(0)
}
console.log(`\nHoja que usaría el importador: "${ws.name}"` + (wb.getWorksheet("Reservas") ? "" : "  (⚠️ no se llama \"Reservas\": cae a la primera hoja)"))

// ¿En qué fila están de verdad los encabezados?
console.log("\n── BÚSQUEDA DE LA FILA DE ENCABEZADOS (primeras 6 filas) ──")
for (let r = 1; r <= Math.min(6, ws.rowCount); r++) {
  const cells = []
  for (let c = 1; c <= Math.min(ws.columnCount, 40); c++) {
    const v = str(ws.getRow(r).getCell(c).value)
    if (v) cells.push(v)
  }
  const norm = new Set(cells.map((v) => normalizeName(v).toLowerCase()))
  const hits = REQUIRED.filter((h) => norm.has(h)).length
  console.log(`  fila ${r}: ${hits}/${REQUIRED.length} encabezados obligatorios · ${cells.length} celdas con texto`)
  if (r === 1 || hits > 0) console.log(`     → ${cells.slice(0, 32).join(" | ")}`)
}

// Lo que ve el parser real (siempre lee la fila 1).
const headerIdx = {}
for (let c = 1; c <= ws.columnCount; c++) {
  const h = normalizeName(str(ws.getRow(1).getCell(c).value)).toLowerCase()
  if (h) headerIdx[h] = c
}
const faltan = REQUIRED.filter((h) => !headerIdx[h])
console.log("\n── ENCABEZADOS OBLIGATORIOS (leídos de la fila 1, como hace el importador) ──")
for (const h of REQUIRED) console.log(`  ${headerIdx[h] ? "✅" : "❌"} "${h}"${headerIdx[h] ? ` → columna ${headerIdx[h]}` : ""}`)

const res = parseReservasWorkbook(wb)
console.log("\n── RESULTADO DEL PARSER ──")
if (res.errors.length) {
  console.log("❌ RECHAZADO. Mensaje que ves en pantalla:")
  for (const e of res.errors) console.log(`     "${e}"`)
  if (faltan.length) {
    console.log("\n   Encabezados que SÍ trae la fila 1 (normalizados):")
    console.log("     " + Object.keys(headerIdx).join(" | "))
  }
} else if (!res.rows.length) {
  console.log('❌ RECHAZADO. Mensaje en pantalla: "No se encontraron reservas en el archivo."')
  console.log("   Los encabezados están bien, pero ninguna fila produjo datos válidos.")
  console.log("   Sospecha principal: la columna \"Fecha de realización\" viene vacía o en un formato que no se reconoce.")
  for (let r = 2; r <= Math.min(4, ws.rowCount); r++) {
    console.log(`     fila ${r} · fecha de realizacion = "${str(ws.getRow(r).getCell(headerIdx["fecha de realizacion"] || 1).value)}"`)
  }
} else {
  console.log(`✅ ACEPTADO. ${res.totalRows} filas · ${res.minDate} → ${res.maxDate}`)
  console.log("   Por estado:", JSON.stringify(res.byStatus))
  console.log("   Por sucursal:", JSON.stringify(res.byBranch))
  console.log("   Períodos:", res.periods.join(", "))
  console.log("   Sin prestador confiable:", res.missingProvider)
  console.log("\n   → El archivo parsea bien. Si aun así falla al confirmar, el problema está en el servidor,")
  console.log("     no en el archivo (revisar el mensaje exacto del toast al pulsar «Confirmar importación»).")
}

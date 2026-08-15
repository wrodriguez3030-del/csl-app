import ExcelJS from "exceljs"
import { parseProductSheet, detectStockColumns, unresolvedStockColumns, summarizeImport, dedupeByClave } from "../lib/productos-import.ts"
import { buildReporteData, kpisDeSucursal, buildConsolidado } from "../lib/inventario-productos-pdf.ts"

const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(process.argv[2])
const toMatrix = (ws) => {
  const out = []
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r); const vals = []
    for (let c = 1; c <= ws.columnCount; c++) {
      let v = row.getCell(c).value
      if (v && typeof v === "object" && "result" in v) v = v.result
      if (v && typeof v === "object" && "richText" in v) v = v.richText.map(t => t.text).join("")
      vals.push(v ?? "")
    }
    out.push(vals)
  }
  return out
}
const activos = toMatrix(wb.getWorksheet("Productos"))
const inactivos = toMatrix(wb.getWorksheet("Inactivos"))
const SUC = ["LOS JARDINES", "RAFAEL VIDAL", "VILLA OLGA"]

console.log("columnas:", detectStockColumns(activos[0], SUC).map(c => `${c.columna.trim()} → ${c.sucursal}`))
console.log("sin mapear:", unresolvedStockColumns(activos[0], SUC))
const a = parseProductSheet(activos, { activo: true, sucursales: SUC })
const i = parseProductSheet(inactivos, { activo: false, sucursales: SUC })
const todos = dedupeByClave([...a, ...i])
console.log("activos:", a.length, "| inactivos:", i.length, "| dedupe:", todos.length)
console.log("resumen:", summarizeImport(todos))
const recs = todos.map(p => ({ nombre: p.nombre, sku: p.sku, stock: p.stock }))
const [rv] = buildReporteData(recs, ["RAFAEL VIDAL"])
console.log("\nRAFAEL VIDAL:", kpisDeSucursal(rv.items, 2))
console.log(rv.items.slice(0, 5).map((x, n) => `  ${n + 1}. ${x.nombre} — ${x.cantidad}`).join("\n"))
const cons = buildConsolidado(recs, SUC)
console.log("\nconsolidado:", cons.totales, "total:", cons.totalGeneral, "| productos:", cons.items.length)

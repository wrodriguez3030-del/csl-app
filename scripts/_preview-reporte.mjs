/** Genera el HTML del reporte con datos reales para revisarlo antes de imprimir. */
import fs from "node:fs"
import ExcelJS from "exceljs"
import { parseProductSheet, dedupeByClave } from "../lib/productos-import.ts"
import { buildReporteData, buildProductosPdfHtml } from "../lib/inventario-productos-pdf.ts"

const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(process.argv[2])
const toMatrix = (ws) => { const o=[]; for(let r=1;r<=ws.rowCount;r++){const row=ws.getRow(r);const v=[];for(let c=1;c<=ws.columnCount;c++){let x=row.getCell(c).value; if(x&&typeof x==="object"&&"result"in x)x=x.result; if(x&&typeof x==="object"&&"richText"in x)x=x.richText.map(t=>t.text).join(""); v.push(x??"")} o.push(v)} return o }
const SUC = ["LOS JARDINES", "RAFAEL VIDAL", "VILLA OLGA"]
const a = parseProductSheet(toMatrix(wb.getWorksheet("Productos")), { activo: true, sucursales: SUC })
const i = parseProductSheet(toMatrix(wb.getWorksheet("Inactivos")), { activo: false, sucursales: SUC })
const records = dedupeByClave([...i, ...a]).map((p) => ({ nombre: p.nombre, sku: p.sku, stock: p.stock }))

const business = { slug: "csl", name: "Cibao Spa Laser", shortName: "CSL", primaryColor: "#14B7B0", logoUrl: "" }
const html = buildProductosPdfHtml({
  data: buildReporteData(records, ["RAFAEL VIDAL", "LOS JARDINES"]),
  records, business, periodo: "MES JUNIO", umbral: 2,
  origin: "http://localhost:3000", generadoPor: "Willian", consolidado: true,
})
fs.writeFileSync(process.argv[3], html)
console.log("HTML escrito en", process.argv[3])

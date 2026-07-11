/** Análisis del archivo SISTEMA INCENTIVOS .xlsx (solo lectura). Dump de hojas,
 *  dimensiones, celdas con contenido y fórmulas para entender el cuadro real. */
import ExcelJS from "exceljs"

const FILE = "C:/Users/ADMIN/Downloads/SISTEMA INCENTIVOS .xlsx"
const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(FILE)

console.log(`Hojas (${wb.worksheets.length}):`, wb.worksheets.map((w) => `"${w.name}" (${w.rowCount}x${w.columnCount})`).join(", "))

for (const ws of wb.worksheets) {
  console.log(`\n═══════════ HOJA: ${ws.name} ═══════════`)
  const maxR = ws.rowCount
  for (let r = 1; r <= maxR; r++) {
    const row = ws.getRow(r)
    const cells = []
    for (let c = 1; c <= Math.min(ws.columnCount, 20); c++) {
      const cell = row.getCell(c)
      let v = cell.value
      if (v == null) continue
      let txt
      if (typeof v === "object") {
        if (v.formula) txt = `={${v.formula}}→${v.result ?? ""}`
        else if (v.richText) txt = v.richText.map((t) => t.text).join("")
        else if (v instanceof Date) txt = v.toISOString().slice(0, 10)
        else if (v.text) txt = v.text
        else txt = JSON.stringify(v)
      } else txt = String(v)
      txt = txt.replace(/\r?\n/g, " ").trim()
      if (txt) cells.push(`${cell.address}:「${txt}」`)
    }
    if (cells.length) console.log(`  R${r}: ${cells.join(" | ")}`)
  }
  if (ws.rowCount > 120) console.log(`  … (${ws.rowCount - 120} filas más)`)
}

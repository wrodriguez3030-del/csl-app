/**
 * Genera el reporte mensual del negocio sin pasar por el navegador.
 * Mismo código que el botón de la app: si aquí sale bien, allí también.
 *
 *   node --import tsx scripts/generar-reporte-mensual.mjs <slug> <mes> <año> [carpeta]
 */
import fs from "node:fs"
import path from "node:path"
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim()
}
const NEGOCIOS = { csl: "66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6", depicenter: "03b96698-c5df-4b4b-84df-1160a7ad56b9" }
const [slug, mes, anio, carpeta = process.env.HOME + "/Downloads"] = process.argv.slice(2)
if (!NEGOCIOS[slug]) { console.error(`Negocio desconocido. Usa: ${Object.keys(NEGOCIOS).join(" | ")}`); process.exit(1) }

const ExcelJS = (await import("exceljs")).default
const { runWithBusinessContext } = await import("../lib/server/business-context.ts")
const { getReporteMensual } = await import("../lib/server/reporte-mensual.ts")
const { buildReporteMensual, nombreReporte } = await import("../lib/commission/reporte-mensual-export.ts")

await runWithBusinessContext(
  { businessId: NEGOCIOS[slug], businessSlug: slug, isSuperadmin: true, isAdmin: true,
    bypassTenantFilter: false, branchScope: { all: true, branches: [] } },
  async () => {
    const d = await getReporteMensual({ month: String(mes), year: String(anio) })
    const wb = await buildReporteMensual(d, ExcelJS)
    const destino = path.join(carpeta, nombreReporte(d))
    await wb.xlsx.writeFile(destino)
    const rd = (n) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })
    console.log(`✅ ${destino}`)
    console.log(`   ventas ${rd(d.resumen.ingresos)} · gastos ${rd(d.resumen.gastos)} · incentivos ${rd(d.resumen.incentivos)}`)
    console.log(`   ${d.liquidacion.length} personas · ${d.gastos.detalle.length} líneas de gasto · ${wb.worksheets.length} hojas`)
  },
)

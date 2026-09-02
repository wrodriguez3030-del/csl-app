import fs from "node:fs"
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim()
}
const { runWithBusinessContext } = await import("../lib/server/business-context.ts")
const { getBiFinanceSummary } = await import("../lib/server/bi-finance.ts")
const CSL = { businessId: "66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6", businessSlug: "csl",
  isSuperadmin: true, isAdmin: true, bypassTenantFilter: false, branchScope: { all: true, branches: [] } }
const rd = (n) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })

await runWithBusinessContext(CSL, async () => {
  const t0 = Date.now()
  const s = await getBiFinanceSummary({ month: 1, year: 2026 })
  console.log(`ENERO 2026 (${Date.now() - t0} ms) · ${s.period.label}`)
  console.log(`  resumen.ingresos          ${rd(s.resumen.ingresos)}   (esperado 1,691,000.00)`)
  console.log(`  gastos.gastosGenerales    ${rd(s.gastos.gastosGenerales)}   (hoy: total mensual migrado)`)
  console.log(`  gastos.total              ${rd(s.gastos.total)}`)
  console.log(`  inversiones.general       ${rd(s.inversiones.general)}   (esperado 403,117.98)`)
  console.log(`  inversiones.byBranch      ${JSON.stringify(s.inversiones.byBranch)}   (esperado VILLA OLGA 484,243.20)`)
  console.log(`  retiros                   ${JSON.stringify(s.retiros)}`)
  console.log(`  flujo                     ${JSON.stringify(s.flujo)}`)
  console.log(`  trend (6)                 ${s.trend.map((t) => `${t.key}:${Math.round(t.ingresos)}/${Math.round(t.gastos)}`).join("  ")}`)
  console.log(`  flujoMensual.length       ${s.flujoMensual.length}`)
  const ene = s.flujoMensual.find((r) => r.key === "2026-01")
  console.log(`  flujoMensual[2026-01]     ventas=${rd(ene.ventas)} gastos=${rd(ene.gastosOperativos)} invG=${rd(ene.inversionGeneral)} invVO=${rd(ene.inversionByBranch["VILLA OLGA"])} neto=${rd(ene.neto)}`)
  console.log(`  ventasByBranch[2026-01]   ${JSON.stringify(ene.ventasByBranch)}`)
  console.log(`  gastosByBranch[2026-01]   ${JSON.stringify(ene.gastosByBranch)}`)
  const ps = Object.entries(s.ingresos.porServicio).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  console.log(`  porServicio               ${ps.map(([k, v]) => `${k}=${Math.round(v)}`).join("  ")}`)
  console.log(`  historicoAnual            ${s.historicoAnual.map((h) => `${h.year}:${Math.round(h.ventas / 1000)}k${h.crecimientoPct != null ? `(${h.crecimientoPct}%)` : ""}${h.parcial ? "*" : ""}`).join("  ")}`)
  console.log(`  rentabilidad              ${s.rentabilidad.map((r) => `${r.branch}: ing ${Math.round(r.ingresos)} gas ${Math.round(r.gastos)} marg ${r.margenNeto}%`).join(" | ")}`)

  const t1 = Date.now()
  const y = await getBiFinanceSummary({ month: 0, year: 2026 })
  console.log(`\nAÑO 2026 (${Date.now() - t1} ms) · ${y.period.label} · ingresos ${rd(y.resumen.ingresos)} · inversiones ${rd(y.inversiones.total)} · flujo neto ${rd(y.flujo.neto)}`)
  const vo = await getBiFinanceSummary({ month: 1, year: 2026, branch: "VILLA OLGA" })
  console.log(`VILLA OLGA ene-2026 · ingresos ${rd(vo.resumen.ingresos)} · inv general ${rd(vo.inversiones.general)} (esperado 0 con filtro) · inv VO ${rd(vo.inversiones.byBranch["VILLA OLGA"])}`)
})

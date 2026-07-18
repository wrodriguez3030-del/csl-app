/**
 * BI FINANCIERO IA — Exportadores ejecutivos (Excel multihoja + PDF imprimible).
 * Reutiliza el branding del tenant (nunca hardcodea CSL). Excel vía ExcelJS
 * (import dinámico), PDF vía ventana de impresión (mismo patrón que comisión).
 */
import type { BusinessBranding } from "@/lib/business"
import type { BiSummary } from "@/components/bi-finance/bi-shared"

const argb = (hex: string) => "FF" + (hex || "#0891b2").replace("#", "").toUpperCase().padStart(6, "0").slice(0, 6)
const rd = (n: number) => Math.round(Number(n) || 0)

type Col = { header: string; key: string; width?: number; money?: boolean; pct?: boolean }

export async function exportBiFinanceExcel(summary: BiSummary, branding: BusinessBranding) {
  const ExcelJS = (await import("exceljs")).default
  const wb = new ExcelJS.Workbook()
  wb.creator = branding.name
  const brand = argb(branding.primaryColor)
  const thin = { style: "thin" as const, color: { argb: "FFCBD5E1" } }
  const border = { top: thin, left: thin, bottom: thin, right: thin }

  function addSheet(name: string, title: string, cols: Col[], rows: Record<string, unknown>[], totals?: Record<string, unknown>) {
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 5 }] })
    ws.columns = cols.map((c) => ({ key: c.key, width: c.width || 18 }))
    const lastCol = cols.length
    // Encabezado corporativo
    ws.mergeCells(1, 1, 1, lastCol)
    const h = ws.getCell(1, 1); h.value = branding.name.toUpperCase(); h.font = { bold: true, size: 14, color: { argb: brand } }
    ws.getRow(1).height = 30
    ws.mergeCells(2, 1, 2, lastCol)
    const s = ws.getCell(2, 1); s.value = `BI FINANCIERO · ${title}`; s.font = { bold: true, size: 11, color: { argb: "FF475569" } }
    ws.mergeCells(3, 1, 3, lastCol)
    const p = ws.getCell(3, 1); p.value = `Período: ${summary.period.label}`; p.font = { size: 10, color: { argb: "FF475569" } }
    ws.addRow([])
    // Header de columnas (fila 5)
    const hr = ws.getRow(5)
    cols.forEach((c, i) => {
      const cell = hr.getCell(i + 1)
      cell.value = c.header
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } }
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: brand } }
      cell.alignment = { vertical: "middle", horizontal: c.money || c.pct ? "right" : "left" }
      cell.border = border
    })
    hr.height = 20
    // Filas
    for (const r of rows) {
      const row = ws.addRow(cols.map((c) => {
        const v = r[c.key]
        if (c.money) return rd(Number(v))
        if (c.pct) return v == null ? "" : Number(v) / 100
        return v ?? ""
      }))
      cols.forEach((c, i) => {
        const cell = row.getCell(i + 1)
        cell.border = border
        if (c.money) { cell.numFmt = '"RD$"#,##0'; cell.alignment = { horizontal: "right" } }
        if (c.pct) { cell.numFmt = "0.0%"; cell.alignment = { horizontal: "right" } }
      })
    }
    // Totales
    if (totals) {
      const row = ws.addRow(cols.map((c) => {
        const v = totals[c.key]
        if (c.money) return rd(Number(v))
        if (c.pct) return v == null ? "" : Number(v) / 100
        return v ?? ""
      }))
      cols.forEach((c, i) => {
        const cell = row.getCell(i + 1)
        cell.font = { bold: true }
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } }
        cell.border = border
        if (c.money) { cell.numFmt = '"RD$"#,##0'; cell.alignment = { horizontal: "right" } }
        if (c.pct) { cell.numFmt = "0.0%"; cell.alignment = { horizontal: "right" } }
      })
    }
  }

  // Hoja 1 — Resumen
  const r = summary.resumen
  addSheet("Resumen", "Resumen ejecutivo", [
    { header: "Indicador", key: "k", width: 28 }, { header: "Valor", key: "v", width: 20, money: false },
  ], [
    { k: "Ingresos", v: `RD$${rd(r.ingresos).toLocaleString()}` },
    { k: "Gastos", v: `RD$${rd(r.gastos).toLocaleString()}` },
    { k: "Utilidad neta", v: `RD$${rd(r.utilidadNeta).toLocaleString()}` },
    { k: "Margen neto", v: `${r.margenNeto.toFixed(1)}%` },
    { k: "Ticket promedio", v: `RD$${rd(r.ticketPromedio).toLocaleString()}` },
    { k: "Transacciones", v: r.transacciones },
    { k: "Pacientes", v: r.pacientes },
  ])

  // Hoja 2 — Rentabilidad por sucursal
  addSheet("Rentabilidad", "Rentabilidad por sucursal", [
    { header: "Sucursal", key: "branch", width: 22 },
    { header: "Ingresos", key: "ingresos", money: true },
    { header: "Facturas", key: "facturas", money: true },
    { header: "Generales", key: "generales", money: true },
    { header: "Menores", key: "menores", money: true },
    { header: "Recurrentes", key: "recurrentes", money: true },
    { header: "Overhead", key: "overhead", money: true },
    { header: "Gastos", key: "gastos", money: true },
    { header: "Utilidad", key: "utilidad", money: true },
    { header: "Margen", key: "margen", pct: true },
  ], summary.rentabilidad.map((b) => ({
    branch: b.branch, ingresos: b.ingresos, facturas: b.desglose.facturas, generales: b.desglose.gastosGenerales,
    menores: b.desglose.gastosMenores, recurrentes: b.desglose.recurrentes, overhead: b.desglose.overheadAsignado,
    gastos: b.gastos, utilidad: b.utilidadNeta, margen: b.margenNeto,
  })), {
    branch: "TOTAL", ingresos: r.ingresos, overhead: summary.gastos.overhead.total, gastos: r.gastos, utilidad: r.utilidadNeta, margen: r.margenNeto,
  })

  // Hoja 3 — Ingresos por categoría/sucursal
  addSheet("Ingresos", "Ingresos por sucursal", [
    { header: "Sucursal", key: "branch", width: 22 },
    { header: "Servicios", key: "servicio", money: true },
    { header: "Productos", key: "producto", money: true },
    { header: "Depilación láser", key: "laser", money: true },
    { header: "Total", key: "total", money: true },
  ], summary.rentabilidad.map((b) => ({
    branch: b.branch, servicio: b.categorias.servicio, producto: b.categorias.producto, laser: b.categorias.laser, total: b.ingresos,
  })), {
    branch: "TOTAL", servicio: summary.ingresos.porCategoria.servicio, producto: summary.ingresos.porCategoria.producto,
    laser: summary.ingresos.porCategoria.laser, total: summary.ingresos.total,
  })

  // Hoja 4 — Gastos
  const g = summary.gastos
  addSheet("Gastos", "Gastos y egresos", [
    { header: "Rubro", key: "k", width: 28 }, { header: "Monto", key: "v", money: true },
  ], [
    { k: "Facturas de proveedores", v: g.facturas },
    { k: "Gastos generales", v: g.gastosGenerales },
    { k: "Gastos menores", v: g.gastosMenores },
    { k: "Pagos recurrentes", v: g.recurrentes },
    { k: "Nómina", v: g.nomina },
    { k: "Materiales (informativo)", v: g.materiales },
  ], { k: "TOTAL GASTOS", v: g.total })

  // Hoja 5 — Tendencia
  addSheet("Tendencia", "Tendencia 6 meses", [
    { header: "Mes", key: "label", width: 16 },
    { header: "Ingresos", key: "ingresos", money: true },
    { header: "Gastos", key: "gastos", money: true },
    { header: "Utilidad", key: "utilidad", money: true },
  ], summary.trend.map((t) => ({ label: t.label, ingresos: t.ingresos, gastos: t.gastos, utilidad: t.utilidad })))

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `BI-Financiero-${branding.shortName}-${summary.period.year}-${String(summary.period.month).padStart(2, "0")}.xlsx`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function printBiFinancePdf(summary: BiSummary, branding: BusinessBranding, origin: string) {
  const brand = branding.primaryColor || "#0891b2"
  const r = summary.resumen
  const money = (n: number) => `RD$${rd(n).toLocaleString()}`
  const rows = summary.rentabilidad.map((b) => `
    <tr>
      <td>${b.branch}</td>
      <td class="r">${money(b.ingresos)}</td>
      <td class="r">${money(b.gastos)}</td>
      <td class="r">${money(b.utilidadNeta)}</td>
      <td class="r">${b.margenNeto.toFixed(1)}%</td>
    </tr>`).join("")
  const trend = summary.trend.map((t) => `<tr><td>${t.label}</td><td class="r">${money(t.ingresos)}</td><td class="r">${money(t.gastos)}</td><td class="r">${money(t.utilidad)}</td></tr>`).join("")

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>BI Financiero · ${branding.name} · ${summary.period.label}</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 0; }
    .head { display:flex; align-items:center; gap:12px; border-bottom: 3px solid ${brand}; padding-bottom: 10px; margin-bottom: 14px; }
    .logo { width:52px; height:52px; border-radius:10px; object-fit:contain; }
    .logo-circle { width:52px; height:52px; border-radius:10px; background:${brand}; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; }
    h1 { font-size: 18px; margin: 0; color:${brand}; }
    .sub { color:#475569; font-size: 12px; }
    .kpis { display:flex; gap:10px; margin: 12px 0; }
    .kpi { flex:1; border:1px solid #e2e8f0; border-radius:10px; padding:8px 10px; }
    .kpi .l { font-size:9px; text-transform:uppercase; color:#64748b; letter-spacing:.04em; }
    .kpi .v { font-size:16px; font-weight:800; color:#0f172a; }
    table { width:100%; border-collapse: collapse; margin-top: 8px; font-size: 11px; }
    th { background:${brand}; color:#fff; text-align:left; padding:6px 8px; }
    td { border:1px solid #e2e8f0; padding:5px 8px; }
    td.r, th.r { text-align: right; }
    tfoot td { font-weight:800; background:#f1f5f9; }
    h2 { font-size: 13px; color:${brand}; margin: 16px 0 4px; }
    .foot { margin-top: 16px; color:#94a3b8; font-size: 10px; }
  </style></head><body>
    <div class="head">
      <img src="${origin}${branding.logoUrl}" class="logo" onerror="this.outerHTML='<div class=&quot;logo-circle&quot;>${branding.shortName}</div>'"/>
      <div><h1>${branding.name}</h1><div class="sub">BI Financiero · ${summary.period.label}</div></div>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="l">Ingresos</div><div class="v">${money(r.ingresos)}</div></div>
      <div class="kpi"><div class="l">Gastos</div><div class="v">${money(r.gastos)}</div></div>
      <div class="kpi"><div class="l">Utilidad neta</div><div class="v">${money(r.utilidadNeta)}</div></div>
      <div class="kpi"><div class="l">Margen neto</div><div class="v">${r.margenNeto.toFixed(1)}%</div></div>
      <div class="kpi"><div class="l">Pacientes</div><div class="v">${r.pacientes.toLocaleString()}</div></div>
    </div>
    <h2>Rentabilidad por sucursal</h2>
    <table><thead><tr><th>Sucursal</th><th class="r">Ingresos</th><th class="r">Gastos</th><th class="r">Utilidad</th><th class="r">Margen</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td>TOTAL</td><td class="r">${money(r.ingresos)}</td><td class="r">${money(r.gastos)}</td><td class="r">${money(r.utilidadNeta)}</td><td class="r">${r.margenNeto.toFixed(1)}%</td></tr></tfoot></table>
    <h2>Tendencia 6 meses</h2>
    <table><thead><tr><th>Mes</th><th class="r">Ingresos</th><th class="r">Gastos</th><th class="r">Utilidad</th></tr></thead><tbody>${trend}</tbody></table>
    <div class="foot">${branding.footerText} · Reporte generado el ${new Date().toLocaleString("es-DO")} · Cifras en RD$ · Datos agregados del sistema.</div>
  </body></html>`

  const popup = window.open("", "_blank", "width=1100,height=800")
  if (!popup) return
  popup.document.write(html)
  popup.document.close()
  popup.onload = () => setTimeout(() => popup.print(), 400)
}

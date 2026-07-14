"use client"

/**
 * Exportación profesional de Incentivos de Ventas:
 * - `exportCommissionExcel`: .xlsx nativo con ExcelJS, 11 hojas (Resumen,
 *   Sucursal, Prestador, Productos, Servicios, Servicios Detalle, Láser,
 *   Clientes, Liquidación, Reglas, Conciliación) con encabezado corporativo,
 *   colores de marca, bordes, freeze panes, autofiltro, moneda RD$ y totales.
 * - `printCommissionPdf`: HTML branded A4 (window.print) con las tablas clave.
 */
import type { Business } from "@/lib/types"
import { CATEGORY_LABELS } from "@/lib/commission/classification"

type ExcelJSModule = typeof import("exceljs")

const MONTHS = ["Todos los meses", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

export interface CommissionReportData {
  period: { month: number; year: number }
  totals: { productIncentive: number; serviceCommission: number; laserIncentive: number; bonusExtra: number; grossTotal: number; cleaningContribution: number; netTotal: number }
  branches: { branch: string; gross: number; tarjeta: number; efectivo: number; transferencia: number; otros: number; cardPct: number; cardResult: number; producto: number; servicio: number; laser: number }[]
  calculations: { provider: string; branch: string; productsCount: number; productIncentive: number; serviceCommission: number; laserIncentive: number; fixedIncentive: number; manualAdjustment: number; bonusExtra: number; grossTotal: number; cleaningContribution: number; netTotal: number; status: string }[]
  patients: { total: number; roundingDiff: number; rows: { provider: string; branch: string; patients: number; participation: number }[] }
  laser: { laserTotal: number; tramoPct: number; threshold: number; fund: number; patientsTotal: number; distribution: { provider: string; patients: number; participation: number; amount: number }[] }
  rules: { name: string; ruleType: string; category: string | null; percentage: number | null; fixedAmount: number | null; minAmount: number | null; active: boolean }[]
  /** Detalle prestador × categoría de la comisión de servicios (venta base × %). */
  serviceDetail?: { provider: string; branch: string; category: string; base: number; pct: number; amount: number }[]
  generadoPor?: string
}

const argb = (color: string) => { const c = (color || "#0891b2").replace("#", ""); const rgb = c.length === 3 ? c.split("").map((x) => x + x).join("") : c.slice(0, 6); return ("FF" + rgb).toUpperCase() }
const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const fmtRD = (n: number) => "RD$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const commissionFileBase = (business: Business, month: number, year: number) =>
  `INCENTIVOS_VENTAS_${(MONTHS[month] || "").toUpperCase()}_${year}`

function pickExt(ct: string | null, url: string): "png" | "jpeg" | "gif" | null {
  const s = (ct || "").toLowerCase()
  if (s.includes("png") || /\.png($|\?)/i.test(url)) return "png"
  if (s.includes("jpeg") || s.includes("jpg") || /\.jpe?g($|\?)/i.test(url)) return "jpeg"
  if (s.includes("gif") || /\.gif($|\?)/i.test(url)) return "gif"
  return null
}
async function fetchLogo(business: Business, origin: string): Promise<{ base64: string; extension: "png" | "jpeg" | "gif" } | null> {
  if (!business.logoUrl) return null
  try {
    const url = /^https?:/.test(business.logoUrl) ? business.logoUrl : `${origin}${business.logoUrl}`
    const resp = await fetch(url)
    if (!resp.ok) return null
    const ext = pickExt(resp.headers.get("content-type"), url)
    if (!ext) return null
    const bytes = new Uint8Array(await resp.arrayBuffer())
    let bin = ""
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return { base64: btoa(bin), extension: ext }
  } catch { return null }
}

interface Col { header: string; key: string; money?: boolean; pct?: boolean; width?: number; align?: "left" | "right" | "center" }

export async function buildCommissionWorkbook(
  data: CommissionReportData, business: Business, ExcelJS: ExcelJSModule,
  logo: { base64: string; extension: "png" | "jpeg" | "gif" } | null,
) {
  const brand = argb(business.primaryColor || "#0891b2")
  const wb = new ExcelJS.Workbook()
  wb.creator = business.name || "CSL"
  const periodLabel = `${MONTHS[data.period.month] || ""} ${data.period.year}`
  const thin = () => { const s = { style: "thin" as const, color: { argb: "FFCBD5E1" } }; return { top: s, left: s, bottom: s, right: s } }

  const addTableSheet = (name: string, title: string, columns: Col[], rows: Record<string, unknown>[], totals?: Record<string, unknown>, withLogo = false) => {
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 6 }] })
    ws.columns = columns.map((c) => ({ width: c.width || 18 }))
    if (withLogo && logo) { try { const id = wb.addImage({ base64: logo.base64, extension: logo.extension }); ws.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: 130, height: 46 } }) } catch { /* */ } }
    ws.mergeCells(1, 2, 1, columns.length); const nm = ws.getCell(1, 2); nm.value = (business.name || "").toUpperCase(); nm.font = { bold: true, size: 14, color: { argb: brand } }; ws.getRow(1).height = 38
    ws.mergeCells(2, 1, 2, columns.length); const tl = ws.getCell(2, 1); tl.value = `INCENTIVOS DE VENTAS · ${title}`; tl.font = { bold: true, size: 12, color: { argb: brand } }
    ws.mergeCells(3, 1, 3, columns.length); ws.getCell(3, 1).value = `Período: ${periodLabel}`; ws.getCell(3, 1).font = { size: 10, color: { argb: "FF475569" } }
    ws.mergeCells(4, 1, 4, columns.length); ws.getCell(4, 1).value = `Generado por: ${data.generadoPor || "—"}`; ws.getCell(4, 1).font = { size: 10, color: { argb: "FF475569" } }
    const hr = ws.getRow(6)
    columns.forEach((c, i) => { const cell = hr.getCell(i + 1); cell.value = c.header; cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: brand } }; cell.alignment = { horizontal: c.align || (c.money || c.pct ? "right" : "left"), vertical: "middle" }; cell.border = thin() })
    hr.height = 18
    let r = 7
    for (const row of rows) {
      const rr = ws.getRow(r)
      columns.forEach((c, i) => {
        const cell = rr.getCell(i + 1); const v = row[c.key]
        if (c.money) { cell.value = Number(v) || 0; cell.numFmt = '"RD$"#,##0.00'; cell.alignment = { horizontal: "right" } }
        else if (c.pct) { cell.value = Number(v) || 0; cell.numFmt = "0.00%"; cell.alignment = { horizontal: "right" } }
        else { cell.value = (v as string | number) ?? ""; cell.alignment = { horizontal: c.align || "left" } }
        cell.border = thin()
      })
      r++
    }
    if (totals) {
      const tr = ws.getRow(r)
      columns.forEach((c, i) => {
        const cell = tr.getCell(i + 1); const v = totals[c.key]
        if (i === 0 && v === undefined) cell.value = "TOTALES"
        else if (c.money) { cell.value = Number(v) || 0; cell.numFmt = '"RD$"#,##0.00' }
        else cell.value = (v as string | number) ?? ""
        cell.font = { bold: true }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } }; cell.border = thin()
      })
    }
    if (rows.length) ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: columns.length } }
    return ws
  }

  const addKvSheet = (name: string, title: string, pairs: [string, string | number, boolean?][]) => {
    const ws = wb.addWorksheet(name)
    ws.columns = [{ width: 40 }, { width: 24 }]
    if (logo && name === "Resumen General") { try { const id = wb.addImage({ base64: logo.base64, extension: logo.extension }); ws.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: 130, height: 46 } }) } catch { /* */ } }
    ws.getCell(1, 2).value = (business.name || "").toUpperCase(); ws.getCell(1, 2).font = { bold: true, size: 14, color: { argb: brand } }; ws.getRow(1).height = 38
    ws.getCell(2, 1).value = `INCENTIVOS DE VENTAS · ${title}`; ws.getCell(2, 1).font = { bold: true, size: 12, color: { argb: brand } }
    ws.getCell(3, 1).value = `Período: ${periodLabel}`; ws.getCell(3, 1).font = { size: 10, color: { argb: "FF475569" } }
    let r = 5
    for (const [label, value, money] of pairs) {
      ws.getCell(r, 1).value = label; ws.getCell(r, 1).font = { color: { argb: "FF475569" } }
      const cell = ws.getCell(r, 2)
      if (money) { cell.value = Number(value) || 0; cell.numFmt = '"RD$"#,##0.00' } else cell.value = value
      cell.font = { bold: true }; r++
    }
    return ws
  }

  const t = data.totals
  const subtotal = Math.round((t.productIncentive + t.serviceCommission + t.laserIncentive) * 100) / 100
  addKvSheet("Resumen General", "Resumen general", [
    ["Incentivo productos", t.productIncentive, true], ["Comisiones servicios", t.serviceCommission, true],
    ["Incentivo láser", t.laserIncentive, true], ["Bono extra", t.bonusExtra, true],
    ["Subtotal", subtotal, true], ["Total bruto", t.grossTotal, true],
    ["Aporte limpieza", t.cleaningContribution, true], ["TOTAL NETO", t.netTotal, true],
  ])

  addTableSheet("Ventas por Sucursal", "Ventas por sucursal",
    [{ header: "Sucursal", key: "branch", width: 28 }, { header: "Bruto", key: "gross", money: true }, { header: "Tarjeta", key: "tarjeta", money: true }, { header: "Efectivo", key: "efectivo", money: true }, { header: "Transferencia", key: "transferencia", money: true }, { header: "Otros", key: "otros", money: true }, { header: "Result. tarjeta", key: "cardResult", money: true }, { header: "Productos", key: "producto", money: true }, { header: "Servicios", key: "servicio", money: true }, { header: "Láser", key: "laser", money: true }],
    data.branches as unknown as Record<string, unknown>[],
    { gross: sum(data.branches, "gross"), tarjeta: sum(data.branches, "tarjeta"), efectivo: sum(data.branches, "efectivo"), transferencia: sum(data.branches, "transferencia"), otros: sum(data.branches, "otros"), cardResult: sum(data.branches, "cardResult"), producto: sum(data.branches, "producto"), servicio: sum(data.branches, "servicio"), laser: sum(data.branches, "laser") },
    true)

  const calcCols: Col[] = [{ header: "Prestador", key: "provider", width: 24 }, { header: "Sucursal", key: "branch", width: 22 }, { header: "Prod. (u)", key: "productsCount", align: "right" }, { header: "Inc. productos", key: "productIncentive", money: true }, { header: "Com. servicios", key: "serviceCommission", money: true }, { header: "Láser", key: "laserIncentive", money: true }, { header: "Ajuste", key: "manualAdjustment", money: true }, { header: "Bono", key: "bonusExtra", money: true }, { header: "Bruto", key: "grossTotal", money: true }, { header: "Limpieza", key: "cleaningContribution", money: true }, { header: "Neto", key: "netTotal", money: true }, { header: "Estado", key: "status" }]
  addTableSheet("Ventas por Prestador", "Comisiones por prestador", calcCols, data.calculations as unknown as Record<string, unknown>[],
    { netTotal: sum(data.calculations, "netTotal"), grossTotal: sum(data.calculations, "grossTotal"), productIncentive: sum(data.calculations, "productIncentive"), serviceCommission: sum(data.calculations, "serviceCommission") })

  addTableSheet("Incentivos Productos", "Incentivos de productos",
    [{ header: "Prestador", key: "provider", width: 24 }, { header: "Sucursal", key: "branch", width: 22 }, { header: "Unidades", key: "productsCount", align: "right" }, { header: "Incentivo", key: "productIncentive", money: true }],
    data.calculations.filter((c) => c.productsCount > 0) as unknown as Record<string, unknown>[],
    { productsCount: data.calculations.reduce((s, c) => s + c.productsCount, 0), productIncentive: sum(data.calculations, "productIncentive") })

  addTableSheet("Incentivos Servicios", "Incentivos de servicios",
    [{ header: "Prestador", key: "provider", width: 24 }, { header: "Comisión categoría", key: "serviceCommission", money: true }, { header: "Láser", key: "laserIncentive", money: true }, { header: "Incentivo fijo", key: "fixedIncentive", money: true }, { header: "Ajuste", key: "manualAdjustment", money: true }],
    data.calculations as unknown as Record<string, unknown>[],
    { serviceCommission: sum(data.calculations, "serviceCommission"), laserIncentive: sum(data.calculations, "laserIncentive") })

  const svcDetail = (data.serviceDetail || []).map((d) => ({ ...d, categoryLabel: CATEGORY_LABELS[d.category] || d.category }))
  addTableSheet("Servicios Detalle", "Detalle de comisión por categoría",
    [{ header: "Prestador", key: "provider", width: 24 }, { header: "Sucursal", key: "branch", width: 22 }, { header: "Categoría", key: "categoryLabel", width: 24 }, { header: "Venta base", key: "base", money: true }, { header: "% aplicado", key: "pct", pct: true, width: 12 }, { header: "Comisión", key: "amount", money: true }],
    svcDetail as unknown as Record<string, unknown>[],
    { base: sum(svcDetail, "base"), amount: sum(svcDetail, "amount") })

  addKvSheet("Depilación Láser", "Depilación láser", [
    ["Venta láser total", data.laser.laserTotal, true], ["Tramo alcanzado", `${(data.laser.tramoPct * 100).toFixed(0)}%`],
    ["Umbral", data.laser.threshold, true], ["Fondo generado", data.laser.fund, true], ["Pacientes totales", data.laser.patientsTotal],
  ])
  addTableSheet("Láser · Reparto", "Reparto del fondo láser",
    [{ header: "Prestador", key: "provider", width: 24 }, { header: "Pacientes", key: "patients", align: "right" }, { header: "Participación %", key: "participation", align: "right" }, { header: "Incentivo", key: "amount", money: true }],
    data.laser.distribution as unknown as Record<string, unknown>[], { amount: data.laser.fund })

  addTableSheet("Clientes Atendidos", "Clientes atendidos",
    [{ header: "Prestador", key: "provider", width: 24 }, { header: "Sucursal", key: "branch", width: 22 }, { header: "Pacientes", key: "patients", align: "right" }, { header: "Participación %", key: "participation", align: "right" }],
    data.patients.rows as unknown as Record<string, unknown>[], { patients: data.patients.total })

  addTableSheet("Liquidación Final", "Liquidación final", calcCols, data.calculations as unknown as Record<string, unknown>[],
    { netTotal: sum(data.calculations, "netTotal"), grossTotal: sum(data.calculations, "grossTotal"), cleaningContribution: sum(data.calculations, "cleaningContribution"), bonusExtra: sum(data.calculations, "bonusExtra") })

  addTableSheet("Reglas Aplicadas", "Reglas aplicadas",
    [{ header: "Regla", key: "name", width: 34 }, { header: "Tipo", key: "ruleType", width: 22 }, { header: "Categoría", key: "category", width: 20 }, { header: "%", key: "pctDisp", align: "right" }, { header: "Monto fijo", key: "fixedAmount", money: true }, { header: "Umbral", key: "minAmount", money: true }, { header: "Activa", key: "activeDisp" }],
    data.rules.map((r) => ({ ...r, pctDisp: r.percentage != null ? `${(r.percentage * 100).toFixed(2)}%` : "", activeDisp: r.active ? "Sí" : "No" })) as unknown as Record<string, unknown>[])

  const totalNet = sum(data.calculations, "netTotal")
  addKvSheet("Conciliación", "Diagnóstico y conciliación", [
    ["Empleados calculados", data.calculations.length], ["Neto (liquidación)", totalNet, true],
    ["Neto (totales)", t.netTotal, true], ["Diferencia neto", Math.round((totalNet - t.netTotal) * 100) / 100, true],
    ["Pacientes (Σ)", data.patients.total], ["Diferencia redondeo participación %", data.patients.roundingDiff],
    ["Fondo láser", data.laser.fund, true],
  ])

  return wb
}

export async function exportCommissionExcel(data: CommissionReportData, business: Business): Promise<void> {
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const mod = await import("exceljs")
  const ExcelJS = ((mod as { default?: ExcelJSModule }).default ?? mod) as ExcelJSModule
  const logo = await fetchLogo(business, origin)
  const wb = await buildCommissionWorkbook(data, business, ExcelJS, logo)
  const bufOut = await wb.xlsx.writeBuffer()
  const blob = new Blob([bufOut as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url; a.download = `${commissionFileBase(business, data.period.month, data.period.year)}.xlsx`
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function sum<T extends Record<string, unknown>>(arr: T[], key: string): number {
  return Math.round(arr.reduce((s, r) => s + (Number(r[key]) || 0), 0) * 100) / 100
}

// ── PDF / impresión (HTML branded A4) ───────────────────────────────────────
export function printCommissionPdf(data: CommissionReportData, business: Business, origin: string): void {
  const brand = business.primaryColor || "#0891b2"
  const logoSrc = business.logoUrl ? `${origin}${business.logoUrl}` : ""
  const periodLabel = `${MONTHS[data.period.month] || ""} ${data.period.year}`
  const generado = new Date().toLocaleString("es-DO", { dateStyle: "long", timeStyle: "short" })
  const t = data.totals

  const branchRows = data.branches.map((b) => `<tr><td>${esc(b.branch)}</td><td class="r">${fmtRD(b.gross)}</td><td class="r">${fmtRD(b.tarjeta)}</td><td class="r">${fmtRD(b.cardResult)}</td><td class="r">${fmtRD(b.producto)}</td><td class="r">${fmtRD(b.servicio)}</td><td class="r">${fmtRD(b.laser)}</td></tr>`).join("")
  const liqRows = data.calculations.map((c, i) => `<tr><td class="c">${i + 1}</td><td>${esc(c.provider)}</td><td>${esc(c.branch)}</td><td class="r">${fmtRD(c.productIncentive)}</td><td class="r">${fmtRD(c.serviceCommission + c.laserIncentive + c.fixedIncentive + c.manualAdjustment)}</td><td class="r">${fmtRD(c.bonusExtra)}</td><td class="r">${fmtRD(c.grossTotal)}</td><td class="r">${fmtRD(c.cleaningContribution)}</td><td class="r">${fmtRD(c.netTotal)}</td></tr>`).join("")

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(commissionFileBase(business, data.period.month, data.period.year))}</title>
  <style>:root{--brand:${brand}}
  @page{size:A4 landscape;margin:12mm}@media print{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  *{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;margin:0}
  .header{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid var(--brand);padding-bottom:10px;margin-bottom:12px}
  .brand{display:flex;align-items:center;gap:12px}.logo-img{height:50px}.logo-circle{height:50px;width:50px;border-radius:50%;background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700}
  .brand-name{font-size:15px;font-weight:800}h1{font-size:16px;margin:0 0 3px;color:var(--brand)}.meta{font-size:11px;color:#475569}
  h2{font-size:12px;margin:14px 0 4px;color:var(--brand)}
  table{width:100%;border-collapse:collapse;font-size:10px;page-break-inside:auto}thead{display:table-header-group}tr{page-break-inside:avoid}
  th,td{border:1px solid #cbd5e1;padding:3px 6px;text-align:left}th{background:var(--brand);color:#fff;font-size:9px;text-transform:uppercase}
  td.r,th.r{text-align:right}td.c,th.c{text-align:center}tfoot td{font-weight:700;background:#f1f5f9}
  .kpis{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0}.kpi{border:1px solid #e2e8f0;border-radius:6px;padding:5px 10px;font-size:11px}.kpi b{display:block;font-size:13px}
  .footer{margin-top:12px;font-size:9px;color:#64748b;display:flex;justify-content:space-between}</style></head><body>
  <div class="header"><div class="brand">${logoSrc ? `<img class="logo-img" src="${esc(logoSrc)}" onerror="this.style.display='none'"/>` : `<div class="logo-circle">${esc(business.shortName || "CSL")}</div>`}<div><div class="brand-name">${esc((business.name || "").toUpperCase())}</div><div class="meta">Sistema Integral de Mantenimientos</div></div></div>
  <div style="text-align:right"><h1>INCENTIVOS DE VENTAS</h1><div class="meta">Período: <b>${esc(periodLabel)}</b></div></div></div>
  <div class="kpis">
    <div class="kpi">Inc. productos<b>${fmtRD(t.productIncentive)}</b></div><div class="kpi">Com. servicios<b>${fmtRD(t.serviceCommission)}</b></div>
    <div class="kpi">Inc. láser<b>${fmtRD(t.laserIncentive)}</b></div><div class="kpi">Bono<b>${fmtRD(t.bonusExtra)}</b></div>
    <div class="kpi">Bruto<b>${fmtRD(t.grossTotal)}</b></div><div class="kpi">Limpieza<b>${fmtRD(t.cleaningContribution)}</b></div>
    <div class="kpi" style="border-color:var(--brand)">TOTAL NETO<b>${fmtRD(t.netTotal)}</b></div>
  </div>
  <h2>Ventas por sucursal</h2>
  <table><thead><tr><th>Sucursal</th><th class="r">Bruto</th><th class="r">Tarjeta</th><th class="r">Result. tarjeta</th><th class="r">Productos</th><th class="r">Servicios</th><th class="r">Láser</th></tr></thead><tbody>${branchRows || `<tr><td colspan="7" class="c">Sin datos</td></tr>`}</tbody></table>
  <h2>Liquidación final</h2>
  <table><thead><tr><th class="c">#</th><th>Prestador</th><th>Sucursal</th><th class="r">Inc. prod.</th><th class="r">Inc. serv.</th><th class="r">Bono</th><th class="r">Bruto</th><th class="r">Limpieza</th><th class="r">Neto</th></tr></thead>
  <tbody>${liqRows || `<tr><td colspan="9" class="c">Sin datos</td></tr>`}</tbody>
  <tfoot><tr><td colspan="6">TOTAL NETO</td><td class="r">${fmtRD(t.grossTotal)}</td><td class="r">${fmtRD(t.cleaningContribution)}</td><td class="r">${fmtRD(t.netTotal)}</td></tr></tfoot></table>
  <div class="footer"><span>${esc(business.name)} · Comisión de ventas</span><span>Generado: ${esc(generado)}${data.generadoPor ? ` · Por: ${esc(data.generadoPor)}` : ""}</span></div>
  </body></html>`
  const popup = window.open("", "_blank", "width=1200,height=900")
  if (!popup) return
  popup.document.write(html); popup.document.close()
  popup.onload = () => setTimeout(() => popup.print(), 400)
}

/**
 * Export del DETALLE DEL INCENTIVO LÁSER (por sucursal): Excel (.xlsx real vía
 * ExcelJS) e impresión/PDF (ventana de impresión con HTML A4). Alimentado por el
 * resultado de `getCommissionLaserDetail`. Cliente (dynamic import de exceljs).
 */
export interface LaserPersonnel {
  name: string; branch: string; applies: boolean
  patients: number; patientsPct: number
  laserLinear: number; laserPatients: number; laserTotal: number
}
export interface LaserBranchDetail {
  branch: string
  ventaLaserBruta: number; ventaLaserTarjeta: number; cardPct: number; descuentoTarjeta: number
  baseLaserNeta: number; tramo: number; pct: number; fondo: number
  fondoPersonas: number; fondoPacientes: number
  personasAplican: number; totalPacientes: number; patientsSource: string
  totalDistribuido: number; cuadre: number
  eligibleCount?: number; perCapita?: number
  personnel: LaserPersonnel[]; alerts: string[]
}
export interface LaserDetail {
  month: number; year: number
  mode?: "equitativo" | "pesos"
  weights: { personas: number; pacientes: number }
  zeroPatientsGetsFixed: boolean
  cardDiscountBeforeScale?: boolean
  globalAlerts?: string[]
  branches: LaserBranchDetail[]
}

/** Descripción corta del modo de reparto vigente (para UI/exportes). */
export function laserModeLabel(d: LaserDetail): string {
  return d.mode === "pesos"
    ? `Reparto por pesos: ${d.weights.personas}% por personas / ${d.weights.pacientes}% por pacientes`
    : "Reparto equitativo (modo cuadro): cuota fondo÷N para quien no tiene pacientes; el resto por pacientes atendidos"
}

const MONTHS = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
const rd = (n: number) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const laserFileBase = (month: number, year: number) => `INCENTIVO_LASER_${(MONTHS[month] || "").toUpperCase()}_${year}`

type ExcelJSModule = typeof import("exceljs")

export async function exportLaserExcel(detail: LaserDetail): Promise<void> {
  const mod = await import("exceljs")
  const ExcelJS = ((mod as { default?: ExcelJSModule }).default ?? mod) as ExcelJSModule
  const wb = new ExcelJS.Workbook()
  wb.creator = "csl-app · Comisión de Ventas"
  const period = `${MONTHS[detail.month] || ""} ${detail.year}`
  const BRAND = "FF0F766E"
  const money = '"RD$"#,##0.00'

  const head = (ws: import("exceljs").Worksheet, cols: number) => {
    ws.mergeCells(1, 1, 1, cols)
    const t = ws.getCell(1, 1)
    t.value = `Incentivo de depilación láser — ${period}`
    t.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } }
    t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } }
    t.alignment = { vertical: "middle", horizontal: "left" }
    ws.getRow(1).height = 24
  }
  const headerRow = (ws: import("exceljs").Worksheet, r: number, labels: string[]) => {
    const row = ws.getRow(r)
    labels.forEach((l, i) => {
      const c = row.getCell(i + 1)
      c.value = l; c.font = { bold: true, color: { argb: "FFFFFFFF" } }
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } }
    })
    row.commit()
  }

  // ── Hoja Resumen ──
  const rs = wb.addWorksheet("Resumen")
  head(rs, 8)
  rs.getCell(2, 1).value = `${laserModeLabel(detail)} · 0 pacientes recibe parte fija: ${detail.zeroPatientsGetsFixed ? "Sí" : "No"}`
  headerRow(rs, 4, ["Sucursal", "Venta bruta", "Venta tarjeta", "Desc. tarjeta", "Base neta", "Tramo", "Fondo", "Cuadre"])
  detail.branches.forEach((b, i) => {
    const row = rs.getRow(5 + i)
    row.values = [b.branch, b.ventaLaserBruta, b.ventaLaserTarjeta, b.descuentoTarjeta, b.baseLaserNeta, `${(b.pct * 100).toFixed(0)}% (≥${rd(b.tramo)})`, b.fondo, b.cuadre]
    ;[2, 3, 4, 5, 7, 8].forEach((c) => (row.getCell(c).numFmt = money))
  })
  rs.columns.forEach((c, i) => (c.width = i === 0 ? 18 : 16))

  // ── Una hoja por sucursal con el personal ──
  for (const b of detail.branches) {
    const ws = wb.addWorksheet(b.branch.slice(0, 28))
    head(ws, 8)
    ws.getCell(2, 1).value = `Fondo ${rd(b.fondo)} = personas ${rd(b.fondoPersonas)} + pacientes ${rd(b.fondoPacientes)} · ${b.personasAplican} personas · ${b.totalPacientes} pacientes (${b.patientsSource})`
    headerRow(ws, 4, ["#", "Empleado", "Aplica", "Pacientes", "% Pac.", "Inc. personas", "Inc. pacientes", "Total láser"])
    b.personnel.forEach((p, i) => {
      const row = ws.getRow(5 + i)
      row.values = [i + 1, p.name, p.applies ? "Sí" : "No", p.patients, `${(p.patientsPct * 100).toFixed(2)}%`, p.laserLinear, p.laserPatients, p.laserTotal]
      ;[6, 7, 8].forEach((c) => (row.getCell(c).numFmt = money))
    })
    const totRow = ws.getRow(5 + b.personnel.length)
    totRow.values = ["", "TOTAL DISTRIBUIDO", "", b.totalPacientes, "", b.fondoPersonas, b.fondoPacientes, b.totalDistribuido]
    totRow.font = { bold: true }
    ;[6, 7, 8].forEach((c) => (totRow.getCell(c).numFmt = money))
    ws.columns.forEach((c, i) => (c.width = i === 1 ? 22 : 14))
  }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = `${laserFileBase(detail.month, detail.year)}.xlsx`
  a.click()
  URL.revokeObjectURL(a.href)
}

export function printLaserPdf(detail: LaserDetail): void {
  const period = `${MONTHS[detail.month] || ""} ${detail.year}`
  const branchBlocks = detail.branches.map((b) => `
    <h2>${b.branch}</h2>
    <table class="kv">
      <tr><td>Venta láser bruta</td><td>RD$${rd(b.ventaLaserBruta)}</td><td>Base láser neta</td><td>RD$${rd(b.baseLaserNeta)}</td></tr>
      <tr><td>Venta láser tarjeta</td><td>RD$${rd(b.ventaLaserTarjeta)}</td><td>Tramo aplicado</td><td>${(b.pct * 100).toFixed(0)}% (≥ RD$${rd(b.tramo)})</td></tr>
      <tr><td>Descuento tarjeta (${(b.cardPct * 100).toFixed(0)}%)</td><td>−RD$${rd(b.descuentoTarjeta)}</td><td>Fondo incentivo</td><td><b>RD$${rd(b.fondo)}</b></td></tr>
      <tr><td>Fondo por personas</td><td>RD$${rd(b.fondoPersonas)}</td><td>Fondo por pacientes</td><td>RD$${rd(b.fondoPacientes)}</td></tr>
      <tr><td>Personas que aplican</td><td>${b.personasAplican}</td><td>Total pacientes (${b.patientsSource})</td><td>${b.totalPacientes}</td></tr>
      <tr><td>Total distribuido</td><td>RD$${rd(b.totalDistribuido)}</td><td>Cuadre</td><td>RD$${rd(b.cuadre)}</td></tr>
    </table>
    <table class="grid">
      <thead><tr><th>#</th><th>Empleado</th><th>Aplica</th><th class="r">Pacientes</th><th class="r">% Pac.</th><th class="r">Inc. personas</th><th class="r">Inc. pacientes</th><th class="r">Total láser</th></tr></thead>
      <tbody>${b.personnel.map((p, i) => `<tr><td>${i + 1}</td><td>${p.name}</td><td>${p.applies ? "Sí" : "No"}</td><td class="r">${p.patients}</td><td class="r">${(p.patientsPct * 100).toFixed(2)}%</td><td class="r">RD$${rd(p.laserLinear)}</td><td class="r">RD$${rd(p.laserPatients)}</td><td class="r">RD$${rd(p.laserTotal)}</td></tr>`).join("")}
      <tr class="tot"><td></td><td>TOTAL</td><td></td><td class="r">${b.totalPacientes}</td><td></td><td class="r">RD$${rd(b.fondoPersonas)}</td><td class="r">RD$${rd(b.fondoPacientes)}</td><td class="r">RD$${rd(b.totalDistribuido)}</td></tr>
      </tbody>
    </table>
    ${b.alerts.length ? `<div class="alerts">${b.alerts.map((a) => `⚠ ${a}`).join("<br>")}</div>` : ""}
  `).join("")

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${laserFileBase(detail.month, detail.year)}</title>
  <style>
    body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;margin:24px;font-size:12px}
    h1{font-size:18px;color:#0f766e;margin:0 0 2px}
    .sub{color:#64748b;margin-bottom:6px}
    h2{font-size:14px;color:#0f766e;border-bottom:2px solid #0f766e;padding-bottom:2px;margin:18px 0 6px}
    table{border-collapse:collapse;width:100%;margin-bottom:8px}
    .kv td{padding:2px 6px;border:1px solid #e2e8f0}
    .kv td:nth-child(odd){color:#64748b;width:20%}
    .grid th,.grid td{border:1px solid #e2e8f0;padding:3px 6px}
    .grid th{background:#0f766e;color:#fff;text-align:left}
    .grid .r{text-align:right}
    .grid .tot{background:#f1f5f9;font-weight:bold}
    .alerts{color:#b45309;font-size:11px;margin-bottom:10px}
    @media print{@page{size:A4 landscape;margin:12mm}}
  </style></head><body>
  <h1>Incentivo de depilación láser</h1>
  <div class="sub">${period} · ${laserModeLabel(detail)} · 0 pacientes recibe parte fija: ${detail.zeroPatientsGetsFixed ? "Sí" : "No"}</div>
  ${branchBlocks}
  <script>window.onload=function(){window.print()}</script>
  </body></html>`

  const w = window.open("", "_blank")
  if (!w) return
  w.document.write(html)
  w.document.close()
}

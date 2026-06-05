/**
 * Reporte Excel de Vacaciones (Código de Trabajo RD) con branding del tenant.
 *
 * Genera un .xls vía HTML (Excel abre tablas HTML de forma nativa) para poder
 * incluir LOGO e identidad visual del negocio activo — algo que el build
 * community de SheetJS no soporta. Incluye título, empresa, fecha, filtros y
 * totales (empleados, días, monto).
 */

import { getBusinessBranding } from "@/lib/business"

export interface VacacionExcelRow {
  no: number
  empleado: string
  cedula: string
  puesto: string
  sucursal: string
  fecha_ingreso: string
  antiguedad: string
  sueldo_mensual: number
  sueldo_diario: number
  dias_legales: number
  dias_solicitados: number
  monto: number
  estado: string
  observaciones: string
}

const rd = (n: number) => `RD$ ${(Number(n) || 0).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export function exportVacacionesExcel(
  business: Parameters<typeof getBusinessBranding>[0],
  rows: VacacionExcelRow[],
  filtrosTexto: string,
): void {
  const b = getBusinessBranding(business)
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const logo = /^https?:/.test(b.logoUrl) ? b.logoUrl : origin + b.logoUrl
  const generado = new Date().toLocaleString("es-DO")

  const totalEmpleados = rows.length
  const totalDias = rows.reduce((s, r) => s + (Number(r.dias_solicitados) || 0), 0)
  const totalMonto = rows.reduce((s, r) => s + (Number(r.monto) || 0), 0)

  const headers = [
    "No.", "Empleado", "Cédula", "Puesto", "Sucursal", "Fecha ingreso", "Antigüedad",
    "Sueldo mensual", "Sueldo diario", "Días legales", "Días solicitados", "Monto vacaciones",
    "Estado", "Observaciones",
  ]

  const bodyRows = rows.map(r => `
    <tr>
      <td style="text-align:center">${r.no}</td>
      <td>${esc(r.empleado)}</td>
      <td>${esc(r.cedula)}</td>
      <td>${esc(r.puesto)}</td>
      <td>${esc(r.sucursal)}</td>
      <td>${esc(r.fecha_ingreso)}</td>
      <td>${esc(r.antiguedad)}</td>
      <td style="text-align:right">${rd(r.sueldo_mensual)}</td>
      <td style="text-align:right">${rd(r.sueldo_diario)}</td>
      <td style="text-align:center">${r.dias_legales}</td>
      <td style="text-align:center">${r.dias_solicitados}</td>
      <td style="text-align:right">${rd(r.monto)}</td>
      <td>${esc(r.estado)}</td>
      <td>${esc(r.observaciones)}</td>
    </tr>`).join("")

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#111827}
  .head{display:flex;align-items:center;gap:12px;border-bottom:3px solid ${b.primaryColor};padding-bottom:8px;margin-bottom:6px}
  .head img{width:54px;height:54px}
  .bn{font-size:18px;font-weight:900;color:${b.primaryColor}}
  .st{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.08em}
  h1{font-size:16px;margin:6px 0 2px}
  .meta{font-size:11px;color:#475569;margin-bottom:8px}
  table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #cbd5e1;padding:5px 7px;font-size:11px}
  th{background:${b.primaryColor};color:#ffffff;text-align:left}
  tfoot td{font-weight:800;background:#f1f5f9}
</style></head><body>
  <div class="head"><img src="${esc(logo)}" alt=""/><div><div class="bn">${esc(b.name).toUpperCase()}</div><div class="st">${esc(b.subtitle)}</div></div></div>
  <h1>Reporte de Vacaciones</h1>
  <div class="meta">Empresa: <b>${esc(b.name)}</b> · Generado: ${esc(generado)}${filtrosTexto ? ` · Filtros: ${esc(filtrosTexto)}` : ""}</div>
  <table>
    <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${bodyRows || `<tr><td colspan="${headers.length}" style="text-align:center">Sin registros</td></tr>`}</tbody>
    <tfoot>
      <tr>
        <td colspan="9" style="text-align:right">TOTALES</td>
        <td colspan="2" style="text-align:center">${totalDias}</td>
        <td style="text-align:right">${rd(totalMonto)}</td>
        <td colspan="2">Empleados: ${totalEmpleados}</td>
      </tr>
    </tfoot>
  </table>
  <p style="font-size:9px;color:#94a3b8;margin-top:10px">${esc(b.footerText)} · Cálculo referencial según Código de Trabajo RD (14 días &lt;5 años · 18 días ≥5 años · base ${23.83}). No es comprobante de pago.</p>
</body></html>`

  const blob = new Blob(["﻿" + html], { type: "application/vnd.ms-excel;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `Vacaciones_${String(b.name).replace(/[^a-z0-9]+/gi, "_")}_${new Date().toISOString().slice(0, 10)}.xls`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

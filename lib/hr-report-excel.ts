/**
 * Reporte Excel genérico para módulos de RR.HH. (con branding del tenant).
 *
 * Igual que hr-vacaciones-excel pero parametrizable por columnas/filas, para
 * reutilizar en Doble Sueldo y Prestaciones. Genera un .xls vía HTML (Excel
 * abre tablas HTML) para poder incluir logo y colores del negocio activo.
 */

import { getBusinessBranding } from "@/lib/business"

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export interface HrExcelOptions {
  title: string
  headers: string[]
  rows: Array<Array<string | number>>
  footer?: Array<string | number>   // fila de totales (alineada a headers, celdas vacías "")
  filtros?: string
  filename?: string
}

export function exportHrReportExcel(
  business: Parameters<typeof getBusinessBranding>[0],
  opts: HrExcelOptions,
): void {
  const b = getBusinessBranding(business)
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const logo = /^https?:/.test(b.logoUrl) ? b.logoUrl : origin + b.logoUrl
  const generado = new Date().toLocaleString("es-DO")

  const headRow = opts.headers.map(h => `<th>${esc(h)}</th>`).join("")
  const bodyRows = opts.rows.length
    ? opts.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${opts.headers.length}" style="text-align:center">Sin registros</td></tr>`
  const footRow = opts.footer ? `<tfoot><tr>${opts.footer.map(c => `<td>${esc(c)}</td>`).join("")}</tr></tfoot>` : ""

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
  th{background:${b.primaryColor};color:#fff;text-align:left}
  tfoot td{font-weight:800;background:#f1f5f9}
</style></head><body>
  <div class="head"><img src="${esc(logo)}" alt=""/><div><div class="bn">${esc(b.name).toUpperCase()}</div><div class="st">${esc(b.subtitle)}</div></div></div>
  <h1>${esc(opts.title)}</h1>
  <div class="meta">Empresa: <b>${esc(b.name)}</b> · Generado: ${esc(generado)}${opts.filtros ? ` · Filtros: ${esc(opts.filtros)}` : ""}</div>
  <table><thead><tr>${headRow}</tr></thead><tbody>${bodyRows}</tbody>${footRow}</table>
  <p style="font-size:9px;color:#94a3b8;margin-top:10px">${esc(b.footerText)} · Cálculo referencial RR.HH. (base ${23.83}). No es comprobante de pago.</p>
</body></html>`

  const blob = new Blob(["﻿" + html], { type: "application/vnd.ms-excel;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = opts.filename || `Reporte_${String(b.name).replace(/[^a-z0-9]+/gi, "_")}_${new Date().toISOString().slice(0, 10)}.xls`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Exportes del módulo COMPRAS: PDF profesional con marca (HTML + window.print())
 * y Excel (HTML → .xls). Cliente, sin dependencias de servidor. Respeta empresa
 * activa (logo/color), filtros aplicados, fechas y usuario que genera.
 */
import type { Business } from "./types"
import type { PurchaseInvoice } from "./purchases-client"
import { fmtMoney, INVOICE_STATUS_LABEL } from "./purchases-client"

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")

export interface ListColumn {
  key: string
  label: string
  align?: "left" | "right" | "center"
  money?: boolean
}
export interface ListExportOpts {
  business: Business
  title: string
  subtitle?: string
  filters?: string
  columns: ListColumn[]
  rows: Array<Record<string, unknown>>
  generadoPor?: string
  origin: string
}

function cell(row: Record<string, unknown>, col: ListColumn): string {
  const v = row[col.key]
  if (col.money) return fmtMoney(Number(v) || 0)
  return esc(v ?? "")
}

function brandedHead(business: Business, title: string, subtitle: string | undefined, filters: string | undefined, origin: string, generado: string, generadoPor?: string): string {
  const brand = business.primaryColor || "#0891b2"
  const logoSrc = business.logoUrl ? `${origin}${business.logoUrl}` : ""
  return `
    <div class="header">
      <div class="brand">
        ${logoSrc
          ? `<img class="logo-img" src="${esc(logoSrc)}" alt="${esc(business.name)}" onerror="this.style.display='none'" />`
          : `<div class="logo-circle">${esc(business.shortName || "CSL")}</div>`}
        <div>
          <div class="brand-name">${esc((business.name || "").toUpperCase())}</div>
          <div class="brand-tag">Sistema Integral de Mantenimientos</div>
        </div>
      </div>
      <div class="header-right">
        <h1>${esc(title)}</h1>
        ${subtitle ? `<div class="meta">${esc(subtitle)}</div>` : ""}
        ${filters ? `<div class="meta">${esc(filters)}</div>` : ""}
        <div class="meta">Generado: ${esc(generado)}${generadoPor ? ` · Por: ${esc(generadoPor)}` : ""}</div>
      </div>
    </div>
    <style>:root{--brand:${brand}}</style>`
}

const PRINT_CSS = `
  @page { size: letter landscape; margin: 12mm; }
  @media print { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 0; }
  .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid var(--brand); padding-bottom: 10px; margin-bottom: 12px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .logo-img { height: 52px; width: auto; object-fit: contain; }
  .logo-circle { height: 52px; width: 52px; border-radius: 50%; background: var(--brand); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; }
  .brand-name { font-size: 15px; font-weight: 800; }
  .brand-tag { font-size: 10px; color: #64748b; }
  .header-right { text-align: right; }
  h1 { font-size: 16px; margin: 0 0 3px; color: var(--brand); }
  .meta { font-size: 11px; color: #475569; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; page-break-inside: auto; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #cbd5e1; padding: 4px 7px; text-align: left; }
  th { background: var(--brand); color: #fff; font-size: 10px; text-transform: uppercase; }
  td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
  td.c, th.c { text-align: center; }
  tfoot td { font-weight: 700; background: #f1f5f9; }
  .footer { margin-top: 12px; font-size: 10px; color: #64748b; }
`

function openPrint(html: string): void {
  const popup = window.open("", "_blank", "width=1200,height=900")
  if (!popup) return
  popup.document.write(html)
  popup.document.close()
  popup.onload = () => setTimeout(() => popup.print(), 400)
}

/** PDF profesional de una lista/consulta (facturas, gastos, menores, recurrentes). */
export function printListPdf(opts: ListExportOpts): void {
  const generado = new Date().toLocaleString("es-DO", { dateStyle: "long", timeStyle: "short" })
  const totals: Record<string, number> = {}
  for (const c of opts.columns) if (c.money) totals[c.key] = opts.rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0)
  const anyMoney = opts.columns.some((c) => c.money)
  const head = `<tr>${opts.columns.map((c) => `<th class="${c.align === "right" || c.money ? "r" : c.align === "center" ? "c" : ""}">${esc(c.label)}</th>`).join("")}</tr>`
  const body = opts.rows.map((r) => `<tr>${opts.columns.map((c) => `<td class="${c.money ? "r" : c.align === "center" ? "c" : c.align === "right" ? "r" : ""}">${cell(r, c)}</td>`).join("")}</tr>`).join("")
  const foot = anyMoney
    ? `<tfoot><tr>${opts.columns.map((c, i) => i === 0 ? `<td>Totales (${opts.rows.length})</td>` : `<td class="${c.money ? "r" : ""}">${c.money ? fmtMoney(totals[c.key]) : ""}</td>`).join("")}</tr></tfoot>`
    : ""
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(opts.title)}-${esc(opts.business.slug)}</title>
    <style>${PRINT_CSS}</style></head><body>
    ${brandedHead(opts.business, opts.title, opts.subtitle, opts.filters, opts.origin, generado, opts.generadoPor)}
    <table><thead>${head}</thead><tbody>${body || `<tr><td colspan="${opts.columns.length}" class="c">Sin registros</td></tr>`}</tbody>${foot}</table>
    <div class="footer">${esc(opts.business.name)} · Compras</div>
    </body></html>`
  openPrint(html)
}

/** Excel (HTML → .xls) de una lista/consulta. */
export function exportListExcel(opts: ListExportOpts): void {
  const date = new Date().toISOString().slice(0, 10)
  const head = `<tr>${opts.columns.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr>`
  const body = opts.rows.map((r) => `<tr>${opts.columns.map((c) => `<td${c.money ? " style='mso-number-format:\"0.00\"'" : ""}>${c.money ? (Number(r[c.key]) || 0).toFixed(2) : esc(r[c.key] ?? "")}</td>`).join("")}</tr>`).join("")
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    table{border-collapse:collapse} th,td{border:1px solid #999;padding:4px 8px} th{background:#0891b2;color:#fff}
    </style></head><body>
    <h3>${esc(opts.business.name)} — ${esc(opts.title)}</h3>
    ${opts.subtitle ? `<p>${esc(opts.subtitle)}</p>` : ""}${opts.filters ? `<p>${esc(opts.filters)}</p>` : ""}
    <table>${head}${body}</table></body></html>`
  const blob = new Blob(["﻿" + html], { type: "application/vnd.ms-excel;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${opts.title.replace(/[^a-z0-9]+/gi, "_")}_${String(opts.business.slug)}_${date}.xls`
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** PDF profesional de UNA factura de proveedor (cabecera + detalle + pagos). */
export function printInvoicePdf(invoice: PurchaseInvoice, business: Business, origin: string, generadoPor?: string): void {
  const generado = new Date().toLocaleString("es-DO", { dateStyle: "long", timeStyle: "short" })
  const items = invoice.items || []
  const payments = invoice.payments || []
  const estado = INVOICE_STATUS_LABEL[invoice.status] || invoice.status
  const rows = items.map((it, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td>${esc(it.materialName || it.description || "")}</td>
      <td class="r">${Number(it.quantity) || 0}</td>
      <td class="c">${esc(it.unit || "")}</td>
      <td class="r">${fmtMoney(it.unitCost)}</td>
      <td class="r">${fmtMoney(it.itbis)}</td>
      <td class="r">${fmtMoney(it.total)}</td>
    </tr>`).join("")
  const payRows = payments.map((p) => `<tr>
      <td>${esc((p.paymentDate || "").slice(0, 10))}</td>
      <td>${esc(p.method || "")}</td>
      <td>${esc(p.reference || "")}</td>
      <td class="r">${fmtMoney(p.amount)}</td>
    </tr>`).join("")
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>factura-${esc(invoice.invoiceNumber || invoice.id.slice(0, 8))}-${esc(business.slug)}</title>
    <style>${PRINT_CSS.replace("landscape", "portrait")}
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; font-size: 11px; margin: 8px 0 12px; }
      .grid b { color: #0f172a; } .grid span { color: #475569; }
      .totbox { margin-top: 10px; width: 46%; margin-left: auto; font-size: 12px; }
      .totbox td { border: none; padding: 2px 6px; } .totbox .tot { border-top: 2px solid var(--brand); font-weight: 800; }
      h2 { font-size: 12px; margin: 14px 0 4px; color: var(--brand); }
    </style></head><body>
    ${brandedHead(business, "FACTURA DE PROVEEDOR", `${esc(invoice.supplier || "")}${invoice.invoiceNumber ? ` · #${esc(invoice.invoiceNumber)}` : ""}`, undefined, origin, generado, generadoPor)}
    <div class="grid">
      <span>Proveedor: <b>${esc(invoice.supplier || "—")}</b></span>
      <span>NCF: <b>${esc(invoice.ncf || "—")}</b></span>
      <span>RNC/Cédula: <b>${esc(invoice.supplierRnc || "—")}</b></span>
      <span>Sucursal: <b>${esc(invoice.branch || "—")}</b></span>
      <span>Fecha: <b>${esc((invoice.invoiceDate || "").slice(0, 10))}</b></span>
      <span>Vencimiento: <b>${esc((invoice.dueDate || "").slice(0, 10) || "—")}</b></span>
      <span>Condición: <b>${esc(invoice.condition || "—")}</b></span>
      <span>Estado: <b>${esc(estado)}</b></span>
    </div>
    <h2>Detalle</h2>
    <table><thead><tr><th class="c">#</th><th>Descripción</th><th class="r">Cant.</th><th class="c">Unidad</th><th class="r">Costo</th><th class="r">ITBIS</th><th class="r">Total</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="7" class="c">Sin detalle</td></tr>`}</tbody></table>
    <table class="totbox">
      <tr><td>Subtotal</td><td class="r">${fmtMoney(invoice.subtotal)}</td></tr>
      <tr><td>Descuento</td><td class="r">${fmtMoney(invoice.discount)}</td></tr>
      <tr><td>ITBIS</td><td class="r">${fmtMoney(invoice.itbis)}</td></tr>
      <tr class="tot"><td>Total</td><td class="r">${fmtMoney(invoice.total)}</td></tr>
      <tr><td>Pagado</td><td class="r">${fmtMoney(invoice.paidAmount)}</td></tr>
      <tr class="tot"><td>Balance</td><td class="r">${fmtMoney(invoice.balance)}</td></tr>
    </table>
    ${payments.length ? `<h2>Pagos</h2><table><thead><tr><th>Fecha</th><th>Método</th><th>Referencia</th><th class="r">Monto</th></tr></thead><tbody>${payRows}</tbody></table>` : ""}
    ${invoice.notes ? `<div class="footer">Nota: ${esc(invoice.notes)}</div>` : ""}
    </body></html>`
  openPrint(html)
}

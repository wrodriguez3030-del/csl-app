/**
 * PDF profesional del Inventario de Materiales (HTML + window.print()).
 * Cliente, sin dependencias de servidor. Mismo enfoque que los demás reportes
 * con marca del proyecto (pulse-auditoria, piezas-poliza): construye un string
 * HTML con el logo de la empresa activa y lo imprime en un popup.
 */
import type { Business } from "./types"
import type { MaterialInventory } from "./materials-client"
import { INV_STATUS_LABEL, fmtNum } from "./materials-client"

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")

interface InvPdfOpts {
  inventory: MaterialInventory
  business: Business
  responsable: string
  generadoPor?: string
  origin: string // window.location.origin (el popup es about:blank → logo necesita URL absoluta)
}

/** Nombre de archivo profesional: INVENTARIO_MATERIALES_<SUCURSAL>_<FECHA>. */
export function inventarioFileBase(inventory: MaterialInventory): string {
  const suc = String(inventory.branch || "SUCURSAL")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  const fecha = String(inventory.inventoryDate || "").slice(0, 10)
  return `INVENTARIO_MATERIALES_${suc}_${fecha}`
}

/** Agrupa los ítems por proveedor preservando orden alfabético. */
function groupBySupplier(items: NonNullable<MaterialInventory["items"]>): [string, typeof items][] {
  const g: Record<string, typeof items> = {}
  for (const it of items) {
    const k = it.supplierGroup || "—"
    ;(g[k] = g[k] || []).push(it)
  }
  return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0]))
}

export function buildInventarioPdfHtml(opts: InvPdfOpts): string {
  const { inventory, business, responsable, generadoPor, origin } = opts
  const brand = business.primaryColor || "#0891b2"
  const logoSrc = business.logoUrl ? `${origin}${business.logoUrl}` : ""
  const items = inventory.items || []
  const total = items.length
  const totalQty = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0)
  const estado = INV_STATUS_LABEL[inventory.status] || inventory.status
  const fecha = String(inventory.inventoryDate || "").slice(0, 10)
  const generado = new Date().toLocaleString("es-DO", { dateStyle: "long", timeStyle: "short" })

  let idx = 0
  const body = groupBySupplier(items)
    .map(([supplier, its]) => {
      const groupRow = `<tr class="grp"><td colspan="5">${esc(supplier)}</td></tr>`
      const rows = its
        .map((it) => {
          idx += 1
          return `<tr>
            <td class="c">${idx}</td>
            <td>${esc(it.materialName)}</td>
            <td class="c">${esc(it.unit || "")}</td>
            <td class="num">${fmtNum(it.quantity)}</td>
            <td>${esc(it.observation || "")}</td>
          </tr>`
        })
        .join("")
      return groupRow + rows
    })
    .join("")

  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
  <title>${esc(inventarioFileBase(inventory))}</title>
  <style>
    :root { --brand: ${brand}; }
    @page { size: A4 portrait; margin: 14mm; }
    @media print { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 0; }
    .header { display: flex; align-items: center; justify-content: space-between;
      border-bottom: 3px solid var(--brand); padding-bottom: 10px; margin-bottom: 12px; }
    .brand { display: flex; align-items: center; gap: 12px; }
    .logo-img { height: 54px; width: auto; object-fit: contain; }
    .logo-circle { height: 54px; width: 54px; border-radius: 50%; background: var(--brand);
      color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; }
    .brand-name { font-size: 15px; font-weight: 800; letter-spacing: .3px; }
    .brand-tag { font-size: 10px; color: #64748b; }
    .header-right { text-align: right; }
    h1 { font-size: 17px; margin: 0 0 3px; color: var(--brand); }
    .meta { font-size: 11px; color: #475569; }
    .meta b { color: #0f172a; }
    .stat { display: inline-block; margin-top: 6px; font-size: 11px; background: #f1f5f9;
      border: 1px solid #e2e8f0; border-radius: 6px; padding: 3px 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; page-break-inside: auto; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    th, td { border: 1px solid #cbd5e1; padding: 4px 7px; text-align: left; }
    th { background: var(--brand); color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: .4px; }
    td.c, th.c { text-align: center; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    tr.grp td { background: #e2e8f0; font-weight: 700; }
    .footer { margin-top: 14px; padding-top: 8px; border-top: 1px solid #e2e8f0;
      font-size: 10px; color: #64748b; display: flex; justify-content: space-between; }
  </style></head><body>
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
        <h1>INVENTARIO DE MATERIALES</h1>
        <div class="meta">Sucursal: <b>${esc(inventory.branch)}</b> · Fecha: <b>${esc(fecha)}</b></div>
        <div class="meta">Responsable: <b>${esc(responsable || "—")}</b> · Estado: <b>${esc(estado)}</b></div>
        <div class="stat">Total de materiales: <b>${total}</b> · Cantidad total: <b>${fmtNum(totalQty)}</b></div>
      </div>
    </div>
    ${inventory.notes ? `<div class="meta" style="margin-bottom:8px">Nota: ${esc(inventory.notes)}</div>` : ""}
    <table>
      <thead><tr>
        <th class="c">#</th><th>Material</th><th class="c">Unidad</th>
        <th class="num">Cantidad en existencia</th><th>Observación</th>
      </tr></thead>
      <tbody>${body || `<tr><td colspan="5" class="c">Sin materiales registrados</td></tr>`}</tbody>
    </table>
    <div class="footer">
      <span>${esc(business.name)} · Inventario de materiales</span>
      <span>Generado: ${esc(generado)}${generadoPor ? ` · Por: ${esc(generadoPor)}` : ""}</span>
    </div>
  </body></html>`
}

export function printInventarioPdf(opts: InvPdfOpts): void {
  const html = buildInventarioPdfHtml(opts)
  const popup = window.open("", "_blank", "width=1100,height=900")
  if (!popup) return
  popup.document.write(html)
  popup.document.close()
  popup.onload = () => setTimeout(() => popup.print(), 400)
}

/**
 * Excel profesional del inventario (mismo enfoque del sistema: HTML → .xls que
 * Excel abre con formato). Reutiliza la marca del negocio activo (logo, color)
 * igual que `hr-report-excel` / `purchases-export`. NO genera un Excel plano:
 * incluye logo, encabezado corporativo, columnas con color, bordes, anchos
 * definidos, números alineados a la derecha y fila de totales.
 *
 * Columnas: No. · Material · Proveedor/Categoría · Cantidad · Unidad · Observación.
 * Filas ordenadas por proveedor y luego por material.
 */
export function buildInventarioExcelHtml(opts: InvPdfOpts): string {
  const { inventory, business, responsable, generadoPor, origin } = opts
  const brand = business.primaryColor || "#0891b2"
  const logoSrc = business.logoUrl
    ? (/^https?:/.test(business.logoUrl) ? business.logoUrl : `${origin}${business.logoUrl}`)
    : ""
  const items = [...(inventory.items || [])].sort((a, b) => {
    const s = String(a.supplierGroup || "").localeCompare(String(b.supplierGroup || ""))
    return s !== 0 ? s : String(a.materialName || "").localeCompare(String(b.materialName || ""))
  })
  const total = items.length
  const totalQty = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0)
  const estado = INV_STATUS_LABEL[inventory.status] || inventory.status
  const fecha = String(inventory.inventoryDate || "").slice(0, 10)
  const generado = new Date().toLocaleString("es-DO")

  const bodyRows = items.length
    ? items
        .map((it, i) => `<tr>
          <td class="c">${i + 1}</td>
          <td>${esc(it.materialName)}</td>
          <td>${esc(it.supplierGroup || "—")}</td>
          <td class="num" style="mso-number-format:'General'">${Number(it.quantity) || 0}</td>
          <td class="c">${esc(it.unit || "")}</td>
          <td>${esc(it.observation || "")}</td>
        </tr>`)
        .join("")
    : `<tr><td colspan="6" class="c">Sin materiales registrados</td></tr>`

  const html = `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" lang="es"><head><meta charset="utf-8"/>
  <style>
    body{font-family:Arial,Helvetica,sans-serif;color:#0f172a}
    .head{display:flex;align-items:center;gap:12px;border-bottom:3px solid ${brand};padding-bottom:8px;margin-bottom:6px}
    .head img{width:54px;height:54px}
    .bn{font-size:18px;font-weight:900;color:${brand}}
    .st{font-size:10px;color:#64748b}
    h1{font-size:16px;margin:8px 0 2px;color:${brand}}
    .meta{font-size:11px;color:#475569;margin:2px 0}
    .meta b{color:#0f172a}
    table{border-collapse:collapse;width:100%;margin-top:8px}
    th,td{border:1px solid #94a3b8;padding:5px 8px;font-size:11px}
    th{background:${brand};color:#fff;text-align:left;text-transform:uppercase;font-size:10px}
    td.c,th.c{text-align:center}
    td.num,th.num{text-align:right}
    tfoot td{font-weight:800;background:#f1f5f9}
  </style></head><body>
    <div class="head">
      ${logoSrc ? `<img src="${esc(logoSrc)}" alt=""/>` : ""}
      <div><div class="bn">${esc((business.name || "").toUpperCase())}</div><div class="st">Sistema Integral de Mantenimientos</div></div>
    </div>
    <h1>INVENTARIO DE MATERIALES</h1>
    <div class="meta">Sucursal: <b>${esc(inventory.branch)}</b> · Fecha: <b>${esc(fecha)}</b> · Estado: <b>${esc(estado)}</b></div>
    <div class="meta">Creado por: <b>${esc(inventory.createdByName || responsable || "—")}</b> · Total de materiales: <b>${total}</b></div>
    <table>
      <colgroup>
        <col style="width:44px"/><col style="width:280px"/><col style="width:150px"/>
        <col style="width:90px"/><col style="width:90px"/><col style="width:240px"/>
      </colgroup>
      <thead><tr>
        <th class="c">No.</th><th>Material</th><th>Proveedor / Categoría</th>
        <th class="num">Cantidad</th><th class="c">Unidad</th><th>Observación</th>
      </tr></thead>
      <tbody>${bodyRows}</tbody>
      <tfoot><tr>
        <td class="c"></td><td>TOTALES</td><td class="c">${total} materiales</td>
        <td class="num">${totalQty}</td><td class="c"></td><td></td>
      </tr></tfoot>
    </table>
    <p style="font-size:9px;color:#94a3b8;margin-top:10px">${esc(business.name)} · Inventario de materiales · Generado: ${esc(generado)}${generadoPor ? ` · Por: ${esc(generadoPor)}` : ""}</p>
  </body></html>`

  return html
}

/** Descarga el Excel profesional del inventario (.xls con formato del sistema). */
export function exportInventarioExcel(opts: InvPdfOpts): void {
  const html = buildInventarioExcelHtml(opts)
  const blob = new Blob(["﻿" + html], { type: "application/vnd.ms-excel;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${inventarioFileBase(opts.inventory)}.xls`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

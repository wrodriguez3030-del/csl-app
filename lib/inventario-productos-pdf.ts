/**
 * Reporte de existencias de productos — PDF profesional (HTML + window.print()).
 *
 * Mismo enfoque que `lib/inventario-materiales-pdf.ts`: se construye un string
 * HTML con el logo y el color de la empresa activa y se imprime en un popup.
 * Sin dependencias de servidor.
 *
 * Las funciones de datos (`buildReporteData`, `kpisDeSucursal`,
 * `buildConsolidado`) son PURAS y están cubiertas por
 * `scripts/test-productos-inventario.mjs` contra el modelo impreso.
 */
import type { Business } from "./types"
import { fmtQty, UMBRAL_STOCK_BAJO } from "./productos-client"

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")

/** Un producto del reporte: nombre y lo que hay en la sucursal. */
export interface ReporteItem {
  nombre: string
  sku?: string
  cantidad: number
}

/** El bloque de una sucursal dentro del reporte. */
export interface ReporteSucursal {
  sucursal: string
  items: ReporteItem[]
}

/** Fuente de datos mínima que necesita el reporte. */
export interface StockRecord {
  nombre: string
  sku?: string | null
  stock: Record<string, number>
}

export interface Kpis {
  productos: number
  unidades: number
  alerta: number
}

export interface ConsolidadoItem {
  nombre: string
  porSucursal: Record<string, number>
  total: number
}

export interface Consolidado {
  sucursales: string[]
  items: ConsolidadoItem[]
  /** Total de unidades por sucursal. */
  totales: Record<string, number>
  totalGeneral: number
}

/**
 * Arma el reporte por sucursal.
 *
 * Solo entran productos CON existencia (`cantidad > 0`) — igual que el modelo
 * impreso, que dice «Solo se incluyen productos con existencia».
 * Orden: cantidad descendente y, a igualdad, nombre alfabético.
 */
export function buildReporteData(records: StockRecord[], sucursales: string[]): ReporteSucursal[] {
  return sucursales.map((sucursal) => {
    const items: ReporteItem[] = []
    for (const rec of records) {
      const cantidad = Number(rec.stock?.[sucursal]) || 0
      if (cantidad <= 0) continue
      items.push({ nombre: rec.nombre, sku: rec.sku || "", cantidad })
    }
    items.sort((a, b) => b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre, "es"))
    return { sucursal, items }
  })
}

/** Los 3 KPIs del encabezado: productos con stock, unidades y alerta de stock bajo. */
export function kpisDeSucursal(items: ReporteItem[], umbral = UMBRAL_STOCK_BAJO): Kpis {
  let unidades = 0
  let alerta = 0
  for (const it of items) {
    unidades += it.cantidad
    if (it.cantidad <= umbral) alerta += 1
  }
  return { productos: items.length, unidades, alerta }
}

/** Página final: producto × sucursales seleccionadas + total, de mayor a menor. */
export function buildConsolidado(records: StockRecord[], sucursales: string[]): Consolidado {
  const items: ConsolidadoItem[] = []
  const totales: Record<string, number> = {}
  for (const suc of sucursales) totales[suc] = 0
  let totalGeneral = 0

  for (const rec of records) {
    const porSucursal: Record<string, number> = {}
    let total = 0
    for (const suc of sucursales) {
      const qty = Number(rec.stock?.[suc]) || 0
      porSucursal[suc] = qty
      total += qty
      totales[suc] += qty
    }
    if (total <= 0) continue
    totalGeneral += total
    items.push({ nombre: rec.nombre, porSucursal, total })
  }
  items.sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, "es"))
  return { sucursales, items, totales, totalGeneral }
}

// ── HTML ─────────────────────────────────────────────────────────────────────

export interface ProductosPdfOpts {
  data: ReporteSucursal[]
  records: StockRecord[]
  business: Business
  /** Texto del periodo, ej. «MES AGOSTO». */
  periodo: string
  umbral: number
  /** window.location.origin — el popup es about:blank, el logo necesita URL absoluta. */
  origin: string
  generadoPor?: string
  consolidado: boolean
}

function styles(brand: string): string {
  return `
    :root { --brand: ${brand}; }
    @page { size: A4 portrait; margin: 13mm; }
    @media print { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 0; }
    .page { page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    .header { display: flex; align-items: center; justify-content: space-between;
      border-bottom: 3px solid var(--brand); padding-bottom: 10px; margin-bottom: 10px; }
    .brand { display: flex; align-items: center; gap: 12px; }
    .logo-img { height: 54px; width: auto; object-fit: contain; }
    .logo-circle { height: 54px; width: 54px; border-radius: 50%; background: var(--brand);
      color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; }
    .brand-name { font-size: 15px; font-weight: 800; letter-spacing: .3px; }
    .brand-tag { font-size: 10px; color: #64748b; }
    .header-right { text-align: right; }
    h1 { font-size: 17px; margin: 0 0 3px; color: var(--brand); text-transform: uppercase; }
    .sub { font-size: 10.5px; color: #475569; }
    .kpis { display: flex; gap: 8px; margin: 10px 0 12px; }
    .kpi { flex: 1; border: 1px solid #e2e8f0; border-top: 3px solid var(--brand);
      border-radius: 8px; padding: 8px 10px; background: #f8fafc; }
    .kpi-label { font-size: 8.5px; letter-spacing: .6px; color: #64748b; text-transform: uppercase; }
    .kpi-value { font-size: 22px; font-weight: 800; color: #0f172a; line-height: 1.1; }
    .kpi.warn { border-top-color: #d97706; }
    .kpi.warn .kpi-value { color: #b45309; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; page-break-inside: auto; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    th, td { border: 1px solid #cbd5e1; padding: 4px 7px; text-align: left; }
    th { background: var(--brand); color: #fff; font-size: 9.5px; text-transform: uppercase; letter-spacing: .4px; }
    tbody tr:nth-child(even) { background: #f8fafc; }
    td.c, th.c { text-align: center; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    td.low { color: #b45309; font-weight: 700; }
    tr.total td { background: #e2e8f0; font-weight: 800; }
    .footer { margin-top: 12px; padding-top: 8px; border-top: 1px solid #e2e8f0;
      font-size: 9.5px; color: #64748b; display: flex; justify-content: space-between; gap: 12px; }
    .empty { text-align: center; color: #64748b; padding: 18px; font-size: 12px; }
  `
}

function headerHtml(business: Business, origin: string, titulo: string, subtitulo: string): string {
  const logoSrc = business.logoUrl ? `${origin}${business.logoUrl}` : ""
  return `<div class="header">
    <div class="brand">
      ${logoSrc
        ? `<img class="logo-img" src="${esc(logoSrc)}" alt="${esc(business.name)}" onerror="this.style.display='none'" />`
        : `<div class="logo-circle">${esc(business.shortName || "CSL")}</div>`}
      <div>
        <div class="brand-name">${esc((business.name || "").toUpperCase())}</div>
        <div class="brand-tag">Inventario de productos</div>
      </div>
    </div>
    <div class="header-right">
      <h1>${esc(titulo)}</h1>
      <div class="sub">${esc(subtitulo)}</div>
    </div>
  </div>`
}

function kpisHtml(k: Kpis): string {
  return `<div class="kpis">
    <div class="kpi"><div class="kpi-label">Productos con stock</div><div class="kpi-value">${fmtQty(k.productos)}</div></div>
    <div class="kpi"><div class="kpi-label">Unidades totales</div><div class="kpi-value">${fmtQty(k.unidades)}</div></div>
    <div class="kpi warn"><div class="kpi-label">Alerta stock bajo</div><div class="kpi-value">${fmtQty(k.alerta)}</div></div>
  </div>`
}

function sucursalPage(
  bloque: ReporteSucursal,
  opts: ProductosPdfOpts,
  generado: string,
): string {
  const { business, periodo, umbral, origin, generadoPor } = opts
  const k = kpisDeSucursal(bloque.items, umbral)
  const titulo = `Inventario ${bloque.sucursal} ${periodo}`.trim()
  const subtitulo = `${business.name} · Sucursal ${bloque.sucursal} · Reporte de productos con existencia`

  const filas = bloque.items
    .map((it, i) => {
      const bajo = it.cantidad <= umbral
      return `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(it.nombre)}</td>
        <td class="num">${fmtQty(it.cantidad)}</td>
        <td class="${bajo ? "low" : ""}">${bajo ? "Stock bajo" : ""}</td>
      </tr>`
    })
    .join("")

  return `<div class="page">
    ${headerHtml(business, origin, titulo, subtitulo)}
    ${kpisHtml(k)}
    <table>
      <thead><tr>
        <th class="c" style="width:34px">#</th>
        <th>Producto</th>
        <th class="num" style="width:90px">Cantidad</th>
        <th style="width:110px">Nota</th>
      </tr></thead>
      <tbody>${filas || `<tr><td colspan="4" class="empty">Sin productos con existencia en esta sucursal</td></tr>`}</tbody>
    </table>
    <div class="footer">
      <span>Solo se incluyen productos con existencia en ${esc(bloque.sucursal)}. Fuente: archivo de productos cargado.</span>
      <span>Generado: ${esc(generado)}${generadoPor ? ` · Por: ${esc(generadoPor)}` : ""}</span>
    </div>
  </div>`
}

function consolidadoPage(cons: Consolidado, opts: ProductosPdfOpts, generado: string): string {
  const { business, periodo, origin, generadoPor } = opts
  const titulo = `Consolidado ${periodo}`.trim()
  const subtitulo = `${business.name} · ${cons.sucursales.join(" · ")}`

  const filas = cons.items
    .map((it, i) => {
      const celdas = cons.sucursales
        .map((s) => `<td class="num">${fmtQty(it.porSucursal[s] || 0)}</td>`)
        .join("")
      return `<tr><td class="c">${i + 1}</td><td>${esc(it.nombre)}</td>${celdas}<td class="num"><b>${fmtQty(it.total)}</b></td></tr>`
    })
    .join("")

  const totales = cons.sucursales
    .map((s) => `<td class="num">${fmtQty(cons.totales[s] || 0)}</td>`)
    .join("")

  return `<div class="page">
    ${headerHtml(business, origin, titulo, subtitulo)}
    ${kpisHtml({ productos: cons.items.length, unidades: cons.totalGeneral, alerta: cons.sucursales.length })}
    <table>
      <thead><tr>
        <th class="c" style="width:34px">#</th>
        <th>Producto</th>
        ${cons.sucursales.map((s) => `<th class="num">${esc(s)}</th>`).join("")}
        <th class="num">Total</th>
      </tr></thead>
      <tbody>
        ${filas || `<tr><td colspan="${cons.sucursales.length + 3}" class="empty">Sin productos con existencia</td></tr>`}
        ${filas ? `<tr class="total"><td></td><td>TOTAL</td>${totales}<td class="num">${fmtQty(cons.totalGeneral)}</td></tr>` : ""}
      </tbody>
    </table>
    <div class="footer">
      <span>Consolidado de ${cons.sucursales.length} sucursales. Fuente: archivo de productos cargado.</span>
      <span>Generado: ${esc(generado)}${generadoPor ? ` · Por: ${esc(generadoPor)}` : ""}</span>
    </div>
  </div>`
}

/** Nombre de archivo profesional para el diálogo de impresión. */
export function reporteFileBase(data: ReporteSucursal[], periodo: string): string {
  const suc =
    data.length === 1
      ? String(data[0].sucursal || "SUCURSAL")
      : `${data.length}_SUCURSALES`
  const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")
  return `INVENTARIO_PRODUCTOS_${clean(suc)}_${clean(periodo)}`
}

export function buildProductosPdfHtml(opts: ProductosPdfOpts): string {
  const brand = opts.business.primaryColor || "#0891b2"
  const generado = new Date().toLocaleString("es-DO", { dateStyle: "long", timeStyle: "short" })
  const paginas = opts.data.map((b) => sucursalPage(b, opts, generado)).join("")
  const cons =
    opts.consolidado && opts.data.length > 1
      ? consolidadoPage(buildConsolidado(opts.records, opts.data.map((d) => d.sucursal)), opts, generado)
      : ""

  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
  <title>${esc(reporteFileBase(opts.data, opts.periodo))}</title>
  <style>${styles(brand)}</style></head><body>${paginas}${cons}</body></html>`
}

export function printProductosPdf(opts: ProductosPdfOpts): void {
  const html = buildProductosPdfHtml(opts)
  const popup = window.open("", "_blank", "width=1100,height=900")
  if (!popup) return
  popup.document.write(html)
  popup.document.close()
  popup.onload = () => setTimeout(() => popup.print(), 400)
}

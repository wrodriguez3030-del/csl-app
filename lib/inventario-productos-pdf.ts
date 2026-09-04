/**
 * Reporte de existencias de productos — PDF profesional (HTML + window.print()).
 *
 * El diseño replica el modelo impreso que entregó el dueño
 * (`INVENTARIO RAFAEL VIDAL MES JUNIO.pdf`): banda verde oscura a todo lo ancho
 * con el título centrado, tres tarjetas de KPI (la de alerta en crema), tabla
 * con cabecera verde y columnas `CANT. · Nombre · CANTIDAD · NOTA`, filas de
 * stock bajo en rosado, y pie fijado al borde inferior de la página.
 *
 * Los colores son los del modelo, no los de la marca activa: este reporte ES
 * ese documento. El nombre del negocio sí es dinámico (subtítulo y pie), así
 * que Depicenter imprime el suyo.
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

/**
 * El modelo lista los productos en MAYÚSCULAS. El archivo trae unos pocos en
 * minúscula («Ampollas Hyal Complex»), así que se uniforman al imprimir: en
 * pantalla el nombre se muestra tal cual vino.
 */
function nombreImpreso(value: unknown): string {
  return String(value ?? "").toUpperCase()
}

/**
 * El NÚMERO del código de barras del producto, debajo del nombre.
 *
 * Sale del `sku`, que es donde viven los códigos: EAN reales de 13 dígitos
 * («8437008443010») y algunas claves internas cortas («3030»). Solo el número:
 * se probó con las barras dibujadas y cambiaba demasiado el impreso.
 * El producto sin `sku` —hoy uno de 84— no muestra nada.
 */
function codigoDeProducto(sku: unknown): string {
  const codigo = String(sku ?? "").trim()
  return codigo ? `<div class="cod">${esc(codigo)}</div>` : ""
}

/** «RAFAEL VIDAL» → «Rafael Vidal», como en el subtítulo y el pie del modelo. */
function titleCase(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/(^|\s|-)([a-záéíóúñ])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
}

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
  /** El `sku` del producto: de ahí sale el código de barras del impreso. */
  sku?: string
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
    items.push({ nombre: rec.nombre, sku: rec.sku ?? undefined, porSucursal, total })
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
  /** window.location.origin — el popup es about:blank (reservado para el logo). */
  origin: string
  generadoPor?: string
  consolidado: boolean
}

/** Paleta del modelo impreso. */
const C = {
  banda: "#0F3D34",
  verde: "#27AE7F",
  tinta: "#0F172A",
  suave: "#F1F5F9",
  borde: "#CBD5E1",
  gris: "#64748B",
  alertaFondo: "#FFF8EC",
  alertaBorde: "#F5D9A8",
  alertaTinta: "#B45309",
  bajoFondo: "#FEF2F2",
  bajoTinta: "#DC2626",
}

const BASE_STYLES = `
  @page { size: A4 portrait; margin: 0; }
  /* Sin esto el navegador IMPRIME SIN FONDOS: la banda verde, la cabecera de la
     tabla y las filas de stock bajo salen en blanco. Va en un selector real —
     escrito suelto dentro de @media print, el bloque es inválido y se ignora,
     que es exactamente lo que pasaba. */
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @media print {
    html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: ${C.tinta}; }

  /* Cada sucursal es una hoja: la banda sangra a los bordes y el pie queda
     pegado abajo aunque la tabla sea corta. 296mm (no 297) evita que el
     redondeo del navegador provoque una página en blanco extra. */
  .page { min-height: 296mm; display: flex; flex-direction: column; page-break-after: always; }
  .page:last-child { page-break-after: auto; }

  .banda { background: ${C.banda}; color: #fff; padding: 26px 40px 22px; text-align: center; }
  .banda h1 { margin: 0; font-size: 27px; font-weight: 800; letter-spacing: .5px; text-transform: uppercase; }
  .banda p { margin: 8px 0 0; font-size: 11.5px; color: rgba(255,255,255,.86); }

  .cuerpo { flex: 1; padding: 18px 26px 0; }

  .kpis { display: flex; gap: 14px; margin-bottom: 16px; }
  .kpi { flex: 1; border: 1px solid ${C.borde}; border-radius: 12px; padding: 10px 14px; background: #fff; }
  .kpi-label { font-size: 8.5px; font-weight: 700; letter-spacing: .9px; text-transform: uppercase; color: ${C.gris}; }
  .kpi-value { margin-top: 2px; font-size: 23px; font-weight: 800; color: ${C.banda}; line-height: 1.1; }
  .kpi.alerta { background: ${C.alertaFondo}; border-color: ${C.alertaBorde}; }
  .kpi.alerta .kpi-value { color: ${C.alertaTinta}; }

  table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th { background: ${C.verde}; color: #fff; font-size: 9px; font-weight: 700; letter-spacing: .7px;
       text-transform: uppercase; padding: 7px 10px; text-align: left; }
  td { padding: 6px 10px; border-bottom: 1px solid #E2E8F0; }
  tbody tr:nth-child(even) td { background: ${C.suave}; }
  table { border: 1px solid ${C.borde}; }
  .c { text-align: center; }
  .r { text-align: right; }
  .num { text-align: center; font-weight: 700; font-variant-numeric: tabular-nums; }
  /* Numero del codigo de barras, bajo el nombre. Discreto: no debe competir
     con el nombre del producto ni alargar la fila. */
  .cod { font-size: 8px; letter-spacing: .6px; color: ${C.gris};
         font-variant-numeric: tabular-nums; line-height: 1.3; }
  td.bajo { background: ${C.bajoFondo} !important; }
  td.nota-bajo { background: ${C.bajoFondo} !important; color: ${C.bajoTinta}; font-weight: 700; font-size: 9.5px; }
  tr.total td { background: #E2E8F0 !important; font-weight: 800; }
  .vacio { text-align: center; color: ${C.gris}; padding: 22px; }

  .pie { margin: 14px 26px 12px; padding-top: 9px; border-top: 1px solid #E2E8F0;
         display: flex; justify-content: space-between; gap: 16px; font-size: 9px; color: ${C.gris}; }
`

function bandaHtml(titulo: string, subtitulo: string): string {
  return `<div class="banda">
    <h1>${esc(titulo)}</h1>
    <p>${esc(subtitulo)}</p>
  </div>`
}

function kpisHtml(k: Kpis): string {
  return `<div class="kpis">
    <div class="kpi"><div class="kpi-label">Productos con stock</div><div class="kpi-value">${fmtQty(k.productos)}</div></div>
    <div class="kpi"><div class="kpi-label">Unidades totales</div><div class="kpi-value">${fmtQty(k.unidades)}</div></div>
    <div class="kpi alerta"><div class="kpi-label">Alerta stock bajo</div><div class="kpi-value">${fmtQty(k.alerta)}</div></div>
  </div>`
}

function pieHtml(izquierda: string, derecha: string): string {
  return `<div class="pie"><span>${esc(izquierda)}</span><span>${esc(derecha)}</span></div>`
}

function sucursalPage(bloque: ReporteSucursal, opts: ProductosPdfOpts): string {
  const { business, periodo, umbral } = opts
  const suc = titleCase(bloque.sucursal)
  const k = kpisDeSucursal(bloque.items, umbral)

  const filas = bloque.items
    .map((it, i) => {
      const bajo = it.cantidad <= umbral
      return `<tr>
        <td class="r">${i + 1}</td>
        <td>${esc(nombreImpreso(it.nombre))}${codigoDeProducto(it.sku)}</td>
        <td class="num${bajo ? " bajo" : ""}">${fmtQty(it.cantidad)}</td>
        <td class="${bajo ? "nota-bajo" : ""}">${bajo ? "Stock bajo" : ""}</td>
      </tr>`
    })
    .join("")

  return `<div class="page">
    ${bandaHtml(
      `Inventario ${bloque.sucursal} ${periodo}`.trim(),
      `${business.name} | Sucursal ${suc} | Reporte profesional de productos con existencia`,
    )}
    <div class="cuerpo">
      ${kpisHtml(k)}
      <table>
        <thead><tr>
          <th class="r" style="width:64px">Cant.</th>
          <th>Nombre</th>
          <th class="c" style="width:110px">Cantidad</th>
          <th style="width:130px">Nota</th>
        </tr></thead>
        <tbody>${filas || `<tr><td colspan="4" class="vacio">Sin productos con existencia en esta sucursal</td></tr>`}</tbody>
      </table>
    </div>
    ${pieHtml(
      `Fuente: archivo de productos cargado. Solo se incluyen productos con existencia en ${suc}.`,
      `Generado para ${business.name}`,
    )}
  </div>`
}

function consolidadoPage(cons: Consolidado, opts: ProductosPdfOpts): string {
  const { business, periodo } = opts
  const filas = cons.items
    .map((it, i) => {
      const celdas = cons.sucursales
        .map((s) => `<td class="num">${fmtQty(it.porSucursal[s] || 0)}</td>`)
        .join("")
      return `<tr><td class="r">${i + 1}</td><td>${esc(nombreImpreso(it.nombre))}${codigoDeProducto(it.sku)}</td>${celdas}<td class="num">${fmtQty(it.total)}</td></tr>`
    })
    .join("")
  const totales = cons.sucursales.map((s) => `<td class="num">${fmtQty(cons.totales[s] || 0)}</td>`).join("")

  return `<div class="page">
    ${bandaHtml(
      `Consolidado ${periodo}`.trim(),
      `${business.name} | ${cons.sucursales.map(titleCase).join(" · ")} | Reporte profesional de productos con existencia`,
    )}
    <div class="cuerpo">
      ${kpisHtml({ productos: cons.items.length, unidades: cons.totalGeneral, alerta: cons.sucursales.length })}
      <table>
        <thead><tr>
          <th class="r" style="width:64px">Cant.</th>
          <th>Nombre</th>
          ${cons.sucursales.map((s) => `<th class="c">${esc(titleCase(s))}</th>`).join("")}
          <th class="c">Total</th>
        </tr></thead>
        <tbody>
          ${filas || `<tr><td colspan="${cons.sucursales.length + 3}" class="vacio">Sin productos con existencia</td></tr>`}
          ${filas ? `<tr class="total"><td></td><td>Total general</td>${totales}<td class="num">${fmtQty(cons.totalGeneral)}</td></tr>` : ""}
        </tbody>
      </table>
    </div>
    ${pieHtml(
      `Fuente: archivo de productos cargado. Consolidado de ${cons.sucursales.length} sucursales.`,
      `Generado para ${business.name}`,
    )}
  </div>`
}

/** Nombre de archivo profesional para el diálogo de impresión. */
export function reporteFileBase(data: ReporteSucursal[], periodo: string): string {
  const suc = data.length === 1 ? String(data[0].sucursal || "SUCURSAL") : `${data.length}_SUCURSALES`
  const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")
  return `INVENTARIO_${clean(suc)}_${clean(periodo)}`
}

export function buildProductosPdfHtml(opts: ProductosPdfOpts): string {
  const paginas = opts.data.map((b) => sucursalPage(b, opts)).join("")
  const cons =
    opts.consolidado && opts.data.length > 1
      ? consolidadoPage(buildConsolidado(opts.records, opts.data.map((d) => d.sucursal)), opts)
      : ""

  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
  <title>${esc(reporteFileBase(opts.data, opts.periodo))}</title>
  <style>${BASE_STYLES}</style></head><body>${paginas}${cons}</body></html>`
}

export function printProductosPdf(opts: ProductosPdfOpts): void {
  const html = buildProductosPdfHtml(opts)
  const popup = window.open("", "_blank", "width=1100,height=900")
  if (!popup) return
  popup.document.write(html)
  popup.document.close()
  popup.onload = () => setTimeout(() => popup.print(), 400)
}

// ── Acta del conteo físico ───────────────────────────────────────────────────

export interface ActaItem {
  nombre: string
  sku?: string | null
  cantidadSistema: number
  cantidadContada: number
  observacion?: string | null
}

export interface ActaConteoOpts {
  sucursal: string
  fecha: string
  estado: string
  responsable?: string | null
  notas?: string | null
  aprobadoPor?: string | null
  items: ActaItem[]
  business: Business
  origin: string
  generadoPor?: string
  /** true = imprime solo los renglones con diferencia. */
  soloDiferencias: boolean
}

export function buildActaConteoHtml(opts: ActaConteoOpts): string {
  const { business, sucursal, fecha, estado, responsable, notas, aprobadoPor } = opts
  const suc = titleCase(sucursal)

  const items = opts.soloDiferencias
    ? opts.items.filter((it) => it.cantidadContada - it.cantidadSistema !== 0)
    : opts.items

  let sobrantes = 0
  let faltantes = 0
  let unidades = 0
  for (const it of items) {
    const d = it.cantidadContada - it.cantidadSistema
    unidades += it.cantidadContada
    if (d > 0) sobrantes += 1
    if (d < 0) faltantes += 1
  }

  const filas = items
    .map((it, i) => {
      const d = it.cantidadContada - it.cantidadSistema
      const dif = d === 0 ? "" : d > 0 ? "sobra" : "falta"
      return `<tr>
        <td class="r">${i + 1}</td>
        <td>${esc(nombreImpreso(it.nombre))}</td>
        <td class="num">${fmtQty(it.cantidadSistema)}</td>
        <td class="num">${fmtQty(it.cantidadContada)}</td>
        <td class="num${d !== 0 ? " bajo" : ""}">${d > 0 ? "+" : ""}${fmtQty(d)}</td>
        <td class="${d !== 0 ? "nota-bajo" : ""}">${dif ? esc(dif.toUpperCase()) : ""} ${esc(it.observacion || "")}</td>
      </tr>`
    })
    .join("")

  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
  <title>CONTEO_${esc(sucursal.replace(/[^A-Za-z0-9]+/g, "_"))}_${esc(fecha)}</title>
  <style>${BASE_STYLES}</style></head><body>
    <div class="page">
      ${bandaHtml(
        `Conteo físico ${sucursal} ${fecha}`,
        `${business.name} | Sucursal ${suc} | Estado: ${estado}${responsable ? ` | Responsable: ${responsable}` : ""}`,
      )}
      <div class="cuerpo">
        <div class="kpis">
          <div class="kpi"><div class="kpi-label">Productos contados</div><div class="kpi-value">${fmtQty(items.length)}</div></div>
          <div class="kpi"><div class="kpi-label">Unidades contadas</div><div class="kpi-value">${fmtQty(unidades)}</div></div>
          <div class="kpi alerta"><div class="kpi-label">Con diferencia</div><div class="kpi-value">${fmtQty(sobrantes + faltantes)}</div></div>
        </div>
        ${notas ? `<p style="margin:0 0 10px;font-size:10.5px;color:${C.gris}">Nota: ${esc(notas)}</p>` : ""}
        <table>
          <thead><tr>
            <th class="r" style="width:64px">Cant.</th>
            <th>Nombre</th>
            <th class="c" style="width:80px">Sistema</th>
            <th class="c" style="width:80px">Contado</th>
            <th class="c" style="width:90px">Diferencia</th>
            <th style="width:150px">Nota</th>
          </tr></thead>
          <tbody>${filas || `<tr><td colspan="6" class="vacio">Sin renglones que mostrar</td></tr>`}</tbody>
        </table>
      </div>
      ${pieHtml(
        `${sobrantes} sobrantes · ${faltantes} faltantes${aprobadoPor ? ` · Aprobado por: ${aprobadoPor}` : ""}`,
        `Generado para ${business.name}`,
      )}
    </div>
  </body></html>`
}

export function printActaConteo(opts: ActaConteoOpts): void {
  const html = buildActaConteoHtml(opts)
  const popup = window.open("", "_blank", "width=1100,height=900")
  if (!popup) return
  popup.document.write(html)
  popup.document.close()
  popup.onload = () => setTimeout(() => popup.print(), 400)
}

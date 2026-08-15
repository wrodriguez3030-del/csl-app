/**
 * Parseo del archivo de productos (hoja ya convertida a matriz por SheetJS).
 *
 * PURO: sin React, sin red, sin Supabase. Solo depende de `./normalize-pulse`
 * (para resolver la sucursal de cada columna de stock) y `./productos-client`.
 * Así el mismo código se prueba con `node --import tsx` y corre en el navegador.
 *
 * El archivo trae UNA COLUMNA DE STOCK POR SUCURSAL y su cantidad NO es fija:
 * por eso las columnas se detectan por título, nunca por posición.
 */
import { normalizeSucursal, allKnownSucursales } from "./normalize-pulse"
import {
  normalizeProductName,
  productKey,
  toNumberOrNull,
  toQuantity,
  type ProductoRow,
  type StockColumn,
} from "./productos-client"

/** Cabeceras conocidas del archivo → clave interna. */
const FIELD_ALIASES: Record<string, string[]> = {
  sku: ["sku", "codigo", "código", "codigo de barra", "código de barra"],
  categoria: ["categoria", "categoría"],
  marca: ["marca"],
  nombre: ["nombre", "producto", "descripcion corta"],
  formato: ["formato"],
  costo: ["costo"],
  precioExterno: ["precio venta externa", "precio externo", "precio de venta"],
  precioInterno: ["precio venta interna", "precio interno"],
  comision: ["comision", "comisión"],
  comisionTipo: ["tipo de comision", "tipo de comisión"],
  descripcion: ["descripcion", "descripción"],
  estado: ["estado"],
  precioConIva: ["precio contiene iva"],
  ivaPct: ["% iva", "iva"],
}

/** Cabecera comparable: minúsculas, sin acentos, sin espacios dobles. */
function normHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Índice de cada campo conocido dentro de la cabecera. Un campo ausente
 * queda en -1 y su valor sale vacío — el archivo puede venir con menos
 * columnas y eso no debe reventar la importación.
 */
export function mapHeaderFields(header: unknown[]): Record<string, number> {
  const norm = header.map(normHeader)
  const out: Record<string, number> = {}
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    out[field] = norm.findIndex((h) => aliases.some((a) => h === a || h.startsWith(a)))
  }
  return out
}

/**
 * Sucursal canónica de un título de columna, o "" si no es una sucursal real.
 *
 * `normalizeSucursal` devuelve la cadena limpia cuando no reconoce el nombre,
 * así que hay que contrastar contra la allow-list: sin esto, una columna
 * «Stock Sucursal Marte» crearía una sucursal fantasma con existencias.
 */
function sucursalDeColumna(title: string, universo: Set<string>): string {
  const suc = normalizeSucursal(title)
  return suc && universo.has(suc) ? suc : ""
}

function universoSucursales(allowed?: string[]): Set<string> {
  return new Set(allowed && allowed.length ? allowed : allKnownSucursales())
}

/**
 * Columnas de existencia del archivo, resueltas a sucursal canónica.
 *
 * `"Stock Cibao Spa Laser  Av. Rafael Vidal "` → `RAFAEL VIDAL`
 * `"Stock Cibao Spa Laser Los Jardines"`       → `LOS JARDINES`
 *
 * `allowed` son las sucursales aceptables (las del tenant activo). Si se omite,
 * se usan todas las conocidas. Las columnas que no resuelvan se descartan:
 * nunca se adivina a qué sucursal pertenece una existencia.
 */
export function detectStockColumns(header: unknown[], allowed?: string[]): StockColumn[] {
  const universo = universoSucursales(allowed)
  const out: StockColumn[] = []
  header.forEach((raw, index) => {
    const title = String(raw ?? "").trim()
    if (!title) return
    if (!normHeader(title).startsWith("stock")) return
    const sucursal = sucursalDeColumna(title, universo)
    if (!sucursal) return
    out.push({ index, columna: title, sucursal })
  })
  return out
}

/** Columnas que empiezan por «Stock» pero NO resolvieron a una sucursal. */
export function unresolvedStockColumns(header: unknown[], allowed?: string[]): string[] {
  const universo = universoSucursales(allowed)
  return header
    .map((raw) => String(raw ?? "").trim())
    .filter((title) => title && normHeader(title).startsWith("stock") && !sucursalDeColumna(title, universo))
}

function cell(row: unknown[], index: number): string {
  if (index < 0) return ""
  const v = row[index]
  if (v === null || v === undefined) return ""
  if (typeof v === "object") {
    const o = v as { result?: unknown; text?: unknown }
    return String(o.result ?? o.text ?? "").trim()
  }
  return String(v).trim()
}

/**
 * Convierte la matriz de una hoja en filas de producto listas para importar.
 *
 * - La fila 0 es la cabecera.
 * - Una fila SIN nombre se descarta (hay filas basura al final de los exports).
 * - Una cantidad no numérica cuenta como 0, nunca como NaN.
 * - `opts.activo` es el valor por defecto cuando la hoja no trae columna Estado
 *   (la hoja «Inactivos» sí la trae, y manda la columna).
 * - `opts.sucursales` limita las columnas de stock aceptadas a las del tenant.
 * - `opts.columnas` permite forzar el mapeo confirmado por el usuario en pantalla.
 */
export function parseProductSheet(
  rows: unknown[][],
  opts: { activo: boolean; sucursales?: string[]; columnas?: StockColumn[] },
): ProductoRow[] {
  if (!rows || rows.length < 2) return []
  const header = rows[0] as unknown[]
  const f = mapHeaderFields(header)
  const stockCols = opts.columnas?.length
    ? opts.columnas.filter((c) => c.sucursal)
    : detectStockColumns(header, opts.sucursales)

  const out: ProductoRow[] = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[]
    if (!row || !row.length) continue

    const nombre = cell(row, f.nombre)
    if (!nombre) continue
    const nombreNorm = normalizeProductName(nombre)
    if (!nombreNorm) continue

    const estado = cell(row, f.estado).toLowerCase()
    const activo = estado ? estado.startsWith("activ") : opts.activo

    const stock: Record<string, number> = {}
    for (const col of stockCols) stock[col.sucursal] = toQuantity(row[col.index])

    const sku = cell(row, f.sku)
    const ivaTxt = cell(row, f.precioConIva).toLowerCase()

    out.push({
      clave: productKey(sku, nombreNorm),
      sku,
      nombre: nombre.replace(/\s+/g, " ").trim(),
      nombreNorm,
      categoria: cell(row, f.categoria),
      marca: cell(row, f.marca),
      formato: cell(row, f.formato),
      descripcion: cell(row, f.descripcion),
      costo: toNumberOrNull(row[f.costo]),
      precioExterno: toNumberOrNull(row[f.precioExterno]),
      precioInterno: toNumberOrNull(row[f.precioInterno]),
      comision: toNumberOrNull(row[f.comision]),
      comisionTipo: toNumberOrNull(row[f.comisionTipo]),
      precioConIva: ivaTxt ? ivaTxt.startsWith("activ") || ivaTxt === "si" || ivaTxt === "sí" : null,
      ivaPct: toNumberOrNull(row[f.ivaPct]),
      activo,
      stock,
    })
  }
  return out
}

/**
 * Si el mismo producto aparece dos veces (misma clave), gana la ÚLTIMA fila y
 * las existencias se suman por sucursal. Sin esto, el upsert por lotes fallaría
 * con «ON CONFLICT DO UPDATE command cannot affect row a second time».
 */
export function dedupeByClave(rows: ProductoRow[]): ProductoRow[] {
  const map = new Map<string, ProductoRow>()
  for (const row of rows) {
    const prev = map.get(row.clave)
    if (!prev) {
      map.set(row.clave, { ...row, stock: { ...row.stock } })
      continue
    }
    const stock = { ...prev.stock }
    for (const [suc, qty] of Object.entries(row.stock)) stock[suc] = (stock[suc] || 0) + qty
    map.set(row.clave, { ...row, stock })
  }
  return [...map.values()]
}

/** Resumen para la previsualización: cuántos productos y cuántas unidades. */
export function summarizeImport(rows: ProductoRow[]): {
  productos: number
  unidades: number
  porSucursal: Record<string, number>
} {
  const porSucursal: Record<string, number> = {}
  let unidades = 0
  for (const row of rows) {
    for (const [suc, qty] of Object.entries(row.stock)) {
      porSucursal[suc] = (porSucursal[suc] || 0) + qty
      unidades += qty
    }
  }
  return { productos: rows.length, unidades, porSucursal }
}

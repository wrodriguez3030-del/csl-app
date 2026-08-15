/**
 * Tipos y helpers del módulo Inventario de Productos.
 *
 * PURO: sin React, sin Supabase, sin Next. Lo importan tanto las pantallas
 * `components/productos/*` como el módulo de servidor `lib/server/products-inventory.ts`,
 * así que no puede arrastrar dependencias de ninguno de los dos lados.
 */

/** Estados de un conteo físico. */
export type ConteoEstado = "borrador" | "enviado" | "aprobado" | "rechazado"

export const CONTEO_ESTADO_LABEL: Record<ConteoEstado, string> = {
  borrador: "Borrador",
  enviado: "Enviado",
  aprobado: "Aprobado",
  rechazado: "Rechazado",
}

/** Umbral por defecto de la alerta «Stock bajo» del reporte de existencias. */
export const UMBRAL_STOCK_BAJO = 2

/** Una fila del archivo de productos ya normalizada. */
export interface ProductoRow {
  clave: string
  sku: string
  nombre: string
  nombreNorm: string
  categoria: string
  marca: string
  formato: string
  descripcion: string
  costo: number | null
  precioExterno: number | null
  precioInterno: number | null
  comision: number | null
  comisionTipo: number | null
  precioConIva: boolean | null
  ivaPct: number | null
  activo: boolean
  /** sucursal canónica → cantidad */
  stock: Record<string, number>
}

/** Una columna de stock del archivo, ya resuelta a sucursal canónica. */
export interface StockColumn {
  /** Índice de la columna en la matriz de la hoja. */
  index: number
  /** Título tal cual viene en el archivo. */
  columna: string
  /** Sucursal canónica, o "" si no se pudo resolver. */
  sucursal: string
}

/** Producto tal como lo devuelve el servidor, con su stock por sucursal. */
export interface ProductoWithStock {
  id: string
  clave: string
  sku: string | null
  nombre: string
  categoria: string | null
  marca: string | null
  formato: string | null
  costo: number | null
  precioExterno: number | null
  precioInterno: number | null
  activo: boolean
  stock: Record<string, number>
  total: number
}

/** Cabecera de un conteo físico. */
export interface Conteo {
  id: string
  sucursal: string
  fecha: string
  estado: ConteoEstado
  notas: string | null
  responsable: string | null
  creadoPorNombre: string | null
  aprobadoPorNombre: string | null
  aprobadoEn: string | null
  motivoRechazo: string | null
  createdAt: string | null
  itemsCount?: number
  diferenciaTotal?: number
}

/** Un renglón del conteo físico. */
export interface ConteoItem {
  id: string
  productoId: string | null
  nombre: string
  sku: string | null
  cantidadSistema: number
  cantidadContada: number
  observacion: string | null
}

export interface ConteoConItems extends Conteo {
  items: ConteoItem[]
}

/** Resumen de una importación (bitácora). */
export interface ImportacionRow {
  id: string
  archivo: string | null
  filasLeidas: number
  productosCreados: number
  productosActualizados: number
  descartados: number
  unidadesTotal: number
  sucursales: { columna: string; sucursal: string; unidades: number }[]
  usuarioNombre: string | null
  createdAt: string | null
}

// ── Normalización ────────────────────────────────────────────────────────────

/**
 * Nombre canónico de un producto: mayúsculas, sin acentos, sin espacios
 * dobles ni extremos. El archivo trae nombres como `"ANESTESIA ENCAIN "` y
 * `"BIRETIX  BARRA DERMALOTOGICA"` — sin esto, la reimportación duplicaría.
 */
export function normalizeProductName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Clave estable del producto: `SKU|NOMBRE`, o solo el nombre si no hay SKU.
 *
 * El nombre entra en la clave a propósito. En el archivo real hay códigos de
 * barra COMPARTIDOS por productos distintos (`8470001682673` es AQUAFOAM y
 * también ENDOCARE). Si la clave fuera solo el SKU, los dos se fundirían en uno
 * y el reporte perdería un producto y sumaría mal las existencias del otro.
 *
 * El riesgo inverso — que renombrar un producto en el origen cree un duplicado —
 * lo neutraliza la importación: la existencia de todo producto que ya no viene
 * en el archivo se pone en cero, así que el registro viejo deja de aparecer.
 */
export function productKey(sku: unknown, nombreNorm: string): string {
  const s = String(sku ?? "").replace(/\s+/g, "").trim()
  return s ? `${s}|${nombreNorm}` : nombreNorm
}

/**
 * Número tolerante: acepta `"1,234.50"`, `"1.234,50"`, vacío y basura.
 * Devuelve `null` cuando no hay número (distinto de 0, que sí es un dato).
 */
export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  const raw = String(value).trim()
  if (!raw) return null

  const hasComma = raw.includes(",")
  const hasDot = raw.includes(".")
  let cleaned = raw
  if (hasComma && hasDot) {
    // El decimal es el separador que aparece de ÚLTIMO:
    // "1.234,50" (europeo) y "1,234.50" (inglés) valen ambos 1234.50.
    cleaned =
      raw.lastIndexOf(",") > raw.lastIndexOf(".")
        ? raw.replace(/\./g, "").replace(",", ".")
        : raw.replace(/,/g, "")
  } else if (hasComma) {
    // Solo coma: tres dígitos exactos detrás = separador de miles ("1,684");
    // uno o dos = decimal ("1,68").
    cleaned = /,\d{3}(\D|$)/.test(raw) ? raw.replace(/,/g, "") : raw.replace(",", ".")
  }
  const digits = cleaned.replace(/[^0-9.-]/g, "")
  // Sin esta guardia, "basura" quedaría en "" y Number("") daría 0: un texto
  // basura entraría al sistema como una existencia de cero unidades.
  if (!/^-?\d*\.?\d+$/.test(digits)) return null
  const n = Number(digits)
  return Number.isFinite(n) ? n : null
}

/** Cantidad de stock: lo que no sea número cuenta como 0, nunca como NaN. */
export function toQuantity(value: unknown): number {
  const n = toNumberOrNull(value)
  return n === null ? 0 : n
}

/** Diferencia de un renglón de conteo: lo contado menos lo que decía el sistema. */
export function diffConteo(cantidadSistema: number, cantidadContada: number): number {
  return (Number(cantidadContada) || 0) - (Number(cantidadSistema) || 0)
}

// ── Formato ──────────────────────────────────────────────────────────────────

/** Cantidad legible: entera si no tiene decimales, con separador de miles. */
export function fmtQty(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return "0"
  return n.toLocaleString("es-DO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
  })
}

/** Monto en pesos, sin símbolo (las tablas ya lo rotulan). */
export function fmtMoney(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const MESES = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
]

/** Periodo por defecto del reporte: «MES AGOSTO», como en el modelo impreso. */
export function periodoActual(date = new Date()): string {
  return `MES ${MESES[date.getMonth()]}`
}

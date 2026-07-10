/**
 * Mapeo flexible de columnas del importador (sección 4). Reconoce nombres de
 * encabezado equivalentes (ES/EN) y propone un mapeo que el usuario puede
 * corregir antes de confirmar. Las equivalencias son datos (ampliables) y las
 * plantillas de mapeo se guardan para reutilizar.
 */
import { normalizeName } from "./normalize"

/** Campo canónico interno de una venta. */
export type SaleField =
  | "date" | "branch" | "customer" | "provider" | "service"
  | "category" | "product" | "quantity" | "amount" | "paymentMethod"

/** Equivalencias de encabezados por campo (sección 4). */
export const COLUMN_EQUIVALENCES: Record<SaleField, string[]> = {
  date: ["fecha", "fecha venta", "sale date", "created at", "transaction date"],
  branch: ["sucursal", "branch", "location", "local", "centro"],
  customer: ["cliente", "customer", "paciente", "client name"],
  provider: ["prestador", "profesional", "especialista", "operadora", "employee", "staff", "provider"],
  service: ["servicio", "service", "treatment", "tratamiento"],
  category: ["categoria", "category", "tipo servicio"],
  product: ["producto", "product", "articulo"],
  quantity: ["cantidad", "qty", "quantity", "units"],
  amount: ["monto", "total", "amount", "gross", "revenue", "precio total", "venta"],
  paymentMethod: ["forma de pago", "payment method", "metodo de pago", "pago"],
}

export const SALE_FIELDS = Object.keys(COLUMN_EQUIVALENCES) as SaleField[]

/** Etiquetas legibles de cada campo, para la UI de mapeo. */
export const SALE_FIELD_LABEL: Record<SaleField, string> = {
  date: "Fecha", branch: "Sucursal", customer: "Cliente", provider: "Prestador",
  service: "Servicio", category: "Categoría", product: "Producto", quantity: "Cantidad",
  amount: "Monto", paymentMethod: "Forma de pago",
}

/** Índice invertido alias-normalizado → campo canónico. */
const ALIAS_INDEX: Record<string, SaleField> = (() => {
  const idx: Record<string, SaleField> = {}
  for (const field of SALE_FIELDS) {
    for (const alias of COLUMN_EQUIVALENCES[field]) idx[normalizeName(alias)] = field
  }
  return idx
})()

export type ColumnMapping = Partial<Record<SaleField, string>>

/**
 * Detecta el mapeo campo→encabezado a partir de los encabezados del archivo.
 * Coincidencia exacta por alias normalizado; si un campo tiene varios headers
 * candidatos, gana el primero encontrado. Devuelve también los headers no
 * reconocidos.
 */
export function detectColumns(headers: string[]): { mapping: ColumnMapping; unmapped: string[] } {
  const mapping: ColumnMapping = {}
  const unmapped: string[] = []
  for (const h of headers) {
    const field = ALIAS_INDEX[normalizeName(h)]
    if (field && mapping[field] == null) mapping[field] = h
    else if (!field) unmapped.push(h)
  }
  return { mapping, unmapped }
}

/** Campos requeridos mínimos para poder importar/calcular. */
export const REQUIRED_FIELDS: SaleField[] = ["branch", "provider", "amount", "paymentMethod"]

/** Valida que un mapeo tenga los campos requeridos; devuelve los que faltan. */
export function missingRequired(mapping: ColumnMapping): SaleField[] {
  return REQUIRED_FIELDS.filter((f) => !mapping[f])
}

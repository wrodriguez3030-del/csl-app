/**
 * Clasificación de ventas del importador real de Cibao (sección 12).
 * - `classifyItem`: deriva la CATEGORÍA a partir del tipo (Servicio/Producto) y
 *   el nombre del servicio (los códigos C-1/T-1/M-1/H-1 y palabras clave). Es
 *   configurable (catálogo editable), no un `includes()` descontrolado.
 * - `classifyProvider`: extrae el rol del prestador (entre paréntesis) y decide
 *   si es COMISIONABLE (excluye recepción/POS/administración/"Sin Información").
 */
import { normalizeName } from "./normalize"

export type SaleCategory =
  | "FACIALES" | "HOLLYWOOD_AQUA_PEEL" | "TATUAJES" | "HIFU" | "MASAJES"
  | "DEPILACION_LASER" | "PRODUCTO" | "OTROS"

export interface ClassificationRule {
  category: SaleCategory
  keywords: string[] // se comparan normalizados (sin acentos, mayúsculas)
}

/**
 * Reglas por defecto. ORDEN importante: Hollywood antes que Láser (ambos pueden
 * contener "LASER"/"PEEL"). Editable desde la pantalla de clasificación.
 */
export const DEFAULT_CLASSIFICATION: ClassificationRule[] = [
  { category: "HOLLYWOOD_AQUA_PEEL", keywords: ["HOLLYWOOD", "AQUA PEEL", "H-1"] },
  { category: "DEPILACION_LASER", keywords: ["DEPILACION LASER", "DEPILACION", "L-1"] },
  { category: "TATUAJES", keywords: ["TATUAJE", "CEJA", "T-1"] },
  { category: "MASAJES", keywords: ["MASAJE", "M-1"] },
  { category: "HIFU", keywords: ["HIFU"] },
  { category: "FACIALES", keywords: ["FACIAL", "LIMPIEZA", "PELLING", "PEELING", "DESCAMANTE", "MICRODERMO", "C-1"] },
]

/** Deriva la categoría de una línea de venta. Los "Producto" son PRODUCTO. */
export function classifyItem(itemType: string, name: string, rules: ClassificationRule[] = DEFAULT_CLASSIFICATION): SaleCategory {
  if (normalizeName(itemType) === "PRODUCTO") return "PRODUCTO"
  const n = normalizeName(name)
  for (const r of rules) {
    if (r.keywords.some((k) => n.includes(normalizeName(k)))) return r.category
  }
  return "OTROS"
}

export interface ProviderInfo {
  name: string // nombre limpio (sin el rol entre paréntesis)
  role: string // rol declarado ("prestador", "Recepcionista", "Administrador Local"…)
  commissionable: boolean
}

/** Patrones de rol/nombre NO comisionable (recepción, POS, administración). */
export const NON_COMMISSION_PATTERNS = [
  "RECEPCION", "ENCARGAD", "ADMINISTRADOR", "OFICINA", "OPERACIONES",
  "PC ", "LAP TOP", "CAJA", "SIN INFORMACION",
]

/**
 * Extrae nombre + rol del prestador y decide si es comisionable. El rol suele
 * venir entre paréntesis: "SAHOMY (prestador)", "… (Recepcionista)". Los "Sin
 * Información" y roles de recepción/administración NO comisionan.
 */
export function classifyProvider(raw: unknown, nonCommission: string[] = NON_COMMISSION_PATTERNS): ProviderInfo {
  const s = String(raw ?? "").trim()
  const m = s.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
  const name = (m ? m[1] : s).trim()
  const role = (m ? m[2] : "").trim()
  const nN = normalizeName(name)
  const roleN = normalizeName(role)
  const nonComm = nonCommission.some((p) => {
    const pN = normalizeName(p)
    return nN.includes(pN) || roleN.includes(pN)
  })
  const roleOk = roleN === "" || roleN === "PRESTADOR"
  const commissionable = roleOk && !nonComm && nN !== "" && nN !== "SIN INFORMACION"
  return { name, role, commissionable }
}

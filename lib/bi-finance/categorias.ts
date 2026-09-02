/**
 * Ventas por SERVICIO (categoría) — núcleo PURO.
 *
 * Las 10 categorías son las de `SaleCategory` (clasificación de ventas de
 * Incentivos). Siempre se devuelven las 10 claves, aunque estén en cero: así la
 * forma del summary es estable (la caché de la IA se calcula sobre su JSON) y
 * la UI no tiene que comprobar `undefined`.
 */
import type { SaleCategory } from "@/lib/commission/classification"

export const SALE_CATEGORY_KEYS: readonly SaleCategory[] = [
  "DEPILACION_LASER", "PRODUCTO", "FACIALES", "MASAJES", "TATUAJES",
  "HOLLYWOOD_AQUA_PEEL", "ANESTESIA", "BOTOX_PLASMA", "HIFU", "OTROS",
]

export type PorServicio = Readonly<Record<SaleCategory, number>>

export interface CategoryAgg { category?: string | null; branch?: string | null; gross?: number | string | null }

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100
const isKnown = (c: string): c is SaleCategory => (SALE_CATEGORY_KEYS as readonly string[]).includes(c)

/** Las 10 categorías en cero. */
export function emptyPorServicio(): PorServicio {
  return Object.fromEntries(SALE_CATEGORY_KEYS.map((k) => [k, 0])) as Record<SaleCategory, number>
}

const addTo = (m: PorServicio, cat: SaleCategory, amount: number): PorServicio => ({ ...m, [cat]: round2(m[cat] + amount) })

/**
 * Agrupa las filas del RPC `sc_sales_by_category` (o del fallback paginado) en
 * total por categoría y desglose por sucursal. Categoría desconocida → OTROS.
 */
export function porServicioFrom(rows: readonly CategoryAgg[]): { total: PorServicio; byBranch: Readonly<Record<string, PorServicio>> } {
  return rows.reduce(
    (acc, r) => {
      const raw = String(r.category || "OTROS")
      const cat: SaleCategory = isKnown(raw) ? raw : "OTROS"
      const branch = String(r.branch || "(sin sucursal)")
      const amount = Number(r.gross) || 0
      return {
        total: addTo(acc.total, cat, amount),
        byBranch: { ...acc.byBranch, [branch]: addTo(acc.byBranch[branch] || emptyPorServicio(), cat, amount) },
      }
    },
    { total: emptyPorServicio(), byBranch: {} as Record<string, PorServicio> },
  )
}

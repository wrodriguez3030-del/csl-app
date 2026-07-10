/**
 * Hashing para deduplicación (sección 5). Sin dependencias: usable en cliente y
 * servidor.
 * - `fnvHex`: hash determinista de 64 bits (16 hex) vía doble FNV-1a con seeds
 *   distintas — suficiente para `row_hash` (evita colisiones prácticas).
 * - `rowHashKey`: arma la clave estable de una venta antes de hashear.
 */

function fnv32(str: string, seed: number): number {
  let h = seed >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Hash determinista de 64 bits en 16 caracteres hex. */
export function fnvHex(str: string): string {
  const a = fnv32(str, 0x811c9dc5)
  const b = fnv32(str, 0x7fffffff)
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")
}

/** Clave estable de una venta para `row_hash`. */
export function rowHashKey(businessId: string, r: {
  date?: string; branch?: string; provider?: string; customer?: string
  itemName?: string; category?: string; quantity?: number; amount?: number
  originalId?: string
}): string {
  return [
    businessId,
    (r.date || "").slice(0, 19),
    r.branch || "",
    r.provider || "",
    r.customer || "",
    r.itemName || "",
    r.category || "",
    r.quantity ?? "",
    r.amount ?? "",
    r.originalId || "",
  ].join("|").toUpperCase()
}

/** Calcula el row_hash de una venta. */
export function computeRowHash(businessId: string, r: Parameters<typeof rowHashKey>[1]): string {
  return fnvHex(rowHashKey(businessId, r))
}

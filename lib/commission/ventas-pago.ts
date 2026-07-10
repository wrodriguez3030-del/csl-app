/**
 * Medios de pago de la hoja "Produccion v2" — PURO (cliente y servidor).
 * El desglose de pago viene POR RECIBO: en recibos multi-línea una sola fila
 * lleva los montos; por eso el importador acumula por Identificador y asigna
 * a cada línea el medio DOMINANTE de su recibo.
 */
export interface PayBuckets { tarjeta: number; efectivo: number; transf: number; otros: number }

interface RowLike { getCell: (c: number) => { value: unknown } }

const flatNum = (v: unknown): number => {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>
    if (o.result !== undefined) return Number(o.result) || 0
  }
  return Number(v) || 0
}

/** Montos por medio de pago de una fila de "Produccion v2" (columnas 18-28). */
export function payBucketsFromV2(row: RowLike): PayBuckets {
  const g = (c: number) => flatNum(row.getCell(c).value)
  return {
    tarjeta: g(19) + g(20) + g(25) + g(28),
    efectivo: g(18),
    transf: g(26) + g(27),
    otros: g(21) + g(22) + g(23) + g(24),
  }
}

/** Medio dominante de un acumulado de buckets. */
export function dominantPayment(b: PayBuckets): string {
  const max = Math.max(b.tarjeta, b.efectivo, b.transf, b.otros)
  if (max <= 0) return "OTROS"
  if (max === b.tarjeta) return "Tarjeta"
  if (max === b.efectivo) return "Efectivo"
  if (max === b.transf) return "Transferencia"
  return "Otro"
}

/** Suma dos buckets (acumulación por recibo). */
export function addBuckets(a: PayBuckets, b: PayBuckets): PayBuckets {
  return { tarjeta: a.tarjeta + b.tarjeta, efectivo: a.efectivo + b.efectivo, transf: a.transf + b.transf, otros: a.otros + b.otros }
}

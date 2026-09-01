/**
 * Resumen de ventas POR SUCURSAL para «Incentivos de Ventas · Ventas por
 * sucursal». Lógica PURA (sin base de datos) para poder probarla.
 *
 * Hay DOS porcentajes de tarjeta y NO significan lo mismo:
 *
 *   · `cardShare`  — qué parte de las ventas DE ESA SUCURSAL se cobró con
 *                    tarjeta (`tarjeta / bruto`). Es una MEDIDA: cambia con
 *                    cada sucursal y cada período.
 *   · `cardPct`    — la regla del negocio (`card_percentage`) que se descuenta
 *                    por cobrar con tarjeta antes de calcular el incentivo.
 *                    Es una CONFIGURACIÓN: igual para todas las sucursales.
 *
 * Confundirlas hacía que la columna «% Tarj.» mostrara siempre el mismo número
 * fijo en las tres sucursales.
 */
import { round2 } from "./money"

export interface BranchSalesRow {
  branch?: unknown
  gross_amount?: unknown
  payment_method?: unknown
  category?: unknown
}

export interface BranchSummary {
  branch: string
  count: number
  gross: number
  tarjeta: number
  efectivo: number
  transferencia: number
  otros: number
  producto: number
  servicio: number
  laser: number
  /** Fracción de las ventas de la sucursal cobrada con tarjeta (0–1). */
  cardShare: number
  /** Regla del negocio que se descuenta a lo cobrado con tarjeta (0–1). */
  cardPct: number
  /** Descuento en pesos: tarjeta × cardPct. */
  cardResult: number
}

interface Acc {
  branch: string; count: number; gross: number
  tarjeta: number; efectivo: number; transferencia: number; otros: number
  producto: number; servicio: number; laser: number
}

const NO_BRANCH = "(sin sucursal)"

/**
 * Agrupa las ventas por sucursal. No modifica `rows`: acumula en un mapa local
 * y devuelve objetos nuevos, ordenados por bruto descendente.
 */
export function aggregateBranches(rows: BranchSalesRow[], cardPct: number): BranchSummary[] {
  const pct = Number(cardPct) || 0
  const map = new Map<string, Acc>()

  for (const r of rows) {
    const branch = String(r.branch || NO_BRANCH)
    let b = map.get(branch)
    if (!b) {
      b = { branch, count: 0, gross: 0, tarjeta: 0, efectivo: 0, transferencia: 0, otros: 0, producto: 0, servicio: 0, laser: 0 }
      map.set(branch, b)
    }
    const amt = Number(r.gross_amount) || 0
    b.gross = round2(b.gross + amt)
    b.count++

    const pm = String(r.payment_method || "OTROS")
    if (pm === "TARJETA") b.tarjeta = round2(b.tarjeta + amt)
    else if (pm === "EFECTIVO") b.efectivo = round2(b.efectivo + amt)
    else if (pm === "TRANSFERENCIA") b.transferencia = round2(b.transferencia + amt)
    else b.otros = round2(b.otros + amt)

    const cat = String(r.category || "")
    if (cat === "PRODUCTO") b.producto = round2(b.producto + amt)
    else if (cat === "DEPILACION_LASER") b.laser = round2(b.laser + amt)
    else b.servicio = round2(b.servicio + amt)
  }

  return [...map.values()]
    .map((b) => ({
      ...b,
      cardShare: cardShareOf(b.tarjeta, b.gross),
      cardPct: pct,
      cardResult: round2(b.tarjeta * pct),
    }))
    .sort((a, b) => b.gross - a.gross)
}

/** Fracción cobrada con tarjeta. Bruto 0 → 0 (nunca dividir por cero). */
export function cardShareOf(tarjeta: number, gross: number): number {
  const g = Number(gross) || 0
  if (g <= 0) return 0
  return Math.round(((Number(tarjeta) || 0) / g) * 10000) / 10000
}

/** Totales de una lista de sucursales (el % de tarjeta se RECALCULA, no se suma). */
export function totalsOf(branches: BranchSummary[], cardPct: number): BranchSummary {
  const add = (f: (b: BranchSummary) => number) => round2(branches.reduce((s, b) => s + f(b), 0))
  const gross = add((b) => b.gross)
  const tarjeta = add((b) => b.tarjeta)
  const pct = Number(cardPct) || 0
  return {
    branch: "Totales", count: branches.reduce((s, b) => s + b.count, 0), gross, tarjeta,
    efectivo: add((b) => b.efectivo), transferencia: add((b) => b.transferencia), otros: add((b) => b.otros),
    producto: add((b) => b.producto), servicio: add((b) => b.servicio), laser: add((b) => b.laser),
    cardShare: cardShareOf(tarjeta, gross), cardPct: pct, cardResult: add((b) => b.cardResult),
  }
}

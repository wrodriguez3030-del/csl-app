/**
 * Quién vendió PRODUCTO — lógica PURA.
 *
 * La pantalla de «Incentivos de productos» muestra quién COBRA el incentivo, que
 * no es lo mismo que quién VENDIÓ: por reglas del negocio, las ventas de las
 * cuentas de recepción se reparten entre prestadoras designadas, hay prestadores
 * excluidos y ventas sin prestador. Esta función devuelve la lista real de
 * vendedores con el motivo por el que cada uno genera o no incentivo directo.
 */
import { classifyProvider } from "./classification"
import { isExcludedProvider, isNonIncentiveItem } from "./exclusions"
import { receptionSplitsForBranch, isReceptionSplitSale } from "./reception-splits"
import { normalizeName } from "./normalize"

export type SellerStatus = "incentiva" | "repartido" | "excluido" | "sin_prestador" | "no_comisionable"

export const SELLER_STATUS_LABEL: Readonly<Record<SellerStatus, string>> = {
  incentiva: "Cobra su incentivo",
  repartido: "Se reparte",
  excluido: "Excluido del incentivo",
  sin_prestador: "Sin prestador",
  no_comisionable: "No comisionable",
}

export interface ProductSaleIn {
  providerOriginal?: unknown
  branch?: unknown
  serviceName?: unknown
  quantity?: unknown
  amount?: unknown
}

export interface SellerRow {
  provider: string
  providerOriginal: string
  role: string
  branch: string
  lines: number
  units: number
  /** Unidades de ítems que NUNCA pagan incentivo (rasuradoras, aplicación de
   *  anestesia): se vendieron, pero por regla del negocio no comisionan. */
  unitsSinIncentivo: number
  gross: number
  status: SellerStatus
  note: string
}

export interface SellerTotals {
  lines: number; units: number; gross: number
  unitsIncentivan: number; unitsRepartidas: number; unitsExcluidas: number
  unitsSinPrestador: number; unitsNoComisionables: number
  /** Ítems que no comisionan nunca (rasuradoras…), ya incluidos en los de arriba. */
  unitsSinIncentivo: number
}

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100

function statusOf(providerOriginal: string, name: string, branch: string, tenant: string): { status: SellerStatus; note: string } {
  const n = normalizeName(name)
  if (!n || n === "SIN INFORMACION") return { status: "sin_prestador", note: "Venta sin prestador asignado en el archivo" }
  if (isExcludedProvider(name, tenant)) return { status: "excluido", note: "Excluido del incentivo por regla del negocio" }
  if (isReceptionSplitSale(branch, providerOriginal, tenant)) {
    const rule = receptionSplitsForBranch(branch, tenant).find((s) => s.account === normalizeName(classifyProvider(providerOriginal).name))
    return { status: "repartido", note: `Sus unidades se reparten entre ${(rule?.recipients || []).join(", ")}` }
  }
  if (!classifyProvider(providerOriginal).commissionable) return { status: "no_comisionable", note: "Cuenta no comisionable y sin regla de reparto" }
  return { status: "incentiva", note: "" }
}

/** Agrupa las ventas de producto por vendedor y sucursal, de más a menos unidades. */
export function buildProductSellers(rows: readonly ProductSaleIn[], tenant: string): SellerRow[] {
  const map = rows.reduce<Record<string, SellerRow>>((acc, r) => {
    const providerOriginal = String(r.providerOriginal ?? "").trim()
    const branch = String(r.branch ?? "") || "(sin sucursal)"
    const { name, role } = classifyProvider(providerOriginal)
    const key = `${normalizeName(name)}|${normalizeName(branch)}`
    const prev = acc[key]
    const units = Number(r.quantity) || 0
    const gross = Number(r.amount) || 0
    const sinIncentivo = isNonIncentiveItem(r.serviceName, tenant) ? units : 0
    if (prev) {
      return { ...acc, [key]: { ...prev, lines: prev.lines + 1, units: round2(prev.units + units), unitsSinIncentivo: round2(prev.unitsSinIncentivo + sinIncentivo), gross: round2(prev.gross + gross) } }
    }
    const { status, note } = statusOf(providerOriginal, name, branch, tenant)
    return { ...acc, [key]: { provider: name, providerOriginal, role, branch, lines: 1, units: round2(units), unitsSinIncentivo: round2(sinIncentivo), gross: round2(gross), status, note } }
  }, {})
  return Object.values(map).sort((a, b) => b.units - a.units || b.gross - a.gross)
}

/** Totales de la lista, con las unidades desglosadas por motivo. */
export function sellerTotals(rows: readonly SellerRow[]): SellerTotals {
  const sum = (f: (r: SellerRow) => number) => round2(rows.reduce((s, r) => s + f(r), 0))
  const byStatus = (s: SellerStatus) => sum((r) => (r.status === s ? r.units : 0))
  return {
    lines: rows.reduce((s, r) => s + r.lines, 0),
    units: sum((r) => r.units),
    gross: sum((r) => r.gross),
    unitsIncentivan: byStatus("incentiva"),
    unitsRepartidas: byStatus("repartido"),
    unitsExcluidas: byStatus("excluido"),
    unitsSinPrestador: byStatus("sin_prestador"),
    unitsNoComisionables: byStatus("no_comisionable"),
    unitsSinIncentivo: sum((r) => r.unitsSinIncentivo),
  }
}

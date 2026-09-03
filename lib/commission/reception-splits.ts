/**
 * Reparto de ventas de PRODUCTO de recepción — FUENTE ÚNICA.
 *
 * Ciertas cuentas de recepción (rol "Recepcionista", NO comisionables) venden
 * productos que, por decisión del negocio, se reparten en partes iguales entre
 * prestadoras designadas de la MISMA sucursal. El reparto es por UNIDADES, con
 * reparto entero (el remanente va a las primeras): 100 u entre 3 → 34, 33, 33.
 *
 * Alcance (confirmado): SOLO ventas de PRODUCTO y SOLO estas cuentas nombradas
 * (las demás cuentas de recepción NO se reparten). El nombre de la cuenta se
 * compara EXACTO sobre el nombre normalizado sin el rol (así "ENCARGADA 1" no
 * choca con "ENCARGADA 2").
 */
import { normalizeName } from "./normalize"
import { classifyProvider } from "./classification"

export interface ReceptionSplitRule {
  /** Slug del negocio dueño de la regla ("csl" | "depicenter"). Obligatorio:
   *  una cuenta de recepción de un tenant no existe en el otro. */
  tenant: string
  /** Sucursal a la que aplica (se compara normalizada). */
  branch: string
  /** Nombre de la cuenta de recepción SIN el rol, normalizado (MAYÚSCULAS, sin
   *  acentos, espacios colapsados). */
  account: string
  /** Prestadoras entre las que se reparten las unidades (nombres del roster). */
  recipients: string[]
  /** Vigencia, «YYYY-MM» inclusive. Sin `from` vale desde siempre; sin `to`,
   *  hasta nuevo aviso. Cuando alguien deja la sucursal se CIERRA su regla y se
   *  abre otra: así recalcular un mes viejo sigue repartiendo como se pagó. */
  from?: string
  to?: string
}

/**
 * Reglas por tenant. NUNCA MEZCLAR TENANTS: los nombres de cuenta y las
 * destinatarias son de un negocio concreto, así que el `tenant` es obligatorio
 * al consultarlas y un slug desconocido devuelve lista vacía (jamás hereda las
 * de otro negocio). Depicenter no tiene cuentas de recepción que se repartan
 * — verificado sobre sus datos: 0 ventas desde cuentas de recepción.
 */
export const RECEPTION_PRODUCT_SPLITS: ReceptionSplitRule[] = [
  { tenant: "csl", branch: "RAFAEL VIDAL", account: "PC RECEPCION LAP TOP R VIDAL", recipients: ["LUISA", "YANIBEL", "KARLA"] },
  { tenant: "csl", branch: "LOS JARDINES", account: "LOS JARDINES ENCARGADA 1", recipients: ["LESLIE", "YADIBEL"] },
  { tenant: "csl", branch: "LOS JARDINES", account: "LOS JARDINES ENCARGADA 2", recipients: ["LESLIE", "YADIBEL"] },
  { tenant: "csl", branch: "VILLA OLGA", account: "VILLA OLGA ENCARGADA", recipients: ["ANGELICA", "GIPSY"], to: "2026-08" },
  { tenant: "csl", branch: "VILLA OLGA", account: "VILLA OLGA ENCARGADA", recipients: ["ANGELICA", "VANELY"], from: "2026-09" },
]

const sameTenant = (a: string, b: string) =>
  String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase()

/** Período de vigencia: «YYYY-MM» o `{ year, month }`. */
export type SplitPeriod = string | { year: number; month: number }

const periodKey = (p: SplitPeriod | null | undefined): string | null => {
  if (!p) return null
  if (typeof p === "string") return /^\d{4}-\d{2}$/.test(p) ? p : null
  return `${p.year}-${String(p.month).padStart(2, "0")}`
}

/** ¿La regla está vigente en ese período? Sin período, valen las abiertas (las de hoy). */
function vigente(r: ReceptionSplitRule, key: string | null): boolean {
  if (!key) return !r.to
  if (r.from && key < r.from) return false
  if (r.to && key > r.to) return false
  return true
}

/** Reglas de reparto de una sucursal DEL TENANT (cuenta normalizada + destinatarias).
 *  `period` decide qué versión de la regla aplica: sin él se devuelven las vigentes hoy. */
export function receptionSplitsForBranch(branch: unknown, tenant: string, period?: SplitPeriod | null): { account: string; recipients: string[] }[] {
  const b = normalizeName(branch)
  const key = periodKey(period)
  return RECEPTION_PRODUCT_SPLITS
    .filter((r) => sameTenant(r.tenant, tenant) && normalizeName(r.branch) === b && vigente(r, key))
    .map((r) => ({ account: r.account, recipients: r.recipients }))
}

/** ¿La venta pertenece a una cuenta de recepción que se reparte? Compara el
 *  nombre original del prestador (con o sin rol) contra la cuenta configurada.
 *  Se usa para no listar estas ventas en "Ventas sin prestador" (ya se reparten). */
export function isReceptionSplitSale(branch: unknown, providerOriginalRaw: unknown, tenant: string, period?: SplitPeriod | null): boolean {
  const splits = receptionSplitsForBranch(branch, tenant, period)
  if (!splits.length) return false
  const name = normalizeName(classifyProvider(providerOriginalRaw).name)
  return splits.some((s) => name === s.account)
}

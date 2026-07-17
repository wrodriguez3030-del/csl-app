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
  /** Sucursal a la que aplica (se compara normalizada). */
  branch: string
  /** Nombre de la cuenta de recepción SIN el rol, normalizado (MAYÚSCULAS, sin
   *  acentos, espacios colapsados). */
  account: string
  /** Prestadoras entre las que se reparten las unidades (nombres del roster). */
  recipients: string[]
}

export const RECEPTION_PRODUCT_SPLITS: ReceptionSplitRule[] = [
  { branch: "RAFAEL VIDAL", account: "PC RECEPCION LAP TOP R VIDAL", recipients: ["LUISA", "YANIBEL", "KARLA"] },
  { branch: "LOS JARDINES", account: "LOS JARDINES ENCARGADA 1", recipients: ["LESLIE", "YADIBEL"] },
  { branch: "LOS JARDINES", account: "LOS JARDINES ENCARGADA 2", recipients: ["LESLIE", "YADIBEL"] },
  { branch: "VILLA OLGA", account: "VILLA OLGA ENCARGADA", recipients: ["ANGELICA", "GIPSY"] },
]

/** Reglas de reparto para una sucursal (cuenta normalizada + destinatarias). */
export function receptionSplitsForBranch(branch: unknown): { account: string; recipients: string[] }[] {
  const b = normalizeName(branch)
  return RECEPTION_PRODUCT_SPLITS.filter((r) => normalizeName(r.branch) === b)
    .map((r) => ({ account: r.account, recipients: r.recipients }))
}

/** ¿La venta pertenece a una cuenta de recepción que se reparte? Compara el
 *  nombre original del prestador (con o sin rol) contra la cuenta configurada.
 *  Se usa para no listar estas ventas en "Ventas sin prestador" (ya se reparten). */
export function isReceptionSplitSale(branch: unknown, providerOriginalRaw: unknown): boolean {
  const splits = receptionSplitsForBranch(branch)
  if (!splits.length) return false
  const name = normalizeName(classifyProvider(providerOriginalRaw).name)
  return splits.some((s) => name === s.account)
}

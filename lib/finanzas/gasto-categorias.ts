/**
 * Categoría de un gasto a partir del CONCEPTO escrito en el libro mensual
 * («NOMINA R VIDAL R-1», «EDENORTE LOS JARDINES», «Claro/Codetel»…).
 *
 * Reglas ordenadas: gana la primera que coincide sobre el concepto normalizado
 * (sin acentos, en mayúsculas). Los nombres coinciden con las categorías que ya
 * sugiere Compras › Pagos/gastos (`RECURRING_CATEGORIES`), para que los filtros
 * de ese módulo reconozcan lo importado.
 */
import { normalizeName } from "@/lib/commission/normalize"

export const CATEGORIA_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bNOMINA\b|\bSUELDO|\bSALARIO|\bQUINCENA/, "Nómina"],
  [/\bTSS\b|\bINFOTEP\b|\bAFP\b|\bARS\b|\bSFS\b/, "Cargas sociales"],
  [/\bALQ(UILER)?\b|\bRENTA\b|\bARRENDAM/, "Alquiler"],
  [/\bEDENORTE\b|\bEDESUR\b|\bEDEESTE\b|\bLUZ\b|\bELECTRIC/, "Electricidad"],
  [/\bCLARO\b|\bCODETEL\b|\bALTICE\b|\bINTERNET\b|\bMEGARED\b|\bWIFI\b|\bTELEFON/, "Internet"],
  [/\bREDES\b|\bMETA\b|\bFACEBOOK\b|\bINSTAGRAM\b|\bPUBLICIDAD\b|\bOFERTA\b|\bMARKETING\b|\bHOST\b|\bPAGINA WEB\b/, "Publicidad"],
  [/\bINCENTIVO|\bCOMISION|\bBONO\b/, "Incentivos"],
  [/\bCAJA CHICA\b/, "Caja chica"],
  [/\bMANT\b|\bMANTENIMIENTO|\bREPARACION|\bPINTURA\b|\bPLOMER|\bELECTRICISTA\b|\bJARDINERO\b|\bLIMPIEZA\b|\bLAVAR\b/, "Mantenimiento"],
  [/\bGASOLINA\b|\bCOMBUSTIBLE\b|\bGASOIL\b|\bPEAJE\b/, "Combustible"],
  [/\bSABANA|\bPAPEL\b|\bCAMILLA\b|\bSUMINISTRO|\bTOALLA|\bCUBO\b|\bBRAVO\b|\bPRICE ?SMART\b|\bOCHOA\b|\bBELLON\b/, "Suministros"],
  [/\bSEGURO\b|\bPOLIZA\b|\bMONITOREO\b|\bTELEGUARD\b|\bALARMA\b/, "Seguros"],
  [/\bDGII\b|\bIMPUESTO|\bITBIS\b|\bANTICIPO\b/, "Impuestos"],
  [/\bDEVOLUCION/, "Devoluciones"],
  [/\bPRODUCTO|\bFACT\.? ?PROD\b|\bDERMAPEN\b|\bREPUESTO|\bRESPUSTO/, "Productos"],
  [/\bCONTABLE\b|\bABOGAD|\bLEGAL\b|\bHONORARIO/, "Servicios profesionales"],
  [/\bSISTEMA\b|\bSOFTWARE\b|\bLICENCIA\b|\bAGENDA ?PRO\b/, "Software"],
  [/\bPRESTAMO\b|\bCUOTA\b|\bBANCO\b/, "Financieros"],
]

export const CATEGORIA_DEFAULT = "Otros"

/** Categoría inferida del concepto; «Otros» si ninguna regla coincide. */
export function inferCategoria(concept: unknown): string {
  const n = normalizeName(String(concept ?? ""))
  if (!n) return CATEGORIA_DEFAULT
  const hit = CATEGORIA_RULES.find(([re]) => re.test(n))
  return hit ? hit[1] : CATEGORIA_DEFAULT
}

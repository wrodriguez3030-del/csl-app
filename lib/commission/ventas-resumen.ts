/**
 * Extractor de la hoja "Resumen" del archivo de Ventas — controles de
 * conciliación (spec Importador §6-§7). PURO: recibe un Workbook cargado.
 *
 * Layout real: pares etiqueta(col1)/valor(col2). "Transferencia Bancaria"
 * aparece DOS veces (variante con espacios) y las tarjetas en 3 filas
 * (Crédito/Débito/Tarjeta) → se SUMAN por forma canónica.
 */
import { normalizeName, normalizePayment, parseDateISO } from "./normalize"
import { round2 } from "./money"

export interface ResumenControls {
  periodStart: string // ISO
  periodEnd: string
  total: number
  servicios: number
  productos: number
  efectivo: number
  tarjeta: number
  transferencia: number
  cheque: number
  online: number
  otros: number
}

interface WorksheetLike {
  rowCount: number
  getRow: (r: number) => { getCell: (c: number) => { value: unknown } }
}
interface WorkbookLike {
  getWorksheet: (name: string) => WorksheetLike | undefined
}

const flat = (v: unknown): unknown => {
  if (v && typeof v === "object") {
    if (v instanceof Date) return v.toISOString()
    const o = v as Record<string, unknown>
    if (o.result !== undefined) return o.result
    if (o.text !== undefined) return o.text
  }
  return v
}

export function extractResumenControls(wb: WorkbookLike): ResumenControls | null {
  const ws = wb.getWorksheet("Resumen")
  if (!ws) return null
  const out: ResumenControls = {
    periodStart: "", periodEnd: "", total: 0, servicios: 0, productos: 0,
    efectivo: 0, tarjeta: 0, transferencia: 0, cheque: 0, online: 0, otros: 0,
  }
  let inPagoSection = false
  for (let r = 1; r <= Math.min(ws.rowCount, 120); r++) {
    const label = String(flat(ws.getRow(r).getCell(1).value) ?? "").trim()
    if (!label) continue
    const labelN = normalizeName(label)
    const val = flat(ws.getRow(r).getCell(2).value)
    const num = Number(val) || 0

    if (labelN.startsWith("FECHA DE INICIO")) out.periodStart = parseDateISO(String(val ?? ""))
    else if (labelN.startsWith("FECHA DE FIN")) out.periodEnd = parseDateISO(String(val ?? ""))
    else if (labelN.startsWith("TOTAL DEL PERIODO")) out.total = round2(num)
    else if (labelN === "SERVICIOS") out.servicios = round2(num)
    else if (labelN === "PRODUCTOS") out.productos = round2(num)
    else if (labelN.startsWith("DETALLE POR MEDIO DE PAGO")) inPagoSection = true
    else if (labelN.startsWith("DETALLE POR COMPROBANTE") || labelN.startsWith("RECAUDACIONES") || labelN.startsWith("RESUMEN POR SUCURSAL")) inPagoSection = false
    else if (inPagoSection && num !== 0) {
      // "Total Giftcard Canjes (-)" y "Vueltos" no son formas de pago reales.
      if (labelN.includes("GIFTCARD") || labelN.includes("VUELTO")) continue
      const pm = normalizePayment(label)
      if (pm === "EFECTIVO") out.efectivo = round2(out.efectivo + num)
      else if (pm === "TARJETA") out.tarjeta = round2(out.tarjeta + num)
      else if (pm === "TRANSFERENCIA") out.transferencia = round2(out.transferencia + num)
      else if (pm === "CHEQUE") out.cheque = round2(out.cheque + num)
      else if (pm === "ONLINE") out.online = round2(out.online + num)
      else out.otros = round2(out.otros + num)
    }
  }
  return out.total || out.servicios || out.productos ? out : null
}

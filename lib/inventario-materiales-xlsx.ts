"use client"

/**
 * Excel (.xlsx) REAL del inventario de materiales usando ExcelJS.
 *
 * A diferencia del enfoque HTML→.xls del resto del sistema, produce un xlsx
 * NATIVO con: logo embebido, encabezado corporativo, columnas con color de
 * marca, bordes, anchos definidos, cantidad con formato numérico alineada a la
 * derecha, fila de totales, AUTOFILTRO y FREEZE PANES. Página A4.
 *
 * `buildInventarioWorkbook` recibe el módulo ExcelJS por parámetro para poder
 * probarse fuera del navegador; `exportInventarioXlsx` lo importa dinámicamente
 * (fuera del bundle inicial) y descarga el archivo.
 */
import type { Business } from "./types"
import type { MaterialInventory } from "./materials-client"
import { INV_STATUS_LABEL } from "./materials-client"
import { inventarioFileBase } from "./inventario-materiales-pdf"

export interface InvXlsxOpts {
  inventory: MaterialInventory
  business: Business
  responsable: string
  generadoPor?: string
  origin: string
}

type ExcelJSModule = typeof import("exceljs")
type LogoInput = { base64: string; extension: "png" | "jpeg" | "gif" }

const HEADER_ROW = 6

/** Convierte "#0891b2" → "FF0891B2" (ARGB que espera ExcelJS). */
function argb(color: string): string {
  const c = (color || "#0891b2").replace("#", "")
  const rgb = c.length === 3 ? c.split("").map((x) => x + x).join("") : c.slice(0, 6)
  return ("FF" + rgb).toUpperCase()
}

function thin() {
  const s = { style: "thin" as const, color: { argb: "FFCBD5E1" } }
  return { top: s, left: s, bottom: s, right: s }
}

/** Construye el Workbook. `logo` es opcional (best-effort). */
export async function buildInventarioWorkbook(
  opts: InvXlsxOpts,
  ExcelJS: ExcelJSModule,
  logo?: LogoInput,
) {
  const { inventory, business, responsable } = opts
  const brand = argb(business.primaryColor || "#0891b2")
  const items = [...(inventory.items || [])].sort((a, b) => {
    const s = String(a.supplierGroup || "").localeCompare(String(b.supplierGroup || ""))
    return s !== 0 ? s : String(a.materialName || "").localeCompare(String(b.materialName || ""))
  })
  const total = items.length
  const totalQty = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0)
  const estado = INV_STATUS_LABEL[inventory.status] || inventory.status
  const fecha = String(inventory.inventoryDate || "").slice(0, 10)

  const wb = new ExcelJS.Workbook()
  wb.creator = business.name || "CSL"
  const ws = wb.addWorksheet("Inventario", {
    views: [{ state: "frozen", ySplit: HEADER_ROW }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: "portrait",
      fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    },
  })

  ws.columns = [
    { width: 6 },   // No.
    { width: 42 },  // Material
    { width: 26 },  // Proveedor / Categoría
    { width: 12 },  // Cantidad
    { width: 12 },  // Unidad
    { width: 36 },  // Observación
  ]

  // Logo embebido (opcional; si falla, seguimos con el texto de marca)
  if (logo) {
    try {
      const imgId = wb.addImage({ base64: logo.base64, extension: logo.extension })
      ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 132, height: 48 } })
    } catch { /* sin logo */ }
  }

  // Fila 1: nombre de empresa (col A reservada para el logo)
  ws.mergeCells(1, 2, 1, 6)
  const nameCell = ws.getCell(1, 2)
  nameCell.value = (business.name || "").toUpperCase()
  nameCell.font = { bold: true, size: 14, color: { argb: brand } }
  nameCell.alignment = { vertical: "middle" }
  ws.getRow(1).height = 40

  // Fila 2: título
  ws.mergeCells(2, 1, 2, 6)
  const titleCell = ws.getCell(2, 1)
  titleCell.value = "INVENTARIO DE MATERIALES"
  titleCell.font = { bold: true, size: 13, color: { argb: brand } }

  // Filas 3 y 4: metadatos
  ws.mergeCells(3, 1, 3, 6)
  ws.getCell(3, 1).value = `Sucursal: ${inventory.branch}      Fecha: ${fecha}      Estado: ${estado}`
  ws.getCell(3, 1).font = { size: 10, color: { argb: "FF475569" } }
  ws.mergeCells(4, 1, 4, 6)
  ws.getCell(4, 1).value = `Creado por: ${inventory.createdByName || responsable || "—"}      Total de materiales: ${total}      Cantidad total: ${totalQty}`
  ws.getCell(4, 1).font = { size: 10, color: { argb: "FF475569" } }

  // Fila 5: separador (vacía)

  // Fila 6: encabezados de columna
  const headers = ["No.", "Material", "Proveedor / Categoría", "Cantidad", "Unidad", "Observación"]
  const headerRow = ws.getRow(HEADER_ROW)
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 }
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: brand } }
    cell.alignment = { vertical: "middle", horizontal: i === 0 || i === 3 ? "center" : "left" }
    cell.border = thin()
  })
  headerRow.height = 20

  // Datos
  let r = HEADER_ROW + 1
  for (const it of items) {
    const row = ws.getRow(r)
    row.getCell(1).value = r - HEADER_ROW
    row.getCell(2).value = it.materialName
    row.getCell(3).value = it.supplierGroup || "—"
    row.getCell(4).value = Number(it.quantity) || 0
    row.getCell(5).value = it.unit || ""
    row.getCell(6).value = it.observation || ""
    row.getCell(1).alignment = { horizontal: "center" }
    row.getCell(4).alignment = { horizontal: "right" }
    row.getCell(4).numFmt = "#,##0.###"
    for (let c = 1; c <= 6; c++) row.getCell(c).border = thin()
    r++
  }

  // Fila de totales
  const totalRow = ws.getRow(r)
  ws.mergeCells(r, 1, r, 3)
  totalRow.getCell(1).value = `TOTALES (${total} materiales)`
  totalRow.getCell(1).font = { bold: true }
  totalRow.getCell(1).alignment = { horizontal: "right" }
  totalRow.getCell(4).value = totalQty
  totalRow.getCell(4).numFmt = "#,##0.###"
  totalRow.getCell(4).font = { bold: true }
  totalRow.getCell(4).alignment = { horizontal: "right" }
  for (let c = 1; c <= 6; c++) {
    totalRow.getCell(c).border = thin()
    totalRow.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } }
  }

  // Autofiltro sobre la fila de encabezados
  ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: 6 } }

  return wb
}

/** Detecta una extensión soportada por ExcelJS (png/jpeg/gif); svg/otros → null. */
function pickExt(ct: string | null, url: string): LogoInput["extension"] | null {
  const s = (ct || "").toLowerCase()
  if (s.includes("png") || /\.png($|\?)/i.test(url)) return "png"
  if (s.includes("jpeg") || s.includes("jpg") || /\.jpe?g($|\?)/i.test(url)) return "jpeg"
  if (s.includes("gif") || /\.gif($|\?)/i.test(url)) return "gif"
  return null
}

/** Descarga el .xlsx real (browser). Nombre: INVENTARIO_MATERIALES_<SUC>_<FECHA>.xlsx */
export async function exportInventarioXlsx(opts: InvXlsxOpts): Promise<void> {
  const mod = await import("exceljs")
  const ExcelJS = ((mod as { default?: ExcelJSModule }).default ?? mod) as ExcelJSModule

  // Logo (best-effort): lo descargamos y convertimos a base64 para embeberlo.
  let logo: LogoInput | undefined
  const { business, origin } = opts
  if (business.logoUrl) {
    try {
      const url = /^https?:/.test(business.logoUrl) ? business.logoUrl : `${origin}${business.logoUrl}`
      const resp = await fetch(url)
      if (resp.ok) {
        const ext = pickExt(resp.headers.get("content-type"), url)
        if (ext) {
          const bytes = new Uint8Array(await resp.arrayBuffer())
          let bin = ""
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
          logo = { base64: btoa(bin), extension: ext }
        }
      }
    } catch { /* sin logo */ }
  }

  const wb = await buildInventarioWorkbook(opts, ExcelJS, logo)
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  const dlUrl = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = dlUrl
  a.download = `${inventarioFileBase(opts.inventory)}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(dlUrl), 1000)
}

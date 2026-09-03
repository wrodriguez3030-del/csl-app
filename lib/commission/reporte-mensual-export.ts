/**
 * Arma el REPORTE MENSUAL DEL NEGOCIO en un solo archivo.
 *
 * Sustituye al libro que se llevaba a mano: cinco hojas planas, sin fórmulas
 * que copiar de un mes a otro y sin nada que teclear. Todo viene ya calculado
 * del sistema, así que no hay forma de que una hoja se desalinee de otra.
 */
const MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

const ETIQUETA_SERVICIO: Record<string, string> = {
  DEPILACION_LASER: "Depilación láser", PRODUCTO: "Productos", FACIALES: "Faciales",
  MASAJES: "Masajes", TATUAJES: "Tatuajes y cejas", HOLLYWOOD_AQUA_PEEL: "Hollywood / Aqua Peel",
  HIFU: "HIFU", ANESTESIA: "Aplicación anestesia", BOTOX_PLASMA: "Botox / plasma", OTROS: "Otros",
}

export interface ReporteMensual {
  negocio: { slug: string; name: string }
  periodo: { month: number; year: number; label?: string }
  resumen: Record<string, number>
  ventas: { porServicio: Record<string, number>; porSucursal: Record<string, number> }
  rentabilidad: { branch: string; ingresos: number; gastos: number; utilidadNeta: number; margenNeto: number }[]
  historicoAnual: { year: number; ventas: number; crecimientoPct: number | null; parcial?: boolean }[]
  liquidacion: {
    persona: string; sucursal: string; unidades: number; producto: number; servicios: number
    pacientes: number; laser: number; limpieza: number; neto: number; detalleServicios: string
  }[]
  gastos: { detalle: { fecha: string; sucursal: string; concepto: string; categoria: string; cuenta: string; monto: number }[]
            porCategoria: Record<string, number>; total: number }
}

const RD = '"RD$"#,##0.00'
const PCT = "0.0%"

/** Arma el libro. Separado de la descarga para poder generarlo también fuera
 *  del navegador (scripts, pruebas) y para poder comprobarlo sin abrir Excel. */
export async function buildReporteMensual(d: ReporteMensual, ExcelJSModule?: unknown) {
  const ExcelJS = (ExcelJSModule as { Workbook: new () => import("exceljs").Workbook } | undefined)
    ?? (await import("exceljs")).default
  const wb = new ExcelJS.Workbook()
  wb.creator = d.negocio.name
  const periodo = `${MESES[d.periodo.month] || d.periodo.month} ${d.periodo.year}`
  const AZUL = "FF1F3864"

  const hoja = (nombre: string, titulo: string, anchos: number[]) => {
    const ws = wb.addWorksheet(nombre, { views: [{ state: "frozen", ySplit: 4 }] })
    ws.columns = anchos.map((w) => ({ width: w }))
    ws.mergeCells(1, 1, 1, anchos.length)
    const t = ws.getCell(1, 1)
    t.value = `${d.negocio.name.toUpperCase()} · ${titulo}`
    t.font = { bold: true, size: 13, color: { argb: AZUL } }
    ws.getRow(1).height = 22
    ws.mergeCells(2, 1, 2, anchos.length)
    ws.getCell(2, 1).value = periodo
    ws.getCell(2, 1).font = { size: 11, color: { argb: "FF595959" } }
    return ws
  }
  const cabecera = (ws: import("exceljs").Worksheet, fila: number, titulos: string[]) => {
    titulos.forEach((h, i) => {
      const c = ws.getCell(fila, i + 1)
      c.value = h
      c.font = { bold: true, color: { argb: "FFFFFFFF" } }
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } }
      c.alignment = { horizontal: i === 0 ? "left" : "right", wrapText: true }
    })
  }
  const totalizar = (ws: import("exceljs").Worksheet, fila: number, cols: number) => {
    for (let i = 1; i <= cols; i++) {
      const c = ws.getCell(fila, i)
      c.font = { bold: true }
      c.border = { top: { style: "double" } }
    }
  }

  // ── 1. Resumen del mes ────────────────────────────────────────────────────
  {
    const ws = hoja("Resumen", "Resumen del mes", [30, 18, 18, 30])
    const r = d.resumen
    const filas: [string, number, string?][] = [
      ["Ventas brutas", r.ingresos, RD],
      ["Gastos del mes", r.gastos, RD],
      ["Margen antes de incentivos", r.utilidadNeta, RD],
      ["Incentivos a pagar", r.incentivos, RD],
      ["Margen después de incentivos", r.utilidadTrasIncentivos, RD],
      ["Rentabilidad", (Number(r.margenNeto) || 0) / 100, PCT],
      ["Clientes atendidos", r.pacientes],
      ["Ticket promedio", r.ticketPromedio, RD],
    ]
    let f = 4
    for (const [etq, val, fmt] of filas) {
      ws.getCell(f, 1).value = etq
      const c = ws.getCell(f, 2); c.value = val ?? 0
      if (fmt) c.numFmt = fmt
      if (etq.startsWith("Margen después")) { ws.getCell(f, 1).font = { bold: true }; c.font = { bold: true } }
      f++
    }
    f += 1
    ws.getCell(f, 1).value = "VENTAS POR SERVICIO"
    ws.getCell(f, 1).font = { bold: true, size: 12, color: { argb: AZUL } }
    f++
    cabecera(ws, f, ["Servicio", "Monto", "% del mes"]); f++
    const totalV = Object.values(d.ventas.porServicio).reduce((a, b) => a + (b || 0), 0)
    for (const [k, v] of Object.entries(d.ventas.porServicio).sort((a, b) => (b[1] || 0) - (a[1] || 0))) {
      if (!v) continue
      ws.getCell(f, 1).value = ETIQUETA_SERVICIO[k] || k
      const m = ws.getCell(f, 2); m.value = v; m.numFmt = RD
      const p = ws.getCell(f, 3); p.value = totalV ? v / totalV : 0; p.numFmt = PCT
      f++
    }
    ws.getCell(f, 1).value = "TOTAL"
    const tv = ws.getCell(f, 2); tv.value = totalV; tv.numFmt = RD
    totalizar(ws, f, 3)
  }

  // ── 2. Liquidación ────────────────────────────────────────────────────────
  {
    const ws = hoja("Liquidación", "Quién cobra cuánto", [18, 15, 9, 14, 14, 8, 14, 12, 15, 60])
    cabecera(ws, 4, ["Persona", "Sucursal", "Unidades", "Producto", "Servicios", "Pacientes", "Láser", "Limpieza", "NETO A PAGAR", "Detalle de servicios"])
    let f = 5
    for (const p of d.liquidacion) {
      ws.getCell(f, 1).value = p.persona
      ws.getCell(f, 2).value = p.sucursal
      ws.getCell(f, 3).value = p.unidades
      for (const [col, val] of [[4, p.producto], [5, p.servicios], [7, p.laser], [8, -p.limpieza], [9, p.neto]] as [number, number][]) {
        const c = ws.getCell(f, col); c.value = val; c.numFmt = RD
      }
      ws.getCell(f, 6).value = p.pacientes
      ws.getCell(f, 9).font = { bold: true }
      ws.getCell(f, 10).value = p.detalleServicios
      ws.getCell(f, 10).alignment = { wrapText: true }
      f++
    }
    ws.getCell(f, 1).value = "TOTAL"
    const suma = (k: keyof (typeof d.liquidacion)[number]) => d.liquidacion.reduce((s, x) => s + (Number(x[k]) || 0), 0)
    ws.getCell(f, 3).value = suma("unidades")
    for (const [col, val] of [[4, suma("producto")], [5, suma("servicios")], [7, suma("laser")], [8, -suma("limpieza")], [9, suma("neto")]] as [number, number][]) {
      const c = ws.getCell(f, col); c.value = val; c.numFmt = RD
    }
    ws.getCell(f, 6).value = suma("pacientes")
    totalizar(ws, f, 9)
  }

  // ── 3. Gastos ─────────────────────────────────────────────────────────────
  {
    const ws = hoja("Gastos", "Gastos del mes", [12, 15, 46, 20, 16, 16])
    let f = 4
    ws.getCell(f, 1).value = "POR CATEGORÍA"
    ws.getCell(f, 1).font = { bold: true, size: 12, color: { argb: AZUL } }
    f++
    cabecera(ws, f, ["Categoría", "", "", "", "", "Monto"]); f++
    for (const [k, v] of Object.entries(d.gastos.porCategoria).sort((a, b) => b[1] - a[1])) {
      ws.getCell(f, 1).value = k
      const c = ws.getCell(f, 6); c.value = v; c.numFmt = RD
      f++
    }
    f += 1
    ws.getCell(f, 1).value = "DETALLE"
    ws.getCell(f, 1).font = { bold: true, size: 12, color: { argb: AZUL } }
    f++
    cabecera(ws, f, ["Fecha", "Sucursal", "Concepto", "Categoría", "Cuenta", "Monto"]); f++
    const ini = f
    for (const g of d.gastos.detalle) {
      ws.getCell(f, 1).value = g.fecha
      ws.getCell(f, 2).value = g.sucursal
      ws.getCell(f, 3).value = g.concepto
      ws.getCell(f, 4).value = g.categoria
      ws.getCell(f, 5).value = g.cuenta
      const c = ws.getCell(f, 6); c.value = g.monto; c.numFmt = RD
      f++
    }
    ws.getCell(f, 1).value = "TOTAL"
    const t = ws.getCell(f, 6)
    t.value = { formula: `SUM(F${ini}:F${f - 1})` }
    t.numFmt = RD
    totalizar(ws, f, 6)
    ws.autoFilter = { from: { row: ini - 1, column: 1 }, to: { row: ini - 1, column: 6 } }
  }

  // ── 4. Rentabilidad por sucursal ──────────────────────────────────────────
  {
    const ws = hoja("Rentabilidad", "Rentabilidad por sucursal", [20, 18, 18, 18, 14])
    cabecera(ws, 4, ["Sucursal", "Ventas", "Gastos", "Margen", "Rentab."])
    let f = 5
    for (const r of d.rentabilidad) {
      ws.getCell(f, 1).value = r.branch
      for (const [col, val] of [[2, r.ingresos], [3, r.gastos], [4, r.utilidadNeta]] as [number, number][]) {
        const c = ws.getCell(f, col); c.value = val; c.numFmt = RD
      }
      const p = ws.getCell(f, 5); p.value = (Number(r.margenNeto) || 0) / 100; p.numFmt = PCT
      f++
    }
  }

  // ── 5. Cómo va el año ─────────────────────────────────────────────────────
  {
    const ws = hoja("Histórico", "Ventas por año", [12, 20, 16, 14])
    cabecera(ws, 4, ["Año", "Ventas", "Crecimiento", ""])
    let f = 5
    for (const h of d.historicoAnual) {
      ws.getCell(f, 1).value = h.year
      const v = ws.getCell(f, 2); v.value = h.ventas; v.numFmt = RD
      if (h.crecimientoPct != null) { const c = ws.getCell(f, 3); c.value = h.crecimientoPct / 100; c.numFmt = PCT }
      if (h.parcial) {
        ws.getCell(f, 4).value = "año en curso"
        for (let i = 1; i <= 4; i++) ws.getCell(f, i).font = { italic: true, color: { argb: "FF808080" } }
      }
      f++
    }
  }

  return wb
}

/** Nombre del archivo, uno solo para navegador y scripts. */
export function nombreReporte(d: ReporteMensual): string {
  return `Reporte ${d.negocio.name} ${MESES[d.periodo.month]} ${d.periodo.year}.xlsx`
}

export async function exportReporteMensual(d: ReporteMensual) {
  const wb = await buildReporteMensual(d)
  const buf = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }))
  const a = document.createElement("a")
  a.href = url
  a.download = nombreReporte(d)
  a.click()
  URL.revokeObjectURL(url)
}

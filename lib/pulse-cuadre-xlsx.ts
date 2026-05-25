/**
 * Exporter del Cuadre Semanal a Excel (3 hojas).
 *   1. Resumen — KPIs del cuadre.
 *   2. Detalle por equipo — una fila por equipo+cabina.
 *   3. Sesiones importadas — todas las sesiones AgendaPro de la semana.
 *
 * Usa `loadXLSX` (wrapper dinámico de XLSX) — mismo helper que ya consume
 * el importador.
 */

import { loadXLSX } from "@/lib/load-xlsx"
import type { CuadreSnapshot } from "@/lib/pulse-cuadre-pdf"
import type { SesionCliente } from "@/lib/types"

export interface ExportCuadreOptions {
  snapshot: CuadreSnapshot
  sesiones: SesionCliente[]   // sesiones de la semana ya filtradas
  filename?: string
}

type XLSXModule = {
  utils: {
    aoa_to_sheet: (data: unknown[][]) => unknown
    book_new: () => unknown
    book_append_sheet: (wb: unknown, ws: unknown, name: string) => void
  }
  writeFile: (wb: unknown, filename: string) => void
}

export async function exportCuadreXlsx({ snapshot, sesiones, filename }: ExportCuadreOptions): Promise<void> {
  const XLSX = (await loadXLSX()) as XLSXModule

  // Hoja 1 — Resumen
  const totLaser = snapshot.equipos.reduce((s, r) => s + r.disparosLaser, 0)
  const totOperador = snapshot.equipos.reduce((s, r) => s + r.disparosOperador, 0)
  const okN = snapshot.equipos.filter((r) => r.alerta === "OK").length
  const warnN = snapshot.equipos.filter((r) => r.alerta === "Advertencia").length
  const critN = snapshot.equipos.filter((r) => r.alerta === "Critico").length

  const resumen: unknown[][] = [
    ["Cuadre semanal de disparos láser — Cibao Spa Láser"],
    [],
    ["Semana", `${snapshot.semanaInicio} → ${snapshot.semanaFin}`],
    ["Sucursal", snapshot.sucursalFiltro],
    ["Generado", snapshot.generadoEn],
    snapshot.generadoPor ? ["Generado por", snapshot.generadoPor] : ["Generado por", ""],
    [],
    ["Métrica", "Valor"],
    ["Equipos revisados", snapshot.equipos.length],
    ["Disparos láser (real)", totLaser],
    ["Disparos operador (reportado)", totOperador],
    ["Diferencia total", totOperador - totLaser],
    ["Equipos OK", okN],
    ["Equipos en advertencia", warnN],
    ["Equipos críticos", critN],
    [],
    ["Archivos AgendaPro", snapshot.archivos.length],
    ["Fotos cargadas", snapshot.fotosCount],
  ]
  const wsResumen = XLSX.utils.aoa_to_sheet(resumen)

  // Hoja 2 — Detalle por equipo
  const detalle: unknown[][] = [[
    "Equipo", "Sucursal", "Cabina",
    "Lectura inicial", "Lectura final",
    "Disp. láser", "Disp. operador",
    "Diferencia", "Porcentaje %", "Estado",
    "Observaciones",
  ]]
  for (const r of snapshot.equipos) {
    detalle.push([
      r.equipoId, r.sucursal, r.cabina,
      r.lecturaInicial, r.lecturaFinal,
      r.disparosLaser, r.disparosOperador,
      r.diferencia, r.porcentaje, r.alerta,
      r.observaciones || "",
    ])
  }
  const wsDetalle = XLSX.utils.aoa_to_sheet(detalle)

  // Hoja 3 — Sesiones importadas
  const sesionesData: unknown[][] = [[
    "Fecha", "Sucursal", "Cabina", "Equipo", "Operadora",
    "Cliente", "Contacto", "Tratamiento", "Potencia", "Spot",
    "Disparos", "Archivo origen", "Fila origen", "Import hash",
  ]]
  for (const s of sesiones) {
    sesionesData.push([
      s.Fecha, s.Sucursal, s.Cabina, s.EquipoID, s.OperadoraID,
      s.Cliente, s.ContactoCliente || "", s.Tratamiento || s.AreaTrabajada, s.Potencia || "", s.Spot || "",
      Number(s.DisparosReportados) || 0,
      s.ArchivoOrigen || "", s.FilaOrigen || "", s.ImportHash || "",
    ])
  }
  const wsSesiones = XLSX.utils.aoa_to_sheet(sesionesData)

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen")
  XLSX.utils.book_append_sheet(wb, wsDetalle, "Detalle por equipo")
  XLSX.utils.book_append_sheet(wb, wsSesiones, "Sesiones importadas")

  const safe = (snapshot.sucursalFiltro || "todas").toLowerCase().replace(/[^a-z0-9]+/g, "-")
  const defaultName = `cuadre-semanal-${snapshot.semanaInicio}_${snapshot.semanaFin}-${safe}.xlsx`
  XLSX.writeFile(wb, filename || defaultName)
}

"use client"

/**
 * Parser del Excel "Dashboard Mantenimiento" producido por el sistema de
 * cuadre semanal de CSL (hoja "Equipos").
 *
 * Columnas esperadas (flexibles):
 *   Equipo | Serial | Sucursal | Cabina | Operadora | Pulsos | Estado | Fallas
 *
 * Solo client-side (usa loadXLSX → SheetJS desde CDN).
 */

import { loadXLSX, type XLSXModule } from "@/lib/load-xlsx"

export interface MantenimientoEquipoRow {
  equipoId: string
  equipoRaw: string
  serie?: string
  sucursal?: string
  cabina?: string
  operadora?: string
  pulsos: number
  estadoExcel?: string
  fallasRaw?: string
  fallas: string[]
}

export interface PeriodoDetectado {
  inicio: string
  fin: string
  etiqueta: string
}

export interface MantenimientoDashboardParseResult {
  rows: MantenimientoEquipoRow[]
  skipped: number
  columnsDetected: string[]
  warnings: string[]
  sheetUsed: string
  periodoDetectado?: PeriodoDetectado
}

function norm(h: unknown): string {
  return String(h ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

const M = {
  equipo:    /^(equipo|eq\.?|no\.?\s*equipo|equipo id|equipo_id)$/,
  serie:     /^(serial|serie|no\.?\s*serie|n\/?s|serie del equipo)$/,
  sucursal:  /^(sucursal|local|centro|sede|ubicacion)$/,
  cabina:    /^(cabina|cab\.?|cabina\s*\/?\s*operadora)$/,
  operadora: /^(operadora|operador|tecnico|responsable)$/,
  pulsos:    /^(pulsos|pulsos cabeza|p\.?\s*cabeza|lectura final|lecturafinal|pulsos acumulados|pulsos acum\.?)$/,
  estado:    /^(estado|condicion|semaforo)$/,
  fallas:    /^(fallas|fallas recientes|codigos|codigos falla|error codes|errores|cod\.?\s*falla)$/,
}

function findCol(headers: string[], key: keyof typeof M): number {
  const pat = M[key]
  for (let i = 0; i < headers.length; i++) {
    if (pat.test(norm(headers[i]))) return i
  }
  return -1
}

function normalizeEquipoId(raw: string): string {
  const s = raw.trim()
  const m = s.match(/^(?:equipo|eq\.?|no\.?\s*equipo|equipo_?id)[_\s\-]*(\S+)/i)
  return m ? m[1].trim() : s
}

function parsePulsos(raw: string): number {
  return Number(raw.replace(/[^0-9]/g, "")) || 0
}

function parseFallas(raw: string): string[] {
  if (!raw.trim()) return []
  return raw.split(",").map(s => s.trim()).filter(Boolean)
}

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

export function detectPeriodoFromFilename(filename: string): PeriodoDetectado | undefined {
  const lower = filename.toLowerCase()
  const m = lower.match(/_(\d{1,2})_(\d{1,2})_([a-z]+)_(\d{4})/)
  if (!m) return undefined
  const [, d1, d2, mesStr, yearStr] = m
  const mes = MESES[mesStr]
  if (!mes) return undefined
  const año = Number(yearStr)
  const inicio = `${año}-${pad2(mes)}-${pad2(Number(d1))}`
  const fin    = `${año}-${pad2(mes)}-${pad2(Number(d2))}`
  const mesCapitalized = mesStr.charAt(0).toUpperCase() + mesStr.slice(1)
  return { inicio, fin, etiqueta: `${d1}-${d2} ${mesCapitalized} ${año}` }
}

export async function parseMantenimientoDashboardExcel(
  file: File
): Promise<MantenimientoDashboardParseResult> {
  const xlsx = (await loadXLSX()) as XLSXModule & {
    read: (data: ArrayBuffer, opts: object) => { SheetNames: string[]; Sheets: Record<string, unknown> }
    utils: { sheet_to_json: (sheet: unknown, opts: object) => unknown[][] }
  }

  const buffer = await file.arrayBuffer()
  const wb = xlsx.read(buffer, { type: "array", cellDates: false })

  const sheetName =
    wb.SheetNames.find(n => n.trim().toLowerCase() === "equipos") ?? wb.SheetNames[0]
  const sheet = wb.Sheets[sheetName]
  const rawRows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false }) as string[][]

  if (rawRows.length < 2) {
    return { rows: [], skipped: 0, columnsDetected: [], warnings: ["Archivo vacío o sin datos."], sheetUsed: sheetName }
  }

  const headers = rawRows[0].map(h => String(h ?? "").trim())
  const columnsDetected = headers.filter(Boolean)
  const warnings: string[] = []

  const idx = {
    equipo:    findCol(headers, "equipo"),
    serie:     findCol(headers, "serie"),
    sucursal:  findCol(headers, "sucursal"),
    cabina:    findCol(headers, "cabina"),
    operadora: findCol(headers, "operadora"),
    pulsos:    findCol(headers, "pulsos"),
    estado:    findCol(headers, "estado"),
    fallas:    findCol(headers, "fallas"),
  }

  if (idx.equipo < 0) warnings.push("Columna 'Equipo' no detectada — equipo_id no se puede mapear.")
  if (idx.pulsos < 0) warnings.push("Columna 'Pulsos' no detectada — pulsos de cabeza no se actualizarán.")

  const get = (row: string[], i: number) => i >= 0 ? String(row[i] ?? "").trim() : ""

  const rows: MantenimientoEquipoRow[] = []
  let skipped = 0

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i]
    if (!row || row.every(cell => !String(cell ?? "").trim())) { skipped++; continue }
    const equipoRaw = get(row, idx.equipo)
    if (!equipoRaw) { skipped++; continue }
    const fallasRaw = get(row, idx.fallas)
    rows.push({
      equipoId:    normalizeEquipoId(equipoRaw),
      equipoRaw,
      serie:       get(row, idx.serie) || undefined,
      sucursal:    get(row, idx.sucursal) || undefined,
      cabina:      get(row, idx.cabina) || undefined,
      operadora:   get(row, idx.operadora) || undefined,
      pulsos:      parsePulsos(get(row, idx.pulsos)),
      estadoExcel: get(row, idx.estado) || undefined,
      fallasRaw:   fallasRaw || undefined,
      fallas:      parseFallas(fallasRaw),
    })
  }

  return { rows, skipped, columnsDetected, warnings, sheetUsed: sheetName, periodoDetectado: detectPeriodoFromFilename(file.name) }
}

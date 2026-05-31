/**
 * Parser para el Excel "Dashboard de Equipos" del módulo PulseControl.
 *
 * Espera una hoja llamada "Equipos" con columnas:
 *   equipo / equipo_id, serial, sucursal, cabina, operadora, pulsos, estado, fallas
 *
 * El período se detecta automáticamente del nombre del archivo:
 *   formato esperado: DD_DD_Mes_YYYY  ej: "25_30_Mayo_2026.xlsx"
 */

const MESES: Record<string, string> = {
  enero: "01", febrero: "02", marzo: "03", abril: "04",
  mayo: "05", junio: "06", julio: "07", agosto: "08",
  septiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
}

export interface ParsedEquipoDashboard {
  equipo_id: string
  serial?: string
  sucursal: string
  cabina?: string
  operadora?: string
  pulsos: number
  estado?: string
  fallas?: string
  row_num: number
}

export interface EquiposDashboardResult {
  period_start: string
  period_end: string
  period_label: string
  rows: ParsedEquipoDashboard[]
  warnings: string[]
  period_detected_from: 'filename' | 'manual'
}

/**
 * Intenta detectar el período semanal del nombre del archivo.
 * Formato esperado: DD_DD_Mes_YYYY  (ej: "25_30_Mayo_2026" o "25_30_mayo_2026")
 */
export function detectPeriodFromFilename(filename: string): { start: string; end: string; label: string } | null {
  const m = filename.match(/(\d{1,2})_(\d{1,2})_([A-Za-záéíóúÁÉÍÓÚñÑ]+)_(\d{4})/i)
  if (!m) return null
  const [, d1, d2, mesRaw, year] = m
  const mes = MESES[mesRaw.toLowerCase()]
  if (!mes) return null
  const start = `${year}-${mes}-${d1.padStart(2, "0")}`
  const end = `${year}-${mes}-${d2.padStart(2, "0")}`
  return { start, end, label: `${d1}/${mes}/${year} al ${d2}/${mes}/${year}` }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseEquiposDashboard(XLSX: any, workbook: any, filename: string): EquiposDashboardResult {
  const warnings: string[] = []
  const sheetName: string | undefined = workbook.SheetNames.find((n: string) => n.toLowerCase() === "equipos")
  if (!sheetName) {
    warnings.push("No se encontró hoja 'Equipos'")
    return { period_start: "", period_end: "", period_label: "", rows: [], warnings, period_detected_from: 'manual' }
  }

  const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" }) as Record<string, unknown>[]
  const rows = rawRows.map(r =>
    Object.entries(r).reduce<Record<string, unknown>>((acc, [k, v]) => {
      acc[k.trim().toLowerCase()] = v
      return acc
    }, {})
  )

  const period = detectPeriodFromFilename(filename)
  const period_start = period?.start ?? ""
  const period_end = period?.end ?? ""
  const period_label = period?.label ?? ""
  const period_detected_from: 'filename' | 'manual' = period ? 'filename' : 'manual'
  if (!period) warnings.push("Período no detectado del nombre del archivo. Formato esperado: DD_DD_Mes_YYYY")

  const parsed: ParsedEquipoDashboard[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const equipo_id = String(r["equipo"] ?? r["equipo_id"] ?? r["equipoid"] ?? "").trim()
    if (!equipo_id) continue
    const pulsosRaw = r["pulsos"] ?? r["pulsos_cabeza"] ?? r["p_cabeza"] ?? ""
    const pulsos = Number(String(pulsosRaw).replace(/[^\d.-]/g, "")) || 0
    parsed.push({
      equipo_id,
      serial: String(r["serial"] ?? "").trim() || undefined,
      sucursal: String(r["sucursal"] ?? "").trim(),
      cabina: String(r["cabina"] ?? r["cab"] ?? "").trim() || undefined,
      operadora: String(r["operadora"] ?? r["operador"] ?? "").trim() || undefined,
      pulsos,
      estado: String(r["estado"] ?? "").trim() || undefined,
      fallas: String(r["fallas"] ?? "").trim() || undefined,
      row_num: i + 2,
    })
  }

  return { period_start, period_end, period_label, rows: parsed, warnings, period_detected_from }
}

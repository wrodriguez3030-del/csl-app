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
 *
 * El mes del nombre corresponde al FINAL de la semana. Cuando la semana cruza
 * de mes (día inicial > día final, ej. "29_04_Julio_2026" = 29 jun → 04 jul),
 * el día inicial pertenece al mes ANTERIOR (y a diciembre del año anterior si
 * el fin es enero). Sin esto, la semana quedaba invertida (start > end) y
 * ningún disparo de operadora matcheaba el período → DISP OPERADOR = 0.
 */
export function detectPeriodFromFilename(filename: string): { start: string; end: string; label: string } | null {
  const m = filename.match(/(\d{1,2})_(\d{1,2})_([A-Za-záéíóúÁÉÍÓÚñÑ]+)_(\d{4})/i)
  if (!m) return null
  const [, d1, d2, mesRaw, year] = m
  const mes = MESES[mesRaw.toLowerCase()]
  if (!mes) return null
  const p2 = (n: number) => String(n).padStart(2, "0")
  const endYear = Number(year)
  const endMonth = Number(mes)
  let startYear = endYear
  let startMonth = endMonth
  if (Number(d1) > Number(d2)) {
    startMonth = endMonth === 1 ? 12 : endMonth - 1
    if (endMonth === 1) startYear = endYear - 1
  }
  const start = `${startYear}-${p2(startMonth)}-${d1.padStart(2, "0")}`
  const end = `${endYear}-${p2(endMonth)}-${d2.padStart(2, "0")}`
  // Guardia: jamás devolver un período invertido — mejor pedir el rango manual.
  if (start > end) return null
  return {
    start,
    end,
    label: `${d1.padStart(2, "0")}/${p2(startMonth)}/${startYear} al ${d2.padStart(2, "0")}/${p2(endMonth)}/${endYear}`,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseEquiposDashboard(XLSX: any, workbook: any, filename: string): EquiposDashboardResult {
  const warnings: string[] = []
  // Hoja por nombre ("Equipos" o "Lecturas"); si no, la primera hoja cuyo header
  // (filas 1-10) tenga "Equipo" en la columna A (export con la hoja renombrada).
  let sheetName: string | undefined = workbook.SheetNames.find(
    (n: string) => { const l = n.trim().toLowerCase(); return l === "equipos" || l === "lecturas" },
  )
  if (!sheetName) {
    for (const n of workbook.SheetNames as string[]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = XLSX.utils.sheet_to_json(workbook.Sheets[n], { header: 1, defval: "" }) as any[][]
      const hit = m.slice(0, 10).some((row) => ["equipo", "equipo_id", "equipoid"].includes(String((row || [])[0] ?? "").trim().toLowerCase()))
      if (hit) { sheetName = n; break }
    }
  }
  if (!sheetName) {
    warnings.push("No se encontró hoja 'Equipos'/'Lecturas' (ni una hoja con 'Equipo' en la columna A)")
    return { period_start: "", period_end: "", period_label: "", rows: [], warnings, period_detected_from: 'manual' }
  }

  // Detectar fila de headers buscando "Equipo" en columna A.
  // Cibao: headers en fila 1.
  // Depicenter: título en fila 1, instrucciones en fila 2, fila 3 vacía,
  // headers en fila 4. Sin esta búsqueda dinámica, el parser tomaba el
  // título como header y nada se reconocía.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" }) as any[][]
  let headerRowIdx = -1
  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    const row = matrix[i] || []
    const first = String(row[0] ?? "").trim().toLowerCase()
    if (first === "equipo" || first === "equipo_id" || first === "equipoid") {
      headerRowIdx = i
      break
    }
  }
  if (headerRowIdx < 0) {
    warnings.push("No se encontró la fila de encabezados (esperaba 'Equipo' en columna A entre filas 1-10)")
    return { period_start: "", period_end: "", period_label: "", rows: [], warnings, period_detected_from: 'manual' }
  }

  const headers = (matrix[headerRowIdx] || []).map((h: unknown) => String(h ?? "").trim().toLowerCase())
  const rows: Record<string, unknown>[] = []
  for (let i = headerRowIdx + 1; i < matrix.length; i++) {
    const rawRow = matrix[i] || []
    // Saltar filas completamente vacías
    if (rawRow.every((c: unknown) => c === "" || c === null || c === undefined)) continue
    const obj: Record<string, unknown> = {}
    for (let j = 0; j < headers.length; j++) {
      if (headers[j]) obj[headers[j]] = rawRow[j] ?? ""
    }
    rows.push(obj)
  }

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

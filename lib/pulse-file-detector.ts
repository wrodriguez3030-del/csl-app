/**
 * Detección automática del tipo y período de archivos PulseControl.
 *
 * Reconoce:
 *   - AgendaPro: hoja "Detalle Disparos tratamientos"
 *   - Lecturas/Equipos: hoja "Equipos" con columnas estándar
 *
 * Para AgendaPro extrae el período desde la fila 1 (rango de fechas del
 * reporte). Para Equipos el período viene del nombre del archivo.
 */

export type DetectedFileType = "agendapro" | "equipos" | "unknown"

type WorkbookLike = {
  SheetNames: string[]
  Sheets: Record<string, unknown>
}

type XlsxUtilsLike = {
  utils: { sheet_to_json: (ws: unknown, opts: { header: 1; defval: string }) => unknown[][] }
}

/**
 * Detecta el tipo de archivo por las hojas que contiene.
 *
 * Lecturas/Equipos: hoja llamada "Equipos" o "Lecturas". Si el nombre de la hoja
 * es otro, se detecta por COLUMNAS (un header con "Equipo" + "Pulsos") — así un
 * export con la hoja renombrada ("Lecturas", "Reporte", etc.) igual se reconoce.
 */
export function detectPulseFileType(wb: WorkbookLike, xlsx?: XlsxUtilsLike): DetectedFileType {
  const sheets = wb.SheetNames.map((s) => s.trim().toLowerCase())
  if (sheets.some((s) => s.includes("detalle") && s.includes("disparos"))) return "agendapro"
  if (sheets.some((s) => s === "equipos" || s === "lecturas")) return "equipos"
  // Fallback por columnas: cualquier hoja cuyo encabezado tenga "equipo" + "pulsos".
  if (xlsx) {
    for (const name of wb.SheetNames) {
      const m = xlsx.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" })
      for (let i = 0; i < Math.min(m.length, 10); i++) {
        const hdr = (m[i] as unknown[] | undefined || []).map((h) => String(h ?? "").trim().toLowerCase())
        if (hdr.includes("equipo") && hdr.includes("pulsos")) return "equipos"
      }
    }
  }
  return "unknown"
}

/**
 * Parsea el período del rango de fechas de AgendaPro.
 *
 * Acepta formatos:
 *   "Fecha: 2026-05-19 - 2026-05-24"
 *   "2026-05-19 - 2026-05-24"
 *   "19/05/2026 - 24/05/2026"
 *   "Del 19/05/2026 al 24/05/2026"
 */
export function parseAgendaProDateRange(
  raw: string,
): { start: string; end: string; label: string } | null {
  if (!raw) return null
  const text = String(raw).trim()
  // ISO yyyy-mm-dd
  const iso = text.match(/(\d{4}-\d{2}-\d{2})\s*[-–—a]+\s*(\d{4}-\d{2}-\d{2})/i)
  if (iso) return buildPeriod(iso[1], iso[2])
  // dd/mm/yyyy o dd-mm-yyyy
  const dmy = text.match(
    /(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s*[-–—a]+\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})/i,
  )
  if (dmy) {
    const s = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`
    const e = `${dmy[6]}-${dmy[5].padStart(2, "0")}-${dmy[4].padStart(2, "0")}`
    return buildPeriod(s, e)
  }
  return null
}

/**
 * Extrae el rango de fechas del archivo AgendaPro: prioriza fila 1, si no,
 * intenta sacar la fecha máxima del nombre (ReporteDisparos-2026-05-24.xlsx).
 */
export function extractAgendaProPeriod(
  wb: WorkbookLike,
  xlsx: XlsxUtilsLike,
  filename: string,
): { start: string; end: string; label: string } | null {
  const target = wb.SheetNames.find(
    (n) => n.toLowerCase().includes("detalle") && n.toLowerCase().includes("disparos"),
  )
  if (target) {
    const ws = wb.Sheets[target]
    const raw = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" })
    // Buscar en las primeras 5 filas algún rango de fechas
    for (let i = 0; i < Math.min(5, raw.length); i++) {
      const row = raw[i] as unknown[]
      for (const cell of row) {
        const period = parseAgendaProDateRange(String(cell || ""))
        if (period) return period
      }
    }
  }
  // Fallback: extraer fecha del nombre "ReporteDisparos-2026-05-24.xlsx"
  // Convención AgendaPro: la fecha del nombre es el FIN del rango (lunes a sábado).
  const fnameDate = filename.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (fnameDate) {
    const end = `${fnameDate[1]}-${fnameDate[2]}-${fnameDate[3]}`
    // Inferir inicio: 5 días antes (lunes si el fin es sábado)
    const endDate = new Date(end + "T12:00:00")
    const startDate = new Date(endDate)
    startDate.setDate(startDate.getDate() - 5)
    const start = startDate.toISOString().slice(0, 10)
    return buildPeriod(start, end)
  }
  return null
}

function buildPeriod(start: string, end: string): { start: string; end: string; label: string } {
  return { start, end, label: formatPeriodLabel(start, end) }
}

function formatPeriodLabel(start: string, end: string): string {
  return `${formatDate(start)} — ${formatDate(end)}`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso + "T12:00:00").toLocaleDateString("es-DO", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    })
  } catch {
    return iso
  }
}

/**
 * Detector del tipo de Excel que el usuario sube al wizard del Cuadre
 * Semanal. Distingue tres formatos válidos + uno fallback:
 *
 *   - "agendapro"   → reporte "Detalle Disparos tratamientos" (Paso 2)
 *   - "lecturas"    → reporte de pulsos por equipo (Paso 3)
 *   - "base_equipos"→ listado maestro de equipos/operadoras (otro módulo)
 *   - "desconocido" → no encaja en ningún formato
 *
 * El objetivo es bloquear uploads en el slot equivocado con un mensaje
 * humano antes de que cualquier parser falle con error técnico.
 *
 * No dependencia de React/store — usado por components/pulsos-cuadre-semanal-page.tsx.
 */

export type ExcelType = "agendapro" | "lecturas" | "base_equipos" | "desconocido"

export interface ExcelTypeDetection {
  type: ExcelType
  /** Hoja donde se detectó el formato (si aplica). */
  sheet: string | null
  /** Razón humana — útil para mostrar al usuario en un toast/banner. */
  reason: string
  /** Sugerencia de dónde subir el archivo cuando type !== expected. */
  suggestion?: string
}

type WorkbookLike = {
  SheetNames: string[]
  Sheets: Record<string, unknown>
}
type XlsxUtilsLike = {
  utils: { sheet_to_json: (ws: unknown, opts: { header: 1; defval: string }) => unknown[][] }
}

function findHeaderRow(raw: unknown[][], keywords: string[][]): { rowIdx: number; row: unknown[] } | null {
  // Escanea las primeras 12 filas. Acepta cualquier fila que contenga AL
  // MENOS UNA palabra de CADA grupo de keywords (AND entre grupos, OR
  // dentro de cada grupo).
  const max = Math.min(raw.length, 12)
  for (let i = 0; i < max; i += 1) {
    const row = raw[i] as unknown[]
    if (!row || row.length < 2) continue
    const cellsLower = row.map((c) => String(c ?? "").toLowerCase())
    const allGroupsMatch = keywords.every((group) =>
      group.some((kw) => cellsLower.some((c) => c.includes(kw))),
    )
    if (allGroupsMatch) return { rowIdx: i, row }
  }
  return null
}

export function detectExcelType(wb: WorkbookLike, xlsx: XlsxUtilsLike): ExcelTypeDetection {
  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    return { type: "desconocido", sheet: null, reason: "El archivo no contiene hojas legibles." }
  }

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    if (!ws) continue
    const raw = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" })
    const nameLow = sheetName.toLowerCase()

    // ── Detección por nombre de hoja ──────────────────────────────────────
    const agendaproPorNombre = nameLow.includes("detalle") && nameLow.includes("disparos")
    const baseEquiposPorNombre = nameLow.includes("equipos") && nameLow.includes("operadoras")

    // ── Detección por headers ─────────────────────────────────────────────
    const headerAgendaPro = findHeaderRow(raw, [
      ["secuencial", "fecha"],            // tiene fecha O secuencial
      ["disparos"],                       // tiene la columna disparos
      ["tratamiento", "operador"],        // y tratamiento u operador
    ])
    const headerBaseEquipos = findHeaderRow(raw, [
      ["sucursal"],
      ["equipo"],
      ["serial", "operadora", "cabina"],  // tiene al menos uno de estos
    ])
    const headerLecturas = findHeaderRow(raw, [
      ["sucursal", "equipo"],
      ["pulsos", "lectura", "lecturas"],  // columna con keyword de lectura
    ])

    // ── Decisión por hoja: el más específico gana ─────────────────────────
    // AgendaPro tiene "disparos" y "fecha" — el más distintivo.
    if (agendaproPorNombre && headerAgendaPro) {
      return { type: "agendapro", sheet: sheetName, reason: "Detectado reporte AgendaPro." }
    }
    if (headerAgendaPro && !headerBaseEquipos) {
      // Headers de AgendaPro presentes pero el nombre de hoja es genérico.
      return { type: "agendapro", sheet: sheetName, reason: "Encabezados de AgendaPro detectados." }
    }
    if (baseEquiposPorNombre && headerBaseEquipos) {
      const hasDisparos = (headerBaseEquipos.row as unknown[]).some((c) =>
        String(c ?? "").toLowerCase().includes("disparos"),
      )
      if (!hasDisparos) {
        return {
          type: "base_equipos",
          sheet: sheetName,
          reason: "Detectado listado maestro de equipos/operadoras.",
          suggestion: "Este archivo es una base de equipos. No se procesa como AgendaPro ni como Lecturas — actualmente se importa fuera del wizard de Cuadre Semanal.",
        }
      }
    }
    if (headerBaseEquipos && !headerAgendaPro && !headerLecturas) {
      // Sucursal+Equipo+Serial pero sin Pulsos ni Disparos = base.
      return {
        type: "base_equipos",
        sheet: sheetName,
        reason: "Detectado listado maestro de equipos (Sucursal · Cabina · Operadora · Equipo · Serial).",
        suggestion: "Este archivo es una base de equipos. Súbelo en el módulo de Equipos (próximamente disponible como importador masivo).",
      }
    }
    if (headerLecturas && !headerAgendaPro) {
      return {
        type: "lecturas",
        sheet: sheetName,
        reason: "Detectado reporte de pulsos/lecturas por equipo.",
      }
    }
  }

  return {
    type: "desconocido",
    sheet: null,
    reason: "El archivo no tiene la estructura esperada (no se detectaron columnas de AgendaPro, lecturas, ni base de equipos).",
  }
}

/**
 * Parser del Excel de "Lecturas/Pulsos por equipo" — reemplaza el flujo de
 * fotos+OCR del wizard "Cuadre semanal".
 *
 * Estructura esperada del Excel (1 hoja):
 *   Fila 1: encabezados — Sucursal | Cabina | Operador | Equipo | Serial | Pulsos <semana>
 *   Fila 2+: datos
 *
 * El header de la columna de lectura cambia con la semana ("Pulsos 18–23 Mayo",
 * "Pulsos 25–30 Mayo", "Lectura final", etc.) — la detectamos por palabras
 * clave: "pulsos", "lectura", "final".
 *
 * Helper agnóstico de React/store — usado por components/pulsos-cuadre-semanal-page.tsx.
 */

import { toUpperField } from "@/lib/normalize-fields"

// ─── Tipos públicos ──────────────────────────────────────────────────────────

export interface ParsedLecturaRow {
  filaOrigen: number              // número de fila en el Excel (1-indexed)
  sucursal: string                // normalizada (Los Jardines / Rafael Vidal / Villa Olga / raw)
  sucursalRaw: string             // texto original del Excel — útil para warnings
  cabina: string                  // "" cuando viene "-" o vacío
  operador: string                // "" cuando viene "-" o vacío
  equipo: string                  // siempre string normalizado (sin .0)
  serial: string                  // "" si no viene
  lecturaFinal: number            // número de pulsos
  /** Lo que venía en la celda de pulsos sin tocar — útil para mostrar. */
  lecturaRaw: string
  status: "valid" | "warning" | "error"
  /** Mensaje legible cuando status !== "valid". */
  message?: string
}

export interface ParseLecturasResult {
  sheet: string                   // nombre de la hoja procesada
  headerRow: number               // 1-indexed
  /** Nombre exacto del header de la columna de lectura detectada. */
  lecturaColumnName: string
  rows: ParsedLecturaRow[]
  warnings: string[]
}

// ─── Helpers internos ────────────────────────────────────────────────────────

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim()
}

/** Normaliza el nombre de sucursal del Excel de lecturas al nombre que el
 *  sistema CSL ya usa (debe coincidir con normalizeSucursalFromAgendaPro
 *  para que la comparación cuadre por equipo + sucursal). */
export function normalizeSucursalFromLecturas(value: unknown): { normalized: string; raw: string; recognized: boolean } {
  const raw = normalizeText(value)
  if (!raw) return { normalized: "", raw, recognized: false }
  const lower = raw.toLowerCase()
  if (lower.includes("jardines")) return { normalized: "Los Jardines", raw, recognized: true }
  if (lower === "r vidal" || lower.includes("rafael") || lower.includes("vidal") || lower.includes("mediterr")) {
    return { normalized: "Rafael Vidal", raw, recognized: true }
  }
  if (lower.includes("villa") && lower.includes("olga")) return { normalized: "Villa Olga", raw, recognized: true }
  if (lower.includes("la vega")) return { normalized: "La Vega", raw, recognized: true }
  // No reconocido — devolvemos el texto limpio para que el usuario decida.
  return { normalized: raw, raw, recognized: false }
}

/** Acepta "1", 1, "1.0", "-", "" y devuelve string limpio. Cabina con "-" o
 *  vacío queda como "" (UI lo muestra como guion). */
function normalizeCabina(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "number") return Number.isFinite(value) ? String(Math.round(value)) : ""
  const s = String(value).trim()
  if (!s || s === "-") return ""
  // "1.0" → "1"
  const asNum = Number(s)
  if (Number.isFinite(asNum) && Math.abs(asNum - Math.round(asNum)) < 1e-9) return String(Math.round(asNum))
  return s
}

/** Equipo se acepta como número o string; siempre devolvemos string sin ".0". */
function normalizeEquipo(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "number") return Number.isFinite(value) ? String(Math.round(value)) : ""
  const s = String(value).trim()
  if (!s) return ""
  const asNum = Number(s)
  if (Number.isFinite(asNum) && Math.abs(asNum - Math.round(asNum)) < 1e-9) return String(Math.round(asNum))
  return s
}

function normalizeOperador(value: unknown): string {
  const s = normalizeText(value)
  return s === "-" ? "" : s
}

function parseLecturaNumber(value: unknown): { value: number; error?: string } {
  if (value === null || value === undefined || value === "") return { value: NaN, error: "Lectura final vacía" }
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0
      ? { value: Math.round(value) }
      : { value: NaN, error: "Lectura final inválida" }
  }
  const s = String(value).trim()
  if (!s) return { value: NaN, error: "Lectura final vacía" }
  // Aceptamos "3,665,497" o "3665497" o "3665497.0".
  const cleaned = s.replace(/[,\s]/g, "").replace(/\.0+$/, "")
  const n = parseInt(cleaned, 10)
  if (!Number.isFinite(n) || n <= 0) return { value: NaN, error: `Lectura final inválida: "${s}"` }
  return { value: n }
}

// ─── Detección de columnas ───────────────────────────────────────────────────

interface ColumnMap {
  sucursal: number
  cabina: number
  operador: number
  equipo: number
  serial: number
  lectura: number
  /** Nombre original del header de lectura — se devuelve al caller. */
  lecturaHeader: string
}

const HEADER_ALIASES: Record<keyof Omit<ColumnMap, "lecturaHeader">, string[]> = {
  sucursal: ["sucursal", "tienda", "local"],
  cabina: ["cabina", "cuarto", "sala"],
  operador: ["operador", "operadora", "tecnico", "técnico"],
  equipo: ["equipo", "equipo id", "equipoid", "id equipo"],
  serial: ["serial", "n/s", "numero de serie", "número de serie"],
  // La columna de lectura cambia de nombre según la semana — usamos keywords.
  lectura: ["pulsos", "lectura", "final", "contador", "total pulses", "total treatment pulses"],
}

function detectColumnMap(headerRow: unknown[]): ColumnMap | null {
  const headersLower = headerRow.map((h) => String(h ?? "").trim().toLowerCase())
  const find = (aliases: string[]): number => {
    // Primero exact-match; luego sub-string match.
    for (let i = 0; i < headersLower.length; i += 1) {
      if (aliases.some((a) => headersLower[i] === a)) return i
    }
    for (let i = 0; i < headersLower.length; i += 1) {
      if (aliases.some((a) => headersLower[i].includes(a))) return i
    }
    return -1
  }
  const map: Partial<ColumnMap> = {
    sucursal: find(HEADER_ALIASES.sucursal),
    cabina: find(HEADER_ALIASES.cabina),
    operador: find(HEADER_ALIASES.operador),
    equipo: find(HEADER_ALIASES.equipo),
    serial: find(HEADER_ALIASES.serial),
    lectura: find(HEADER_ALIASES.lectura),
  }
  // Mínimo viable: sucursal, equipo, lectura. El resto son opcionales.
  if (map.sucursal === -1 || map.equipo === -1 || map.lectura === -1) return null
  map.lecturaHeader = String(headerRow[map.lectura as number] ?? "").trim()
  return map as ColumnMap
}

// ─── Parser principal ────────────────────────────────────────────────────────

type WorkbookLike = {
  SheetNames: string[]
  Sheets: Record<string, unknown>
}
type XlsxUtilsLike = {
  utils: { sheet_to_json: (ws: unknown, opts: { header: 1; defval: string }) => unknown[][] }
}

export function parseLecturasWorkbook(wb: WorkbookLike, xlsx: XlsxUtilsLike): ParseLecturasResult {
  const warnings: string[] = []

  // 1) Elegir hoja: la primera que tenga estructura reconocible.
  let chosenSheet = ""
  let chosenHeaderIdx = -1
  let chosenColumnMap: ColumnMap | null = null
  let chosenRaw: unknown[][] = []
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    if (!ws) continue
    const raw = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" })
    // Buscamos el primer row que pueda ser header (hasta los primeros 10).
    const maxScan = Math.min(raw.length, 10)
    for (let i = 0; i < maxScan; i += 1) {
      const row = raw[i] as unknown[]
      if (!row || row.length < 3) continue
      const map = detectColumnMap(row)
      if (map) {
        chosenSheet = sheetName
        chosenHeaderIdx = i
        chosenColumnMap = map
        chosenRaw = raw
        break
      }
    }
    if (chosenColumnMap) break
  }

  if (!chosenColumnMap) {
    throw new Error("El archivo de lecturas no tiene las columnas requeridas: Sucursal, Equipo y Pulsos/Lectura final.")
  }

  const map = chosenColumnMap
  const rows: ParsedLecturaRow[] = []

  for (let i = chosenHeaderIdx + 1; i < chosenRaw.length; i += 1) {
    const row = chosenRaw[i] as unknown[]
    if (!row || row.every((c) => c === "" || c === null || c === undefined)) continue

    const sucResult = normalizeSucursalFromLecturas(row[map.sucursal])
    const cabina = toUpperField(normalizeCabina(row[map.cabina]))
    const operador = toUpperField(map.operador !== -1 ? normalizeOperador(row[map.operador]) : "")
    const equipo = normalizeEquipo(row[map.equipo])
    const serial = map.serial !== -1 ? normalizeText(row[map.serial]) : ""
    const lecturaRawCell = row[map.lectura]
    const lecturaRaw = String(lecturaRawCell ?? "").trim()
    const lect = parseLecturaNumber(lecturaRawCell)

    // Validación
    const issues: string[] = []
    if (!equipo) issues.push("Falta equipo")
    if (!sucResult.normalized) issues.push("Falta sucursal")
    if (lect.error) issues.push(lect.error)

    let status: ParsedLecturaRow["status"] = "valid"
    if (issues.length) status = "error"
    else if (!sucResult.recognized && sucResult.raw) status = "warning"

    rows.push({
      filaOrigen: i + 1,
      sucursal: sucResult.normalized,
      sucursalRaw: sucResult.raw,
      cabina,
      operador,
      equipo,
      serial,
      lecturaFinal: Number.isFinite(lect.value) ? lect.value : 0,
      lecturaRaw,
      status,
      message: issues.length
        ? issues.join(" · ")
        : !sucResult.recognized && sucResult.raw
          ? `Sucursal no reconocida: "${sucResult.raw}"`
          : undefined,
    })
  }

  if (!rows.length) warnings.push("El archivo no contiene filas de datos tras el encabezado.")

  return {
    sheet: chosenSheet,
    headerRow: chosenHeaderIdx + 1,
    lecturaColumnName: map.lecturaHeader,
    rows,
    warnings,
  }
}

/**
 * Parser del Excel de "Base maestra de equipos / operadoras" — flujo de
 * importación masiva en el módulo Equipos.
 *
 * Estructura esperada del Excel:
 *   - Hoja: "Equipos Operadoras" (o cualquiera con headers reconocibles)
 *   - Header row con columnas: Sucursal | Cabina | Operadora | Equipo | Serial
 *   - Datos: una fila por equipo
 *
 * Sin fechas, sin disparos, sin pulsos — eso es lo que distingue este
 * formato de AgendaPro y de Lecturas.
 *
 * Helper agnóstico de UI/store.
 */

// ─── Tipos públicos ──────────────────────────────────────────────────────────

export interface ParsedEquipoBaseRow {
  filaOrigen: number
  sucursal: string                // normalizada
  sucursalRaw: string             // original del Excel
  cabina: string                  // "" cuando viene "-" o vacío
  operadora: string               // "" cuando viene "-" o vacío
  equipo: string                  // siempre string
  serial: string                  // "" si no viene
  status: "valid" | "warning" | "error"
  message?: string
}

export interface ParseEquiposBaseResult {
  sheet: string
  headerRow: number
  rows: ParsedEquipoBaseRow[]
  warnings: string[]
}

// ─── Helpers internos ────────────────────────────────────────────────────────

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim()
}

/** Normaliza el nombre de sucursal a los nombres que usa el sistema. */
export function normalizeSucursalFromBase(value: unknown): { normalized: string; raw: string; recognized: boolean } {
  const raw = normalizeText(value)
  if (!raw) return { normalized: "", raw, recognized: false }
  const lower = raw.toLowerCase()
  if (lower.includes("jardines")) return { normalized: "Los Jardines", raw, recognized: true }
  if (lower === "r vidal" || lower.includes("rafael") || lower.includes("vidal") || lower.includes("mediterr")) {
    return { normalized: "Rafael Vidal", raw, recognized: true }
  }
  if (lower.includes("villa") && lower.includes("olga")) return { normalized: "Villa Olga", raw, recognized: true }
  if (lower.includes("la vega")) return { normalized: "La Vega", raw, recognized: true }
  return { normalized: raw, raw, recognized: false }
}

function normalizeCabina(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "number") return Number.isFinite(value) ? `Cabina ${Math.round(value)}` : ""
  const s = String(value).trim()
  if (!s || s === "-") return ""
  // Si es solo un número (ej. "1"), conviértelo a "Cabina 1" para consistencia
  // con el dropdown del modal de edición.
  const asNum = Number(s)
  if (Number.isFinite(asNum) && Math.abs(asNum - Math.round(asNum)) < 1e-9) {
    return `Cabina ${Math.round(asNum)}`
  }
  // Si ya viene formateado ("Cabina 4", "Backup", "Taller"), respetamos.
  return s
}

function normalizeEquipo(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "number") return Number.isFinite(value) ? String(Math.round(value)) : ""
  const s = String(value).trim()
  if (!s) return ""
  const asNum = Number(s)
  if (Number.isFinite(asNum) && Math.abs(asNum - Math.round(asNum)) < 1e-9) return String(Math.round(asNum))
  return s
}

function normalizeOperadora(value: unknown): string {
  const s = normalizeText(value)
  return s === "-" ? "" : s
}

// ─── Detección de columnas ───────────────────────────────────────────────────

interface ColumnMap {
  sucursal: number
  cabina: number
  operadora: number
  equipo: number
  serial: number
}

const HEADER_ALIASES: Record<keyof ColumnMap, string[]> = {
  sucursal: ["sucursal", "tienda", "local"],
  cabina: ["cabina", "cuarto", "sala"],
  operadora: ["operadora", "operador", "tecnico", "técnico"],
  equipo: ["equipo", "id equipo", "equipoid", "no equipo"],
  serial: ["serial", "n/s", "serie", "numero de serie", "número de serie"],
}

function detectColumnMap(headerRow: unknown[]): ColumnMap | null {
  const headersLower = headerRow.map((h) => String(h ?? "").trim().toLowerCase())
  const find = (aliases: string[]): number => {
    for (let i = 0; i < headersLower.length; i += 1) {
      if (aliases.some((a) => headersLower[i] === a)) return i
    }
    for (let i = 0; i < headersLower.length; i += 1) {
      if (aliases.some((a) => headersLower[i].includes(a))) return i
    }
    return -1
  }
  const map = {
    sucursal: find(HEADER_ALIASES.sucursal),
    cabina: find(HEADER_ALIASES.cabina),
    operadora: find(HEADER_ALIASES.operadora),
    equipo: find(HEADER_ALIASES.equipo),
    serial: find(HEADER_ALIASES.serial),
  }
  // Mínimo viable: sucursal + equipo. El resto son opcionales.
  if (map.sucursal === -1 || map.equipo === -1) return null
  return map
}

// ─── Parser principal ────────────────────────────────────────────────────────

type WorkbookLike = {
  SheetNames: string[]
  Sheets: Record<string, unknown>
}
type XlsxUtilsLike = {
  utils: { sheet_to_json: (ws: unknown, opts: { header: 1; defval: string }) => unknown[][] }
}

export function parseEquiposBaseWorkbook(wb: WorkbookLike, xlsx: XlsxUtilsLike): ParseEquiposBaseResult {
  const warnings: string[] = []

  let chosenSheet = ""
  let chosenHeaderIdx = -1
  let chosenColumnMap: ColumnMap | null = null
  let chosenRaw: unknown[][] = []
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    if (!ws) continue
    const raw = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" })
    const maxScan = Math.min(raw.length, 12)
    for (let i = 0; i < maxScan; i += 1) {
      const row = raw[i] as unknown[]
      if (!row || row.length < 2) continue
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
    throw new Error("El archivo no tiene las columnas requeridas: Sucursal y Equipo (las opcionales son Cabina, Operadora, Serial).")
  }

  const map = chosenColumnMap
  const rows: ParsedEquipoBaseRow[] = []

  for (let i = chosenHeaderIdx + 1; i < chosenRaw.length; i += 1) {
    const row = chosenRaw[i] as unknown[]
    if (!row || row.every((c) => c === "" || c === null || c === undefined)) continue

    const sucResult = normalizeSucursalFromBase(row[map.sucursal])
    const cabina = map.cabina !== -1 ? normalizeCabina(row[map.cabina]) : ""
    const operadora = map.operadora !== -1 ? normalizeOperadora(row[map.operadora]) : ""
    const equipo = normalizeEquipo(row[map.equipo])
    const serial = map.serial !== -1 ? normalizeText(row[map.serial]) : ""

    const issues: string[] = []
    if (!equipo) issues.push("Falta equipo")
    if (!sucResult.normalized) issues.push("Falta sucursal")

    let status: ParsedEquipoBaseRow["status"] = "valid"
    if (issues.length) status = "error"
    else if (!sucResult.recognized && sucResult.raw) status = "warning"

    rows.push({
      filaOrigen: i + 1,
      sucursal: sucResult.normalized,
      sucursalRaw: sucResult.raw,
      cabina,
      operadora,
      equipo,
      serial,
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
    rows,
    warnings,
  }
}

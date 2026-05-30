/**
 * Parser de Excel de AgendaPro para "Disparos del operador".
 *
 * Estructura esperada del Excel (sheet "Detalle Disparos tratamientos"):
 *   - Fila 1: rango de fecha del reporte (string informativo)
 *   - Fila 4: encabezados — Secuencial | Cliente | Contacto | Tratamiento |
 *             Operador | Sucursal | Potencia | Spot | Disparos | Fecha
 *   - Fila 5+: datos
 *
 * Hace detección defensiva del encabezado buscando "Secuencial" en columna 0,
 * por si el reporte cambia un poco de filas en versiones futuras.
 *
 * El helper es agnóstico de UI — no toca React ni store. Lo usa
 * `components/pulsos-sesiones-page.tsx` para mostrar vista previa antes de
 * confirmar la importación.
 */

// ─── Helpers públicos ────────────────────────────────────────────────────────

/**
 * Parsea el valor de la columna "Disparos". Maneja:
 *   - Números: `126` → 126
 *   - Strings con un número: `"126"` → 126
 *   - Strings con comas que representan MÚLTIPLES disparos: `"120,150"` → 270
 *     (suma los componentes; NO se interpreta como "ciento veinte mil")
 *   - Vacíos/null: cuenta como inválido (la fila debe rechazarse)
 *   - Parte no numérica dentro de la lista (`"120,abc"`) → inválido
 *
 * Devuelve `{ value, error }` para que el caller decida si la fila es
 * válida. `value` es la suma cuando es válida, o NaN cuando hay error.
 */
export function parseDisparos(raw: unknown): { value: number; error?: string } {
  if (raw === null || raw === undefined) return { value: NaN, error: "Disparos vacío" }
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? { value: Math.round(raw) } : { value: NaN, error: "Disparos no es número" }
  }
  const str = String(raw).trim()
  if (!str) return { value: NaN, error: "Disparos vacío" }
  const parts = str.split(",").map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return { value: NaN, error: "Disparos vacío" }
  let total = 0
  for (const part of parts) {
    // Stripeamos solo dígitos para tolerar "120 disparos" o "120.0".
    // Si tras eso queda vacío o no es número, es error de fila.
    const cleaned = part.replace(/\.0+$/, "").replace(/[^\d-]/g, "")
    if (!cleaned) return { value: NaN, error: `"${part}" no es número` }
    const n = parseInt(cleaned, 10)
    if (!Number.isFinite(n)) return { value: NaN, error: `"${part}" no es número` }
    total += n
  }
  return { value: total }
}

/**
 * Normaliza el nombre de sucursal que viene de AgendaPro al nombre que el
 * resto del sistema usa.
 *
 * AgendaPro puede reportar sucursales con prefijo de negocio:
 *   "Cibao Spa Láser - Los Jardines"  → "Los Jardines"
 *   "Cibao Spa Láser - Rafael Vidal"  → "Rafael Vidal"
 *   "Depicenter - Los Jardines"       → "Los Jardines"
 *
 * También acepta formato sin prefijo: "Plaza Mediterránea" → "Rafael Vidal"
 * (nombre antiguo de AgendaPro para la sucursal Rafael Vidal).
 */
export function normalizeSucursalFromAgendaPro(value: unknown): string {
  const raw = String(value || "").trim()
  if (!raw) return ""
  // Strippear prefijo de negocio: "BusinessName - SucursalName" → "SucursalName"
  // El patrón captura todo hasta el primer guion rodeado de espacios.
  const stripped = raw.replace(/^.+\s+-\s+/i, "").trim() || raw
  const lower = stripped.toLowerCase()
  if (lower.includes("plaza") || lower.includes("mediterr")) return "Rafael Vidal"
  if (lower.includes("jardines")) return "Los Jardines"
  if (lower.includes("rafael") || lower.includes("vidal")) return "Rafael Vidal"
  if (lower.includes("villa olga")) return "Villa Olga"
  if (lower.includes("la vega")) return "La Vega"
  // Si no hay mapping específico, devolver el nombre ya sin prefijo de negocio.
  return stripped
}

/** Normaliza el nombre de operadora — solo trim + colapsa espacios. */
export function normalizeOperadora(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim()
}

/** Convierte la celda fecha (Date | número Excel | string) a ISO YYYY-MM-DD. */
function toIsoDate(raw: unknown): string {
  if (raw instanceof Date) return raw.toISOString().slice(0, 10)
  if (typeof raw === "number") {
    // Serial Excel: días desde 1900-01-00 (con bug de 1900 como bisiesto).
    return new Date((raw - 25569) * 86400000).toISOString().slice(0, 10)
  }
  const str = String(raw || "").trim()
  if (!str) return ""
  // Aceptamos ISO directo o con "T".
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  // dd/mm/yyyy o dd-mm-yyyy
  const dmy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`
  return str.slice(0, 10)
}

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface ParsedDisparoRow {
  /** Número de fila en el Excel (1-indexed), útil para mostrar errores. */
  filaOrigen: number
  fecha: string
  cliente: string
  contacto: string
  tratamiento: string
  operadora: string
  sucursal: string
  potencia: string
  spot: string
  /** Lo que venía en la celda I, sin tocar. Útil para mostrar en preview. */
  disparosRaw: string
  /** Resultado de parseDisparos. */
  disparos: number
  /** Hash determinístico para deduplicación. Vacío si la fila tiene error. */
  hash: string
  /** Estado de la fila:
   *   - "valid": entra al import.
   *   - "duplicate_file": misma fila aparece varias veces dentro del MISMO Excel.
   *   - "already_imported": ya existe en la DB (por import_hash o por igualdad
   *     de campos clave) — se omite silenciosamente, no es un error.
   *   - "error": fila inválida (falta fecha/operadora/sucursal/disparos);
   *     no se importa hasta corregir manualmente. */
  status: "valid" | "duplicate_file" | "already_imported" | "error"
  /** Mensaje legible cuando status !== "valid". */
  message?: string
}

export interface ParseAgendaProResult {
  sheet: string
  /** Información del header (1-indexed) y rango de fechas del reporte. */
  headerRow: number
  fileDateRange: string
  rows: ParsedDisparoRow[]
  warnings: string[]
}

// ─── Hash determinístico (SHA-256, browser-safe vía SubtleCrypto) ────────────

const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null

/** Hash determinístico de una fila — usado para detectar Excel duplicado. */
export async function computeRowHash(row: {
  fecha: string
  cliente: string
  contacto: string
  tratamiento: string
  operadora: string
  sucursal: string
  potencia: string
  spot: string
  disparos: number
}): Promise<string> {
  const payload = [
    row.fecha,
    row.cliente.trim().toLowerCase(),
    row.contacto.trim().toLowerCase(),
    row.tratamiento.trim().toLowerCase(),
    row.operadora.trim().toLowerCase(),
    row.sucursal.trim().toLowerCase(),
    row.potencia.trim(),
    row.spot.trim(),
    String(row.disparos),
  ].join("|")
  if (!encoder || typeof crypto === "undefined" || !crypto.subtle) {
    // Fallback no criptográfico para entornos sin SubtleCrypto (tests/SSR).
    let h = 0
    for (let i = 0; i < payload.length; i += 1) {
      h = (h * 31 + payload.charCodeAt(i)) | 0
    }
    return `h${(h >>> 0).toString(16)}`
  }
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(payload))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

// ─── Parser principal ────────────────────────────────────────────────────────

type WorkbookLike = {
  SheetNames: string[]
  Sheets: Record<string, unknown>
}
type XlsxUtilsLike = {
  utils: { sheet_to_json: (ws: unknown, opts: { header: 1; defval: string }) => unknown[][] }
}

/**
 * Parsea un workbook ya cargado (loadXLSX → XLSX.read). Devuelve filas con
 * status + diagnósticos. La dedupe contra sesiones existentes se hace en
 * el caller (necesita acceso al store).
 */
export async function parseAgendaProWorkbook(
  wb: WorkbookLike,
  xlsx: XlsxUtilsLike,
): Promise<ParseAgendaProResult> {
  const warnings: string[] = []
  // 1) Elegir hoja: preferimos "Detalle Disparos tratamientos"; si no, primera.
  const targetSheet = wb.SheetNames.find((name) =>
    name.toLowerCase().includes("detalle") && name.toLowerCase().includes("disparos"),
  ) || wb.SheetNames[0]
  if (!targetSheet) throw new Error("El archivo no contiene hojas legibles.")
  const ws = wb.Sheets[targetSheet]
  const raw = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" })

  // 2) Detectar headerRow buscando "Secuencial" en la columna 0.
  let headerRow = -1
  for (let i = 0; i < raw.length; i += 1) {
    const first = String((raw[i] as unknown[])[0] || "").toLowerCase()
    if (first.includes("secuencial")) { headerRow = i; break }
  }
  if (headerRow === -1) {
    throw new Error("No se detectó la fila de encabezados (esperaba 'Secuencial' en columna A).")
  }

  // 3) Fila 1 (índice 0) suele traer el rango de fecha del reporte.
  const fileDateRange = String((raw[0] as unknown[] | undefined)?.[0] || "").trim()

  // 4) Leer filas de datos. Columnas: A..J (índices 0..9):
  //    A=Secuencial B=Cliente C=Contacto D=Tratamiento E=Operador F=Sucursal
  //    G=Potencia H=Spot I=Disparos J=Fecha
  const rows: ParsedDisparoRow[] = []
  for (let i = headerRow + 1; i < raw.length; i += 1) {
    const row = raw[i] as unknown[]
    const seqRaw = String(row[0] ?? "").trim()
    if (!seqRaw) continue
    // Saltamos filas de subtotales / vacías que no tienen secuencial numérico.
    if (Number.isNaN(parseInt(seqRaw.replace(/,/g, ""), 10))) continue

    const cliente = String(row[1] ?? "").trim()
    const contacto = String(row[2] ?? "").trim()
    const tratamiento = String(row[3] ?? "").trim()
    const operadora = normalizeOperadora(row[4])
    const sucursal = normalizeSucursalFromAgendaPro(row[5])
    const potencia = String(row[6] ?? "").trim()
    const spot = String(row[7] ?? "").trim()
    const disparosRaw = String(row[8] ?? "").trim()
    const fecha = toIsoDate(row[9])

    const disp = parseDisparos(row[8])

    // Validación: fecha + operadora + sucursal + disparos > 0.
    const issues: string[] = []
    if (!fecha) issues.push("falta fecha")
    if (!operadora || operadora.toLowerCase() === "sistema") issues.push("operadora inválida")
    if (!sucursal) issues.push("falta sucursal")
    if (disp.error) issues.push(disp.error)
    else if (disp.value <= 0) issues.push("disparos = 0")

    const status: ParsedDisparoRow["status"] = issues.length ? "error" : "valid"
    const baseRow: Omit<ParsedDisparoRow, "hash"> = {
      filaOrigen: i + 1,
      fecha,
      cliente,
      contacto,
      tratamiento,
      operadora,
      sucursal,
      potencia,
      spot,
      disparosRaw,
      disparos: Number.isFinite(disp.value) ? disp.value : 0,
      status,
      message: issues.length ? issues.join(" · ") : undefined,
    }
    const hash = status === "valid"
      ? await computeRowHash({
        fecha: baseRow.fecha,
        cliente: baseRow.cliente,
        contacto: baseRow.contacto,
        tratamiento: baseRow.tratamiento,
        operadora: baseRow.operadora,
        sucursal: baseRow.sucursal,
        potencia: baseRow.potencia,
        spot: baseRow.spot,
        disparos: baseRow.disparos,
      })
      : ""
    rows.push({ ...baseRow, hash })
  }

  if (!rows.length) warnings.push("El archivo no contiene filas de datos válidas tras el encabezado.")
  return {
    sheet: targetSheet,
    headerRow: headerRow + 1,
    fileDateRange,
    rows,
    warnings,
  }
}

// ─── Dedupe contra sesiones existentes ───────────────────────────────────────

export interface ExistingSesionForDedupe {
  Fecha?: string
  Cliente?: string
  OperadoraID?: string
  Sucursal?: string
  DisparosReportados?: number
  /** Campos ricos persistidos desde migración 009_pulse_import_richer.sql. */
  ContactoCliente?: string
  Tratamiento?: string
  Potencia?: string
  Spot?: string
  /** Cuando está disponible, dedupe es exacto (mismo hash = mismo registro). */
  ImportHash?: string
}

/** Clave expandida para dedupe: incluye TODOS los campos de identidad de una
 *  sesión real. Un mismo cliente puede tener múltiples tratamientos el mismo
 *  día — la clave reducida (sin tratamiento/contacto) los colapsaba en uno
 *  solo y marcaba los reales como duplicados falsos. */
function expandedKey(parts: {
  fecha: string; cliente: string; contacto: string; tratamiento: string
  operadora: string; sucursal: string; potencia: string; spot: string
  disparos: number
}): string {
  return [
    parts.fecha,
    parts.cliente.trim().toLowerCase(),
    parts.contacto.trim().toLowerCase(),
    parts.tratamiento.trim().toLowerCase(),
    parts.operadora.trim().toLowerCase(),
    parts.sucursal.trim().toLowerCase(),
    parts.potencia.trim(),
    parts.spot.trim(),
    String(parts.disparos),
  ].join("|")
}

/**
 * Marca filas con su status final de dedupe:
 *   - "already_imported": ya existe en DB (match por ImportHash o por clave
 *     expandida — la primera es exacta, la segunda cubre sesiones cargadas
 *     antes de la migración 009 cuando aún no se guardaba ImportHash).
 *   - "duplicate_file": la fila se repite dentro del MISMO Excel.
 *   - "valid": entra al import.
 *   - "error": se mantiene (no se toca).
 *
 * El backend tiene como segundo filtro el UNIQUE parcial sobre import_hash
 * (csl_sesiones_cliente_import_hash_uidx) — saveSesion devuelve duplicate:true
 * cuando la DB rechaza, pero este helper le evita ese round-trip a la mayoría
 * de filas y permite al usuario ver el detalle antes de confirmar.
 */
export function markDuplicatesAgainstExisting(
  rows: ParsedDisparoRow[],
  existentes: ExistingSesionForDedupe[],
): ParsedDisparoRow[] {
  // Indexamos las existentes por DOS llaves:
  //   - hashIndex: match exacto por ImportHash (sesiones importadas con el
  //     nuevo parser ya lo tienen).
  //   - keyIndex: clave expandida — cubre sesiones legacy sin ImportHash, o
  //     sesiones manualmente registradas. Las que sí tienen ImportHash entran
  //     a las DOS para que `markDuplicatesAgainstExisting` sea idempotente.
  const hashIndex = new Set<string>()
  const keyIndex = new Set<string>()
  for (const s of existentes) {
    if (s.ImportHash && s.ImportHash.trim()) hashIndex.add(s.ImportHash.trim())
    const key = expandedKey({
      fecha: String(s.Fecha || "").slice(0, 10),
      cliente: String(s.Cliente || ""),
      contacto: String(s.ContactoCliente || ""),
      tratamiento: String(s.Tratamiento || ""),
      operadora: String(s.OperadoraID || ""),
      sucursal: String(s.Sucursal || ""),
      potencia: String(s.Potencia || ""),
      spot: String(s.Spot || ""),
      disparos: Number(s.DisparosReportados || 0),
    })
    keyIndex.add(key)
  }
  // Dedupe contra el propio batch (Excel con filas repetidas).
  const seenInBatch = new Set<string>()
  return rows.map((r) => {
    if (r.status !== "valid") return r
    const key = expandedKey({
      fecha: r.fecha, cliente: r.cliente, contacto: r.contacto,
      tratamiento: r.tratamiento, operadora: r.operadora, sucursal: r.sucursal,
      potencia: r.potencia, spot: r.spot, disparos: r.disparos,
    })
    // 1) Match contra DB → already_imported.
    if ((r.hash && hashIndex.has(r.hash)) || keyIndex.has(key)) {
      return { ...r, status: "already_imported", message: "Ya importada previamente" }
    }
    // 2) Match contra batch actual → duplicate_file.
    if (seenInBatch.has(key)) {
      return { ...r, status: "duplicate_file", message: "Repetida dentro del mismo Excel" }
    }
    seenInBatch.add(key)
    return r
  })
}

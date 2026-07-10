/**
 * Parser de la hoja "Reservas" del export real (29 columnas) — PURO: recibe un
 * Workbook de ExcelJS ya cargado (cliente o script) y devuelve filas
 * normalizadas + resúmenes para preview/conciliación.
 *
 * Reglas (spec Importador §10-16):
 *  - El período de una atención sale de "Fecha de realización" (NO creación).
 *  - Estado normalizado: ASISTE cuenta como atención; NO_ASISTE/CANCELADO/
 *    CONFIRMADO/RESERVADO/EN_ESPERA no cuentan (regla inicial, configurable).
 *  - provider_original se conserva crudo; provider_normalized va en MAYÚSCULAS
 *    sin "(Desactivado)" — la vinculación a employee_id es un paso aparte.
 */
import { normalizeBranch, normalizeName, parseDateISO } from "./normalize"
import { computeRowHash, fnvHex } from "./hash"

export type AttendanceStatus =
  | "ASISTE" | "NO_ASISTE" | "CANCELADO" | "CONFIRMADO" | "RESERVADO" | "EN_ESPERA" | "OTRO"

/** Normaliza el Estado de la reserva. OJO: "No Asiste" antes que "Asiste". */
export function normalizeAttendance(v: unknown): AttendanceStatus {
  const n = normalizeName(v)
  if (!n) return "OTRO"
  if (n.includes("NO ASISTE")) return "NO_ASISTE"
  if (n.includes("ASISTE")) return "ASISTE"
  if (n.includes("CANCEL")) return "CANCELADO"
  if (n.includes("CONFIRM")) return "CONFIRMADO"
  if (n.includes("RESERV")) return "RESERVADO"
  if (n.includes("ESPERA")) return "EN_ESPERA"
  return "OTRO"
}

/** Limpia el nombre del prestador ("SAHOMY (Desactivado)" → "SAHOMY"). */
export function normalizeProviderName(v: unknown): string {
  return normalizeName(String(v ?? "").replace(/\((desactivado|prestador|recepcionista)[^)]*\)/gi, " "))
}

export interface ReservaRow {
  appointmentDate: string // ISO YYYY-MM-DD
  appointmentTime: string
  createdAt: string
  branchOriginal: string
  branch: string
  externalClientId: string
  firstName: string
  lastName: string
  email: string
  phone: string
  document: string
  serviceName: string
  listPrice: number
  realPrice: number
  sessionNumber: string
  totalSessions: string
  providerOriginal: string
  provider: string
  attendanceStatus: AttendanceStatus
  paymentStatus: string
  paymentDate: string
  externalPaymentId: string
  source: string
  assignedTo: string
  billingType: string
  rowHash: string
}

export interface ReservasParseResult {
  rows: ReservaRow[]
  totalRows: number
  byStatus: Record<string, number>
  byProvider: Record<string, { total: number; attended: number }>
  byBranch: Record<string, number>
  periods: string[] // "YYYY-MM" ordenados
  minDate: string
  maxDate: string
  missingProvider: number
  errors: string[]
}

/** Encabezados requeridos mínimos de la hoja Reservas. */
const REQUIRED_HEADERS = ["fecha de realizacion", "local", "servicio", "prestador", "estado"]

type CellVal = unknown
interface WorksheetLike {
  rowCount: number
  columnCount: number
  getRow: (r: number) => { getCell: (c: number) => { value: CellVal } }
}
interface WorkbookLike {
  getWorksheet: (name: string) => WorksheetLike | undefined
  worksheets: WorksheetLike[]
}

const flat = (v: CellVal): unknown => {
  if (v && typeof v === "object") {
    if (v instanceof Date) return v.toISOString()
    const o = v as Record<string, unknown>
    if (o.result !== undefined) return o.result
    if (o.text !== undefined) return o.text
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join("")
  }
  return v
}
const str = (v: CellVal): string => String(flat(v) ?? "").trim()

export function parseReservasWorkbook(wb: WorkbookLike): ReservasParseResult {
  const ws = wb.getWorksheet("Reservas") || wb.worksheets[0]
  const errors: string[] = []
  if (!ws) return { rows: [], totalRows: 0, byStatus: {}, byProvider: {}, byBranch: {}, periods: [], minDate: "", maxDate: "", missingProvider: 0, errors: ["El archivo no tiene hoja Reservas."] }

  // Índice de columnas por nombre de encabezado (tolerante a acentos/orden).
  const headerIdx: Record<string, number> = {}
  for (let c = 1; c <= ws.columnCount; c++) {
    const h = normalizeName(str(ws.getRow(1).getCell(c).value)).toLowerCase()
    if (h) headerIdx[h] = c
  }
  const col = (...names: string[]): number => {
    for (const n of names) { const i = headerIdx[n]; if (i) return i }
    return 0
  }
  for (const req of REQUIRED_HEADERS) {
    if (!col(req)) errors.push(`Falta la columna "${req}" en la hoja Reservas.`)
  }
  if (errors.length) return { rows: [], totalRows: 0, byStatus: {}, byProvider: {}, byBranch: {}, periods: [], minDate: "", maxDate: "", missingProvider: 0, errors }

  const C = {
    fechaReal: col("fecha de realizacion"),
    fechaCrea: col("fecha de creacion"),
    local: col("local"),
    nCliente: col("n° de cliente", "no de cliente", "n de cliente"),
    nombre: col("nombre"),
    apellido: col("apellido"),
    email: col("e-mail", "email"),
    telefono: col("telefono"),
    cedula: col("cedula"),
    servicio: col("servicio"),
    precioLista: col("precio lista"),
    precioReal: col("precio real"),
    nSesion: col("nº de sesion", "n° de sesion", "no de sesion"),
    sesionesTot: col("sesiones totales"),
    prestador: col("prestador"),
    estado: col("estado"),
    estadoPago: col("estado de pago"),
    fechaPago: col("fecha pago"),
    idPago: col("id pago"),
    origen: col("origen"),
    asignadoA: col("asignado a"),
    tipoFact: col("tipo de facturacion"),
  }

  const rows: ReservaRow[] = []
  const byStatus: Record<string, number> = {}
  const byProvider: Record<string, { total: number; attended: number }> = {}
  const byBranch: Record<string, number> = {}
  const monthSet = new Set<string>()
  const hashSeen = new Map<string, number>()
  let minDate = "", maxDate = "", missingProvider = 0

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const fechaRaw = str(row.getCell(C.fechaReal).value)
    const estadoRaw = str(row.getCell(C.estado).value)
    if (!fechaRaw && !estadoRaw) continue

    const appointmentDate = parseDateISO(fechaRaw)
    const timeMatch = fechaRaw.match(/(\d{1,2}:\d{2})/)
    const providerOriginal = str(row.getCell(C.prestador).value)
    const provider = normalizeProviderName(providerOriginal)
    const branchOriginal = str(row.getCell(C.local).value)
    const attendanceStatus = normalizeAttendance(estadoRaw)

    const base: Omit<ReservaRow, "rowHash"> = {
      appointmentDate,
      appointmentTime: timeMatch ? timeMatch[1] : "",
      createdAt: parseDateISO(str(row.getCell(C.fechaCrea).value)),
      branchOriginal,
      branch: normalizeBranch(branchOriginal),
      externalClientId: str(row.getCell(C.nCliente).value),
      firstName: str(row.getCell(C.nombre).value),
      lastName: str(row.getCell(C.apellido).value),
      email: str(row.getCell(C.email).value),
      phone: str(row.getCell(C.telefono).value),
      document: str(row.getCell(C.cedula).value),
      serviceName: str(row.getCell(C.servicio).value),
      listPrice: Number(flat(row.getCell(C.precioLista).value)) || 0,
      realPrice: Number(flat(row.getCell(C.precioReal).value)) || 0,
      sessionNumber: str(row.getCell(C.nSesion).value),
      totalSessions: str(row.getCell(C.sesionesTot).value),
      providerOriginal,
      provider,
      attendanceStatus,
      paymentStatus: str(row.getCell(C.estadoPago).value),
      paymentDate: parseDateISO(str(row.getCell(C.fechaPago).value)),
      externalPaymentId: str(row.getCell(C.idPago).value),
      source: str(row.getCell(C.origen).value),
      assignedTo: str(row.getCell(C.asignadoA).value),
      billingType: str(row.getCell(C.tipoFact).value),
    }

    // row_hash por campos estables (§23) + hora + desambiguación de ocurrencias.
    const baseHash = computeRowHash("", {
      date: `${appointmentDate} ${base.appointmentTime}`,
      branch: base.branch,
      provider,
      customer: base.externalClientId || `${base.firstName} ${base.lastName}`,
      itemName: base.serviceName,
      category: attendanceStatus,
      amount: base.realPrice,
      originalId: base.externalPaymentId,
    })
    const occ = (hashSeen.get(baseHash) || 0) + 1
    hashSeen.set(baseHash, occ)
    const rowHash = occ === 1 ? baseHash : fnvHex(`${baseHash}#${occ}`)

    rows.push({ ...base, rowHash })
    byStatus[attendanceStatus] = (byStatus[attendanceStatus] || 0) + 1
    byBranch[base.branch || "(sin sucursal)"] = (byBranch[base.branch || "(sin sucursal)"] || 0) + 1
    if (!provider || provider.includes("NO DISPONIBLE")) missingProvider++
    else {
      const p = byProvider[provider] || { total: 0, attended: 0 }
      p.total++
      if (attendanceStatus === "ASISTE") p.attended++
      byProvider[provider] = p
    }
    if (appointmentDate) {
      monthSet.add(appointmentDate.slice(0, 7))
      if (!minDate || appointmentDate < minDate) minDate = appointmentDate
      if (!maxDate || appointmentDate > maxDate) maxDate = appointmentDate
    }
  }

  return {
    rows,
    totalRows: rows.length,
    byStatus,
    byProvider,
    byBranch,
    periods: [...monthSet].sort(),
    minDate,
    maxDate,
    missingProvider,
    errors,
  }
}

/** Agrega atenciones por (mes × prestador × sucursal): métrica principal
 *  = atenciones realizadas (ASISTE); auxiliar = clientes únicos. */
export function aggregateAttendance(rows: ReservaRow[]): {
  periodMonth: number; periodYear: number; provider: string; branch: string
  attended: number; uniquePatients: number
}[] {
  const map = new Map<string, { periodMonth: number; periodYear: number; provider: string; branch: string; attended: number; uniq: Set<string> }>()
  for (const r of rows) {
    if (r.attendanceStatus !== "ASISTE" || !r.appointmentDate || !r.provider) continue
    if (r.provider.includes("NO DISPONIBLE")) continue
    const [y, m] = r.appointmentDate.split("-").map(Number)
    const key = `${y}-${m}|${r.provider}|${r.branch}`
    let e = map.get(key)
    if (!e) { e = { periodMonth: m, periodYear: y, provider: r.provider, branch: r.branch, attended: 0, uniq: new Set() }; map.set(key, e) }
    e.attended++
    const client = r.externalClientId || r.phone || `${r.firstName} ${r.lastName}`.trim()
    if (client) e.uniq.add(client)
  }
  return [...map.values()].map(({ uniq, ...rest }) => ({ ...rest, uniquePatients: uniq.size }))
}

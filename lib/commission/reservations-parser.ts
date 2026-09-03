/**
 * Parser de la hoja "Reservas" del export real — PURO: recibe un Workbook de
 * ExcelJS ya cargado (cliente o script) y devuelve filas normalizadas +
 * resúmenes para preview/conciliación.
 *
 * El juego de columnas VARÍA entre cuentas de AgendaPro (CSL exporta 29,
 * Depicenter 26): solo los 5 encabezados de REQUIRED_HEADERS son obligatorios;
 * el resto se lee con `cellOf`, que devuelve vacío si la columna no viene.
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
import { isDepilacionService } from "./classification"

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
interface RowLike {
  getCell: (c: number) => { value: CellVal }
}
interface WorksheetLike {
  rowCount: number
  columnCount: number
  getRow: (r: number) => RowLike
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

/**
 * Lee una celda por índice de columna, tolerando que la columna NO exista.
 *
 * `col()` devuelve 0 cuando el encabezado no está en el archivo, y solo se
 * validan los 5 encabezados OBLIGATORIOS: los opcionales pueden faltar
 * legítimamente porque AgendaPro no exporta el mismo juego de columnas en todas
 * las cuentas (CSL trae 29 columnas; Depicenter 26, sin "Asignado a" ni "Tipo de
 * facturación"). ExcelJS lanza "0 is out of bounds" si se le pide la columna 0,
 * así que ese caso se resuelve aquí: columna ausente → valor vacío.
 */
const cellOf = (row: RowLike, idx: number): CellVal => (idx > 0 ? row.getCell(idx).value : undefined)

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
    const fechaRaw = str(cellOf(row, C.fechaReal))
    const estadoRaw = str(cellOf(row, C.estado))
    if (!fechaRaw && !estadoRaw) continue

    const appointmentDate = parseDateISO(fechaRaw)
    const timeMatch = fechaRaw.match(/(\d{1,2}:\d{2})/)
    const providerOriginal = str(cellOf(row, C.prestador))
    const provider = normalizeProviderName(providerOriginal)
    const branchOriginal = str(cellOf(row, C.local))
    const attendanceStatus = normalizeAttendance(estadoRaw)

    const base: Omit<ReservaRow, "rowHash"> = {
      appointmentDate,
      appointmentTime: timeMatch ? timeMatch[1] : "",
      createdAt: parseDateISO(str(cellOf(row, C.fechaCrea))),
      branchOriginal,
      branch: normalizeBranch(branchOriginal),
      externalClientId: str(cellOf(row, C.nCliente)),
      firstName: str(cellOf(row, C.nombre)),
      lastName: str(cellOf(row, C.apellido)),
      email: str(cellOf(row, C.email)),
      phone: str(cellOf(row, C.telefono)),
      document: str(cellOf(row, C.cedula)),
      serviceName: str(cellOf(row, C.servicio)),
      listPrice: Number(flat(cellOf(row, C.precioLista))) || 0,
      realPrice: Number(flat(cellOf(row, C.precioReal))) || 0,
      sessionNumber: str(cellOf(row, C.nSesion)),
      totalSessions: str(cellOf(row, C.sesionesTot)),
      providerOriginal,
      provider,
      attendanceStatus,
      paymentStatus: str(cellOf(row, C.estadoPago)),
      paymentDate: parseDateISO(str(cellOf(row, C.fechaPago))),
      externalPaymentId: str(cellOf(row, C.idPago)),
      source: str(cellOf(row, C.origen)),
      assignedTo: str(cellOf(row, C.asignadoA)),
      billingType: str(cellOf(row, C.tipoFact)),
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
 *  = atenciones realizadas (ASISTE); auxiliar = clientes únicos.
 *
 *  `attendedDepilacion` cuenta SOLO las citas de depilación láser: es la que
 *  manda en el reparto del fondo láser. `attended` sigue siendo el total de
 *  atenciones (alimenta el KPI «Clientes atendidos»), así que quien hace
 *  tatuajes o faciales sigue apareciendo con su trabajo, pero ya no entra en
 *  un reparto de depilación que no le corresponde. */
export function aggregateAttendance(rows: ReservaRow[]): {
  periodMonth: number; periodYear: number; provider: string; branch: string
  attended: number; attendedDepilacion: number; uniquePatients: number
}[] {
  const map = new Map<string, { periodMonth: number; periodYear: number; provider: string; branch: string; attended: number; attendedDepilacion: number; uniq: Set<string> }>()
  for (const r of rows) {
    if (r.attendanceStatus !== "ASISTE" || !r.appointmentDate || !r.provider) continue
    if (r.provider.includes("NO DISPONIBLE")) continue
    const [y, m] = r.appointmentDate.split("-").map(Number)
    const key = `${y}-${m}|${r.provider}|${r.branch}`
    let e = map.get(key)
    if (!e) { e = { periodMonth: m, periodYear: y, provider: r.provider, branch: r.branch, attended: 0, attendedDepilacion: 0, uniq: new Set() }; map.set(key, e) }
    e.attended++
    if (isDepilacionService(r.serviceName)) e.attendedDepilacion++
    const client = r.externalClientId || r.phone || `${r.firstName} ${r.lastName}`.trim()
    if (client) e.uniq.add(client)
  }
  return [...map.values()].map(({ uniq, ...rest }) => ({ ...rest, uniquePatients: uniq.size }))
}

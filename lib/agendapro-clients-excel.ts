/**
 * Parser de Excel/CSV de clientes exportados desde AgendaPro.
 *
 * Detecta automáticamente las columnas por nombre (en español o inglés,
 * con o sin acentos). Devuelve un array en formato AgendaProClientRaw para
 * que sea compatible con syncAgendaProClients sin conversión adicional.
 *
 * Solo client-side (usa loadXLSX que carga SheetJS desde CDN).
 */

import { loadXLSX, type XLSXModule } from "@/lib/load-xlsx"
import type { AgendaProClientRaw } from "@/lib/server/agendapro"

export interface ExcelParseResult {
  /** Clientes en formato AgendaProClientRaw — listos para syncAgendaProClients. */
  clients: AgendaProClientRaw[]
  /** Filas vacías o sin datos mínimos omitidas. */
  skipped: number
  /** Nombres de columna detectados en el archivo. */
  columnsDetected: string[]
  /** Advertencias no fatales (columna de nombre no encontrada, etc.). */
  warnings: string[]
}

// ── Normalización de encabezados ──────────────────────────────────────────────

function norm(h: unknown): string {
  return String(h ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

// ── Matchers por columna ──────────────────────────────────────────────────────

const M = {
  id: /^(id|client id|cliente id|agenda ?pro id|agendapro id|codigo|num cliente)$/,
  nombre: /^(nombre|first ?name|nombre de pila|primer nombre)$/,
  apellido: /^(apellido|last ?name|apellidos|segundo nombre|surname)$/,
  nombreCompleto: /^(nombre completo|full ?name|name|cliente|client|contact|nombre y apellido)$/,
  telefono: /^(tel[e]?fono|phone|celular|movil|cel|tel|numero de tel|contact ?number|phone ?number)$/,
  telefono2: /^(tel[e]?fono 2|phone 2|second ?phone|segundo tel|telefono2|tel2|celular 2|otro tel)$/,
  email: /^(email|correo|e ?mail|correo electronico)$/,
  documento: /^(cedula|documento|dni|id number|n[u]?m[e]?ro doc|identidad|identification|document|rut|passport|cedula o doc)$/,
  direccion: /^(direcc?ion|address|domicilio|calle|dir)$/,
  ciudad: /^(ciudad|city|municipio|localidad|municipality)$/,
  sucursal: /^(sucursal|branch|sede|location|ubicacion|local|location ?name|sede|punto)$/,
  fechaNac: /^(fecha ?nac|birth ?date|fecha de nac|birthday|nacimiento|birth|fecha nacimiento)$/,
  genero: /^(genero|gender|sexo|sex)$/,
}

function findCol(headers: string[], key: keyof typeof M): number {
  const pat = M[key]
  for (let i = 0; i < headers.length; i++) {
    if (pat.test(norm(headers[i]))) return i
  }
  return -1
}

// ── Normalización de datos ────────────────────────────────────────────────────

function normalizePhone(raw: string): string {
  const d = raw.replace(/\D/g, "")
  if (!d) return ""
  // RD: 10 dígitos comenzando con 809/829/849 → agregar prefijo 1
  if (d.length === 10 && /^(809|829|849)/.test(d)) return `+1${d}`
  if (d.length === 11 && d.startsWith("1") && /^1(809|829|849)/.test(d)) return `+${d}`
  return d
}

function normalizeDoc(raw: string): string {
  return raw.replace(/[\s\-_.]/g, "")
}

function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ")
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

// ── Parser principal ──────────────────────────────────────────────────────────

export async function parseAgendaProClientsExcel(file: File): Promise<ExcelParseResult> {
  const xlsx = (await loadXLSX()) as XLSXModule & {
    read: (data: ArrayBuffer, opts: object) => { SheetNames: string[]; Sheets: Record<string, unknown> }
    utils: {
      sheet_to_json: (sheet: unknown, opts: object) => unknown[][]
    }
  }

  const buffer = await file.arrayBuffer()
  const wb = xlsx.read(buffer, { type: "array", cellDates: false })
  const sheetName = wb.SheetNames[0]
  const sheet = wb.Sheets[sheetName]
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false }) as string[][]

  if (rows.length < 2) {
    return { clients: [], skipped: 0, columnsDetected: [], warnings: ["El archivo está vacío o solo tiene encabezados."] }
  }

  const headers = rows[0].map(h => String(h ?? "").trim())
  const columnsDetected = headers.filter(Boolean)
  const warnings: string[] = []

  // Detectar posiciones
  const idx = {
    id: findCol(headers, "id"),
    nombre: findCol(headers, "nombre"),
    apellido: findCol(headers, "apellido"),
    nombreCompleto: findCol(headers, "nombreCompleto"),
    telefono: findCol(headers, "telefono"),
    telefono2: findCol(headers, "telefono2"),
    email: findCol(headers, "email"),
    documento: findCol(headers, "documento"),
    direccion: findCol(headers, "direccion"),
    ciudad: findCol(headers, "ciudad"),
    sucursal: findCol(headers, "sucursal"),
    fechaNac: findCol(headers, "fechaNac"),
    genero: findCol(headers, "genero"),
  }

  const hasName = idx.nombre >= 0 || idx.apellido >= 0 || idx.nombreCompleto >= 0
  if (!hasName) warnings.push("No se detectó columna de nombre — se usará la primera columna como nombre si existe.")
  if (idx.telefono < 0) warnings.push("No se detectó columna de teléfono.")

  const get = (row: string[], colIdx: number) =>
    colIdx >= 0 ? String(row[colIdx] ?? "").trim() : ""

  const clients: AgendaProClientRaw[] = []
  let skipped = 0

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.every(cell => !String(cell ?? "").trim())) { skipped++; continue }

    let nombre = get(row, idx.nombre)
    let apellido = get(row, idx.apellido)

    // Fallback: nombre completo en una sola columna
    if (!nombre && !apellido && idx.nombreCompleto >= 0) {
      const full = get(row, idx.nombreCompleto)
      const parts = full.split(/\s+/)
      nombre = parts[0] || ""
      apellido = parts.slice(1).join(" ")
    }

    // Último fallback: primera columna si no hay nombre
    if (!nombre && !apellido && !hasName) {
      const first = String(row[0] ?? "").trim()
      const parts = first.split(/\s+/)
      nombre = parts[0] || ""
      apellido = parts.slice(1).join(" ")
    }

    const telefono = normalizePhone(get(row, idx.telefono))
    const telefono2Raw = get(row, idx.telefono2)
    const telefono2 = telefono2Raw && telefono2Raw !== telefono ? normalizePhone(telefono2Raw) : ""
    const email = normalizeEmail(get(row, idx.email))
    const documento = normalizeDoc(get(row, idx.documento))

    // Skip si no hay datos mínimos
    if (!nombre && !apellido && !telefono && !documento && !email) { skipped++; continue }

    const raw: AgendaProClientRaw = {
      id: get(row, idx.id) || undefined,
      first_name: normalizeName(nombre),
      last_name: normalizeName(apellido),
      phone: telefono || undefined,
      second_phone: telefono2 || undefined,
      email: email || undefined,
      identification_number: documento || undefined,
      address: get(row, idx.direccion) || undefined,
      city: get(row, idx.ciudad) || undefined,
      location_name: get(row, idx.sucursal) || undefined,
      birth_date: get(row, idx.fechaNac) || undefined,
      gender: get(row, idx.genero) || undefined,
    }

    clients.push(raw)
  }

  return { clients, skipped, columnsDetected, warnings }
}

/**
 * Núcleo PURO del procesador de pagos de AgendaPro — SIN acceso a base de datos.
 *
 * Aquí vive toda la lógica determinística y testeable en aislamiento:
 *   - validación del payload
 *   - extracción de servicios (bookings / mock_bookings / memberships / products / giftcards)
 *   - extracción de transacciones de pago y recibos
 *   - normalización de nombres de servicio y derivación de claves de cliente
 *   - identificador de servicio para idempotencia
 *   - enmascarado de PII para logs
 *   - conversión de fecha a zona horaria de República Dominicana
 *
 * La orquestación con DB (idempotencia real, upserts, tenant) vive en
 * `agendapro-payments.ts`, que consume estas funciones a través de un
 * repositorio inyectable — así los 25 casos de prueba corren sin tocar prod.
 */

import { digitsOnly } from "@/lib/formatters"

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del payload real (ver §6 del brief). Todos opcionales/laxos: el payload
// externo no es de confianza y puede variar de forma.
// ─────────────────────────────────────────────────────────────────────────────
export interface AgendaProClientPayload {
  id?: number | string
  first_name?: string
  last_name?: string
  email?: string
  identification_number?: string
  phone?: string
  second_phone?: string
  age?: number
  birth_day?: number
  birth_month?: number
  birth_year?: number
  record_number?: string
  address?: string
  district?: string
  city?: string
}

export interface AgendaProMockBooking {
  price?: number
  discount?: number
  payment_id?: number
  service?: string
  provider?: string | null
  receipt_id?: number
}

export interface AgendaProPaymentTransaction {
  number?: string
  amount?: number
  installments?: number
  payment_method?: string
  payment_method_type?: string
  bank?: string
}

export interface AgendaProReceipt {
  id?: number
  amount?: number
  date?: string
  number?: string
  receipt_type?: string
}

export interface AgendaProPaymentPayload {
  id?: number
  payment_date?: string
  location_id?: number
  location_name?: string
  amount?: number
  paid_amount?: number
  change_amount?: number
  client?: AgendaProClientPayload
  bookings?: unknown[]
  products?: unknown[]
  mock_bookings?: AgendaProMockBooking[]
  memberships?: unknown[]
  giftcards?: unknown[]
  down_payments?: { payment_transactions?: AgendaProPaymentTransaction[] }[]
  receipts?: AgendaProReceipt[]
}

/** Un servicio comprado, ya extraído y unificado desde cualquiera de las fuentes. */
export interface ServiceItem {
  rawName: string
  normalizedName: string
  price: number
  discount: number
  receiptId: number | null
  provider: string | null
  source: "bookings" | "mock_bookings" | "memberships" | "products" | "giftcards"
  index: number
}

export type PaymentStatus =
  | "processed"
  | "already_processed"
  | "requires_mapping"
  | "invalid"
  | "error"

// ─────────────────────────────────────────────────────────────────────────────
// Normalización
// ─────────────────────────────────────────────────────────────────────────────

/** Normaliza un nombre de servicio para matching tolerante:
 *  minúsculas, sin acentos, espacios colapsados, trim. */
export function normalizeServiceName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** Nombre en MAYÚSCULAS respetando acentos (§11): "Adalissa " → "ADALISSA". */
export function toUpperName(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
}

/**
 * Claves de teléfono para dedup determinístico (§11). Devuelve las variantes
 * de dígitos a probar contra `cli_tel_<digits>`:
 *   - dígitos completos
 *   - últimos 10 dígitos (RD sin código país)
 *   - con/sin el "1" de código de país
 */
export function phoneDigitVariants(phone: unknown): string[] {
  const d = digitsOnly(phone)
  if (!d) return []
  const set = new Set<string>()
  set.add(d)
  if (d.length > 10) set.add(d.slice(-10))
  if (d.length === 10) set.add("1" + d)
  if (d.length === 11 && d.startsWith("1")) set.add(d.slice(1))
  return [...set]
}

// ─────────────────────────────────────────────────────────────────────────────
// Enmascarado de PII para logs (§23)
// ─────────────────────────────────────────────────────────────────────────────

export function maskEmail(value: unknown): string {
  const s = String(value ?? "").trim()
  const at = s.indexOf("@")
  if (at <= 0) return s ? "***" : ""
  const user = s.slice(0, at)
  const domain = s.slice(at)
  const first = user[0] ?? ""
  const last = user.length > 1 ? user[user.length - 1] : ""
  return `${first}${"*".repeat(Math.max(1, user.length - 2))}${last}${domain}`
}

export function maskPhone(value: unknown): string {
  const d = digitsOnly(value)
  if (!d) return ""
  return "*".repeat(Math.max(0, d.length - 4)) + d.slice(-4)
}

export function maskCedula(value: unknown): string {
  const d = digitsOnly(value)
  if (!d) return ""
  if (d.length <= 5) return "*".repeat(d.length)
  return d.slice(0, 3) + "*".repeat(d.length - 5) + d.slice(-2)
}

// ─────────────────────────────────────────────────────────────────────────────
// Validación del payload (§7)
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean
  paymentId: number | null
  error?: string
}

export function validatePayload(payload: unknown): ValidationResult {
  if (!payload || typeof payload !== "object") {
    return { ok: false, paymentId: null, error: "Payload no es un objeto JSON" }
  }
  const p = payload as AgendaProPaymentPayload
  const paymentId = typeof p.id === "number" ? p.id : Number(p.id)
  if (!paymentId || !Number.isFinite(paymentId)) {
    return { ok: false, paymentId: null, error: "Falta payment.id" }
  }
  if (!p.client || typeof p.client !== "object" || (!p.client.id && !p.client.first_name && !p.client.email)) {
    return { ok: false, paymentId, error: "Falta client en el payload" }
  }
  return { ok: true, paymentId }
}

// ─────────────────────────────────────────────────────────────────────────────
// Extracción de servicios comprados (§12) — combina TODAS las fuentes válidas
// ─────────────────────────────────────────────────────────────────────────────

function pickServiceName(obj: Record<string, unknown>): string {
  return String(
    obj.service ?? obj.service_name ?? obj.name ?? obj.title ?? obj.product ?? obj.description ?? "",
  ).trim()
}

export function extractServiceItems(payload: AgendaProPaymentPayload): ServiceItem[] {
  const items: ServiceItem[] = []
  let idx = 0

  const push = (
    source: ServiceItem["source"],
    obj: Record<string, unknown>,
  ) => {
    const rawName = pickServiceName(obj)
    if (!rawName) return
    items.push({
      rawName,
      normalizedName: normalizeServiceName(rawName),
      price: Number(obj.price ?? obj.amount ?? 0) || 0,
      discount: Number(obj.discount ?? 0) || 0,
      receiptId:
        obj.receipt_id != null && Number.isFinite(Number(obj.receipt_id))
          ? Number(obj.receipt_id)
          : null,
      provider: obj.provider != null ? String(obj.provider) : null,
      source,
      index: idx++,
    })
  }

  for (const b of payload.bookings ?? []) if (b && typeof b === "object") push("bookings", b as Record<string, unknown>)
  for (const b of payload.mock_bookings ?? []) if (b && typeof b === "object") push("mock_bookings", b as Record<string, unknown>)
  for (const m of payload.memberships ?? []) if (m && typeof m === "object") push("memberships", m as Record<string, unknown>)
  for (const p of payload.products ?? []) if (p && typeof p === "object") push("products", p as Record<string, unknown>)
  for (const g of payload.giftcards ?? []) if (g && typeof g === "object") push("giftcards", g as Record<string, unknown>)

  return items
}

/** Identificador estable de un servicio dentro de un pago, para idempotencia (§16).
 *  Usa receipt_id cuando existe; si no, el índice del item. */
export function buildServiceIdentifier(item: ServiceItem): string {
  const base = item.receiptId != null ? `r${item.receiptId}` : `i${item.index}`
  return `${base}#${item.normalizedName}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Transacciones de pago (§14) y recibos (§15)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExtractedTransaction {
  number: string
  amount: number
  installments: number
  paymentMethod: string
  paymentMethodType: string
  bank: string
}

export function extractTransactions(payload: AgendaProPaymentPayload): ExtractedTransaction[] {
  const out: ExtractedTransaction[] = []
  for (const dp of payload.down_payments ?? []) {
    for (const tx of dp?.payment_transactions ?? []) {
      out.push({
        number: String(tx.number ?? "").trim(),
        amount: Number(tx.amount ?? 0) || 0,
        installments: Number(tx.installments ?? 0) || 0,
        paymentMethod: String(tx.payment_method ?? "").trim(),
        paymentMethodType: String(tx.payment_method_type ?? "").trim(),
        bank: String(tx.bank ?? "").trim(),
      })
    }
  }
  return out
}

/** Suma de transacciones y comparación con paid_amount (§14). */
export function summarizePayment(payload: AgendaProPaymentPayload) {
  const txs = extractTransactions(payload)
  const txSum = txs.reduce((s, t) => s + t.amount, 0)
  const paid = Number(payload.paid_amount ?? payload.amount ?? 0) || 0
  const methods = [...new Set(txs.map((t) => t.paymentMethod).filter(Boolean))]
  // tolerancia de 1 centavo por redondeo
  const mismatch = txs.length > 0 && Math.abs(txSum - paid) > 0.01
  return { txs, txSum, paid, methods, method: methods.join(" + "), mismatch }
}

export function indexReceipts(payload: AgendaProPaymentPayload): Map<number, AgendaProReceipt> {
  const map = new Map<number, AgendaProReceipt>()
  for (const r of payload.receipts ?? []) {
    if (r && r.id != null) map.set(Number(r.id), r)
  }
  return map
}

// ─────────────────────────────────────────────────────────────────────────────
// Fechas — zona horaria RD (§22). RD = America/Santo_Domingo (UTC-4, sin DST).
// ─────────────────────────────────────────────────────────────────────────────

/** ISO/UTC → 'YYYY-MM-DD' en hora de República Dominicana (para columna date). */
export function toDominicanDateISO(iso: unknown): string | null {
  const s = String(iso ?? "").trim()
  if (!s) return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  // en-CA da 'YYYY-MM-DD'
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santo_Domingo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d)
}

/** ISO/UTC → 'DD/MM/YYYY' en hora de RD (para mostrar en UI). */
export function toDominicanDateDisplay(iso: unknown): string | null {
  const isoDate = toDominicanDateISO(iso)
  if (!isoDate) return null
  const [y, m, dd] = isoDate.split("-")
  return `${dd}/${m}/${y}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Cliente: campos normalizados desde el payload (§11)
// ─────────────────────────────────────────────────────────────────────────────

export interface NormalizedClient {
  agendaproClientId: string
  nombre: string
  apellido: string
  telefono: string
  telefono2: string
  email: string
  documento: string
  direccion: string
  ciudad: string
  localidad: string
  fechaNacimiento: string | null
  edad: number | null
}

function two(n: number): string {
  return String(n).padStart(2, "0")
}

export function normalizeClientFromPayload(c: AgendaProClientPayload): NormalizedClient {
  let fechaNacimiento: string | null = null
  if (c.birth_year && c.birth_month && c.birth_day) {
    fechaNacimiento = `${c.birth_year}-${two(Number(c.birth_month))}-${two(Number(c.birth_day))}`
  }
  return {
    agendaproClientId: String(c.id ?? "").trim(),
    nombre: toUpperName(c.first_name),
    apellido: toUpperName(c.last_name),
    telefono: String(c.phone ?? "").trim(),
    telefono2: String(c.second_phone ?? "").trim(),
    email: String(c.email ?? "").trim().toLowerCase(),
    documento: digitsOnly(c.identification_number),
    direccion: String(c.address ?? "").trim(),
    ciudad: String(c.city ?? "").trim(),
    localidad: String(c.district ?? "").trim(),
    fechaNacimiento,
    edad: c.age != null && Number.isFinite(Number(c.age)) ? Number(c.age) : null,
  }
}

/** cliente_id determinístico preferido para un cliente nuevo (§11):
 *  cédula → cli_doc_, teléfono → cli_tel_, si no AgendaPro id → cli_apro_. */
export function preferredNewClienteId(c: NormalizedClient): string {
  if (c.documento) return `cli_doc_${c.documento}`
  const d = digitsOnly(c.telefono)
  if (d) return `cli_tel_${d}`
  if (c.agendaproClientId) return `cli_apro_${c.agendaproClientId}`
  return `cli_${c.nombre}_${c.apellido}`.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40) || `cli_unknown`
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapeo status → HTTP (§19)
// ─────────────────────────────────────────────────────────────────────────────

export function httpStatusForResult(status: PaymentStatus): number {
  switch (status) {
    case "processed":
    case "already_processed":
      return 200
    case "requires_mapping":
      return 202
    case "invalid":
      return 400
    case "error":
    default:
      return 500
  }
}

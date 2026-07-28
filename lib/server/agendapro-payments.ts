/**
 * Orquestador del webhook de PAGOS de AgendaPro (§5–§17 del brief).
 *
 * Recibe el payload de un pago y, de forma IDEMPOTENTE y AISLADA POR TENANT:
 *   1. Resuelve el tenant y la sucursal por `location_id` (csl_agendapro_location_map).
 *   2. Registra el evento en csl_agendapro_webhook_events (idempotencia por pago).
 *   3. Encuentra o crea el cliente (dedup por agendapro_id > email > teléfono > cédula,
 *      SIN pisar clientes de otro tenant que compartan la clave global cliente_id).
 *   4. Registra la compra/paquete (sesiones adquiridas = disponibles; NUNCA consume).
 *   5. Crea el consentimiento PENDIENTE de firma que corresponda al servicio.
 *
 * Toda la lógica pura vive en `agendapro-payments-core.ts`. El acceso a datos se
 * abstrae en `AgendaProPaymentRepo` para poder probar los 25 casos sin tocar prod;
 * `createSupabaseRepo()` es la implementación real contra db-cls.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { getSupabaseAdmin } from "@/lib/server/supabase"
import {
  buildServiceIdentifier,
  extractServiceItems,
  httpStatusForResult,
  indexReceipts,
  inferDepilacionLaserService,
  maskCedula,
  maskEmail,
  maskPhone,
  normalizeClientFromPayload,
  phoneDigitVariants,
  preferredNewClienteId,
  summarizePayment,
  toDominicanDateISO,
  validatePayload,
  type AgendaProPaymentPayload,
  type NormalizedClient,
  type PaymentStatus,
  type ServiceItem,
} from "@/lib/server/agendapro-payments-core"

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de filas (subset de columnas que usamos)
// ─────────────────────────────────────────────────────────────────────────────
export interface ClientRow {
  cliente_id: string
  business_id?: string
  nombre?: string
  apellido?: string
  telefono?: string
  telefono2?: string
  email?: string
  documento_identidad?: string
  direccion?: string
  ciudad?: string
  localidad?: string
  fecha_nacimiento?: string | null
  edad?: number | null
  agendapro_client_id?: string | null
}

export interface ServiceMapRow {
  internal_service_name: string | null
  categoria: string | null
  consent_type: string | null
  sessions_quantity: number
}

export interface LocationMapRow {
  businessId: string
  internalSucursal: string
}

/** Contrato de acceso a datos. Real = Supabase; en tests = repo en memoria. */
export interface AgendaProPaymentRepo {
  getDefaultBusinessId(): Promise<string>
  getLocationMap(agendaproLocationId: number): Promise<LocationMapRow | null>
  getServiceMap(businessId: string, normalizedName: string): Promise<ServiceMapRow | null>

  findEvent(businessId: string, paymentId: number): Promise<{ id: string; status: string; attempts: number } | null>
  insertEvent(row: Record<string, unknown>): Promise<{ id: string }>
  updateEvent(id: string, patch: Record<string, unknown>): Promise<void>

  findClientByAgendaProId(businessId: string, agendaproClientId: string): Promise<ClientRow | null>
  findClientByEmail(businessId: string, email: string): Promise<ClientRow | null>
  findClientByClienteId(businessId: string, clienteId: string): Promise<ClientRow | null>
  /** Dueño (business_id) de un cliente_id GLOBAL, sin filtrar por tenant. */
  getClienteOwner(clienteId: string): Promise<{ businessId: string } | null>
  insertClient(row: Record<string, unknown>): Promise<void>
  updateClient(clienteId: string, businessId: string, patch: Record<string, unknown>): Promise<void>

  findPaquete(businessId: string, paymentId: number, serviceIdentifier: string): Promise<{ paquete_id: string } | null>
  insertPaquete(row: Record<string, unknown>): Promise<void>

  findConsent(businessId: string, paymentId: number, serviceIdentifier: string): Promise<{ consent_id: string } | null>
  insertConsent(row: Record<string, unknown>): Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Resultado del procesamiento
// ─────────────────────────────────────────────────────────────────────────────
export interface PaqueteResult {
  paquete_id: string
  servicio: string
  sesiones_adquiridas: number
  mapped: boolean
  consent_id: string | null
}
export interface ProcessResult {
  status: PaymentStatus
  httpStatus: number
  paymentId: number | null
  clienteId?: string
  reason?: string
  error?: string
  paquetes?: PaqueteResult[]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const nowIso = () => new Date().toISOString()

function sanitizeIdPart(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40)
}

// ─────────────────────────────────────────────────────────────────────────────
// Cliente: encontrar o crear, sin pisar otro tenant
// ─────────────────────────────────────────────────────────────────────────────
function safeClientPatch(existing: ClientRow, nc: NormalizedClient): Record<string, unknown> {
  // Solo rellena campos vacíos; nunca sobrescribe datos válidos (§11).
  const patch: Record<string, unknown> = { agendapro_synced_at: nowIso() }
  if (!existing.agendapro_client_id && nc.agendaproClientId) patch.agendapro_client_id = nc.agendaproClientId
  if (!existing.email && nc.email) patch.email = nc.email
  if (!existing.telefono && nc.telefono) patch.telefono = nc.telefono
  if (!existing.documento_identidad && nc.documento) patch.documento_identidad = nc.documento
  if (!existing.direccion && nc.direccion) patch.direccion = nc.direccion
  if (!existing.ciudad && nc.ciudad) patch.ciudad = nc.ciudad
  if (!existing.localidad && nc.localidad) patch.localidad = nc.localidad
  if (!existing.fecha_nacimiento && nc.fechaNacimiento) patch.fecha_nacimiento = nc.fechaNacimiento
  return patch
}

async function resolveOrCreateClient(
  repo: AgendaProPaymentRepo,
  businessId: string,
  nc: NormalizedClient,
): Promise<string> {
  // 1) agendapro_client_id  2) email  3) teléfono  4) cédula — todo scoped al tenant.
  let found: ClientRow | null = null
  if (nc.agendaproClientId) found = await repo.findClientByAgendaProId(businessId, nc.agendaproClientId)
  if (!found && nc.email && EMAIL_RE.test(nc.email)) found = await repo.findClientByEmail(businessId, nc.email)
  if (!found) {
    for (const v of phoneDigitVariants(nc.telefono)) {
      found = await repo.findClientByClienteId(businessId, `cli_tel_${v}`)
      if (found) break
    }
  }
  if (!found && nc.documento) found = await repo.findClientByClienteId(businessId, `cli_doc_${nc.documento}`)

  if (found) {
    await repo.updateClient(found.cliente_id, businessId, safeClientPatch(found, nc))
    return found.cliente_id
  }

  // Crear — clave determinística, pero si ya pertenece a OTRO tenant, sufijar.
  let candidate = preferredNewClienteId(nc)
  const owner = await repo.getClienteOwner(candidate)
  if (owner && owner.businessId !== businessId) {
    candidate = `${candidate}__${businessId.slice(0, 8)}`
  }
  await repo.insertClient({
    cliente_id: candidate,
    business_id: businessId,
    nombre: nc.nombre,
    apellido: nc.apellido,
    telefono: nc.telefono || null,
    telefono2: nc.telefono2 && nc.telefono2 !== nc.telefono ? nc.telefono2 : null,
    email: nc.email || null,
    documento_identidad: nc.documento || null,
    direccion: nc.direccion || null,
    ciudad: nc.ciudad || null,
    localidad: nc.localidad || null,
    fecha_nacimiento: nc.fechaNacimiento,
    edad: nc.edad,
    estado: "Activo",
    origen: "AgendaPro",
    agendapro_client_id: nc.agendaproClientId || null,
    agendapro_synced_at: nowIso(),
  })
  return candidate
}

// ─────────────────────────────────────────────────────────────────────────────
// Procesador principal
// ─────────────────────────────────────────────────────────────────────────────
export interface ProcessOptions {
  payloadHash?: string | null
  /** Guardar el payload completo en el evento (protegido). Controlado por env. */
  storePayload?: boolean
}

export async function processAgendaProPayment(
  payloadRaw: unknown,
  repo: AgendaProPaymentRepo,
  opts: ProcessOptions = {},
): Promise<ProcessResult> {
  const payload = (payloadRaw ?? {}) as AgendaProPaymentPayload
  const validation = validatePayload(payloadRaw)
  const storedPayload = opts.storePayload ? payload : null

  // Resolver tenant por location_id.
  const locationId = Number(payload?.location_id) || null
  let businessId: string | null = null
  let sucursal = ""
  let locationMapped = false
  if (locationId) {
    const lm = await repo.getLocationMap(locationId)
    if (lm) {
      businessId = lm.businessId
      sucursal = lm.internalSucursal
      locationMapped = true
    }
  }
  if (!businessId) businessId = await repo.getDefaultBusinessId()

  const agendaproClientId = payload.client?.id != null ? Number(payload.client.id) || null : null

  // Payload inválido → registrar (best-effort) y responder 400.
  if (!validation.ok) {
    await repo.insertEvent({
      business_id: businessId,
      agendapro_payment_id: validation.paymentId,
      event_type: "payment",
      status: "failed",
      attempts: 1,
      agendapro_location_id: locationId,
      agendapro_client_id: agendaproClientId,
      payload_hash: opts.payloadHash ?? null,
      payload_json: storedPayload,
      error_code: "invalid_payload",
      error_message: validation.error ?? "Payload inválido",
      processed_at: nowIso(),
    }).catch(() => {})
    return { status: "invalid", httpStatus: 400, paymentId: validation.paymentId, error: validation.error }
  }

  const paymentId = validation.paymentId as number

  // Idempotencia: si ya está procesado, no repetir.
  const existing = await repo.findEvent(businessId, paymentId)
  if (existing && existing.status === "processed") {
    return { status: "already_processed", httpStatus: 200, paymentId }
  }

  let eventId: string
  if (existing) {
    eventId = existing.id
    await repo.updateEvent(eventId, { status: "processing", attempts: (existing.attempts ?? 0) + 1, updated_at: nowIso() })
  } else {
    const inserted = await repo.insertEvent({
      business_id: businessId,
      agendapro_payment_id: paymentId,
      event_type: "payment",
      status: "processing",
      attempts: 1,
      agendapro_location_id: locationId,
      agendapro_client_id: agendaproClientId,
      payload_hash: opts.payloadHash ?? null,
      payload_json: storedPayload,
      received_at: nowIso(),
    })
    eventId = inserted.id
  }

  // Sin mapeo de sucursal → requiere revisión; NO crear cliente/compra.
  if (!locationMapped) {
    await repo.updateEvent(eventId, {
      status: "requires_mapping",
      error_code: "location_unmapped",
      error_message: `location_id ${locationId ?? "(vacío)"} sin mapeo en csl_agendapro_location_map`,
      processed_at: nowIso(),
      updated_at: nowIso(),
    })
    return { status: "requires_mapping", httpStatus: 202, paymentId, reason: "location_unmapped" }
  }

  try {
    const nc = normalizeClientFromPayload(payload.client!)
    const clienteId = await resolveOrCreateClient(repo, businessId, nc)

    const items = extractServiceItems(payload)
    const receipts = indexReceipts(payload)
    const pay = summarizePayment(payload)
    const fechaCompra = toDominicanDateISO(payload.payment_date)
    const paquetes: PaqueteResult[] = []
    let anyUnmapped = false

    for (const item of items) {
      const serviceIdentifier = buildServiceIdentifier(item)
      // Mapeo explícito (admin) tiene prioridad; si no hay, se infiere el patrón
      // "Depilación Láser N sesiones" (N = sesiones) para no mapear cada variante.
      const map = (await repo.getServiceMap(businessId, item.normalizedName)) ?? inferDepilacionLaserService(item.rawName)
      if (!map) anyUnmapped = true
      const receipt = item.receiptId != null ? receipts.get(item.receiptId) : undefined
      const sesiones = map?.sessions_quantity ?? sessionsFromName(item.rawName)
      const requiereRevision = !map || pay.mismatch

      // Paquete idempotente por (tenant, pago, servicio).
      let paqueteId = (await repo.findPaquete(businessId, paymentId, serviceIdentifier))?.paquete_id ?? null
      if (!paqueteId) {
        paqueteId = `PKG-${paymentId}-${sanitizeIdPart(serviceIdentifier)}`
        await repo.insertPaquete({
          paquete_id: paqueteId,
          business_id: businessId,
          cliente_id: clienteId,
          sucursal,
          categoria: map?.categoria ?? null,
          servicio: map?.internal_service_name ?? item.rawName,
          sesiones_adquiridas: sesiones,
          sesiones_disponibles: sesiones, // §17: NUNCA se consume al recibir el pago
          monto: item.price,
          monto_pagado: Math.max(0, item.price - item.discount),
          descuento: item.discount,
          metodo_pago: pay.method || null,
          numero_transaccion: pay.txs.map((t) => t.number).filter(Boolean).join(", ") || null,
          numero_factura: receipt?.number ?? null,
          tipo_comprobante: receipt?.receipt_type ?? null,
          proveedor: item.provider,
          fecha_compra: fechaCompra,
          fecha_compra_utc: payload.payment_date ?? null,
          origen: "agendapro_webhook",
          estado: "disponible",
          requiere_revision: requiereRevision,
          agendapro_payment_id: paymentId,
          agendapro_receipt_id: item.receiptId,
          agendapro_location_id: locationId,
          agendapro_client_id: agendaproClientId,
          service_identifier: serviceIdentifier,
          payload_json: storedPayload,
          created_by: "agendapro_webhook",
        })
      }

      // Consentimiento pendiente idempotente — solo tipos con soporte de esquema.
      let consentId: string | null = null
      if (map?.consent_type === "depilacion-laser") {
        const existsConsent = await repo.findConsent(businessId, paymentId, serviceIdentifier)
        if (existsConsent) {
          consentId = existsConsent.consent_id
        } else {
          consentId = `CONS-DL-${paymentId}-${sanitizeIdPart(serviceIdentifier)}`
          await repo.insertConsent({
            consent_id: consentId,
            business_id: businessId,
            cliente_id: clienteId,
            fecha: fechaCompra,
            sucursal,
            estado: "Pendiente",
            nombre_cliente: `${nc.nombre} ${nc.apellido}`.trim(),
            cliente_nombre: `${nc.nombre} ${nc.apellido}`.trim(),
            documento: nc.documento || null,
            telefono: nc.telefono || null,
            correo: nc.email || null,
            fecha_nacimiento: nc.fechaNacimiento,
            edad: nc.edad,
            direccion: nc.direccion || null,
            zona_tratar: map?.internal_service_name ?? null,
            origen: "AgendaPro",
            paquete_id: paqueteId,
            agendapro_payment_id: paymentId,
            service_identifier: serviceIdentifier,
            created_by: "agendapro_webhook",
          })
        }
      }

      paquetes.push({
        paquete_id: paqueteId,
        servicio: map?.internal_service_name ?? item.rawName,
        sesiones_adquiridas: sesiones,
        mapped: !!map,
        consent_id: consentId,
      })
    }

    const finalStatus: PaymentStatus = anyUnmapped ? "requires_mapping" : "processed"
    await repo.updateEvent(eventId, {
      status: finalStatus,
      processed_at: nowIso(),
      updated_at: nowIso(),
      error_code: anyUnmapped ? "service_unmapped" : null,
      error_message: anyUnmapped ? "Uno o más servicios sin mapeo — compra registrada, requiere revisión." : null,
      result_summary: {
        cliente_id: clienteId,
        cliente: { email: maskEmail(nc.email), telefono: maskPhone(nc.telefono), cedula: maskCedula(nc.documento) },
        paquetes: paquetes.map((p) => ({ paquete_id: p.paquete_id, servicio: p.servicio, mapped: p.mapped, consent_id: p.consent_id })),
      },
    })

    return {
      status: finalStatus,
      httpStatus: httpStatusForResult(finalStatus),
      paymentId,
      clienteId,
      paquetes,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido"
    await repo.updateEvent(eventId, {
      status: "failed",
      error_code: "processing_error",
      error_message: message.slice(0, 500),
      processed_at: nowIso(),
      updated_at: nowIso(),
    }).catch(() => {})
    return { status: "error", httpStatus: 500, paymentId, error: message }
  }
}

/** Extrae "N sesiones" de un nombre de servicio cuando no hay mapeo (fallback). */
function sessionsFromName(name: string): number {
  const m = String(name).match(/(\d+)\s*sesion/i)
  const n = m ? Number(m[1]) : 1
  return Number.isFinite(n) && n > 0 ? n : 1
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementación real del repo contra db-cls (Supabase service-role)
// ─────────────────────────────────────────────────────────────────────────────
export function createSupabaseRepo(client?: SupabaseClient): AgendaProPaymentRepo {
  const sb = client ?? getSupabaseAdmin()

  return {
    async getDefaultBusinessId() {
      const envId = process.env.AGENDAPRO_DEFAULT_TENANT_ID
      if (envId) return envId
      const { data } = await sb.from("businesses").select("id").eq("slug", "csl").maybeSingle()
      const id = (data as { id?: string } | null)?.id
      if (!id) throw new Error("No se encontró el business CSL en businesses.")
      return id
    },

    async getLocationMap(agendaproLocationId) {
      const { data } = await sb
        .from("csl_agendapro_location_map")
        .select("business_id, internal_sucursal, active")
        .eq("agendapro_location_id", agendaproLocationId)
        .eq("active", true)
        .maybeSingle()
      const row = data as { business_id?: string; internal_sucursal?: string } | null
      if (!row?.business_id) return null
      return { businessId: row.business_id, internalSucursal: row.internal_sucursal ?? "" }
    },

    async getServiceMap(businessId, normalizedName) {
      const { data } = await sb
        .from("csl_agendapro_service_map")
        .select("internal_service_name, categoria, consent_type, sessions_quantity, active")
        .eq("business_id", businessId)
        .eq("normalized_service_name", normalizedName)
        .eq("active", true)
        .maybeSingle()
      const row = data as ServiceMapRow | null
      return row ?? null
    },

    async findEvent(businessId, paymentId) {
      const { data } = await sb
        .from("csl_agendapro_webhook_events")
        .select("id, status, attempts")
        .eq("business_id", businessId)
        .eq("agendapro_payment_id", paymentId)
        .maybeSingle()
      return (data as { id: string; status: string; attempts: number } | null) ?? null
    },

    async insertEvent(row) {
      const { data, error } = await sb
        .from("csl_agendapro_webhook_events")
        .insert(row)
        .select("id")
        .single()
      if (error) throw error
      return { id: (data as { id: string }).id }
    },

    async updateEvent(id, patch) {
      const { error } = await sb.from("csl_agendapro_webhook_events").update(patch).eq("id", id)
      if (error) throw error
    },

    async findClientByAgendaProId(businessId, agendaproClientId) {
      const { data } = await sb
        .from("csl_cosmiatria_clientes")
        .select("cliente_id, business_id, nombre, apellido, telefono, telefono2, email, documento_identidad, direccion, ciudad, localidad, fecha_nacimiento, edad, agendapro_client_id")
        .eq("business_id", businessId)
        .eq("agendapro_client_id", agendaproClientId)
        .limit(1)
        .maybeSingle()
      return (data as ClientRow | null) ?? null
    },

    async findClientByEmail(businessId, email) {
      const { data } = await sb
        .from("csl_cosmiatria_clientes")
        .select("cliente_id, business_id, nombre, apellido, telefono, telefono2, email, documento_identidad, direccion, ciudad, localidad, fecha_nacimiento, edad, agendapro_client_id")
        .eq("business_id", businessId)
        .ilike("email", email)
        .limit(1)
        .maybeSingle()
      return (data as ClientRow | null) ?? null
    },

    async findClientByClienteId(businessId, clienteId) {
      const { data } = await sb
        .from("csl_cosmiatria_clientes")
        .select("cliente_id, business_id, nombre, apellido, telefono, telefono2, email, documento_identidad, direccion, ciudad, localidad, fecha_nacimiento, edad, agendapro_client_id")
        .eq("business_id", businessId)
        .eq("cliente_id", clienteId)
        .maybeSingle()
      return (data as ClientRow | null) ?? null
    },

    async getClienteOwner(clienteId) {
      const { data } = await sb
        .from("csl_cosmiatria_clientes")
        .select("business_id")
        .eq("cliente_id", clienteId)
        .maybeSingle()
      const row = data as { business_id?: string } | null
      return row?.business_id ? { businessId: row.business_id } : null
    },

    async insertClient(row) {
      const { error } = await sb.from("csl_cosmiatria_clientes").insert(row)
      if (error) throw error
    },

    async updateClient(clienteId, businessId, patch) {
      if (Object.keys(patch).length === 0) return
      const { error } = await sb
        .from("csl_cosmiatria_clientes")
        .update(patch)
        .eq("cliente_id", clienteId)
        .eq("business_id", businessId)
      if (error) throw error
    },

    async findPaquete(businessId, paymentId, serviceIdentifier) {
      const { data } = await sb
        .from("csl_paquetes")
        .select("paquete_id")
        .eq("business_id", businessId)
        .eq("agendapro_payment_id", paymentId)
        .eq("service_identifier", serviceIdentifier)
        .maybeSingle()
      return (data as { paquete_id: string } | null) ?? null
    },

    async insertPaquete(row) {
      const { error } = await sb.from("csl_paquetes").insert(row)
      if (error) throw error
    },

    async findConsent(businessId, paymentId, serviceIdentifier) {
      const { data } = await sb
        .from("csl_consent_depilacion_laser")
        .select("consent_id")
        .eq("business_id", businessId)
        .eq("agendapro_payment_id", paymentId)
        .eq("service_identifier", serviceIdentifier)
        .maybeSingle()
      return (data as { consent_id: string } | null) ?? null
    },

    async insertConsent(row) {
      const { error } = await sb.from("csl_consent_depilacion_laser").insert(row)
      if (error) throw error
    },
  }
}

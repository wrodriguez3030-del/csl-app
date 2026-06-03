/**
 * Dispatcher central de las acciones soportadas por /api/csl.
 *
 * Mantiene el contrato `action: "..."` que el frontend ya envía — agregar
 * acciones nuevas implica añadir un `case` aquí, no cambiar la firma.
 *
 * Server-only.
 */

import { ALL_MENU_IDS } from "@/lib/menus"
import { sendFichaDermoEmail } from "@/lib/dermo-server"
import { getSupabaseAdmin } from "@/lib/server/supabase"
import {
  dateValue,
  numberFrom,
  parsePayload,
  stringArrayFrom,
  textFrom,
  textValue,
  numberValue,
} from "@/lib/server/csl-helpers"
import {
  deleteRow,
  getAllData,
  getAllPulsosData,
  getProfile,
  getRecordCompleto,
  getReporteCompleto,
  getRows,
  getRowsPaged,
  loadBusinessContext,
  requireAdmin,
  resolveClienteId,
  syncFichasCliente,
  tableConfig,
  updateRowFields,
  upsertClienteCosmiatriaPreserving,
  upsertRow,
  SOLICITUDES_LIST_COLS,
  FICHA_LIST_COLS,
  CONSENT_LIST_COLS,
} from "@/lib/server/csl-crud"
import { runWithBusinessContext, applyActiveBusiness, getBusinessContext } from "@/lib/server/business-context"
import { createHash } from "node:crypto"
import { makeAgendaMatchKey } from "@/lib/normalize-pulse"
import {
  clienteCosmiatriaToDb,
  consentToDb,
  fichaDermoToDb,
  fromDb,
  profileToUser,
  solicitudToDb,
} from "@/lib/server/csl-transforms"
import {
  sendApprovedSolicitudEmail,
  sendConsentMasajeEmail,
  sendConsentTatuajeCejaEmail,
  sendReporteEmail,
} from "@/lib/server/csl-email"
import type { ActionParams, ActionUser, Row } from "@/lib/server/csl-types"

const MENU_IDS: string[] = [...ALL_MENU_IDS]

/** SHA-256 hex — usado para hashear el PIN de ponche (nunca se guarda plano). */
function hrSha256(value: string): string {
  return createHash("sha256").update(String(value), "utf8").digest("hex")
}
/** ¿El error de Supabase es "tabla no existe" (migración pendiente)? */
function isMissingTable(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "42P01"
}
/** business_id efectivo (respeta el business activo del superadmin). */
function effectiveBusinessId(): string | null {
  const ctx = getBusinessContext()
  return ctx?.businessId ?? null
}
/** ¿Se debe filtrar por business_id? (false solo para superadmin en modo "Todos"). */
function shouldScopeTenant(): boolean {
  const ctx = getBusinessContext()
  return Boolean(ctx && !ctx.bypassTenantFilter)
}

/** Base estándar de días hábiles RD para el sueldo diario. */
const HR_DAILY_BASE = 23.83
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

/**
 * Registra una acción crítica en hr_audit_logs. Nunca rompe la operación
 * principal si la auditoría falla (best-effort). business_id desde contexto.
 */
async function hrAudit(
  user: ActionUser,
  module: string,
  action: string,
  entityType: string,
  entityId: string | null,
  oldValues: unknown,
  newValues: unknown,
): Promise<void> {
  const businessId = effectiveBusinessId()
  if (!businessId) return
  try {
    await getSupabaseAdmin().from("hr_audit_logs").insert({
      business_id: businessId,
      user_id: user.id || null,
      user_email: user.email || null,
      module,
      action,
      entity_type: entityType,
      entity_id: entityId,
      old_values: oldValues ?? null,
      new_values: newValues ?? null,
    })
  } catch {
    // No bloquear la operación principal por un fallo de auditoría.
  }
}

/** Salario mensual VIGENTE: hr_employee_salary_history (effective_to null) → fallback csl_empleados.salario. */
async function salarioVigente(businessId: string, employeeId: string): Promise<number> {
  const sb = getSupabaseAdmin()
  const { data: hist } = await sb
    .from("hr_employee_salary_history")
    .select("salary")
    .eq("business_id", businessId)
    .eq("employee_id", employeeId)
    .is("effective_to", null)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (hist && (hist as { salary?: number }).salary != null) return Number((hist as { salary: number }).salary)
  const { data: emp } = await sb
    .from("csl_empleados")
    .select("salario")
    .eq("business_id", businessId)
    .eq("empleado_id", employeeId)
    .maybeSingle()
  return Number((emp as { salario?: number } | null)?.salario ?? 0)
}

/**
 * Cálculo REFERENCIAL de prestaciones RD (Código de Trabajo). Editable y a
 * validar legalmente. salario_diario = mensual/23.83 (mismo del sistema).
 * Preaviso/cesantía solo aplican en desahucio y despido injustificado.
 */
function computeSeverance(motivo: string, fechaIngreso: string, fechaSalida: string, mensual: number) {
  const ing = fechaIngreso ? new Date(fechaIngreso) : null
  const sal = fechaSalida ? new Date(fechaSalida) : new Date()
  const t = ing ? Math.max(0, (sal.getTime() - ing.getTime()) / (365.25 * 24 * 3600 * 1000)) : 0
  const diario = round2(mensual / HR_DAILY_BASE)
  const aplicaPreCes = motivo === "desahucio" || motivo === "despido_injustificado"
  let preavisoDias = 0, cesantiaDias = 0
  if (aplicaPreCes) {
    if (t >= 1) preavisoDias = 28
    else if (t >= 0.5) preavisoDias = 14
    else if (t >= 0.25) preavisoDias = 7
    if (t >= 1) { const cap5 = Math.min(t, 5); const extra = Math.max(0, t - 5); cesantiaDias = round2(cap5 * 21 + extra * 23) }
    else if (t >= 0.5) cesantiaDias = 13
    else if (t >= 0.25) cesantiaDias = 6
  }
  const preavisoMonto = round2(diario * preavisoDias)
  const cesantiaMonto = round2(diario * cesantiaDias)
  const vacacionesMonto = round2(diario * 14 * Math.min(1, t)) // referencial
  const mesesAnio = sal.getMonth() + 1 // meses transcurridos del año de salida
  const navidadMonto = round2(mensual * mesesAnio / 12)
  return {
    anios_servicio: round2(t), salario_diario: diario,
    preaviso_dias: preavisoDias, preaviso_monto: preavisoMonto,
    cesantia_dias: cesantiaDias, cesantia_monto: cesantiaMonto,
    vacaciones_monto: vacacionesMonto, navidad_monto: navidadMonto,
  }
}

/** ISR anual según escala de tramos [{li, ls, tasa, cuota}]. Devuelve 0 si exento. */
function applyIsrAnnual(taxable: number, brackets: Array<{ li: number; ls: number | null; tasa: number; cuota: number }>): number {
  if (!Array.isArray(brackets) || taxable <= 0) return 0
  for (const b of brackets) {
    const within = taxable >= Number(b.li) && (b.ls == null || taxable <= Number(b.ls))
    if (within) return round2(Number(b.cuota) + (taxable - Number(b.li)) * Number(b.tasa))
  }
  return 0
}

/** Cuenta días distintos con al menos una marca de ponche en el rango (TZ RD). */
async function diasDesdeAsistencia(businessId: string, employeeId: string, desde: string, hasta: string): Promise<number> {
  if (!desde || !hasta) return 0
  const sb = getSupabaseAdmin()
  const { data } = await sb
    .from("hr_punches")
    .select("punched_at")
    .eq("business_id", businessId)
    .eq("employee_id", employeeId)
    .gte("punched_at", desde)
    .lte("punched_at", `${hasta}T23:59:59`)
  const TZ = "America/Santo_Domingo"
  const dias = new Set<string>()
  for (const r of (data || []) as { punched_at: string }[]) {
    dias.add(new Date(r.punched_at).toLocaleDateString("en-CA", { timeZone: TZ }))
  }
  return dias.size
}

export async function handleAction(params: ActionParams, user: ActionUser) {
  const action = textValue(params, "action")

  // Cargar BusinessContext UNA vez por request. Todos los CRUD ops dentro
  // de runWithBusinessContext lo leen automático y filtran por business_id.
  // Si el profile no tiene business_id (no debería pasar post-migración 002),
  // ctx queda null y los CRUD ops no filtran — riesgo aceptable porque la
  // migración garantizó backfill.
  const businessContext = await loadBusinessContext(user.id)

  // Aislamiento end-to-end: la UI manda el business activo en cada request.
  // Para un superadmin con business activo, scopeamos a ese tenant (deja de
  // ver datos cruzados). Para un usuario normal no tiene efecto.
  const activeBusinessId = textValue(params, "activeBusinessId")
  const effectiveContext = applyActiveBusiness(businessContext, activeBusinessId)

  return runWithBusinessContext(effectiveContext, async () => {
    return dispatchAction(action, params, user)
  })
}

async function dispatchAction(action: string, params: ActionParams, user: ActionUser) {
  switch (action) {
    case "health": {
      const { error } = await getSupabaseAdmin().from("csl_sucursales").select("codigo").limit(1)
      if (error) throw error
      return { ok: true, provider: "supabase" }
    }
    case "getAllData":
      return { ok: true, data: await getAllData() }
    case "getAllPulsosData":
      return { ok: true, ...(await getAllPulsosData()) }

    // ── HR · Fase 1 · Contratos ──────────────────────────────────────────
    case "getHrContracts": {
      const sb = getSupabaseAdmin()
      const { data: profile } = await sb
        .from("csl_user_profiles").select("business_id").eq("user_id", user.id).single()
      if (!profile?.business_id) throw new Error("business_id no encontrado")
      const { data, error } = await sb
        .from("hr_contracts")
        .select("*")
        .eq("business_id", profile.business_id)
        .order("start_date", { ascending: false })
      if (error) {
        const code = (error as { code?: string }).code
        if (code === "42P01") return { ok: true, records: [], tableMissing: true }
        throw error
      }
      return { ok: true, records: data || [] }
    }

    case "saveHrContract": {
      const record = parsePayload(params)
      const sb = getSupabaseAdmin()
      const { data: profile } = await sb
        .from("csl_user_profiles").select("business_id").eq("user_id", user.id).single()
      if (!profile?.business_id) throw new Error("business_id no encontrado")
      const row: Record<string, unknown> = {
        business_id: profile.business_id,
        employee_id: textFrom(record, "employee_id"),
        contract_type: textFrom(record, "contract_type") || "indefinido",
        start_date: textFrom(record, "start_date"),
        end_date: textFrom(record, "end_date") || null,
        salary: record.salary != null ? numberFrom(record, "salary") : null,
        position_name: textFrom(record, "position_name") || null,
        schedule: textFrom(record, "schedule") || null,
        workday: textFrom(record, "workday") || "completa",
        status: textFrom(record, "status") || "borrador",
        file_url: textFrom(record, "file_url") || null,
        observations: textFrom(record, "observations") || null,
        updated_at: new Date().toISOString(),
      }
      if (textFrom(record, "id")) row.id = textFrom(record, "id")
      const { data, error } = await sb
        .from("hr_contracts")
        .upsert(row, { onConflict: "id" })
        .select()
        .single()
      if (error) {
        const code = (error as { code?: string }).code
        if (code === "42P01") return { ok: false, tableMissing: true, error: "Migración pendiente" }
        throw error
      }
      return { ok: true, record: data }
    }

    case "deleteHrContract": {
      const id = textValue(params, "id")
      if (!id) throw new Error("id obligatorio")
      const sb = getSupabaseAdmin()
      const { data: profile } = await sb
        .from("csl_user_profiles").select("business_id").eq("user_id", user.id).single()
      if (!profile?.business_id) throw new Error("business_id no encontrado")
      const { error } = await sb
        .from("hr_contracts")
        .delete()
        .eq("id", id)
        .eq("business_id", profile.business_id)
      if (error) {
        const code = (error as { code?: string }).code
        if (code === "42P01") return { ok: true, tableMissing: true }
        throw error
      }
      return { ok: true }
    }

    // ── HR · Fase 1 · Documentos empleados ───────────────────────────────
    case "getHrDocuments": {
      const sb = getSupabaseAdmin()
      const { data: profile } = await sb
        .from("csl_user_profiles").select("business_id").eq("user_id", user.id).single()
      if (!profile?.business_id) throw new Error("business_id no encontrado")
      const { data, error } = await sb
        .from("hr_documents")
        .select("*")
        .eq("business_id", profile.business_id)
        .order("uploaded_at", { ascending: false })
      if (error) {
        const code = (error as { code?: string }).code
        if (code === "42P01") return { ok: true, records: [], tableMissing: true }
        throw error
      }
      return { ok: true, records: data || [] }
    }

    case "saveHrDocument": {
      const record = parsePayload(params)
      const sb = getSupabaseAdmin()
      const { data: profile } = await sb
        .from("csl_user_profiles").select("business_id").eq("user_id", user.id).single()
      if (!profile?.business_id) throw new Error("business_id no encontrado")
      const row: Record<string, unknown> = {
        business_id: profile.business_id,
        employee_id: textFrom(record, "employee_id"),
        document_type: textFrom(record, "document_type") || "otros",
        title: textFrom(record, "title"),
        file_url: textFrom(record, "file_url") || null,
        expires_at: textFrom(record, "expires_at") || null,
        visibility: textFrom(record, "visibility") || "rrhh",
        status: textFrom(record, "status") || "activo",
        observations: textFrom(record, "observations") || null,
        updated_at: new Date().toISOString(),
      }
      if (textFrom(record, "id")) row.id = textFrom(record, "id")
      const { data, error } = await sb
        .from("hr_documents")
        .upsert(row, { onConflict: "id" })
        .select()
        .single()
      if (error) {
        const code = (error as { code?: string }).code
        if (code === "42P01") return { ok: false, tableMissing: true, error: "Migración pendiente" }
        throw error
      }
      return { ok: true, record: data }
    }

    case "deleteHrDocument": {
      const id = textValue(params, "id")
      if (!id) throw new Error("id obligatorio")
      const sb = getSupabaseAdmin()
      const { data: profile } = await sb
        .from("csl_user_profiles").select("business_id").eq("user_id", user.id).single()
      if (!profile?.business_id) throw new Error("business_id no encontrado")
      const { error } = await sb
        .from("hr_documents")
        .delete()
        .eq("id", id)
        .eq("business_id", profile.business_id)
      if (error) {
        const code = (error as { code?: string }).code
        if (code === "42P01") return { ok: true, tableMissing: true }
        throw error
      }
      return { ok: true }
    }
    // ── HR · Fase 2 · Horarios y turnos ──────────────────────────────────
    case "getHrSchedules": {
      const sb = getSupabaseAdmin()
      let q = sb.from("hr_schedules").select("*").order("created_at", { ascending: false })
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const { data, error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, records: [], tableMissing: true }; throw error }
      return { ok: true, records: data || [] }
    }
    case "saveHrSchedule": {
      const record = parsePayload(params)
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const row: Record<string, unknown> = {
        business_id: businessId,
        name: textFrom(record, "name"),
        type: textFrom(record, "type") || "fijo",
        entry_time: textFrom(record, "entry_time") || null,
        exit_time: textFrom(record, "exit_time") || null,
        lunch_start: textFrom(record, "lunch_start") || null,
        lunch_end: textFrom(record, "lunch_end") || null,
        workdays: Array.isArray(record.workdays) ? record.workdays : stringArrayFrom(record.workdays),
        late_tolerance_min: record.late_tolerance_min != null ? numberFrom(record, "late_tolerance_min") : 0,
        status: textFrom(record, "status") || "activo",
        updated_at: new Date().toISOString(),
      }
      if (textFrom(record, "id")) row.id = textFrom(record, "id")
      const { data, error } = await getSupabaseAdmin().from("hr_schedules").upsert(row, { onConflict: "id" }).select().single()
      if (error) { if (isMissingTable(error)) return { ok: false, tableMissing: true, error: "Migración pendiente" }; throw error }
      return { ok: true, record: data }
    }
    case "deleteHrSchedule": {
      const id = textValue(params, "id")
      if (!id) throw new Error("id obligatorio")
      let q = getSupabaseAdmin().from("hr_schedules").delete().eq("id", id)
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const { error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, tableMissing: true }; throw error }
      return { ok: true }
    }

    // ── HR · Fase 2 · Asignación de horario a empleado ───────────────────
    case "getHrScheduleAssignments": {
      const sb = getSupabaseAdmin()
      let q = sb.from("hr_schedule_assignments").select("*").order("created_at", { ascending: false })
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const employeeId = textValue(params, "employee_id")
      if (employeeId) q = q.eq("employee_id", employeeId)
      const { data, error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, records: [], tableMissing: true }; throw error }
      return { ok: true, records: data || [] }
    }
    case "saveHrScheduleAssignment": {
      const record = parsePayload(params)
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const row: Record<string, unknown> = {
        business_id: businessId,
        employee_id: textFrom(record, "employee_id"),
        schedule_id: textFrom(record, "schedule_id"),
        sucursal: textFrom(record, "sucursal") || null,
        start_date: textFrom(record, "start_date") || new Date().toISOString().slice(0, 10),
        end_date: textFrom(record, "end_date") || null,
        updated_at: new Date().toISOString(),
      }
      if (textFrom(record, "id")) row.id = textFrom(record, "id")
      const { data, error } = await getSupabaseAdmin().from("hr_schedule_assignments").upsert(row, { onConflict: "id" }).select().single()
      if (error) { if (isMissingTable(error)) return { ok: false, tableMissing: true, error: "Migración pendiente" }; throw error }
      return { ok: true, record: data }
    }
    case "deleteHrScheduleAssignment": {
      const id = textValue(params, "id")
      if (!id) throw new Error("id obligatorio")
      let q = getSupabaseAdmin().from("hr_schedule_assignments").delete().eq("id", id)
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const { error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, tableMissing: true }; throw error }
      return { ok: true }
    }

    // ── HR · Fase 2 · Ponche (admin) ─────────────────────────────────────
    case "getHrPunches": {
      const sb = getSupabaseAdmin()
      let q = sb.from("hr_punches").select("*").order("punched_at", { ascending: false }).limit(500)
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const employeeId = textValue(params, "employee_id")
      if (employeeId) q = q.eq("employee_id", employeeId)
      const sucursal = textValue(params, "sucursal")
      if (sucursal) q = q.eq("sucursal", sucursal)
      const desde = textValue(params, "desde")
      if (desde) q = q.gte("punched_at", desde)
      const hasta = textValue(params, "hasta")
      if (hasta) q = q.lte("punched_at", hasta)
      const { data, error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, records: [], tableMissing: true }; throw error }
      return { ok: true, records: data || [] }
    }
    case "saveHrPunch": {
      const record = parsePayload(params)
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const isCorrection = Boolean(record.is_correction)
      const reason = textFrom(record, "correction_reason")
      if (isCorrection && !reason) throw new Error("Una corrección manual requiere motivo")
      const row: Record<string, unknown> = {
        business_id: businessId,
        employee_id: textFrom(record, "employee_id"),
        type: textFrom(record, "type"),
        punched_at: textFrom(record, "punched_at") || new Date().toISOString(),
        sucursal: textFrom(record, "sucursal") || null,
        source: textFrom(record, "source") || "manual",
        is_correction: isCorrection,
        correction_reason: reason || null,
        approved_by: textFrom(record, "approved_by") || user.id,
        updated_at: new Date().toISOString(),
      }
      if (textFrom(record, "id")) row.id = textFrom(record, "id")
      const { data, error } = await getSupabaseAdmin().from("hr_punches").upsert(row, { onConflict: "id" }).select().single()
      if (error) { if (isMissingTable(error)) return { ok: false, tableMissing: true, error: "Migración pendiente" }; throw error }
      return { ok: true, record: data }
    }
    case "deleteHrPunch": {
      const id = textValue(params, "id")
      if (!id) throw new Error("id obligatorio")
      let q = getSupabaseAdmin().from("hr_punches").delete().eq("id", id)
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const { error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, tableMissing: true }; throw error }
      return { ok: true }
    }

    // ── HR · Fase 2 · Asistencia (consolidación on-read) ─────────────────
    case "getHrAttendance": {
      const sb = getSupabaseAdmin()
      const scope = shouldScopeTenant()
      const bid = effectiveBusinessId()
      const desde = textValue(params, "desde")
      const hasta = textValue(params, "hasta")
      const empF = textValue(params, "employee_id")
      let pq = sb.from("hr_punches").select("employee_id,type,punched_at,sucursal").order("punched_at", { ascending: true })
      if (scope && bid) pq = pq.eq("business_id", bid)
      if (desde) pq = pq.gte("punched_at", desde)
      if (hasta) pq = pq.lte("punched_at", `${hasta}T23:59:59`)
      if (empF) pq = pq.eq("employee_id", empF)
      const { data: punches, error } = await pq
      if (error) { if (isMissingTable(error)) return { ok: true, records: [], tableMissing: true }; throw error }

      let aq = sb.from("hr_schedule_assignments").select("employee_id,schedule_id").is("end_date", null)
      if (scope && bid) aq = aq.eq("business_id", bid)
      const { data: assigns } = await aq
      let sq = sb.from("hr_schedules").select("id,entry_time,late_tolerance_min")
      if (scope && bid) sq = sq.eq("business_id", bid)
      const { data: scheds } = await sq
      type Sched = { id: string; entry_time: string | null; late_tolerance_min: number }
      const schedById = new Map<string, Sched>((scheds || []).map((s) => [String((s as Sched).id), s as Sched]))
      const schedByEmp = new Map<string, Sched | undefined>((assigns || []).map((a) => {
        const row = a as { employee_id: string; schedule_id: string }
        return [String(row.employee_id), schedById.get(String(row.schedule_id))]
      }))

      const TZ = "America/Santo_Domingo"
      type Punch = { employee_id: string; type: string; punched_at: string; sucursal: string | null }
      const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ })
      const minOf = (iso: string) => {
        const t = new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ, hour12: false })
        const [h, m] = t.split(":")
        return Number(h) * 60 + Number(m)
      }
      const groups = new Map<string, { employee_id: string; fecha: string; sucursal: string | null; punches: Punch[] }>()
      for (const raw of (punches || []) as Punch[]) {
        const day = dayOf(raw.punched_at)
        const key = `${raw.employee_id}|${day}`
        if (!groups.has(key)) groups.set(key, { employee_id: raw.employee_id, fecha: day, sucursal: raw.sucursal, punches: [] })
        groups.get(key)!.punches.push(raw)
      }
      const records = [] as Record<string, unknown>[]
      for (const g of groups.values()) {
        const ps = g.punches
        const entrada = ps.find((x) => x.type === "entrada") || ps[0] || null
        const salida = [...ps].reverse().find((x) => x.type === "salida") || (ps.length > 1 ? ps[ps.length - 1] : null)
        const aIni = ps.find((x) => x.type === "almuerzo_inicio")
        const aFin = ps.find((x) => x.type === "almuerzo_fin")
        const entMin = entrada ? minOf(entrada.punched_at) : null
        const salMin = salida ? minOf(salida.punched_at) : null
        let worked = entMin != null && salMin != null ? Math.max(0, salMin - entMin) : 0
        if (aIni && aFin) worked -= Math.max(0, minOf(aFin.punched_at) - minOf(aIni.punched_at))
        const sched = schedByEmp.get(g.employee_id)
        let tarde = 0
        let estado = "presente"
        if (sched?.entry_time && entMin != null) {
          const [eh, em] = String(sched.entry_time).split(":")
          const schedMin = Number(eh) * 60 + Number(em)
          const tol = Number(sched.late_tolerance_min || 0)
          if (entMin > schedMin + tol) { tarde = entMin - schedMin; estado = "tarde" }
        }
        if (!salida) estado = "incompleto"
        records.push({
          employee_id: g.employee_id, fecha: g.fecha, sucursal: g.sucursal,
          entrada: entrada?.punched_at || null, salida: salida?.punched_at || null,
          minutos_trabajados: Math.max(0, worked), tarde_min: tarde, estado, marcas: ps.length,
        })
      }
      records.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || String(a.employee_id).localeCompare(String(b.employee_id)))
      return { ok: true, records }
    }

    // ── HR · Fase 2 · PIN de empleado + kiosco ───────────────────────────
    case "setHrEmployeePin": {
      const employeeId = textValue(params, "employee_id")
      const pin = textValue(params, "pin")
      if (!employeeId) throw new Error("employee_id obligatorio")
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      // pin vacío => limpiar (deshabilitar ponche por PIN para ese empleado)
      const pinHash = pin ? hrSha256(`${businessId}:${pin}`) : null
      let q = getSupabaseAdmin().from("csl_empleados").update({ hr_pin_hash: pinHash }).eq("empleado_id", employeeId)
      if (shouldScopeTenant()) q = q.eq("business_id", businessId)
      const { error } = await q
      if (error) throw error
      return { ok: true }
    }
    case "punchByPin": {
      const pin = textValue(params, "pin")
      const businessId = effectiveBusinessId()
      if (!pin) throw new Error("PIN obligatorio")
      if (!businessId) throw new Error("business_id no encontrado")
      const sb = getSupabaseAdmin()
      const pinHash = hrSha256(`${businessId}:${pin}`)
      const { data: emp, error: empErr } = await sb
        .from("csl_empleados")
        .select("empleado_id, nombre, apellido")
        .eq("business_id", businessId)
        .eq("hr_pin_hash", pinHash)
        .maybeSingle()
      if (empErr) throw empErr
      if (!emp) return { ok: false, error: "PIN no válido" }
      // Sucursal: se deriva de la asignación de horario vigente (csl_empleados
      // no tiene columna sucursal). Si no hay, queda null.
      const { data: asg } = await sb
        .from("hr_schedule_assignments")
        .select("sucursal")
        .eq("business_id", businessId)
        .eq("employee_id", emp.empleado_id)
        .is("end_date", null)
        .maybeSingle()
      const empSucursal = (asg as { sucursal?: string } | null)?.sucursal ?? null
      // Inferir el próximo tipo de marca según la última del día.
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
      const { data: lastRows } = await sb
        .from("hr_punches")
        .select("type, punched_at")
        .eq("business_id", businessId)
        .eq("employee_id", emp.empleado_id)
        .gte("punched_at", dayStart.toISOString())
        .order("punched_at", { ascending: false })
        .limit(1)
      const last = lastRows && lastRows[0] ? String(lastRows[0].type) : null
      const NEXT: Record<string, string> = {
        "": "entrada",
        entrada: "almuerzo_inicio",
        almuerzo_inicio: "almuerzo_fin",
        almuerzo_fin: "salida",
        salida: "entrada",
        salida_autorizada: "entrada",
      }
      const nextType = NEXT[last ?? ""] ?? "entrada"
      const { data: punch, error: punchErr } = await sb
        .from("hr_punches")
        .insert({
          business_id: businessId,
          employee_id: emp.empleado_id,
          type: nextType,
          sucursal: empSucursal,
          source: "kiosk",
          device_info: textValue(params, "device_info") || null,
        })
        .select()
        .single()
      if (punchErr) { if (isMissingTable(punchErr)) return { ok: false, tableMissing: true, error: "Migración pendiente" }; throw punchErr }
      return {
        ok: true,
        record: punch,
        empleado: `${emp.nombre ?? ""} ${emp.apellido ?? ""}`.trim(),
        tipo: nextType,
      }
    }

    // ── HR · Fase 2 · Permisos y licencias ───────────────────────────────
    case "getHrLeaves": {
      const sb = getSupabaseAdmin()
      let q = sb.from("hr_leave_requests").select("*").order("start_date", { ascending: false })
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const employeeId = textValue(params, "employee_id")
      if (employeeId) q = q.eq("employee_id", employeeId)
      const status = textValue(params, "status")
      if (status) q = q.eq("status", status)
      const { data, error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, records: [], tableMissing: true }; throw error }
      return { ok: true, records: data || [] }
    }
    case "saveHrLeave": {
      const record = parsePayload(params)
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const status = textFrom(record, "status") || "pendiente"
      const row: Record<string, unknown> = {
        business_id: businessId,
        employee_id: textFrom(record, "employee_id"),
        leave_type: textFrom(record, "leave_type") || "personal_con_disfrute",
        start_date: textFrom(record, "start_date"),
        end_date: textFrom(record, "end_date"),
        days: record.days != null ? numberFrom(record, "days") : 0,
        reason: textFrom(record, "reason") || null,
        evidence_url: textFrom(record, "evidence_url") || null,
        impact: textFrom(record, "impact") || "no_aplica",
        status,
        observations: textFrom(record, "observations") || null,
        created_by: textFrom(record, "created_by") || user.id,
        updated_at: new Date().toISOString(),
      }
      // Al aprobar/rechazar, sellar quién y cuándo.
      if (status === "aprobado" || status === "rechazado") {
        row.approved_by = user.id
        row.approved_at = new Date().toISOString()
      }
      if (textFrom(record, "id")) row.id = textFrom(record, "id")
      const { data, error } = await getSupabaseAdmin().from("hr_leave_requests").upsert(row, { onConflict: "id" }).select().single()
      if (error) { if (isMissingTable(error)) return { ok: false, tableMissing: true, error: "Migración pendiente" }; throw error }
      return { ok: true, record: data }
    }
    case "deleteHrLeave": {
      const id = textValue(params, "id")
      if (!id) throw new Error("id obligatorio")
      let q = getSupabaseAdmin().from("hr_leave_requests").delete().eq("id", id)
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const { error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, tableMissing: true }; throw error }
      return { ok: true }
    }

    // ── HR · Fase 3 · Días laborados ─────────────────────────────────────
    case "getHrDiasLaborados": {
      const sb = getSupabaseAdmin()
      let q = sb.from("hr_dias_laborados").select("*").order("created_at", { ascending: false })
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const est = textValue(params, "estado"); if (est) q = q.eq("estado", est)
      const emp = textValue(params, "employee_id"); if (emp) q = q.eq("employee_id", emp)
      const { data, error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, records: [], tableMissing: true }; throw error }
      return { ok: true, records: data || [] }
    }
    case "getHrDiasSugeridos": {
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const employeeId = textValue(params, "employee_id")
      if (!employeeId) throw new Error("employee_id obligatorio")
      const ps = textValue(params, "period_start")
      const pe = textValue(params, "period_end")
      const sueldoMensual = round2(await salarioVigente(businessId, employeeId))
      const dias = ps && pe ? await diasDesdeAsistencia(businessId, employeeId, ps, pe) : 0
      const { data: emp } = await getSupabaseAdmin()
        .from("csl_empleados").select("nombre, apellido")
        .eq("business_id", businessId).eq("empleado_id", employeeId).maybeSingle()
      const e = emp as { nombre?: string; apellido?: string } | null
      const nombre = e ? `${e.nombre ?? ""} ${e.apellido ?? ""}`.trim() : employeeId
      return { ok: true, employee_nombre: nombre, sueldo_mensual: sueldoMensual, sueldo_diario: round2(sueldoMensual / HR_DAILY_BASE), dias_sugeridos: dias }
    }
    case "saveHrDiaLaborado": {
      const record = parsePayload(params)
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const employeeId = textFrom(record, "employee_id")
      if (!employeeId) throw new Error("Empleado obligatorio")
      const periodStart = textFrom(record, "period_start")
      const periodEnd = textFrom(record, "period_end")
      if (!periodStart || !periodEnd) throw new Error("Período obligatorio")
      const diasOrigen = textFrom(record, "dias_origen") || "manual"
      const dias = numberFrom(record, "dias_laborados")
      const editReason = textFrom(record, "edit_reason")
      // Edición manual de días → motivo obligatorio.
      if (diasOrigen === "manual" && !editReason) throw new Error("La edición manual de días requiere un motivo")
      const sueldoMensual = record.sueldo_mensual != null && Number(record.sueldo_mensual) > 0
        ? round2(numberFrom(record, "sueldo_mensual"))
        : round2(await salarioVigente(businessId, employeeId))
      const sueldoDiario = round2(sueldoMensual / HR_DAILY_BASE)  // base 23.83
      const ingresos = round2(numberFrom(record, "ingresos"))
      const descuentos = round2(numberFrom(record, "descuentos"))
      const pagoDias = round2(sueldoDiario * dias)
      const total = round2(pagoDias + ingresos - descuentos)
      const estado = textFrom(record, "estado") || "borrador"
      let nombre = textFrom(record, "employee_nombre")
      if (!nombre) {
        const { data: emp } = await getSupabaseAdmin()
          .from("csl_empleados").select("nombre, apellido")
          .eq("business_id", businessId).eq("empleado_id", employeeId).maybeSingle()
        const e = emp as { nombre?: string; apellido?: string } | null
        nombre = e ? `${e.nombre ?? ""} ${e.apellido ?? ""}`.trim() : employeeId
      }
      const id = textFrom(record, "id")
      let oldValues: unknown = null
      if (id) {
        const { data: prev } = await getSupabaseAdmin().from("hr_dias_laborados").select("*").eq("id", id).maybeSingle()
        oldValues = prev ?? null
      }
      const row: Record<string, unknown> = {
        business_id: businessId, employee_id: employeeId, employee_nombre: nombre,
        period_start: periodStart, period_end: periodEnd,
        sucursal: textFrom(record, "sucursal") || null,
        sueldo_mensual: sueldoMensual, sueldo_diario: sueldoDiario,
        dias_laborados: dias, dias_origen: diasOrigen, edit_reason: editReason || null,
        ingresos, ingresos_detalle: textFrom(record, "ingresos_detalle") || null,
        descuentos, descuentos_detalle: textFrom(record, "descuentos_detalle") || null,
        pago_dias: pagoDias, total, estado,
        observations: textFrom(record, "observations") || null,
        created_by: textFrom(record, "created_by") || user.id,
        updated_at: new Date().toISOString(),
      }
      if (estado === "aprobado") { row.approved_by = user.id; row.approved_at = new Date().toISOString() }
      if (id) row.id = id
      const { data, error } = await getSupabaseAdmin().from("hr_dias_laborados").upsert(row, { onConflict: "id" }).select().single()
      if (error) { if (isMissingTable(error)) return { ok: false, tableMissing: true, error: "Migración pendiente" }; throw error }
      const saved = data as { id: string }
      const action = estado === "aprobado" ? "approve" : (id ? "update" : "create")
      await hrAudit(user, "dias_laborados", action, "hr_dias_laborados", String(saved.id), oldValues, data)
      return { ok: true, record: data }
    }
    case "deleteHrDiaLaborado": {
      const id = textValue(params, "id")
      if (!id) throw new Error("id obligatorio")
      let q = getSupabaseAdmin().from("hr_dias_laborados").delete().eq("id", id)
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const { error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, tableMissing: true }; throw error }
      await hrAudit(user, "dias_laborados", "delete", "hr_dias_laborados", id, null, null)
      return { ok: true }
    }

    // ── HR · Fase 3 · Préstamos y avances ────────────────────────────────
    case "getHrLoans": {
      const sb = getSupabaseAdmin()
      let q = sb.from("hr_loans").select("*").order("created_at", { ascending: false })
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const emp = textValue(params, "employee_id"); if (emp) q = q.eq("employee_id", emp)
      const est = textValue(params, "status"); if (est) q = q.eq("status", est)
      const { data, error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, records: [], tableMissing: true }; throw error }
      return { ok: true, records: data || [] }
    }
    case "getHrLoanPayments": {
      const loanId = textValue(params, "loan_id")
      const sb = getSupabaseAdmin()
      let q = sb.from("hr_loan_payments").select("*").order("fecha", { ascending: false })
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      if (loanId) q = q.eq("loan_id", loanId)
      const { data, error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, records: [], tableMissing: true }; throw error }
      return { ok: true, records: data || [] }
    }
    case "saveHrLoan": {
      const record = parsePayload(params)
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const employeeId = textFrom(record, "employee_id")
      if (!employeeId) throw new Error("Empleado obligatorio")
      const principal = round2(numberFrom(record, "principal"))
      if (principal <= 0) throw new Error("El monto del préstamo debe ser mayor a 0")
      const cuotas = Math.max(1, Math.round(numberFrom(record, "cuotas") || 1))
      const montoCuota = record.monto_cuota != null && Number(record.monto_cuota) > 0
        ? round2(numberFrom(record, "monto_cuota")) : round2(principal / cuotas)
      const sb = getSupabaseAdmin()
      const id = textFrom(record, "id")
      let nombre = textFrom(record, "employee_nombre")
      if (!nombre) {
        const { data: emp } = await sb.from("csl_empleados").select("nombre, apellido").eq("business_id", businessId).eq("empleado_id", employeeId).maybeSingle()
        const e = emp as { nombre?: string; apellido?: string } | null
        nombre = e ? `${e.nombre ?? ""} ${e.apellido ?? ""}`.trim() : employeeId
      }
      let oldValues: unknown = null
      let paid = 0
      if (id) {
        const { data: prev } = await sb.from("hr_loans").select("*").eq("id", id).maybeSingle()
        oldValues = prev ?? null
        const { data: pays } = await sb.from("hr_loan_payments").select("monto").eq("loan_id", id)
        paid = (pays || []).reduce((s, p) => s + Number((p as { monto?: number }).monto || 0), 0)
      }
      const balance = round2(Math.max(0, principal - paid))
      const status = textFrom(record, "status") || (balance <= 0 && id ? "pagado" : "activo")
      const row: Record<string, unknown> = {
        business_id: businessId, employee_id: employeeId, employee_nombre: nombre,
        principal, cuotas, monto_cuota: montoCuota, balance,
        descripcion: textFrom(record, "descripcion") || null,
        status,
        start_date: textFrom(record, "start_date") || new Date().toISOString().slice(0, 10),
        created_by: textFrom(record, "created_by") || user.id,
        updated_at: new Date().toISOString(),
      }
      if (id) row.id = id
      const { data, error } = await sb.from("hr_loans").upsert(row, { onConflict: "id" }).select().single()
      if (error) { if (isMissingTable(error)) return { ok: false, tableMissing: true, error: "Migración pendiente" }; throw error }
      const saved = data as { id: string }
      await hrAudit(user, "prestamos", id ? "update" : "create", "hr_loans", String(saved.id), oldValues, data)
      return { ok: true, record: data }
    }
    case "addHrLoanPayment": {
      const record = parsePayload(params)
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const loanId = textFrom(record, "loan_id")
      const monto = round2(numberFrom(record, "monto"))
      if (!loanId || monto <= 0) throw new Error("Préstamo y monto válidos son obligatorios")
      const sb = getSupabaseAdmin()
      const { data: loan } = await sb.from("hr_loans").select("principal, status, business_id").eq("id", loanId).maybeSingle()
      if (!loan) throw new Error("Préstamo no encontrado")
      const l = loan as { principal: number; status: string; business_id: string }
      if (shouldScopeTenant() && l.business_id !== businessId) throw new Error("Préstamo de otro negocio")
      const { error: insErr } = await sb.from("hr_loan_payments").insert({
        business_id: l.business_id, loan_id: loanId, monto,
        fecha: textFrom(record, "fecha") || new Date().toISOString().slice(0, 10),
        tipo: textFrom(record, "tipo") || "extra",
        notes: textFrom(record, "notes") || null,
        created_by: user.id,
      })
      if (insErr) { if (isMissingTable(insErr)) return { ok: false, tableMissing: true, error: "Migración pendiente" }; throw insErr }
      const { data: pays } = await sb.from("hr_loan_payments").select("monto").eq("loan_id", loanId)
      const paid = (pays || []).reduce((s, p) => s + Number((p as { monto?: number }).monto || 0), 0)
      const balance = round2(Math.max(0, Number(l.principal) - paid))
      const newStatus = l.status === "cancelado" ? "cancelado" : (balance <= 0 ? "pagado" : "activo")
      await sb.from("hr_loans").update({ balance, status: newStatus, updated_at: new Date().toISOString() }).eq("id", loanId)
      await hrAudit(user, "prestamos", "payment", "hr_loans", loanId, { balance_anterior: round2(Number(l.principal) - (paid - monto)) }, { monto, balance, status: newStatus })
      return { ok: true, balance, status: newStatus }
    }
    case "deleteHrLoan": {
      const id = textValue(params, "id")
      if (!id) throw new Error("id obligatorio")
      let q = getSupabaseAdmin().from("hr_loans").delete().eq("id", id)
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const { error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, tableMissing: true }; throw error }
      await hrAudit(user, "prestamos", "delete", "hr_loans", id, null, null)
      return { ok: true }
    }

    // ── HR · Fase 3 · Incentivos y comisiones ────────────────────────────
    case "getHrIncentives": {
      const sb = getSupabaseAdmin()
      let q = sb.from("hr_incentives").select("*").order("created_at", { ascending: false })
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const emp = textValue(params, "employee_id"); if (emp) q = q.eq("employee_id", emp)
      const est = textValue(params, "status"); if (est) q = q.eq("status", est)
      const { data, error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, records: [], tableMissing: true }; throw error }
      return { ok: true, records: data || [] }
    }
    case "saveHrIncentive": {
      const record = parsePayload(params)
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const employeeId = textFrom(record, "employee_id")
      if (!employeeId) throw new Error("Empleado obligatorio")
      const monto = round2(numberFrom(record, "monto"))
      if (monto <= 0) throw new Error("El monto debe ser mayor a 0")
      const sb = getSupabaseAdmin()
      const id = textFrom(record, "id")
      let nombre = textFrom(record, "employee_nombre")
      if (!nombre) {
        const { data: emp } = await sb.from("csl_empleados").select("nombre, apellido").eq("business_id", businessId).eq("empleado_id", employeeId).maybeSingle()
        const e = emp as { nombre?: string; apellido?: string } | null
        nombre = e ? `${e.nombre ?? ""} ${e.apellido ?? ""}`.trim() : employeeId
      }
      let oldValues: unknown = null
      if (id) { const { data: prev } = await sb.from("hr_incentives").select("*").eq("id", id).maybeSingle(); oldValues = prev ?? null }
      const status = textFrom(record, "status") || "pendiente"
      const row: Record<string, unknown> = {
        business_id: businessId, employee_id: employeeId, employee_nombre: nombre,
        tipo: textFrom(record, "tipo") || "comision",
        monto,
        periodo: textFrom(record, "periodo") || null,
        descripcion: textFrom(record, "descripcion") || null,
        salida: textFrom(record, "salida") || "nomina",
        status,
        created_by: textFrom(record, "created_by") || user.id,
        updated_at: new Date().toISOString(),
      }
      if (status === "aprobado") { row.approved_by = user.id; row.approved_at = new Date().toISOString() }
      if (id) row.id = id
      const { data, error } = await sb.from("hr_incentives").upsert(row, { onConflict: "id" }).select().single()
      if (error) { if (isMissingTable(error)) return { ok: false, tableMissing: true, error: "Migración pendiente" }; throw error }
      const saved = data as { id: string }
      await hrAudit(user, "incentivos", status === "aprobado" ? "approve" : (id ? "update" : "create"), "hr_incentives", String(saved.id), oldValues, data)
      return { ok: true, record: data }
    }
    case "deleteHrIncentive": {
      const id = textValue(params, "id")
      if (!id) throw new Error("id obligatorio")
      let q = getSupabaseAdmin().from("hr_incentives").delete().eq("id", id)
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const { error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, tableMissing: true }; throw error }
      await hrAudit(user, "incentivos", "delete", "hr_incentives", id, null, null)
      return { ok: true }
    }

    // ── HR · Fase 3 · Nómina ─────────────────────────────────────────────
    case "getHrPayrollConfig": {
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const sb = getSupabaseAdmin()
      const { data, error } = await sb.from("hr_payroll_config").select("*").eq("business_id", businessId).maybeSingle()
      if (error) { if (isMissingTable(error)) return { ok: true, config: null, tableMissing: true }; throw error }
      return { ok: true, config: data || null }
    }
    case "saveHrPayrollConfig": {
      const record = parsePayload(params)
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const sb = getSupabaseAdmin()
      const { data: prev } = await sb.from("hr_payroll_config").select("*").eq("business_id", businessId).maybeSingle()
      const row: Record<string, unknown> = {
        business_id: businessId,
        daily_base: record.daily_base != null ? numberFrom(record, "daily_base") : 23.83,
        afp_rate: record.afp_rate != null ? numberFrom(record, "afp_rate") : 0.0287,
        sfs_rate: record.sfs_rate != null ? numberFrom(record, "sfs_rate") : 0.0304,
        afp_cap: record.afp_cap != null ? numberFrom(record, "afp_cap") : 0,
        sfs_cap: record.sfs_cap != null ? numberFrom(record, "sfs_cap") : 0,
        verificado: Boolean(record.verificado),
        bank_origin_account: textFrom(record, "bank_origin_account") || null,
        bank_origin_name: textFrom(record, "bank_origin_name") || null,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      }
      if (record.isr_brackets) row.isr_brackets = record.isr_brackets
      const { data, error } = await sb.from("hr_payroll_config").upsert(row, { onConflict: "business_id" }).select().single()
      if (error) { if (isMissingTable(error)) return { ok: false, tableMissing: true, error: "Migración pendiente" }; throw error }
      await hrAudit(user, "nomina", "config_update", "hr_payroll_config", businessId, prev ?? null, data)
      return { ok: true, config: data }
    }
    case "getHrPayrollRuns": {
      const sb = getSupabaseAdmin()
      let q = sb.from("hr_payroll_runs").select("*").order("period_start", { ascending: false })
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const { data, error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, records: [], tableMissing: true }; throw error }
      return { ok: true, records: data || [] }
    }
    case "getHrPayrollRun": {
      const runId = textValue(params, "id")
      if (!runId) throw new Error("id obligatorio")
      const sb = getSupabaseAdmin()
      const { data: run } = await sb.from("hr_payroll_runs").select("*").eq("id", runId).maybeSingle()
      const { data: items } = await sb.from("hr_payroll_items").select("*").eq("run_id", runId).order("employee_nombre", { ascending: true })
      return { ok: true, run: run || null, items: items || [] }
    }
    case "createHrPayrollRun": {
      const record = parsePayload(params)
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const sb = getSupabaseAdmin()
      const periodStart = textFrom(record, "period_start")
      const periodEnd = textFrom(record, "period_end")
      if (!periodStart || !periodEnd) throw new Error("Período obligatorio")
      const tipo = textFrom(record, "tipo") || "quincenal"
      const factor = tipo === "quincenal" ? 0.5 : 1
      // Config (tasas)
      const { data: cfg } = await sb.from("hr_payroll_config").select("*").eq("business_id", businessId).maybeSingle()
      const c = (cfg || {}) as { afp_rate?: number; sfs_rate?: number; afp_cap?: number; sfs_cap?: number; isr_brackets?: Array<{ li: number; ls: number | null; tasa: number; cuota: number }> }
      const afpRate = Number(c.afp_rate ?? 0.0287), sfsRate = Number(c.sfs_rate ?? 0.0304)
      const afpCap = Number(c.afp_cap ?? 0), sfsCap = Number(c.sfs_cap ?? 0)
      const isrBrackets = Array.isArray(c.isr_brackets) ? c.isr_brackets : []
      // Crear (o reusar) la corrida en estado calculada
      const runId = textFrom(record, "id")
      let run: { id: string }
      if (runId) {
        const { data: existing } = await sb.from("hr_payroll_runs").select("status").eq("id", runId).maybeSingle()
        const st = (existing as { status?: string } | null)?.status
        if (st && !["borrador", "calculada", "revision"].includes(st)) throw new Error("Solo se puede recalcular una corrida en borrador/cálculo/revisión")
        await sb.from("hr_payroll_items").delete().eq("run_id", runId)
        const { data: upd } = await sb.from("hr_payroll_runs").update({ period_start: periodStart, period_end: periodEnd, tipo, sucursal: textFrom(record, "sucursal") || null, status: "calculada", updated_at: new Date().toISOString() }).eq("id", runId).select().single()
        run = upd as { id: string }
      } else {
        const { data: ins, error: insErr } = await sb.from("hr_payroll_runs").insert({ business_id: businessId, period_start: periodStart, period_end: periodEnd, tipo, sucursal: textFrom(record, "sucursal") || null, status: "calculada", created_by: user.id }).select().single()
        if (insErr) { if (isMissingTable(insErr)) return { ok: false, tableMissing: true, error: "Migración pendiente" }; throw insErr }
        run = ins as { id: string }
      }
      // Empleados con salario > 0
      const { data: emps } = await sb.from("csl_empleados").select("empleado_id, nombre, apellido, salario").eq("business_id", businessId)
      const items: Record<string, unknown>[] = []
      const totals = { bruto: 0, deducciones: 0, neto: 0, empleados: 0 }
      for (const e of (emps || []) as Array<{ empleado_id: string; nombre?: string; apellido?: string; salario?: number }>) {
        const sueldoMensual = round2(await salarioVigente(businessId, e.empleado_id))
        if (sueldoMensual <= 0) continue
        const basePeriodo = round2(sueldoMensual * factor)
        const afpBase = afpCap > 0 ? Math.min(sueldoMensual, afpCap) : sueldoMensual
        const sfsBase = sfsCap > 0 ? Math.min(sueldoMensual, sfsCap) : sueldoMensual
        const afpMensual = round2(afpBase * afpRate)
        const sfsMensual = round2(sfsBase * sfsRate)
        const annualTaxable = (sueldoMensual - afpMensual - sfsMensual) * 12
        const isrMensual = round2(applyIsrAnnual(annualTaxable, isrBrackets) / 12)
        const afp = round2(afpMensual * factor), sfs = round2(sfsMensual * factor), isr = round2(isrMensual * factor)
        // Incentivos aprobados a nómina (no pagados)
        const { data: incs } = await sb.from("hr_incentives").select("id, monto").eq("business_id", businessId).eq("employee_id", e.empleado_id).eq("status", "aprobado").eq("salida", "nomina")
        const incentiveRows = (incs || []) as Array<{ id: string; monto: number }>
        const incentivos = round2(incentiveRows.reduce((s, i) => s + Number(i.monto || 0), 0))
        // Préstamos activos: cuota (cap balance)
        const { data: loans } = await sb.from("hr_loans").select("id, monto_cuota, balance").eq("business_id", businessId).eq("employee_id", e.empleado_id).eq("status", "activo")
        const loanRows = (loans || []) as Array<{ id: string; monto_cuota: number; balance: number }>
        const loanDeductions = loanRows.map(l => ({ loan_id: l.id, monto: round2(Math.min(Number(l.monto_cuota || 0), Number(l.balance || 0))) })).filter(d => d.monto > 0)
        const prestamos = round2(loanDeductions.reduce((s, d) => s + d.monto, 0))
        const bruto = round2(basePeriodo + incentivos)
        const totalDed = round2(afp + sfs + isr + prestamos)
        const neto = round2(bruto - totalDed)
        items.push({
          business_id: businessId, run_id: run.id, employee_id: e.empleado_id,
          employee_nombre: `${e.nombre ?? ""} ${e.apellido ?? ""}`.trim() || e.empleado_id,
          sueldo_mensual: sueldoMensual, base_periodo: basePeriodo, incentivos,
          afp, sfs, isr, prestamos, bruto, total_deducciones: totalDed, neto,
          detalle: { incentive_ids: incentiveRows.map(i => i.id), loan_deductions: loanDeductions },
        })
        totals.bruto = round2(totals.bruto + bruto)
        totals.deducciones = round2(totals.deducciones + totalDed)
        totals.neto = round2(totals.neto + neto)
        totals.empleados += 1
      }
      if (items.length) await sb.from("hr_payroll_items").insert(items)
      await sb.from("hr_payroll_runs").update({ totals, updated_at: new Date().toISOString() }).eq("id", run.id)
      await hrAudit(user, "nomina", runId ? "recalc" : "create", "hr_payroll_runs", run.id, null, { period: `${periodStart}/${periodEnd}`, tipo, ...totals })
      return { ok: true, run_id: run.id, totals, empleados: totals.empleados }
    }
    case "setHrPayrollStatus": {
      const runId = textValue(params, "id")
      const status = textValue(params, "status")
      if (!runId || !status) throw new Error("id y status obligatorios")
      const sb = getSupabaseAdmin()
      const { data: run } = await sb.from("hr_payroll_runs").select("*").eq("id", runId).maybeSingle()
      if (!run) throw new Error("Corrida no encontrada")
      const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
      // Al APROBAR: marcar incentivos como pagados y registrar cuotas de préstamo.
      if (status === "aprobada") {
        update.approved_by = user.id
        update.approved_at = new Date().toISOString()
        const { data: items } = await sb.from("hr_payroll_items").select("detalle").eq("run_id", runId)
        for (const it of (items || []) as Array<{ detalle?: { incentive_ids?: string[]; loan_deductions?: Array<{ loan_id: string; monto: number }> } }>) {
          const det = it.detalle || {}
          for (const incId of det.incentive_ids || []) {
            await sb.from("hr_incentives").update({ status: "pagado", updated_at: new Date().toISOString() }).eq("id", incId)
          }
          for (const ld of det.loan_deductions || []) {
            await sb.from("hr_loan_payments").insert({ business_id: (run as { business_id: string }).business_id, loan_id: ld.loan_id, monto: ld.monto, tipo: "nomina", notes: `Nómina ${runId}` })
            const { data: pays } = await sb.from("hr_loan_payments").select("monto").eq("loan_id", ld.loan_id)
            const { data: loan } = await sb.from("hr_loans").select("principal, status").eq("id", ld.loan_id).maybeSingle()
            const principal = Number((loan as { principal?: number } | null)?.principal ?? 0)
            const paid = (pays || []).reduce((s, p) => s + Number((p as { monto?: number }).monto || 0), 0)
            const balance = round2(Math.max(0, principal - paid))
            const lstatus = (loan as { status?: string } | null)?.status === "cancelado" ? "cancelado" : (balance <= 0 ? "pagado" : "activo")
            await sb.from("hr_loans").update({ balance, status: lstatus, updated_at: new Date().toISOString() }).eq("id", ld.loan_id)
          }
        }
      }
      const { data, error } = await sb.from("hr_payroll_runs").update(update).eq("id", runId).select().single()
      if (error) throw error
      await hrAudit(user, "nomina", status === "aprobada" ? "approve" : "status", "hr_payroll_runs", runId, { status: (run as { status?: string }).status }, { status })
      return { ok: true, run: data }
    }
    case "deleteHrPayrollRun": {
      const id = textValue(params, "id")
      if (!id) throw new Error("id obligatorio")
      const sb = getSupabaseAdmin()
      const { data: run } = await sb.from("hr_payroll_runs").select("status").eq("id", id).maybeSingle()
      if ((run as { status?: string } | null)?.status === "aprobada" || (run as { status?: string } | null)?.status === "pagada") {
        return { ok: false, error: "No se puede eliminar una corrida aprobada/pagada" }
      }
      let q = sb.from("hr_payroll_runs").delete().eq("id", id)
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const { error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, tableMissing: true }; throw error }
      await hrAudit(user, "nomina", "delete", "hr_payroll_runs", id, null, null)
      return { ok: true }
    }

    // ── HR · Fase 3 · Cuentas bancarias ──────────────────────────────────
    case "getHrBankAccounts": {
      const sb = getSupabaseAdmin()
      let q = sb.from("hr_employee_bank_accounts").select("*").order("created_at", { ascending: false })
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const emp = textValue(params, "employee_id"); if (emp) q = q.eq("employee_id", emp)
      const { data, error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, records: [], tableMissing: true }; throw error }
      return { ok: true, records: data || [] }
    }
    case "saveHrBankAccount": {
      const record = parsePayload(params)
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const employeeId = textFrom(record, "employee_id")
      if (!employeeId) throw new Error("Empleado obligatorio")
      const account = textFrom(record, "account_number")
      if (!account) throw new Error("Número de cuenta obligatorio")
      const sb = getSupabaseAdmin()
      const isPrimary = record.is_primary == null ? true : Boolean(record.is_primary)
      // Si es primaria, desmarcar las otras del empleado.
      if (isPrimary) {
        await sb.from("hr_employee_bank_accounts").update({ is_primary: false }).eq("business_id", businessId).eq("employee_id", employeeId)
      }
      const row: Record<string, unknown> = {
        business_id: businessId, employee_id: employeeId,
        bank_name: textFrom(record, "bank_name") || "—",
        account_number: account,
        account_type: textFrom(record, "account_type") || "Ahorro",
        beneficiary: textFrom(record, "beneficiary") || null,
        is_primary: isPrimary,
        active: record.active == null ? true : Boolean(record.active),
        notes: textFrom(record, "notes") || null,
        updated_at: new Date().toISOString(),
      }
      if (textFrom(record, "id")) row.id = textFrom(record, "id")
      const { data, error } = await sb.from("hr_employee_bank_accounts").upsert(row, { onConflict: "id" }).select().single()
      if (error) { if (isMissingTable(error)) return { ok: false, tableMissing: true, error: "Migración pendiente" }; throw error }
      const saved = data as { id: string }
      await hrAudit(user, "txt_bancarios", textFrom(record, "id") ? "update" : "create", "hr_employee_bank_accounts", String(saved.id), null, data)
      return { ok: true, record: data }
    }
    case "deleteHrBankAccount": {
      const id = textValue(params, "id")
      if (!id) throw new Error("id obligatorio")
      let q = getSupabaseAdmin().from("hr_employee_bank_accounts").delete().eq("id", id)
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const { error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, tableMissing: true }; throw error }
      await hrAudit(user, "txt_bancarios", "delete_account", "hr_employee_bank_accounts", id, null, null)
      return { ok: true }
    }

    // ── HR · Fase 3 · Archivos TXT bancarios ─────────────────────────────
    case "getHrBankTxtFiles": {
      const sb = getSupabaseAdmin()
      let q = sb.from("hr_bank_txt_files").select("id, origen, run_id, filename, total, lineas, status, created_at").order("created_at", { ascending: false })
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const { data, error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, records: [], tableMissing: true }; throw error }
      return { ok: true, records: data || [] }
    }
    case "getHrBankTxtFile": {
      const id = textValue(params, "id")
      if (!id) throw new Error("id obligatorio")
      const sb = getSupabaseAdmin()
      let q = sb.from("hr_bank_txt_files").select("*").eq("id", id)
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const { data, error } = await q.maybeSingle()
      if (error) throw error
      return { ok: true, record: data || null }
    }
    case "generateBankTxt": {
      const runId = textValue(params, "run_id")
      if (!runId) throw new Error("run_id obligatorio")
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const ctx = getBusinessContext()
      const sb = getSupabaseAdmin()
      const { data: run } = await sb.from("hr_payroll_runs").select("*").eq("id", runId).maybeSingle()
      if (!run) throw new Error("Corrida no encontrada")
      const r = run as { status: string; sucursal: string | null; period_end: string }
      if (r.status !== "aprobada" && r.status !== "pagada") {
        return { ok: false, error: "Solo se genera TXT de una corrida aprobada" }
      }
      const { data: cfg } = await sb.from("hr_payroll_config").select("bank_origin_account").eq("business_id", businessId).maybeSingle()
      const origin = (cfg as { bank_origin_account?: string } | null)?.bank_origin_account || ""
      if (!origin) return { ok: false, error: "Configura la cuenta origen de la empresa (Nómina → Configuración) antes de generar el TXT" }
      const { data: items } = await sb.from("hr_payroll_items").select("employee_id, employee_nombre, neto").eq("run_id", runId)
      const lines: string[] = []
      const omitidos: string[] = []
      let total = 0
      for (const it of (items || []) as Array<{ employee_id: string; employee_nombre: string | null; neto: number }>) {
        const neto = Number(it.neto || 0)
        if (neto <= 0) continue
        const { data: acct } = await sb.from("hr_employee_bank_accounts").select("account_number, beneficiary").eq("business_id", businessId).eq("employee_id", it.employee_id).eq("is_primary", true).eq("active", true).maybeSingle()
        const a = acct as { account_number?: string; beneficiary?: string } | null
        if (!a?.account_number) { omitidos.push(it.employee_nombre || it.employee_id); continue }
        const nombre = (a.beneficiary || it.employee_nombre || it.employee_id).toUpperCase()
        lines.push(`${origin},${a.account_number},${neto.toFixed(2)},${nombre}`)
        total = round2(total + neto)
      }
      const content = lines.join("\n")
      if (!lines.length) return { ok: false, error: "No hay empleados con cuenta bancaria primaria activa para esta corrida", omitidos }
      const hash = hrSha256(content)
      const slug = (ctx?.businessSlug || "csl").toUpperCase()
      const suc = (r.sucursal || "TODAS").toUpperCase().replace(/\s+/g, "_")
      const filename = `NOMINA_${slug}_${suc}_${r.period_end}.txt`
      // Idempotencia: si ya existe ese hash, devolver el registro existente.
      const { data: existing } = await sb.from("hr_bank_txt_files").select("id, filename, content, total, lineas").eq("business_id", businessId).eq("hash", hash).maybeSingle()
      if (existing) {
        const e = existing as { id: string; filename: string; content: string; total: number; lineas: number }
        return { ok: true, duplicado: true, id: e.id, filename: e.filename, content: e.content, total: e.total, lineas: e.lineas, omitidos }
      }
      const { data: ins, error: insErr } = await sb.from("hr_bank_txt_files").insert({
        business_id: businessId, origen: "nomina", run_id: runId, filename, hash, total, lineas: lines.length, content, created_by: user.id,
      }).select("id").single()
      if (insErr) { if (isMissingTable(insErr)) return { ok: false, tableMissing: true, error: "Migración pendiente" }; throw insErr }
      await hrAudit(user, "txt_bancarios", "generate", "hr_bank_txt_files", String((ins as { id: string }).id), null, { filename, total, lineas: lines.length, run_id: runId })
      return { ok: true, id: (ins as { id: string }).id, filename, content, total, lineas: lines.length, omitidos }
    }

    // ── HR · Fase 3 · Vacaciones ─────────────────────────────────────────
    case "getHrVacations": {
      const sb = getSupabaseAdmin()
      let q = sb.from("hr_vacations").select("*").order("created_at", { ascending: false })
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const emp = textValue(params, "employee_id"); if (emp) q = q.eq("employee_id", emp)
      const { data, error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, records: [], tableMissing: true }; throw error }
      return { ok: true, records: data || [] }
    }
    case "saveHrVacation": {
      const record = parsePayload(params)
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const employeeId = textFrom(record, "employee_id")
      if (!employeeId) throw new Error("Empleado obligatorio")
      const dias = numberFrom(record, "dias")
      if (dias <= 0) throw new Error("Los días deben ser mayores a 0")
      const sb = getSupabaseAdmin()
      const sueldoMensual = round2(await salarioVigente(businessId, employeeId))
      const sueldoDiario = round2(sueldoMensual / HR_DAILY_BASE)
      const monto = round2(sueldoDiario * dias)
      const id = textFrom(record, "id")
      let nombre = textFrom(record, "employee_nombre")
      if (!nombre) {
        const { data: emp } = await sb.from("csl_empleados").select("nombre, apellido").eq("business_id", businessId).eq("empleado_id", employeeId).maybeSingle()
        const e = emp as { nombre?: string; apellido?: string } | null
        nombre = e ? `${e.nombre ?? ""} ${e.apellido ?? ""}`.trim() : employeeId
      }
      const status = textFrom(record, "status") || "solicitado"
      const row: Record<string, unknown> = {
        business_id: businessId, employee_id: employeeId, employee_nombre: nombre,
        periodo: textFrom(record, "periodo") || String(new Date().getFullYear()),
        dias, fecha_inicio: textFrom(record, "fecha_inicio") || null, fecha_fin: textFrom(record, "fecha_fin") || null,
        sueldo_diario: sueldoDiario, monto, status,
        observations: textFrom(record, "observations") || null,
        created_by: textFrom(record, "created_by") || user.id,
        updated_at: new Date().toISOString(),
      }
      if (status === "aprobado" || status === "pagado") { row.approved_by = user.id; row.approved_at = new Date().toISOString() }
      if (id) row.id = id
      const { data, error } = await sb.from("hr_vacations").upsert(row, { onConflict: "id" }).select().single()
      if (error) { if (isMissingTable(error)) return { ok: false, tableMissing: true, error: "Migración pendiente" }; throw error }
      await hrAudit(user, "vacaciones", status === "aprobado" ? "approve" : (id ? "update" : "create"), "hr_vacations", String((data as { id: string }).id), null, data)
      return { ok: true, record: data }
    }
    case "deleteHrVacation": {
      const id = textValue(params, "id")
      if (!id) throw new Error("id obligatorio")
      let q = getSupabaseAdmin().from("hr_vacations").delete().eq("id", id)
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const { error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, tableMissing: true }; throw error }
      await hrAudit(user, "vacaciones", "delete", "hr_vacations", id, null, null)
      return { ok: true }
    }

    // ── HR · Fase 3 · Doble sueldo (Salario de Navidad) ──────────────────
    case "getHrChristmasBonus": {
      const sb = getSupabaseAdmin()
      let q = sb.from("hr_christmas_bonus").select("*").order("anio", { ascending: false })
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const emp = textValue(params, "employee_id"); if (emp) q = q.eq("employee_id", emp)
      const { data, error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, records: [], tableMissing: true }; throw error }
      return { ok: true, records: data || [] }
    }
    case "saveHrChristmasBonus": {
      const record = parsePayload(params)
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const employeeId = textFrom(record, "employee_id")
      if (!employeeId) throw new Error("Empleado obligatorio")
      const anio = Math.round(numberFrom(record, "anio") || new Date().getFullYear())
      const sb = getSupabaseAdmin()
      const sueldoMensual = round2(await salarioVigente(businessId, employeeId))
      const proporcional = Boolean(record.proporcional)
      const meses = proporcional ? Math.min(12, Math.max(0, numberFrom(record, "meses") || 12)) : 12
      const monto = round2(proporcional ? sueldoMensual * meses / 12 : sueldoMensual)
      const id = textFrom(record, "id")
      let nombre = textFrom(record, "employee_nombre")
      if (!nombre) {
        const { data: emp } = await sb.from("csl_empleados").select("nombre, apellido").eq("business_id", businessId).eq("empleado_id", employeeId).maybeSingle()
        const e = emp as { nombre?: string; apellido?: string } | null
        nombre = e ? `${e.nombre ?? ""} ${e.apellido ?? ""}`.trim() : employeeId
      }
      const status = textFrom(record, "status") || "calculado"
      const row: Record<string, unknown> = {
        business_id: businessId, employee_id: employeeId, employee_nombre: nombre,
        anio, sueldo_mensual: sueldoMensual, proporcional, meses, monto, status,
        observations: textFrom(record, "observations") || null,
        created_by: textFrom(record, "created_by") || user.id,
        updated_at: new Date().toISOString(),
      }
      if (status === "aprobado" || status === "pagado") { row.approved_by = user.id; row.approved_at = new Date().toISOString() }
      if (id) row.id = id
      const { data, error } = await sb.from("hr_christmas_bonus").upsert(row, { onConflict: "id" }).select().single()
      if (error) {
        if (isMissingTable(error)) return { ok: false, tableMissing: true, error: "Migración pendiente" }
        if ((error as { code?: string }).code === "23505") return { ok: false, error: `Ya existe doble sueldo de ${anio} para este empleado (bloqueo de doble pago)` }
        throw error
      }
      await hrAudit(user, "doble_sueldo", status === "aprobado" ? "approve" : (id ? "update" : "create"), "hr_christmas_bonus", String((data as { id: string }).id), null, data)
      return { ok: true, record: data }
    }
    case "deleteHrChristmasBonus": {
      const id = textValue(params, "id")
      if (!id) throw new Error("id obligatorio")
      let q = getSupabaseAdmin().from("hr_christmas_bonus").delete().eq("id", id)
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const { error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, tableMissing: true }; throw error }
      await hrAudit(user, "doble_sueldo", "delete", "hr_christmas_bonus", id, null, null)
      return { ok: true }
    }

    // ── HR · Fase 6 · Auditoría RR.HH. ───────────────────────────────────
    case "getHrAuditLogs": {
      const sb = getSupabaseAdmin()
      let q = sb.from("hr_audit_logs").select("*").order("created_at", { ascending: false }).limit(500)
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const mod = textValue(params, "module"); if (mod) q = q.eq("module", mod)
      const act = textValue(params, "action"); if (act) q = q.eq("action", act)
      const desde = textValue(params, "desde"); if (desde) q = q.gte("created_at", desde)
      const hasta = textValue(params, "hasta"); if (hasta) q = q.lte("created_at", `${hasta}T23:59:59`)
      const { data, error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, records: [], tableMissing: true }; throw error }
      return { ok: true, records: data || [] }
    }

    // ── HR · Fase 6 · Reportes RR.HH. (resumen consolidado) ──────────────
    case "getHrReportSummary": {
      const sb = getSupabaseAdmin()
      const scope = shouldScopeTenant()
      const bid = effectiveBusinessId() as string
      const countOf = async (table: string, status?: string): Promise<number> => {
        let q = sb.from(table).select("*", { count: "exact", head: true })
        if (scope) q = q.eq("business_id", bid)
        if (status) q = q.eq("status", status)
        const { count, error } = await q
        return error ? 0 : (count ?? 0)
      }
      const sumBalanceActivos = async (): Promise<number> => {
        let q = sb.from("hr_loans").select("balance").eq("status", "activo")
        if (scope) q = q.eq("business_id", bid)
        const { data } = await q
        return round2((data || []).reduce((s, r) => s + Number((r as { balance?: number }).balance || 0), 0))
      }
      const [empleados, contratos, documentos, permisosPend, prestamosActivos, prestamosBalance, incentivosPend, corridas, vacacionesPend] = await Promise.all([
        countOf("csl_empleados"),
        countOf("hr_contracts"),
        countOf("hr_documents"),
        countOf("hr_leave_requests", "pendiente"),
        countOf("hr_loans", "activo"),
        sumBalanceActivos(),
        countOf("hr_incentives", "pendiente"),
        countOf("hr_payroll_runs"),
        countOf("hr_vacations", "solicitado"),
      ])
      return {
        ok: true,
        summary: { empleados, contratos, documentos, permisosPend, prestamosActivos, prestamosBalance, incentivosPend, corridas, vacacionesPend },
      }
    }

    // ── HR · Fase 4 · Liquidaciones / prestaciones (RD, referencial) ─────
    case "getHrSeverance": {
      const sb = getSupabaseAdmin()
      let q = sb.from("hr_severance").select("*").order("created_at", { ascending: false })
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const emp = textValue(params, "employee_id"); if (emp) q = q.eq("employee_id", emp)
      const { data, error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, records: [], tableMissing: true }; throw error }
      return { ok: true, records: data || [] }
    }
    case "getHrSeveranceSuggestion": {
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const employeeId = textValue(params, "employee_id")
      if (!employeeId) throw new Error("employee_id obligatorio")
      const motivo = textValue(params, "motivo") || "desahucio"
      const fechaIngreso = textValue(params, "fecha_ingreso")
      const fechaSalida = textValue(params, "fecha_salida") || new Date().toISOString().slice(0, 10)
      const mensual = round2(await salarioVigente(businessId, employeeId))
      const calc = computeSeverance(motivo, fechaIngreso, fechaSalida, mensual)
      const { data: emp } = await getSupabaseAdmin().from("csl_empleados").select("nombre, apellido").eq("business_id", businessId).eq("empleado_id", employeeId).maybeSingle()
      const e = emp as { nombre?: string; apellido?: string } | null
      return { ok: true, employee_nombre: e ? `${e.nombre ?? ""} ${e.apellido ?? ""}`.trim() : employeeId, sueldo_mensual: mensual, ...calc }
    }
    case "saveHrSeverance": {
      const record = parsePayload(params)
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const employeeId = textFrom(record, "employee_id")
      if (!employeeId) throw new Error("Empleado obligatorio")
      const sb = getSupabaseAdmin()
      const id = textFrom(record, "id")
      let nombre = textFrom(record, "employee_nombre")
      if (!nombre) {
        const { data: emp } = await sb.from("csl_empleados").select("nombre, apellido").eq("business_id", businessId).eq("empleado_id", employeeId).maybeSingle()
        const e = emp as { nombre?: string; apellido?: string } | null
        nombre = e ? `${e.nombre ?? ""} ${e.apellido ?? ""}`.trim() : employeeId
      }
      const n = (k: string) => round2(numberFrom(record, k))
      const preaviso = n("preaviso_monto"), cesantia = n("cesantia_monto"), vac = n("vacaciones_monto")
      const nav = n("navidad_monto"), salPend = n("salario_pendiente"), otros = n("otros_ingresos"), desc = n("descuentos")
      const total = round2(preaviso + cesantia + vac + nav + salPend + otros - desc)
      const status = textFrom(record, "status") || "borrador"
      let oldValues: unknown = null
      if (id) { const { data: prev } = await sb.from("hr_severance").select("*").eq("id", id).maybeSingle(); oldValues = prev ?? null }
      const row: Record<string, unknown> = {
        business_id: businessId, employee_id: employeeId, employee_nombre: nombre,
        motivo: textFrom(record, "motivo") || "desahucio",
        fecha_ingreso: textFrom(record, "fecha_ingreso") || null,
        fecha_salida: textFrom(record, "fecha_salida") || null,
        anios_servicio: n("anios_servicio"),
        sueldo_mensual: n("sueldo_mensual"), salario_diario: n("salario_diario"),
        preaviso_dias: n("preaviso_dias"), preaviso_monto: preaviso,
        cesantia_dias: n("cesantia_dias"), cesantia_monto: cesantia,
        vacaciones_monto: vac, navidad_monto: nav, salario_pendiente: salPend,
        otros_ingresos: otros, descuentos: desc, total, status,
        observations: textFrom(record, "observations") || null,
        created_by: textFrom(record, "created_by") || user.id,
        updated_at: new Date().toISOString(),
      }
      if (status === "aprobado" || status === "pagado") { row.approved_by = user.id; row.approved_at = new Date().toISOString() }
      if (id) row.id = id
      const { data, error } = await sb.from("hr_severance").upsert(row, { onConflict: "id" }).select().single()
      if (error) { if (isMissingTable(error)) return { ok: false, tableMissing: true, error: "Migración pendiente" }; throw error }
      await hrAudit(user, "liquidaciones", status === "aprobado" ? "approve" : (id ? "update" : "create"), "hr_severance", String((data as { id: string }).id), oldValues, data)
      return { ok: true, record: data }
    }
    case "deleteHrSeverance": {
      const id = textValue(params, "id")
      if (!id) throw new Error("id obligatorio")
      let q = getSupabaseAdmin().from("hr_severance").delete().eq("id", id)
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const { error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, tableMissing: true }; throw error }
      await hrAudit(user, "liquidaciones", "delete", "hr_severance", id, null, null)
      return { ok: true }
    }

    case "getCredenciales":
      return { ok: true, records: await getRows("credenciales") }
    case "getSolicitudesEmpleo":
      // Listado liviano — sin firma_digital, documentos_adjuntos,
      // experiencia JSON, payload_json (que contiene foto cédula base64).
      return { ok: true, records: await getRows("solicitudes_empleo", { columns: SOLICITUDES_LIST_COLS }) }
    case "getSolicitudCompleta": {
      // Detalle full por ID — incluye firma_digital, documentos_adjuntos,
      // experiencia, payload_json (con foto cédula). Llamado al abrir,
      // editar o imprimir una solicitud específica.
      const id = textValue(params, "id") || textValue(params, "solicitudId")
      if (!id) throw new Error("id obligatorio")
      const record = await getRecordCompleto("solicitudes_empleo", id)
      return record ? { ok: true, record } : { ok: false, error: "Solicitud no encontrada" }
    }
    case "getFichaCompleta": {
      const id = textValue(params, "id") || textValue(params, "fichaId")
      if (!id) throw new Error("id obligatorio")
      const record = await getRecordCompleto("ficha_dermatologica", id)
      return record ? { ok: true, record } : { ok: false, error: "Ficha no encontrada" }
    }
    case "getConsentMasajesCompleto": {
      const id = textValue(params, "id") || textValue(params, "consentId")
      if (!id) throw new Error("id obligatorio")
      const record = await getRecordCompleto("csl_consent_masajes", id)
      return record ? { ok: true, record } : { ok: false, error: "Consentimiento no encontrado" }
    }
    case "getConsentTatuajesCejasCompleto": {
      const id = textValue(params, "id") || textValue(params, "consentId")
      if (!id) throw new Error("id obligatorio")
      const record = await getRecordCompleto("csl_consent_tatuajes_cejas", id)
      return record ? { ok: true, record } : { ok: false, error: "Consentimiento no encontrado" }
    }
    case "getClientesCosmiatria":
      return { ok: true, records: await getRows("cosmiatria_clientes") }
    case "getFichasDermatologia":
      // Listado liviano — sin firma_digital + payload_json (cuerpo clínico
      // + foto cédula). El detalle completo se carga al abrir.
      return { ok: true, records: await getRows("ficha_dermatologica", { columns: FICHA_LIST_COLS }) }
    case "getConsentMasajes":
      // Sin firmas data-URL + payload_json + JSONs grandes.
      return { ok: true, records: await getRows("csl_consent_masajes", { columns: CONSENT_LIST_COLS }) }
    case "getConsentTatuajesCejas":
      return { ok: true, records: await getRows("csl_consent_tatuajes_cejas", { columns: CONSENT_LIST_COLS }) }
    case "getCertificadosRegalo":
      return { ok: true, records: await getRows("certificados_regalo") }
    case "getRowsPaged": {
      // Lectura paginada genérica: el cliente pasa entity, limit, offset y
      // filtros opcionales como pares clave/valor (string).
      const entity = textValue(params, "entity")
      const limit = numberValue(params, "limit", 50)
      const offset = numberValue(params, "offset", 0)
      const filtersRaw = parsePayload(params).filters
      const filters: Record<string, string | number | boolean | null | undefined> = {}
      if (filtersRaw && typeof filtersRaw === "object") {
        for (const [key, value] of Object.entries(filtersRaw as Record<string, unknown>)) {
          if (value === undefined || value === null) continue
          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            filters[key] = value
          }
        }
      }
      const { rows, total } = await getRowsPaged(entity, { limit, offset, filters })
      return { ok: true, records: rows, total, limit, offset }
    }
    case "getEmpleados": {
      const empleados = await getRows("empleados")
      if (empleados.length) return { ok: true, records: empleados }
      const solicitudes = await getRows("solicitudes_empleo")
      return { ok: true, records: solicitudes.filter((record) => String(record.Estado ?? record.estado) === "Aprobado") }
    }
    case "getCurrentUserProfile": {
      const profile = await getProfile(user.id)
      return { ok: true, user: profile ? profileToUser(profile) : null }
    }
    case "getUsers": {
      // BUG CRÍTICO DE MULTI-TENANT (fix): antes este handler devolvía TODOS
      // los usuarios sin filtrar por business_id. Un admin Depicenter veía
      // usuarios CSL y viceversa. Ahora:
      //   - superadmin → todos los usuarios (ambos tenants)
      //   - admin de tenant → solo usuarios con su mismo business_id
      const callerProfile = await requireAdmin(user.id)
      const supabase = getSupabaseAdmin()
      let query = supabase
        .from("csl_user_profiles")
        .select("*")
        .order("nombre", { ascending: true })
      if (!callerProfile.is_superadmin) {
        if (!callerProfile.business_id) throw new Error("Tu perfil no tiene business_id asignado")
        query = query.eq("business_id", callerProfile.business_id)
      }
      const { data, error } = await query
      if (error) throw error
      return { ok: true, records: (data || []).map((profile) => profileToUser(profile as Row)) }
    }
    case "saveUser": {
      const callerProfile = await requireAdmin(user.id)
      const record = parsePayload(params)
      const email = textFrom(record, "username").trim().toLowerCase()
      const password = textFrom(record, "password").trim()
      const editingId = textFrom(record, "id").trim()
      const nombre = textFrom(record, "nombre").trim()
      const isAdmin = Boolean(record.isAdmin)
      const activo = record.activo !== false
      // Filtrar al ID set conocido para que no se cuelen valores arbitrarios.
      const allowed = new Set(MENU_IDS)
      const menus = isAdmin
        ? [...MENU_IDS]
        : stringArrayFrom(record.menus).filter((id) => allowed.has(id))

      // ---- validaciones ----
      if (!nombre) throw new Error("Falta el nombre del usuario")
      if (!email) throw new Error("Falta el correo del usuario")
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Correo con formato inválido")
      if (!editingId && !password) throw new Error("Falta la clave del usuario nuevo")
      if (password && password.length < 6) throw new Error("La clave debe tener al menos 6 caracteres")
      if (!isAdmin && menus.length === 0) {
        throw new Error("Selecciona al menos un módulo o marca el usuario como Administrador")
      }

      const supabase = getSupabaseAdmin()

      // ---- aislamiento multi-tenant: admin normal solo puede tocar
      // usuarios de su propio business_id. Superadmin puede tocar cualquiera.
      // Si está EDITANDO, verificamos el business_id del target ANTES de
      // cualquier mutación. Si está CREANDO, forzamos business_id =
      // caller.business_id (no aceptamos del payload para admin normal).
      let targetBusinessId: string | null = callerProfile.business_id as string | null
      if (editingId && !callerProfile.is_superadmin) {
        const { data: target, error: targetErr } = await supabase
          .from("csl_user_profiles")
          .select("business_id")
          .eq("user_id", editingId)
          .maybeSingle()
        if (targetErr) throw targetErr
        if (!target) throw new Error("Usuario no encontrado")
        if (target.business_id !== callerProfile.business_id) {
          throw new Error("No tienes permiso para administrar este usuario")
        }
        targetBusinessId = target.business_id as string
      } else if (editingId && callerProfile.is_superadmin) {
        // Superadmin editando — respetamos el business_id existente del target
        // a menos que el payload lo cambie explícitamente.
        const { data: target } = await supabase
          .from("csl_user_profiles")
          .select("business_id")
          .eq("user_id", editingId)
          .maybeSingle()
        targetBusinessId = (target?.business_id as string | undefined) ?? targetBusinessId
      }

      // ---- protección "último admin": si me edito a mí mismo y me quito
      // admin/me desactivo, verificar que quede al menos OTRO admin activo.
      if (editingId === user.id && (!isAdmin || !activo)) {
        const { count, error: adminCountError } = await supabase
          .from("csl_user_profiles")
          .select("user_id", { count: "exact", head: true })
          .eq("is_admin", true)
          .eq("activo", true)
          .neq("user_id", user.id)
        if (adminCountError) throw adminCountError
        if ((count ?? 0) === 0) {
          throw new Error(
            !activo
              ? "No puedes desactivarte: eres el único administrador activo"
              : "No puedes quitarte el rol de administrador: eres el único administrador activo",
          )
        }
      }

      // ---- evitar email duplicado al CREAR ----
      if (!editingId) {
        const { data: existing, error: existingError } = await supabase
          .from("csl_user_profiles")
          .select("user_id")
          .ilike("username", email)
          .maybeSingle()
        if (existingError) throw existingError
        if (existing) throw new Error("Ya existe un usuario con ese correo")
      }

      let userId = editingId

      if (editingId) {
        const attributes: Record<string, unknown> = {
          email,
          user_metadata: { nombre, username: email, is_admin: isAdmin, activo, menus },
        }
        if (password) attributes.password = password
        const { data, error } = await supabase.auth.admin.updateUserById(editingId, attributes)
        if (error) throw error
        userId = data.user.id
      } else {
        const { data, error } = await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { nombre, username: email, is_admin: isAdmin, activo, menus },
        })
        if (error) throw error
        userId = data.user.id
      }

      const profile: Record<string, unknown> = {
        user_id: userId,
        nombre,
        username: email,
        is_admin: isAdmin,
        activo,
        menus,
      }
      // Inyectar business_id explícitamente para que no dependa del default
      // de la columna (que era CSL para todos). Admin normal hereda su propio
      // business_id; superadmin respeta el del target o el actual del caller.
      if (targetBusinessId) profile.business_id = targetBusinessId
      const { error } = await supabase
        .from("csl_user_profiles")
        .upsert(profile, { onConflict: "user_id" })
      if (error) throw error
      return { ok: true, record: profileToUser(profile as Row) }
    }
    case "deleteUser": {
      const callerProfile = await requireAdmin(user.id)
      const userId = textValue(params, "id")
      if (!userId) throw new Error("Falta el id del usuario")
      if (userId === user.id) throw new Error("No puedes eliminar tu propia cuenta")

      const supabase = getSupabaseAdmin()

      // No permitir borrar al último admin activo, aunque sea otro admin.
      const { data: target, error: targetError } = await supabase
        .from("csl_user_profiles")
        .select("user_id, is_admin, activo, business_id")
        .eq("user_id", userId)
        .maybeSingle()
      if (targetError) throw targetError
      // Aislamiento multi-tenant: admin normal no puede borrar usuarios de
      // otro business_id. Superadmin sí puede borrar cross-tenant.
      if (!callerProfile.is_superadmin
          && target?.business_id !== callerProfile.business_id) {
        throw new Error("No tienes permiso para eliminar este usuario")
      }
      if (target?.is_admin && target?.activo) {
        const { count, error: adminCountError } = await supabase
          .from("csl_user_profiles")
          .select("user_id", { count: "exact", head: true })
          .eq("is_admin", true)
          .eq("activo", true)
          .neq("user_id", userId)
        if (adminCountError) throw adminCountError
        if ((count ?? 0) === 0) {
          throw new Error("No puedes eliminar al único administrador activo")
        }
      }

      const { error } = await supabase.auth.admin.deleteUser(userId)
      if (error) throw error
      await supabase.from("csl_user_profiles").delete().eq("user_id", userId)
      return { ok: true }
    }
    case "saveSucursal": {
      const row = { codigo: textValue(params, "codigo"), nombre: textValue(params, "nombre"), ciudad: textValue(params, "ciudad"), direccion: textValue(params, "direccion"), estado: textValue(params, "estado", "Activa"), notas: textValue(params, "notas"), correo: textValue(params, "correo") }
      await upsertRow("sucursales", row)
      return { ok: true, record: fromDb("sucursales", row) }
    }
    case "deleteSucursal":
      await deleteRow("sucursales", textValue(params, "codigo"))
      return { ok: true }
    case "setSucursalEstado":
      await updateRowFields("sucursales", textValue(params, "codigo"), { estado: textValue(params, "estado") })
      return { ok: true }
    case "saveEquipo": {
      // Cabina/operadora_nombre/operadora_id vienen como string vacío cuando
      // no se asignan — convertimos a null para respetar el default de la DB.
      const cabinaRaw = textValue(params, "cabina")
      const operadoraRaw = textValue(params, "operadora")
      const operadoraIdRaw = textValue(params, "operadoraId")
      const ultimaActRaw = textValue(params, "ultimaActualizacionPulsos")
      const ultimaSemRaw = textValue(params, "ultimaSemanaPulsos")
      const row: Record<string, unknown> = {
        equipo_id: textValue(params, "equipoId"),
        sucursal: textValue(params, "sucursal"),
        empresa: textValue(params, "empresa"),
        domicilio: textValue(params, "domicilio"),
        modelo: textValue(params, "modelo"),
        serie: textValue(params, "serie"),
        numero: textValue(params, "numero"),
        p_cabeza: numberValue(params, "pcabeza"),
        p_totales: numberValue(params, "ptotales"),
        max_cabeza: numberValue(params, "maxCabeza", 6000000),
        estado: textValue(params, "estado", "Activo"),
        observaciones: textValue(params, "observaciones"),
        // Columnas añadidas por 202605280001_equipos_cabina_operadora.sql.
        // Nombre de la operadora simplificado a `operadora` (no `operadora_nombre`).
        cabina: cabinaRaw ? cabinaRaw : null,
        operadora: operadoraRaw ? operadoraRaw : null,
        operadora_id: operadoraIdRaw ? operadoraIdRaw : null,
      }
      // Columnas añadidas por 202605280002_equipos_pulsos_audit.sql.
      // Solo se envían si el caller las pasó — guardar un equipo
      // manualmente NO debe resetear estos timestamps.
      if (ultimaActRaw) row.ultima_actualizacion_pulsos = ultimaActRaw
      if (ultimaSemRaw) row.ultima_semana_pulsos = ultimaSemRaw
      await upsertRow("equipos", row)
      return { ok: true, record: fromDb("equipos", row) }
    }
    case "deleteEquipo":
      await deleteRow("equipos", textValue(params, "equipoId"))
      return { ok: true }
    case "setEquipoEstado":
      await updateRowFields("equipos", textValue(params, "equipoId"), { estado: textValue(params, "estado") })
      return { ok: true }
    case "updateEquipoCampos": {
      // UPDATE parcial — solo aplica los campos enviados con valor no vacío.
      // A diferencia de saveEquipo (upsert full-row), preserva los campos
      // que NO se mandan. Usado por:
      //   - guardarCuadre (solo actualiza pulsos)
      //   - importador masivo de base (solo actualiza sucursal/cabina/op./serial)
      const equipoId = textValue(params, "equipoId")
      if (!equipoId) throw new Error("equipoId obligatorio para updateEquipoCampos")
      const fields: Record<string, unknown> = {}
      // Mapeo camelCase del request → snake_case de la DB. Solo se incluye
      // un campo si vino con valor no vacío (= el caller quiere actualizarlo).
      const mapText: Array<[string, string]> = [
        ["sucursal", "sucursal"],
        ["empresa", "empresa"],
        ["domicilio", "domicilio"],
        ["modelo", "modelo"],
        ["serie", "serie"],
        ["numero", "numero"],
        ["estado", "estado"],
        ["observaciones", "observaciones"],
        ["cabina", "cabina"],
        ["operadora", "operadora"],
        ["operadoraId", "operadora_id"],
        ["ultimaActualizacionPulsos", "ultima_actualizacion_pulsos"],
        ["ultimaSemanaPulsos", "ultima_semana_pulsos"],
      ]
      for (const [camel, snake] of mapText) {
        const v = params[camel]
        if (typeof v === "string" && v.length > 0) fields[snake] = v
      }
      // Numéricos: el frontend los manda como string. Solo aplicamos si
      // vino una cadena no vacía (string "0" sí vale → permite resetear).
      const mapNum: Array<[string, string]> = [
        ["pcabeza", "p_cabeza"],
        ["ptotales", "p_totales"],
        ["maxCabeza", "max_cabeza"],
      ]
      for (const [camel, snake] of mapNum) {
        const v = params[camel]
        if (typeof v === "string" && v.length > 0) fields[snake] = Number(v) || 0
      }
      if (Object.keys(fields).length === 0) {
        return { ok: true, message: "Sin campos para actualizar" }
      }
      await updateRowFields("equipos", equipoId, fields)
      return { ok: true }
    }
    case "saveTecnico": {
      const row = { codigo: textValue(params, "codigo"), nombre: textValue(params, "nombre"), telefono: textValue(params, "telefono"), correo: textValue(params, "correo"), estado: textValue(params, "estado", "Activo"), notas: textValue(params, "notas") }
      await upsertRow("tecnicos", row)
      return { ok: true, record: fromDb("tecnicos", row) }
    }
    case "deleteTecnico":
      await deleteRow("tecnicos", textValue(params, "codigo"))
      return { ok: true }
    case "setTecnicoEstado":
      await updateRowFields("tecnicos", textValue(params, "codigo"), { estado: textValue(params, "estado") })
      return { ok: true }
    case "savePieza": {
      const row = { pieza: textValue(params, "pieza"), categoria: textValue(params, "categoria"), prioridad: textValue(params, "prioridad", "Media"), tipo: textValue(params, "tipo", "Consumible"), funcion: textValue(params, "funcion"), fallas_comunes: textValue(params, "fallasComunes"), activa: textValue(params, "activa", "Sí") }
      await upsertRow("piezas", row)
      return { ok: true, record: fromDb("piezas", row) }
    }
    case "deletePieza":
      await deleteRow("piezas", textValue(params, "pieza"))
      return { ok: true }
    case "getPiezasPolizaLista":
      return { ok: true, records: await getRows("piezas_poliza_lista") }
    case "savePiezaPolizaLista": {
      // id opcional → generamos UUID server-side si es nuevo. La columna en DB
      // tiene default gen_random_uuid(), pero upsertRow requiere la clave en
      // el payload para el onConflict (no podemos delegarlo).
      const id = textValue(params, "id") || (globalThis.crypto?.randomUUID?.() ?? `pp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`)
      const estadoRaw = textValue(params, "estado", "pendiente")
      const estado: "pendiente" | "recibida" = estadoRaw === "recibida" ? "recibida" : "pendiente"
      const fechaRecibida = dateValue(params.fechaRecibida)
      const row: Row = {
        id,
        pieza_nombre: textValue(params, "piezaNombre"),
        categoria_snapshot: textValue(params, "categoriaSnapshot") || null,
        cantidad: Math.max(1, numberValue(params, "cantidad", 1)),
        suplidor: textValue(params, "suplidor") || null,
        prioridad: textValue(params, "prioridad", "Media"),
        estado,
        sucursal: textValue(params, "sucursal") || null,
        fecha_solicitada: dateValue(params.fechaSolicitada) || new Date().toISOString().slice(0, 10),
        // Coherencia estado ↔ fecha_recibida:
        //   recibida → si el cliente pasó fecha la usamos, sino hoy
        //   pendiente → siempre null (limpieza si se devolvió a pendiente)
        fecha_recibida: estado === "recibida" ? (fechaRecibida || new Date().toISOString().slice(0, 10)) : null,
        nota: textValue(params, "nota") || null,
        creado_por: user.id,
      }
      if (!row.pieza_nombre) throw new Error("Falta el nombre de la pieza")
      await upsertRow("piezas_poliza_lista", row)
      return { ok: true, record: fromDb("piezas_poliza_lista", row) }
    }
    case "markPiezaPolizaRecibida": {
      const id = textValue(params, "id")
      if (!id) throw new Error("Falta id")
      await updateRowFields("piezas_poliza_lista", id, {
        estado: "recibida",
        fecha_recibida: dateValue(params.fechaRecibida) || new Date().toISOString().slice(0, 10),
      })
      return { ok: true }
    }
    case "markPiezaPolizaPendiente": {
      const id = textValue(params, "id")
      if (!id) throw new Error("Falta id")
      await updateRowFields("piezas_poliza_lista", id, {
        estado: "pendiente",
        fecha_recibida: null,
      })
      return { ok: true }
    }
    case "deletePiezaPolizaLista":
      await deleteRow("piezas_poliza_lista", textValue(params, "id"))
      return { ok: true }
    case "saveReporte": {
      const row = { report_id: textValue(params, "reportId"), fecha: dateValue(params.fecha), equipo_id: textValue(params, "equipoId"), sucursal: textValue(params, "sucursal"), empresa: textValue(params, "empresa"), cliente: textValue(params, "cliente"), domicilio: textValue(params, "domicilio"), ciudad: textValue(params, "ciudad", "Santiago"), modelo: textValue(params, "modelo"), serie: textValue(params, "serie"), numero: textValue(params, "numero"), tipo: textValue(params, "tipo", "Preventivo"), estado_equipo: textValue(params, "estadoEquipo", "Operativo"), prioridad: textValue(params, "prioridad", "Baja"), problema: textValue(params, "problema"), correccion: textValue(params, "correccion"), observaciones: textValue(params, "observaciones"), checklist: textValue(params, "checklist"), p_cabeza: numberValue(params, "pcabeza"), p_totales: numberValue(params, "ptotales"), atendio: textValue(params, "atendio"), piezas_json: textValue(params, "piezasJson", "[]"), partes_texto: textValue(params, "partesTexto"), firma_cliente: textValue(params, "firmaCliente"), firma_tecnico: textValue(params, "firmaTecnico"), fotos: textValue(params, "fotos", "[]") }
      const config = tableConfig("reportes")
      const { data } = await getSupabaseAdmin()
        .from(config.table)
        .select(config.key)
        .eq(config.key, row.report_id)
        .maybeSingle()
      await upsertRow("reportes", row)
      const email = data ? undefined : await sendReporteEmail(row).catch((error: unknown) => ({
        sent: false,
        warning: error instanceof Error ? error.message : "No se pudo enviar el correo",
      }))
      return { ok: true, record: fromDb("reportes", row), email }
    }
    case "updateReporteCampos": {
      // UPDATE PARCIAL — solo aplica los campos enviados con valor no vacío,
      // preservando los demás. Usado por el modal de edición de Reportes
      // para evitar el bug de upsert-full-row que sobreescribe firmas/piezas
      // con strings vacíos cuando el formData solo cambió 1 campo.
      const reportId = textValue(params, "reportId") || textValue(params, "id")
      if (!reportId) throw new Error("reportId obligatorio para updateReporteCampos")
      const fields: Record<string, unknown> = {}
      const mapText: Array<[string, string]> = [
        ["fecha", "fecha"],
        ["equipoId", "equipo_id"],
        ["sucursal", "sucursal"],
        ["empresa", "empresa"],
        ["cliente", "cliente"],
        ["domicilio", "domicilio"],
        ["ciudad", "ciudad"],
        ["modelo", "modelo"],
        ["serie", "serie"],
        ["numero", "numero"],
        ["tipo", "tipo"],
        ["estadoEquipo", "estado_equipo"],
        ["prioridad", "prioridad"],
        ["problema", "problema"],
        ["correccion", "correccion"],
        ["observaciones", "observaciones"],
        ["checklist", "checklist"],
        ["atendio", "atendio"],
        ["piezasJson", "piezas_json"],
        ["partesTexto", "partes_texto"],
        ["firmaCliente", "firma_cliente"],
        ["firmaTecnico", "firma_tecnico"],
        ["fotos", "fotos"],
      ]
      for (const [camel, snake] of mapText) {
        const v = params[camel]
        if (typeof v === "string" && v.length > 0) {
          // Fecha como string ISO (date column)
          if (camel === "fecha") {
            fields[snake] = dateValue(v)
          } else {
            fields[snake] = v
          }
        }
      }
      const mapNum: Array<[string, string]> = [["pcabeza", "p_cabeza"], ["ptotales", "p_totales"]]
      for (const [camel, snake] of mapNum) {
        const v = params[camel]
        if (typeof v === "string" && v.length > 0) fields[snake] = Number(v) || 0
      }
      if (Object.keys(fields).length === 0) {
        return { ok: true, message: "Sin campos para actualizar" }
      }
      await updateRowFields("reportes", reportId, fields)
      return { ok: true }
    }
    case "getReporte": {
      // Detalle completo de un reporte — incluye firma_cliente, firma_tecnico,
      // fotos, piezas_json, checklist, partes_texto (todo lo que getAllData
      // omite por egress). Llamado por el frontend al ABRIR un reporte
      // específico, no en el listado.
      const reportId = textValue(params, "reportId") || textValue(params, "id")
      if (!reportId) throw new Error("reportId obligatorio")
      const record = await getReporteCompleto(reportId)
      if (!record) return { ok: false, error: "Reporte no encontrado" }
      return { ok: true, record }
    }
    case "deleteReporte":
      await deleteRow("reportes", textValue(params, "reportId") || textValue(params, "id"))
      return { ok: true }
    case "addInventario":
    case "updateInventario":
    case "saveInventario": {
      const record = parsePayload(params)
      const row = { item_id: String(record.ItemID ?? params.id ?? `inv_${Date.now()}`), codigo_barras: record.CodigoBarras ?? "", pieza: record.Pieza ?? "", categoria: record.Categoria ?? "", marca: record.Marca ?? "", modelo: record.Modelo ?? "", numero_parte: record.NumeroParte ?? "", precio_compra: Number(record.PrecioCompra ?? 0), precio_compra_mercado: Number(record.PrecioCompraMercado ?? 0), precio_venta: Number(record.PrecioVenta ?? 0), stock_rafael_vidal: Number(record.StockRafaelVidal ?? 0), stock_los_jardines: Number(record.StockLosJardines ?? 0), stock_villa_olga: Number(record.StockVillaOlga ?? 0), stock_la_vega: Number(record.StockLaVega ?? 0), stock_minimo: Number(record.StockMinimo ?? 0), proveedor: record.Proveedor ?? "", estado: record.Estado ?? "Activo", observaciones: record.Observaciones ?? "" }
      await upsertRow("inventario", row)
      return { ok: true, record: fromDb("inventario", row) }
    }
    case "deleteInventario":
      await deleteRow("inventario", textValue(params, "id"))
      return { ok: true }
    case "saveCredencial": {
      const record = parsePayload(params)
      const row = { credencial_id: String(record.CredencialID ?? record.id ?? `CRD-${Date.now()}`), sucursal: record.Sucursal ?? record.sucursal ?? "", area: record.Area ?? record.area ?? "", equipo: record.Equipo ?? record.equipo ?? "", sistema: record.Sistema ?? record.sistema ?? "", usuario: record.Usuario ?? record.usuario ?? "", contrasena: record.Contrasena ?? record.contrasena ?? "", pin: record.PIN ?? record.pin ?? "", url: record.URL ?? record.url ?? "", correo: record.Correo ?? record.correo ?? "" }
      await upsertRow("credenciales", row)
      return { ok: true, record: fromDb("credenciales", row) }
    }
    case "deleteCredencial":
      await deleteRow("credenciales", textValue(params, "id"))
      return { ok: true }
    case "saveSolicitudEmpleo": {
      const row = solicitudToDb(parsePayload(params))
      await upsertRow("solicitudes_empleo", row)
      let email: Awaited<ReturnType<typeof sendApprovedSolicitudEmail>> | undefined
      if (row.estado === "Aprobado") {
        await upsertRow("empleados", { ...row, empleado_id: row.solicitud_id })
        email = await sendApprovedSolicitudEmail(row).catch((error: unknown) => ({
          sent: false,
          warning: error instanceof Error ? error.message : "No se pudo enviar el correo",
        }))
      } else {
        await deleteRow("empleados", String(row.solicitud_id)).catch(() => undefined)
      }
      return { ok: true, record: fromDb("solicitudes_empleo", row), email }
    }
    case "deleteSolicitudEmpleo": {
      const id = textValue(params, "id")
      await deleteRow("solicitudes_empleo", id)
      await deleteRow("empleados", id).catch(() => undefined)
      return { ok: true }
    }
    case "saveClienteCosmiatria": {
      // Solo admin/superadmin pueden crear o editar clientes. Rol Usuario es
      // solo-lectura sobre el módulo Clientes (incluye el auto-save del
      // modal Generar link para cliente).
      const callerProfile = await getProfile(user.id)
      if (!callerProfile?.is_admin && !callerProfile?.is_superadmin) {
        return { ok: false, code: "forbidden", error: "No tienes permiso para crear o editar clientes." }
      }
      const payload = parsePayload(params)
      const explicitClienteId = String(payload.ClienteID ?? payload.clienteId ?? payload.cliente_id ?? "").trim()
      const clienteId = await resolveClienteId(payload)
      // Dedupe explícito en backend: si NO viene ClienteID en payload
      // (caso CREATE) pero el resolved ID ya corresponde a un cliente
      // existente, devolvemos error controlado en vez de silenciosamente
      // mergear sobre el registro existente. Multi-tenant: select va
      // filtrado por business_id vía AsyncLocalStorage en runWithBusinessContext.
      if (!explicitClienteId) {
        const existing = await getSupabaseAdmin()
          .from("csl_cosmiatria_clientes")
          .select("*")
          .eq("cliente_id", clienteId)
          .maybeSingle()
        if (existing.data) {
          return {
            ok: false,
            code: "duplicate",
            error: "Este cliente ya existe en el sistema.",
            record: fromDb("cosmiatria_clientes", existing.data as Row),
          }
        }
      }
      const row = clienteCosmiatriaToDb({ ...payload, ClienteID: clienteId })
      const cliente = await upsertClienteCosmiatriaPreserving(row)
      await syncFichasCliente(cliente)
      return { ok: true, record: fromDb("cosmiatria_clientes", cliente) }
    }
    case "deleteClienteCosmiatria": {
      const callerProfile = await getProfile(user.id)
      if (!callerProfile?.is_admin && !callerProfile?.is_superadmin) {
        return { ok: false, code: "forbidden", error: "No tienes permiso para eliminar clientes." }
      }
      await deleteRow("cosmiatria_clientes", textValue(params, "id"))
      return { ok: true }
    }
    case "mergeClientes": {
      // Unificación de clientes duplicados. Solo admin/superadmin.
      // Migración requerida: 202605260009_cliente_merge_audit.sql.
      const profile = await getProfile(user.id)
      if (!profile?.is_admin && !profile?.is_superadmin) {
        return { ok: false, code: "forbidden", error: "No tienes permiso para unificar clientes." }
      }
      const primary = textValue(params, "primaryClienteId")
      const duplicate = textValue(params, "duplicateClienteId")
      const note = textValue(params, "note") || null
      const finalFieldsRaw = parsePayload(params).finalFields
      const finalFields = (finalFieldsRaw && typeof finalFieldsRaw === "object" ? finalFieldsRaw : {}) as Row
      if (!primary || !duplicate) {
        return { ok: false, error: "Faltan IDs de cliente principal o duplicado." }
      }
      if (primary === duplicate) {
        return { ok: false, error: "No puedes unificar un cliente consigo mismo." }
      }

      const supabase = getSupabaseAdmin()
      const [primRes, dupRes] = await Promise.all([
        supabase.from("csl_cosmiatria_clientes").select("*").eq("cliente_id", primary).maybeSingle(),
        supabase.from("csl_cosmiatria_clientes").select("*").eq("cliente_id", duplicate).maybeSingle(),
      ])
      if (primRes.error || !primRes.data) {
        return { ok: false, error: "Cliente principal no encontrado." }
      }
      if (dupRes.error || !dupRes.data) {
        return { ok: false, error: "Cliente duplicado no encontrado." }
      }
      const primRow = primRes.data as Row
      const dupRow = dupRes.data as Row
      if (String(primRow.business_id) !== String(dupRow.business_id)) {
        return { ok: false, error: "No se pueden unificar clientes de negocios diferentes." }
      }
      // Superadmin puede mover cross-tenant; admin normal solo dentro de su business.
      if (!profile.is_superadmin && String(primRow.business_id) !== String(profile.business_id)) {
        return { ok: false, code: "forbidden", error: "Solo puedes unificar clientes de tu propio negocio." }
      }
      if (dupRow.merged_into_cliente_id) {
        return { ok: false, error: "El cliente duplicado ya fue fusionado previamente." }
      }
      if (primRow.merged_into_cliente_id) {
        return { ok: false, error: "El cliente principal ya estaba fusionado en otro. Elige uno activo." }
      }

      // 1) Aplicar campos finales al primary (solo whitelist segura).
      const allowedFinal: Array<keyof Row> = [
        "nombre", "apellido", "telefono", "telefono2", "documento_identidad",
        "email", "direccion", "localidad", "ciudad", "region", "sucursal", "genero",
      ]
      const updatePrimary: Row = {}
      for (const key of allowedFinal) {
        if (Object.prototype.hasOwnProperty.call(finalFields, key)) {
          updatePrimary[key] = finalFields[key]
        }
      }
      updatePrimary.updated_at = new Date().toISOString()
      const updRes = await supabase
        .from("csl_cosmiatria_clientes")
        .update(updatePrimary)
        .eq("cliente_id", primary)
        .select("*")
        .maybeSingle()
      if (updRes.error || !updRes.data) {
        return { ok: false, error: `No se pudo actualizar el cliente principal: ${updRes.error?.message || ""}`.trim() }
      }
      const finalRow = updRes.data as Row

      // 2) Reasignar registros relacionados (cliente_id en las 3 tablas hijas).
      const counts = { fichas: 0, masajes: 0, tatuajes: 0, links: 0 }
      const reassign = async (table: string, key: keyof typeof counts) => {
        const res = await supabase
          .from(table)
          .update({ cliente_id: primary })
          .eq("cliente_id", duplicate)
          .select("cliente_id")
        if (res.error) throw new Error(`Error reasignando ${table}: ${res.error.message}`)
        counts[key] = Array.isArray(res.data) ? res.data.length : 0
      }
      try {
        await reassign("csl_ficha_dermatologica", "fichas")
        await reassign("csl_consent_masajes", "masajes")
        await reassign("csl_consent_tatuajes_cejas", "tatuajes")
      } catch (transferError) {
        return { ok: false, error: transferError instanceof Error ? transferError.message : "Error transfiriendo registros." }
      }
      // csl_public_form_links no tiene cliente_id (solo nombre/telefono snapshot)
      // — no se modifica. counts.links queda en 0 intencionalmente.

      // 3) Marcar duplicate como fusionado.
      const dupUpdate = await supabase
        .from("csl_cosmiatria_clientes")
        .update({
          estado: "Fusionado",
          merged_into_cliente_id: primary,
          merged_at: new Date().toISOString(),
          merged_by: user.id,
          merge_note: note,
          updated_at: new Date().toISOString(),
        })
        .eq("cliente_id", duplicate)
      if (dupUpdate.error) {
        return { ok: false, error: `No se pudo marcar el duplicado: ${dupUpdate.error.message}` }
      }

      // 4) Auditoría (append-only).
      const auditInsert = await supabase.from("csl_cliente_merge_audit").insert({
        business_id: primRow.business_id,
        primary_cliente_id: primary,
        duplicate_cliente_id: duplicate,
        primary_snapshot: primRow,
        duplicate_snapshot: dupRow,
        final_snapshot: finalRow,
        affected_counts: counts,
        merged_by: user.id,
        note,
      })
      if (auditInsert.error) {
        // Audit fallida no revierte el merge — pero lo reportamos como warning.
        return {
          ok: true,
          counts,
          primary: fromDb("cosmiatria_clientes", finalRow),
          warning: `Merge completado pero falló la auditoría: ${auditInsert.error.message}`,
        }
      }

      return {
        ok: true,
        counts,
        primary: fromDb("cosmiatria_clientes", finalRow),
      }
    }
    case "saveFichaDermatologia": {
      const payload = parsePayload(params)
      const clienteId = await resolveClienteId(payload)
      const cliente = await upsertClienteCosmiatriaPreserving(clienteCosmiatriaToDb({ ...payload, ClienteID: clienteId }))
      const row: Row = {
        ...fichaDermoToDb({ ...payload, clienteId: cliente.cliente_id }),
        cliente_id: cliente.cliente_id,
        email: String(payload.email || payload.Email || cliente.email || ""),
      }
      row.payload_json = { ...((row.payload_json as unknown as Row) || {}), email: row.email, Email: row.email }
      await upsertRow("ficha_dermatologica", row)
      await syncFichasCliente(cliente)
      const email = await sendFichaDermoEmail(row).catch((error: unknown) => ({
        sent: false,
        warning: error instanceof Error ? error.message : "No se pudo enviar el correo",
      }))
      return { ok: true, record: fromDb("ficha_dermatologica", row), email }
    }
    case "deleteFichaDermatologia":
      await deleteRow("ficha_dermatologica", textValue(params, "id"))
      return { ok: true }
    case "saveConsentMasaje": {
      const payload = parsePayload(params)
      const clienteId = await resolveClienteId(payload)
      const cliente = await upsertClienteCosmiatriaPreserving(clienteCosmiatriaToDb({ ...payload, ClienteID: clienteId }))
      const row = consentToDb({ ...payload, clienteId: cliente.cliente_id }, "masajes")
      await upsertRow("csl_consent_masajes", row)
      await syncFichasCliente(cliente)
      // Notificación por email (Resend) — el guardado nunca se pierde si
      // el correo falla; reportamos el warning al frontend.
      const email = await sendConsentMasajeEmail(row).catch((error: unknown) => ({
        sent: false,
        warning: error instanceof Error ? error.message : "No se pudo enviar el correo",
      }))
      return { ok: true, record: fromDb("csl_consent_masajes", row), email }
    }
    case "deleteConsentMasaje":
      await deleteRow("csl_consent_masajes", textValue(params, "id") || textValue(params, "consentId"))
      return { ok: true }
    case "saveConsentTatuajeCeja": {
      const payload = parsePayload(params)
      const clienteId = await resolveClienteId(payload)
      const cliente = await upsertClienteCosmiatriaPreserving(clienteCosmiatriaToDb({ ...payload, ClienteID: clienteId }))
      const row = consentToDb({ ...payload, clienteId: cliente.cliente_id }, "tatuajes")
      await upsertRow("csl_consent_tatuajes_cejas", row)
      await syncFichasCliente(cliente)
      // Notificación por email — patrón idéntico al de masajes / ficha derma.
      const email = await sendConsentTatuajeCejaEmail(row).catch((error: unknown) => ({
        sent: false,
        warning: error instanceof Error ? error.message : "No se pudo enviar el correo",
      }))
      return { ok: true, record: fromDb("csl_consent_tatuajes_cejas", row), email }
    }
    case "deleteConsentTatuajeCeja":
      await deleteRow("csl_consent_tatuajes_cejas", textValue(params, "id") || textValue(params, "consentId"))
      return { ok: true }
    case "getClienteHistorial": {
      // Devuelve TODO lo relacionado con un cliente: ficha + consents.
      // Útil para la vista "Historial" del módulo Clientes y para que el
      // formulario de consentimientos pueda detectar si el cliente ya tiene
      // ficha dermatológica.
      //
      // Las queries a csl_consent_masajes/csl_consent_tatuajes_cejas requieren la
      // columna `cliente_id` que se agrega en `csl_relate_consents.sql`. Si
      // la migración aún no se aplicó, devolvemos arrays vacíos y un
      // warning, en vez de romper toda la respuesta.
      const clienteId = textValue(params, "clienteId") || textValue(params, "id")
      if (!clienteId) throw new Error("Falta clienteId")
      const supabase = getSupabaseAdmin()
      const [cliente, fichas] = await Promise.all([
        supabase.from("csl_cosmiatria_clientes").select("*").eq("cliente_id", clienteId).maybeSingle(),
        supabase.from("csl_ficha_dermatologica").select("*").eq("cliente_id", clienteId).order("fecha", { ascending: false }),
      ])
      if (cliente.error) throw cliente.error
      if (fichas.error) throw fichas.error

      const safeQueryConsents = async (table: string) => {
        const res = await supabase.from(table).select("*").eq("cliente_id", clienteId).order("fecha", { ascending: false })
        if (res.error) {
          // 42703 = undefined_column. Pre-migración: sin vínculos posibles.
          if (/cliente_id|column.*does not exist|42703/i.test(res.error.message || "")) return []
          throw res.error
        }
        return (res.data || []) as Row[]
      }

      const [consMas, consTat] = await Promise.all([
        safeQueryConsents("csl_consent_masajes"),
        safeQueryConsents("csl_consent_tatuajes_cejas"),
      ])

      // Sesiones PulseControl: el campo `cliente` es texto libre (nombre).
      // Buscamos por coincidencia de nombre completo del cliente cargado.
      const clienteRow = cliente.data as Row | null
      const sesionesPulse: Row[] = []
      if (clienteRow) {
        const nombre = String(clienteRow.nombre || "").trim()
        const apellido = String(clienteRow.apellido || "").trim()
        const full = [nombre, apellido].filter(Boolean).join(" ")
        if (full.length >= 3) {
          const { data: ses, error: sesError } = await supabase
            .from("csl_sesiones_cliente")
            .select("*")
            .ilike("cliente", `%${full}%`)
            .order("fecha", { ascending: false })
            .limit(200)
          if (!sesError && Array.isArray(ses)) {
            sesionesPulse.push(...(ses as Row[]))
          }
        }
      }

      return {
        ok: true,
        cliente: clienteRow ? fromDb("cosmiatria_clientes", clienteRow) : null,
        fichas: ((fichas.data || []) as Row[]).map((row) => fromDb("ficha_dermatologica", row)),
        consentMasajes: consMas.map((row) => fromDb("csl_consent_masajes", row)),
        consentTatuajesCejas: consTat.map((row) => fromDb("csl_consent_tatuajes_cejas", row)),
        sesionesPulse: sesionesPulse.map((row) => fromDb("sesiones_cliente", row)),
      }
    }
    case "saveCertificadoRegalo": {
      const record = parsePayload(params)
      const row = {
        codigo: String(record.codigo ?? record.Codigo ?? params.codigo ?? `CSL-GC-${Date.now()}`),
        tipo: String(record.tipo ?? record.Tipo ?? "Digital"),
        fecha: dateValue(record.fecha ?? record.Fecha),
        sucursal: String(record.sucursal ?? record.Sucursal ?? ""),
        otorgado_a: String(record.otorgadoA ?? record.OtorgadoA ?? ""),
        cortesia_de: String(record.cortesiaDe ?? record.CortesiaDe ?? ""),
        valido_por: String(record.validoPor ?? record.ValidoPor ?? ""),
        firma: String(record.firma ?? record.Firma ?? ""),
        emitido_en: String(record.emitidoEn ?? record.EmitidoEn ?? new Date().toISOString()),
        estado: String(record.estado ?? record.Estado ?? "Emitido"),
        canjeado_en: record.canjeadoEn || record.CanjeadoEn ? String(record.canjeadoEn ?? record.CanjeadoEn) : null,
        notas_estado: String(record.notasEstado ?? record.NotasEstado ?? ""),
      }
      await upsertRow("certificados_regalo", row)
      return { ok: true, record: fromDb("certificados_regalo", row) }
    }
    case "deleteCertificadoRegalo":
      await deleteRow("certificados_regalo", textValue(params, "codigo") || textValue(params, "id"))
      return { ok: true }
    case "getCertificadosDepicenter":
      return { ok: true, records: await getRows("certificados_depicenter") }
    case "saveCertificadoDepicenter": {
      const record = parsePayload(params)
      const row = {
        codigo: String(record.codigo ?? record.Codigo ?? params.codigo ?? `DEPI-GC-${Date.now()}`),
        tipo: String(record.tipo ?? record.Tipo ?? "Digital"),
        fecha: dateValue(record.fecha ?? record.Fecha),
        fecha_vencimiento: dateValue(record.fechaVencimiento ?? record.FechaVencimiento),
        sucursal: String(record.sucursal ?? record.Sucursal ?? ""),
        otorgado_a: String(record.otorgadoA ?? record.OtorgadoA ?? ""),
        cortesia_de: String(record.cortesiaDe ?? record.CortesiaDe ?? ""),
        valido_por: String(record.validoPor ?? record.ValidoPor ?? ""),
        monto: record.monto != null && record.monto !== "" ? Number(record.monto) : null,
        servicio: String(record.servicio ?? ""),
        firma: String(record.firma ?? record.Firma ?? ""),
        emitido_en: String(record.emitidoEn ?? record.EmitidoEn ?? new Date().toISOString()),
        emitido_por: String(record.emitidoPor ?? record.EmitidoPor ?? ""),
        estado: String(record.estado ?? record.Estado ?? "Activo"),
        usado_en: record.usadoEn ? String(record.usadoEn) : null,
        fecha_uso: record.fechaUso ? String(record.fechaUso) : null,
        cancelado_en: record.canceladoEn ? String(record.canceladoEn) : null,
        notas_estado: String(record.notasEstado ?? record.NotasEstado ?? ""),
        cliente_nombre: String(record.clienteNombre ?? record.ClienteNombre ?? ""),
        cliente_telefono: String(record.clienteTelefono ?? record.ClienteTelefono ?? ""),
        cliente_correo: String(record.clienteCorreo ?? record.ClienteCorreo ?? ""),
        cliente_documento: String(record.clienteDocumento ?? record.ClienteDocumento ?? ""),
        observaciones: String(record.observaciones ?? record.Observaciones ?? ""),
      }
      await upsertRow("certificados_depicenter", row)
      return { ok: true, record: fromDb("certificados_depicenter", row) }
    }
    case "deleteCertificadoDepicenter":
      await deleteRow("certificados_depicenter", textValue(params, "codigo") || textValue(params, "id"))
      return { ok: true }
    case "addOperadora":
    case "updateOperadora":
    case "saveOperadora": {
      const record = parsePayload(params)
      const row = { operadora_id: String(record.OperadoraID ?? params.id ?? `op_${Date.now()}`), nombre: record.Nombre ?? "", sucursal: record.Sucursal ?? "", estado: record.Estado ?? "Activa", notas: record.Notas ?? "" }
      await upsertRow("operadoras", row)
      return { ok: true, record: fromDb("operadoras", row) }
    }
    case "deleteOperadora":
      await deleteRow("operadoras", textValue(params, "id"))
      return { ok: true }
    case "addLectura":
    case "updateLectura":
    case "saveLectura": {
      const record = parsePayload(params)
      const row = { lectura_id: String(record.LecturaID ?? params.id ?? `lec_${Date.now()}`), fecha_semana: dateValue(record.FechaSemana), equipo_id: record.EquipoID ?? "", sucursal: record.Sucursal ?? "", cabina: record.Cabina ?? "", operadora_id: record.OperadoraID ?? "", lectura_inicial: numberFrom(record, "LecturaInicial"), lectura_final: numberFrom(record, "LecturaFinal"), diferencia_real: numberFrom(record, "DiferenciaReal"), observaciones: record.Observaciones ?? "" }
      await upsertRow("lecturas_semanales", row)
      return { ok: true, record: fromDb("lecturas_semanales", row) }
    }
    case "deleteLectura":
      await deleteRow("lecturas_semanales", textValue(params, "id"))
      return { ok: true }
    case "addSesion":
    case "updateSesion":
    case "saveSesion": {
      const record = parsePayload(params)
      // Campos del Excel AgendaPro (opcionales — solo vienen en imports).
      const importHash = typeof record.ImportHash === "string" && record.ImportHash.trim() ? record.ImportHash.trim() : null
      const row = {
        sesion_id: String(record.SesionID ?? params.id ?? `ses_${Date.now()}`),
        fecha: dateValue(record.Fecha),
        sucursal: record.Sucursal ?? "",
        cabina: record.Cabina ?? "",
        operadora_id: record.OperadoraID ?? "",
        cliente: record.Cliente ?? "",
        area_trabajada: record.AreaTrabajada ?? "",
        disparos_reportados: numberFrom(record, "DisparosReportados"),
        duracion: record.Duracion ? Number(record.Duracion) : null,
        equipo_id: record.EquipoID ?? "",
        observaciones: record.Observaciones ?? "",
        // Columnas agregadas por 009_pulse_import_richer.sql. Las vacías
        // se mandan como null para que la DB respete los defaults.
        contacto_cliente: typeof record.ContactoCliente === "string" && record.ContactoCliente ? record.ContactoCliente : null,
        tratamiento: typeof record.Tratamiento === "string" && record.Tratamiento ? record.Tratamiento : null,
        potencia: typeof record.Potencia === "string" && record.Potencia ? record.Potencia : null,
        spot: typeof record.Spot === "string" && record.Spot ? record.Spot : null,
        archivo_origen: typeof record.ArchivoOrigen === "string" && record.ArchivoOrigen ? record.ArchivoOrigen : null,
        fila_origen: typeof record.FilaOrigen === "number" ? record.FilaOrigen : null,
        import_hash: importHash,
      }
      try {
        await upsertRow("sesiones_cliente", row)
      } catch (err) {
        // El UNIQUE parcial csl_sesiones_cliente_import_hash_uidx dispara
        // 23505 cuando el mismo Excel se sube dos veces. Esto NO es error
        // — es la dedupe robusta funcionando. Devolvemos OK con flag
        // `duplicate: true` para que el frontend lo cuente.
        const code = (err as { code?: string }).code
        const message = (err as { message?: string }).message || ""
        const isUniqueDup = code === "23505" || /duplicate key|import_hash/i.test(message)
        if (isUniqueDup && importHash) {
          return { ok: true, duplicate: true }
        }
        throw err
      }
      return { ok: true, record: fromDb("sesiones_cliente", row) }
    }
    case "deleteSesion":
      await deleteRow("sesiones_cliente", textValue(params, "id"))
      return { ok: true }
    case "addAuditoria":
    case "updateAuditoria":
    case "saveAuditoria": {
      const record = parsePayload(params)
      const archivoExcel = (() => {
        const v = record.ArchivoExcel
        if (Array.isArray(v)) return v
        if (typeof v === "string" && v.trim()) {
          try { const p = JSON.parse(v); return Array.isArray(p) ? p : [] } catch { return [] }
        }
        return []
      })()
      const row: Record<string, unknown> = {
        auditoria_id: String(record.AuditoriaID ?? params.id ?? `aud_${Date.now()}`),
        fecha_semana: dateValue(record.FechaSemana),
        equipo_id: record.EquipoID ?? "",
        sucursal: record.Sucursal ?? "",
        pulsos_reales: numberFrom(record, "PulsosReales"),
        pulsos_reportados: numberFrom(record, "PulsosReportados"),
        diferencia: numberFrom(record, "Diferencia"),
        porcentaje_desviacion: numberFrom(record, "PorcentajeDesviacion"),
        alerta: record.Alerta ?? "OK",
        observaciones: record.Observaciones ?? "",
        // Columnas agregadas por 010_pulse_cuadre_semanal_auditoria.sql
        cabina: typeof record.Cabina === "string" && record.Cabina ? record.Cabina : null,
        semana_fin: record.SemanaFin ? dateValue(record.SemanaFin) : null,
        lectura_inicial: record.LecturaInicial !== undefined && record.LecturaInicial !== null && record.LecturaInicial !== ""
          ? numberFrom(record, "LecturaInicial") : null,
        lectura_final: record.LecturaFinal !== undefined && record.LecturaFinal !== null && record.LecturaFinal !== ""
          ? numberFrom(record, "LecturaFinal") : null,
        creado_por: typeof record.CreadoPor === "string" && record.CreadoPor ? record.CreadoPor : null,
        archivo_excel: archivoExcel,
        fotos_count: typeof record.FotosCount === "number" ? record.FotosCount : 0,
        fuente: typeof record.Fuente === "string" && record.Fuente ? record.Fuente : null,
      }
      // Upsert via PK (auditoria_id). El UNIQUE parcial sobre
      // (business_id, fecha_semana, equipo_id, sucursal, coalesce(cabina,''))
      // garantiza que re-correr el cuadre de la misma semana+equipo+cabina
      // colisione si el auditoria_id es nuevo — el wizard ya envía un id
      // determinístico para evitarlo.
      try {
        await upsertRow("auditorias_semanales", row)
      } catch (err) {
        const code = (err as { code?: string }).code
        const message = (err as { message?: string }).message || ""
        if (code === "23505" || /semana_equipo|duplicate key/i.test(message)) {
          return { ok: false, error: "Ya existe un cuadre para esta semana/equipo/cabina. Reemplázalo desde el wizard si quieres regenerarlo." }
        }
        throw err
      }
      return { ok: true, record: fromDb("auditorias_semanales", row) }
    }
    case "deleteAuditoria":
      await deleteRow("auditorias_semanales", textValue(params, "id"))
      return { ok: true }

    // ── PulseControl: nueva tabla canónica csl_pulse_readings ──────────────

    case "getPulseReadings": {
      const sb = getSupabaseAdmin()
      const { data: profile } = await sb
        .from("csl_user_profiles").select("business_id").eq("user_id", user.id).single()
      if (!profile?.business_id) throw new Error("business_id no encontrado")
      const { data, error } = await sb
        .from("csl_pulse_readings")
        .select("*")
        .eq("business_id", profile.business_id)
        .order("period_start", { ascending: false })
      if (error) throw error
      return { ok: true, records: data || [] }
    }

    case "savePulseReading": {
      const record = parsePayload(params)
      const sb = getSupabaseAdmin()
      const { data: profile } = await sb
        .from("csl_user_profiles")
        .select("business_id")
        .eq("user_id", user.id)
        .single()
      if (!profile?.business_id) throw new Error("business_id no encontrado")

      const row: Record<string, unknown> = {
        business_id: profile.business_id,
        equipo_id: textFrom(record, "equipo_id"),
        serial: textFrom(record, "serial") || null,
        sucursal: textFrom(record, "sucursal"),
        cabina: textFrom(record, "cabina") || null,
        operadora: textFrom(record, "operadora") || null,
        period_start: textFrom(record, "period_start"),
        period_end: textFrom(record, "period_end"),
        period_label: textFrom(record, "period_label") || null,
        lectura_inicial: numberFrom(record, "lectura_inicial"),
        lectura_final: numberFrom(record, "lectura_final"),
        disp_operador: record.disp_operador != null ? numberFrom(record, "disp_operador") : null,
        diferencia_pct: record.diferencia_pct != null ? numberFrom(record, "diferencia_pct") : null,
        estado_cuadre: textFrom(record, "estado_cuadre") || "lectura_guardada",
        estado_mantenimiento: textFrom(record, "estado_mantenimiento") || null,
        fallas: textFrom(record, "fallas") || null,
        source_file: textFrom(record, "source_file") || null,
        source_type: textFrom(record, "source_type") || "manual",
        observaciones: textFrom(record, "observaciones") || null,
        updated_at: new Date().toISOString(),
      }
      if (textFrom(record, "id")) row.id = textFrom(record, "id")

      const { data, error } = await sb
        .from("csl_pulse_readings")
        .upsert(row, { onConflict: "business_id,equipo_id,period_start,period_end" })
        .select()
        .single()
      if (error) throw error

      // Sincronizar campos del equipo si la lectura final es válida
      if (row.equipo_id && Number(row.lectura_final) > 0) {
        const equipoUpdate: Record<string, unknown> = {
          p_cabeza: row.lectura_final,
          ultima_actualizacion_pulsos: new Date().toISOString(),
        }
        if (row.period_label) equipoUpdate.ultima_semana_pulsos = row.period_label
        if (row.sucursal) equipoUpdate.sucursal = row.sucursal
        if (row.cabina) equipoUpdate.cabina = row.cabina
        if (row.operadora) equipoUpdate.operadora = row.operadora
        if (row.serial) equipoUpdate.serie = row.serial
        if (row.fallas) equipoUpdate.fallas_recientes = row.fallas
        await sb
          .from("csl_equipos")
          .update(equipoUpdate)
          .eq("equipo_id", row.equipo_id as string)
          .eq("business_id", profile.business_id)
      }
      return { ok: true, record: data }
    }

    case "deletePulseReading": {
      const id = textValue(params, "id")
      if (!id) throw new Error("id obligatorio")
      const sb = getSupabaseAdmin()
      const { data: profile } = await sb
        .from("csl_user_profiles").select("business_id").eq("user_id", user.id).single()
      if (!profile?.business_id) throw new Error("business_id no encontrado")
      const { error } = await sb
        .from("csl_pulse_readings")
        .delete()
        .eq("id", id)
        .eq("business_id", profile.business_id)
      if (error) throw error
      return { ok: true }
    }

    case "recalculatePulseContinuity": {
      const sb = getSupabaseAdmin()
      const { data: profile } = await sb
        .from("csl_user_profiles")
        .select("business_id")
        .eq("user_id", user.id)
        .single()
      if (!profile?.business_id) throw new Error("business_id no encontrado")

      const { data: all, error: fetchErr } = await sb
        .from("csl_pulse_readings")
        .select("*")
        .eq("business_id", profile.business_id)
        .order("period_start", { ascending: true })
      if (fetchErr) throw fetchErr

      const byEquipo = new Map<string, typeof all>()
      for (const r of (all || [])) {
        if (!byEquipo.has(r.equipo_id)) byEquipo.set(r.equipo_id, [])
        byEquipo.get(r.equipo_id)!.push(r)
      }

      let fixed = 0
      for (const [, readings] of byEquipo) {
        const sorted = [...(readings || [])].sort((a, b) => String(a.period_start).localeCompare(String(b.period_start)))
        for (let i = 1; i < sorted.length; i++) {
          const prev = sorted[i - 1]
          const cur = sorted[i]
          const correctInicial = Number(prev.lectura_final)
          if (Number(cur.lectura_inicial) !== correctInicial) {
            const { error } = await sb
              .from("csl_pulse_readings")
              .update({ lectura_inicial: correctInicial, updated_at: new Date().toISOString() })
              .eq("id", cur.id)
            if (!error) fixed++
          }
        }
      }
      return { ok: true, fixed }
    }

    case "getOperatorShots": {
      // Devuelve el resumen semanal de disparos por operadora (csl_operator_shots).
      // Si la tabla aún no existe (migración pendiente), devuelve [] sin error.
      const sb = getSupabaseAdmin()
      const { data: profile } = await sb
        .from("csl_user_profiles").select("business_id").eq("user_id", user.id).single()
      if (!profile?.business_id) throw new Error("business_id no encontrado")
      const { data, error } = await sb
        .from("csl_operator_shots")
        .select("*")
        .eq("business_id", profile.business_id)
        .order("period_start", { ascending: false })
      if (error) {
        const code = (error as { code?: string }).code
        if (code === "42P01") return { ok: true, records: [], tableMissing: true }
        throw error
      }
      return { ok: true, records: data || [] }
    }

    case "deleteOperatorShot": {
      // Borra una fila de csl_operator_shots por id, scopeada por tenant.
      const id = textValue(params, "id")
      if (!id) throw new Error("id obligatorio")
      const sb = getSupabaseAdmin()
      const { data: profile } = await sb
        .from("csl_user_profiles").select("business_id").eq("user_id", user.id).single()
      if (!profile?.business_id) throw new Error("business_id no encontrado")
      const { error } = await sb
        .from("csl_operator_shots")
        .delete()
        .eq("id", id)
        .eq("business_id", profile.business_id)
      if (error) {
        const code = (error as { code?: string }).code
        if (code === "42P01") return { ok: true, tableMissing: true }
        throw error
      }
      return { ok: true }
    }

    case "deleteOperatorShotsByPeriod": {
      // Borra todos los shots de una semana específica (period_start + period_end).
      const periodStart = textValue(params, "periodStart")
      const periodEnd = textValue(params, "periodEnd")
      if (!periodStart || !periodEnd) throw new Error("periodStart y periodEnd obligatorios")
      const sb = getSupabaseAdmin()
      const { data: profile } = await sb
        .from("csl_user_profiles").select("business_id").eq("user_id", user.id).single()
      if (!profile?.business_id) throw new Error("business_id no encontrado")
      const { data, error } = await sb
        .from("csl_operator_shots")
        .delete()
        .eq("business_id", profile.business_id)
        .eq("period_start", periodStart)
        .eq("period_end", periodEnd)
        .select("id")
      if (error) {
        const code = (error as { code?: string }).code
        if (code === "42P01") return { ok: true, deleted: 0, tableMissing: true }
        throw error
      }
      return { ok: true, deleted: (data || []).length }
    }

    case "saveOperatorShots": {
      // Upsert por (business_id, period_start, period_end, sucursal_normalizada,
      // operadora_normalizada). Acepta payload: { rows: OperatorShotRow[] }.
      const payload = parsePayload(params) as { rows?: unknown[] }
      const rowsInput = Array.isArray(payload.rows) ? payload.rows : []
      if (!rowsInput.length) return { ok: true, upserted: 0 }
      const sb = getSupabaseAdmin()
      const { data: profile } = await sb
        .from("csl_user_profiles").select("business_id").eq("user_id", user.id).single()
      if (!profile?.business_id) throw new Error("business_id no encontrado")

      const now = new Date().toISOString()
      const toUpsert = rowsInput.map((raw) => {
        const r = raw as Record<string, unknown>
        return {
          business_id: profile.business_id,
          period_start: String(r.period_start || ""),
          period_end: String(r.period_end || ""),
          period_label: r.period_label ? String(r.period_label) : null,
          sucursal_original: r.sucursal_original ? String(r.sucursal_original) : null,
          sucursal_normalizada: String(r.sucursal_normalizada || ""),
          operadora_original: r.operadora_original ? String(r.operadora_original) : null,
          operadora_normalizada: String(r.operadora_normalizada || ""),
          sesiones: Number(r.sesiones) || 0,
          disparos: Number(r.disparos) || 0,
          source_file: r.source_file ? String(r.source_file) : null,
          source_type: r.source_type ? String(r.source_type) : "agendapro",
          updated_at: now,
        }
      }).filter(r =>
        r.period_start && r.period_end && r.sucursal_normalizada && r.operadora_normalizada
      )
      if (!toUpsert.length) return { ok: true, upserted: 0 }

      const { data, error } = await sb
        .from("csl_operator_shots")
        .upsert(toUpsert, {
          onConflict: "business_id,period_start,period_end,sucursal_normalizada,operadora_normalizada",
        })
        .select()
      if (error) {
        const code = (error as { code?: string }).code
        if (code === "42P01") {
          console.warn("csl_operator_shots no existe — migración pendiente. Saltando persistencia.")
          return { ok: true, upserted: 0, tableMissing: true }
        }
        throw error
      }
      return { ok: true, upserted: (data || []).length }
    }

    case "recalculateDispOperador": {
      // Recalcula disp_operador en csl_pulse_readings agregando desde
      // csl_sesiones_cliente por (business_id, period_start..period_end,
      // sucursal_normalizada, operadora_normalizada). Idempotente.
      //
      // Params opcionales (todos string):
      //   periodStart, periodEnd   → limitar a un rango específico
      //   sucursal                 → limitar a una sucursal (canónica)
      // Si no se pasan, recalcula TODAS las lecturas del tenant.
      const sb = getSupabaseAdmin()
      const { data: profile } = await sb
        .from("csl_user_profiles")
        .select("business_id")
        .eq("user_id", user.id)
        .single()
      if (!profile?.business_id) throw new Error("business_id no encontrado")

      const filterPeriodStart = textValue(params, "periodStart") || null
      const filterPeriodEnd = textValue(params, "periodEnd") || null
      const filterSucursal = textValue(params, "sucursal") || null

      let readingsQuery = sb
        .from("csl_pulse_readings")
        .select("*")
        .eq("business_id", profile.business_id)
      if (filterPeriodStart) readingsQuery = readingsQuery.gte("period_start", filterPeriodStart)
      if (filterPeriodEnd) readingsQuery = readingsQuery.lte("period_end", filterPeriodEnd)
      const { data: readings, error: rErr } = await readingsQuery
      if (rErr) throw rErr

      // Fuente PRIMARIA: csl_operator_shots (resumen semanal por sucursal+op).
      // Fuente FALLBACK: csl_sesiones_cliente (filas individuales) cuando el
      // tenant no tiene operator_shots o la tabla no existe.
      const shotsByKey = new Map<string, number>()
      try {
        const { data: shots, error: shErr } = await sb
          .from("csl_operator_shots")
          .select("period_start, period_end, sucursal_normalizada, operadora_normalizada, disparos")
          .eq("business_id", profile.business_id)
        if (!shErr && shots) {
          for (const s of shots) {
            const k = `${String(s.period_start).slice(0, 10)}|${String(s.period_end).slice(0, 10)}|${String(s.sucursal_normalizada || "").toUpperCase()}|${String(s.operadora_normalizada || "").toUpperCase()}`
            shotsByKey.set(k, (shotsByKey.get(k) || 0) + Number(s.disparos || 0))
          }
        }
      } catch {
        // operator_shots no disponible — usaremos solo sesiones_cliente
      }

      // Sesiones individuales como fallback / complemento
      const periodStarts = (readings || []).map(r => String(r.period_start)).filter(Boolean)
      const periodEnds = (readings || []).map(r => String(r.period_end)).filter(Boolean)
      const minDate = periodStarts.length ? periodStarts.reduce((a, b) => (a < b ? a : b)) : null
      const maxDate = periodEnds.length ? periodEnds.reduce((a, b) => (a > b ? a : b)) : null

      let sesionesQuery = sb
        .from("csl_sesiones_cliente")
        .select("fecha, sucursal, operadora_id, disparos_reportados")
        .eq("business_id", profile.business_id)
      if (minDate) sesionesQuery = sesionesQuery.gte("fecha", minDate)
      if (maxDate) sesionesQuery = sesionesQuery.lte("fecha", maxDate)
      const { data: sesiones, error: sErr } = await sesionesQuery
      if (sErr) throw sErr

      type Sesion = { fecha: string; sucursal: string; operadora_id: string; disparos_reportados: number }
      const sesionList: Sesion[] = (sesiones || []).map(s => ({
        fecha: String(s.fecha || "").slice(0, 10),
        sucursal: String(s.sucursal || ""),
        operadora_id: String(s.operadora_id || ""),
        disparos_reportados: Number(s.disparos_reportados) || 0,
      }))

      let updated = 0
      let unchanged = 0
      let skipped = 0
      for (const r of (readings || [])) {
        const matchKey = makeAgendaMatchKey(r.sucursal, r.operadora)
        if (!matchKey) { skipped += 1; continue }
        if (filterSucursal && makeAgendaMatchKey(r.sucursal, "x").split("|")[0] !== filterSucursal.toUpperCase()) {
          skipped += 1
          continue
        }
        const desde = String(r.period_start).slice(0, 10)
        const hasta = String(r.period_end).slice(0, 10)
        const [sucNorm, opNorm] = matchKey.split("|")

        // 1) Intento por operator_shots (match exacto por período + clave)
        const shotsKey = `${desde}|${hasta}|${sucNorm}|${opNorm}`
        let suma = shotsByKey.get(shotsKey) || 0

        // 2) Si no hay shot, fallback a sesionesCliente sumando por rango
        if (suma === 0) {
          for (const s of sesionList) {
            if (!s.fecha || s.fecha < desde || s.fecha > hasta) continue
            if (makeAgendaMatchKey(s.sucursal, s.operadora_id) !== matchKey) continue
            suma += s.disparos_reportados
          }
        }

        const currentValue = r.disp_operador == null ? null : Number(r.disp_operador)
        const newValue = suma > 0 ? suma : null
        if (currentValue === newValue) { unchanged += 1; continue }

        const dispLaser = Number(r.disp_laser) || 0
        const newPct = newValue != null && dispLaser > 0
          ? Math.round(((newValue - dispLaser) / dispLaser) * 10000) / 100
          : null

        const { error: uErr } = await sb
          .from("csl_pulse_readings")
          .update({
            disp_operador: newValue,
            diferencia_pct: newPct,
            updated_at: new Date().toISOString(),
          })
          .eq("id", r.id)
          .eq("business_id", profile.business_id)
        if (!uErr) updated += 1
      }

      return {
        ok: true,
        updated,
        unchanged,
        skipped,
        total: (readings || []).length,
      }
    }

    default:
      return { ok: false, error: `Accion no soportada: ${action}` }
  }
}

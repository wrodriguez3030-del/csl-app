/**
 * Dispatcher central de las acciones soportadas por /api/csl.
 *
 * Mantiene el contrato `action: "..."` que el frontend ya envía — agregar
 * acciones nuevas implica añadir un `case` aquí, no cambiar la firma.
 *
 * Server-only.
 */

import { ALL_MENU_IDS } from "@/lib/menus"
import { lunchMinutesForShift } from "@/lib/work-hours"
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
  getRowBusinessIds,
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
import { runWithBusinessContext, applyActiveBusiness, getBusinessContext, isKnownBusinessId, scopeByBranch } from "@/lib/server/business-context"
import { runWithMaintenanceWriteScope, type MaintenanceChangeSource } from "@/lib/server/maintenance-guard"

/**
 * Acciones MANUALES del módulo de Mantenimiento. Solo estas pueden escribir en
 * las tablas protegidas (csl_equipos, csl_reportes, csl_piezas, csl_tecnicos,
 * csl_inventario, csl_piezas_poliza_lista). Cualquier otra escritura a esas
 * tablas (PulseControl, import, sync, seed, scripts) queda bloqueada por el
 * guard en csl-crud.ts.
 */
const MAINTENANCE_MANUAL_ACTIONS = new Set<string>([
  // Equipos
  "saveEquipo", "updateEquipoCampos", "setEquipoEstado", "deleteEquipo",
  // Técnicos
  "saveTecnico", "setTecnicoEstado", "deleteTecnico",
  // Piezas (catálogo)
  "savePieza", "deletePieza",
  // Reportes
  "saveReporte", "updateReporteCampos", "deleteReporte",
  // Inventario
  "addInventario", "updateInventario", "saveInventario", "deleteInventario",
  // Lista piezas póliza
  "savePiezaPolizaLista", "markPiezaPolizaRecibida", "markPiezaPolizaPendiente", "deletePiezaPolizaLista",
])

/**
 * Resuelve el business_id objetivo para una escritura de Mantenimiento sobre un
 * registro identificado por `keyValue` en `entity`.
 *
 *   1. Usuario scopeado (admin/técnico, o superadmin con un negocio activo):
 *      se usa SIEMPRE su propio tenant. No puede tocar otro.
 *   2. Superadmin en modo "Todos los negocios" (bypassTenantFilter): no hay
 *      tenant implícito. Se prefiere el `businessId` que mande la UI; si no
 *      llega (ej. frontend cacheado viejo), se DEDUCE del propio registro.
 *      - 1 dueño  → ese.
 *      - 0 dueños → no existe / hay que crearlo eligiendo negocio.
 *      - >1 dueño → la clave colisiona entre negocios; exige elección.
 *
 * Sin esto un UPDATE en modo "Todos" tocaría ambos tenants (los equipo_id
 * colisionan entre CSL y Depicenter).
 */
async function resolveMaintenanceTargetBusiness(
  params: ActionParams,
  entity: string,
  keyValue: string,
): Promise<string> {
  const ctx = getBusinessContext()
  const fromParams = textValue(params, "businessId")

  // Superadmin: el negocio objetivo es el del REGISTRO que se edita (no un
  // "activo" global), para nunca tocar el homónimo del otro tenant (los
  // equipo_id 1/2/3 colisionan entre CSL y Depicenter). Se prefiere el
  // business_id que manda la UI; si no llega, se deduce del propio registro.
  if (ctx?.isSuperadmin) {
    if (isKnownBusinessId(fromParams)) return fromParams
    const owners = await getRowBusinessIds(entity, keyValue)
    if (owners.length === 1) return owners[0]
    if (owners.length === 0) return ctx.businessId // registro nuevo → su negocio
    throw new Error("Selecciona un negocio específico para editar este equipo.")
  }

  // Usuario NO superadmin (admin/técnico): SIEMPRE su propio tenant. Si la UI
  // manda OTRO business_id, es un intento cross-tenant → error explícito (jamás
  // se escribe en silencio en el tenant equivocado). Cibao no edita Depicenter
  // ni viceversa.
  if (ctx) {
    if (isKnownBusinessId(fromParams) && fromParams !== ctx.businessId) {
      throw new Error("No puedes editar equipos de otro negocio.")
    }
    return ctx.businessId
  }

  // Sin contexto (scripts/migraciones): usar el de params o deducir.
  if (isKnownBusinessId(fromParams)) return fromParams
  const owners = await getRowBusinessIds(entity, keyValue)
  if (owners.length === 1) return owners[0]
  throw new Error("Selecciona un negocio específico para editar este equipo.")
}
import { createHash, randomBytes } from "node:crypto"
import { haversineMeters } from "@/lib/hr-geo"
import { makeAgendaMatchKey, normalizeSucursal } from "@/lib/normalize-pulse"
import { toUpperField, toUpperFieldOrNull } from "@/lib/normalize-fields"
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
  sendConsentPeelingEmail,
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

/** CRUD genérico context-aware para módulos simples (Fase 5 Desarrollo). */
async function devList(table: string) {
  const sb = getSupabaseAdmin()
  let q = sb.from(table).select("*").order("created_at", { ascending: false })
  if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
  const { data, error } = await q
  if (error) { if (isMissingTable(error)) return { ok: true, records: [], tableMissing: true }; throw error }
  return { ok: true, records: data || [] }
}
async function devSave(table: string, module: string, user: ActionUser, record: Row, fields: string[]) {
  const businessId = effectiveBusinessId()
  if (!businessId) throw new Error("business_id no encontrado")
  const row: Record<string, unknown> = {
    business_id: businessId, updated_at: new Date().toISOString(),
    created_by: textFrom(record, "created_by") || user.id,
  }
  for (const f of fields) {
    if (record[f] !== undefined) row[f] = record[f] === "" ? null : record[f]
  }
  const id = textFrom(record, "id")
  if (id) row.id = id
  const { data, error } = await getSupabaseAdmin().from(table).upsert(row, { onConflict: "id" }).select().single()
  if (error) { if (isMissingTable(error)) return { ok: false, tableMissing: true, error: "Migración pendiente" }; throw error }
  await hrAudit(user, module, id ? "update" : "create", table, String((data as { id: string }).id), null, data)
  return { ok: true, record: data }
}
async function devDelete(table: string, module: string, user: ActionUser, id: string) {
  if (!id) throw new Error("id obligatorio")
  let q = getSupabaseAdmin().from(table).delete().eq("id", id)
  if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
  const { error } = await q
  if (error) { if (isMissingTable(error)) return { ok: true, tableMissing: true }; throw error }
  await hrAudit(user, module, "delete", table, id, null, null)
  return { ok: true }
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
/**
 * Salario de Navidad proporcional (art. 219 C.T.): salario ordinario devengado
 * en el año / 12. Periodo: 1-ene (o ingreso si fue ese año) → fecha de salida.
 * Devuelve meses y días en el formato del Ministerio (mes = 30 días).
 */
function navidadProporcional(ing: Date | null, sal: Date, mensual: number) {
  const y = sal.getUTCFullYear()
  const sameYear = ing && !Number.isNaN(ing.getTime()) && ing.getUTCFullYear() === y
  const startMonth = sameYear ? (ing as Date).getUTCMonth() + 1 : 1
  const startDay = sameYear ? (ing as Date).getUTCDate() : 1
  let months = (sal.getUTCMonth() + 1) - startMonth
  let days = sal.getUTCDate() - startDay + 1 // inclusivo (criterio Ministerio)
  while (days >= 30) { months += 1; days -= 30 }
  while (days < 0) { months -= 1; days += 30 }
  if (months < 0) { months = 0; days = 0 }
  const fraction = months + days / 30
  return { meses: months, dias: days, monto: round2(mensual * fraction / 12) }
}

/**
 * Cálculo de prestaciones laborales RD (formato Ministerio de Trabajo).
 * Usa salario diario a precisión completa (mensual/23.83) y redondea solo al
 * final, para cuadrar con la calculadora oficial.
 *   - Preaviso (art. 76): >1 año = 28 días.
 *   - Cesantía (art. 80): 1-5 años = 21 días/año; >5 años = 23 días/año (todos).
 *   - Vacaciones (art. 177): 1-5 años = 14 días; >=5 años = 18 días.
 *   - Navidad (art. 219): proporcional al año.
 */
function computeSeverance(motivo: string, fechaIngreso: string, fechaSalida: string, mensual: number) {
  const ing = fechaIngreso ? new Date(fechaIngreso) : null
  const sal = fechaSalida ? new Date(fechaSalida) : new Date()
  const t = ing && !Number.isNaN(ing.getTime()) ? Math.max(0, (sal.getTime() - ing.getTime()) / (365.25 * 24 * 3600 * 1000)) : 0
  const aniosCompletos = Math.floor(t + 1e-9)
  const diarioFull = mensual / HR_DAILY_BASE // sin redondear: precisión Ministerio
  const aplicaPreCes = motivo === "desahucio" || motivo === "despido_injustificado"
  let preavisoDias = 0, cesantiaDias = 0
  if (aplicaPreCes) {
    if (t >= 1) preavisoDias = 28
    else if (t >= 0.5) preavisoDias = 14
    else if (t >= 0.25) preavisoDias = 7
    if (t > 5) cesantiaDias = 23 * aniosCompletos
    else if (t >= 1) cesantiaDias = 21 * aniosCompletos
    else if (t >= 0.5) cesantiaDias = 13
    else if (t >= 0.25) cesantiaDias = 6
  }
  const vacacionesDias = diasVacacionesRD(t)
  const nav = navidadProporcional(ing, sal, mensual)
  // Días sobre los años completos, por calendario e inclusivo (criterio Ministerio).
  let diasTrabajados = 0
  if (ing && !Number.isNaN(ing.getTime())) {
    const anchor = Date.UTC(ing.getUTCFullYear() + aniosCompletos, ing.getUTCMonth(), ing.getUTCDate())
    diasTrabajados = Math.max(0, Math.round((sal.getTime() - anchor) / 86400000) + 1)
  }
  return {
    anios_servicio: round2(t),
    tiempo_anios: aniosCompletos, tiempo_dias: diasTrabajados,
    salario_diario: round2(diarioFull),
    preaviso_dias: preavisoDias, preaviso_monto: round2(diarioFull * preavisoDias),
    cesantia_dias: cesantiaDias, cesantia_monto: round2(diarioFull * cesantiaDias),
    vacaciones_dias: vacacionesDias, vacaciones_monto: round2(diarioFull * vacacionesDias),
    navidad_meses: nav.meses, navidad_dias: nav.dias, navidad_monto: nav.monto,
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

/** Días de vacaciones legales RD según antigüedad (Código de Trabajo). */
function diasVacacionesRD(anios: number): number {
  return anios >= 5 ? 18 : anios >= 1 ? 14 : 0
}
/**
 * Meses trabajados dentro de un año (para doble sueldo / salario de Navidad).
 * Desde el mes de ingreso (si ingresó ese año) hasta diciembre, o hasta el mes
 * de salida si existe. Año completo = 12.
 */
function mesesTrabajadosAnio(fechaIngreso: string, anio: number, fechaSalida?: string): number {
  if (!fechaIngreso) return 12
  const ing = new Date(fechaIngreso)
  if (Number.isNaN(ing.getTime())) return 12
  if (ing.getUTCFullYear() > anio) return 0
  const startMonth = ing.getUTCFullYear() === anio ? ing.getUTCMonth() + 1 : 1
  let endMonth = 12
  if (fechaSalida) {
    const sal = new Date(fechaSalida)
    if (!Number.isNaN(sal.getTime())) {
      if (sal.getUTCFullYear() < anio) return 0
      if (sal.getUTCFullYear() === anio) endMonth = sal.getUTCMonth() + 1
    }
  }
  return Math.max(0, Math.min(12, endMonth - startMonth + 1))
}
/** Antigüedad en años (decimal) entre fecha de ingreso y una fecha de referencia. */
function antiguedadAnios(fechaIngreso: string, ref: Date): number {
  if (!fechaIngreso) return 0
  const ing = new Date(fechaIngreso)
  if (Number.isNaN(ing.getTime())) return 0
  const years = (ref.getTime() - ing.getTime()) / (365.25 * 24 * 3600 * 1000)
  return years > 0 ? years : 0
}
/**
 * Datos del empleado para vacaciones: csl_empleados → fallback a solicitudes de
 * empleo APROBADAS. La fecha de ingreso vive en payload_json.fechaIngresoLaboral.
 */
async function vacEmpInfo(businessId: string, employeeId: string) {
  const sb = getSupabaseAdmin()
  const t = (...vals: unknown[]) => { for (const v of vals) { const s = v == null ? "" : String(v).trim(); if (s) return s } return "" }
  const pick = (row: Record<string, unknown>) => {
    const pj = (row.payload_json || {}) as Record<string, unknown>
    return {
      nombre: `${t(row.nombre, pj.nombre, pj.Nombre)} ${t(row.apellido, pj.apellido, pj.Apellido)}`.trim(),
      cedula: t(row.cedula, pj.cedula, pj.Cedula),
      puesto: t(row.puesto_solicitado, row.puesto, pj.puestoSolicitado, pj.PuestoSolicitado, pj.puesto),
      sucursal: t(row.sucursal, pj.sucursal, pj.Sucursal),
      fecha_ingreso: t(pj.fechaIngresoLaboral, pj.FechaIngresoLaboral, row.fecha_ingreso, pj.fechaIngreso, row.fecha_solicitud),
      salario: Number(row.salario ?? pj.salario ?? pj.Salario ?? 0) || 0,
    }
  }
  const { data: emp } = await sb.from("csl_empleados").select("*").eq("business_id", businessId).eq("empleado_id", employeeId).maybeSingle()
  if (emp) return pick(emp as Record<string, unknown>)
  const { data: sol } = await sb.from("csl_solicitudes_empleo").select("*").eq("business_id", businessId).eq("solicitud_id", employeeId).maybeSingle()
  if (sol) return pick(sol as Record<string, unknown>)
  return { nombre: "", cedula: "", puesto: "", sucursal: "", fecha_ingreso: "", salario: 0 }
}

/** "HH:MM" → minutos desde medianoche (null si vacío/ inválido). */
function hhmmToMin(hhmm: unknown): number | null {
  const s = String(hhmm ?? "").trim()
  if (!s) return null
  const [h, m] = s.split(":")
  const n = Number(h) * 60 + Number(m || 0)
  return Number.isFinite(n) ? n : null
}
type SchedDay = { source: "employee" | "branch"; sucursal: string | null; is_working_day: boolean; start_time: string | null; end_time: string | null; break_minutes: number }
/** Horario efectivo de un empleado para una fecha (YYYY-MM-DD); fallback a la sucursal. */
async function empScheduleForDate(businessId: string, employeeId: string, dateStr: string, sucursalFallback: string | null): Promise<SchedDay | null> {
  const sb = getSupabaseAdmin()
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay() // 0=Dom … 6=Sáb
  const { data: scheds } = await sb.from("hr_employee_schedules")
    .select("id, sucursal, effective_from, effective_to")
    .eq("business_id", businessId).eq("employee_id", employeeId).eq("active", true)
    .order("effective_from", { ascending: false })
  for (const s of ((scheds || []) as Array<{ id: string; sucursal: string | null; effective_from: string | null; effective_to: string | null }>)) {
    const from = s.effective_from ? String(s.effective_from).slice(0, 10) : null
    const to = s.effective_to ? String(s.effective_to).slice(0, 10) : null
    if (from && dateStr < from) continue
    if (to && dateStr > to) continue
    const { data: day } = await sb.from("hr_employee_schedule_days").select("*").eq("schedule_id", s.id).eq("day_of_week", dow).maybeSingle()
    const d = day as { is_working_day?: boolean; start_time?: string; end_time?: string; break_minutes?: number } | null
    if (d) return { source: "employee", sucursal: s.sucursal, is_working_day: d.is_working_day !== false, start_time: d.start_time ?? null, end_time: d.end_time ?? null, break_minutes: Number(d.break_minutes || 0) }
    return { source: "employee", sucursal: s.sucursal, is_working_day: false, start_time: null, end_time: null, break_minutes: 0 }
  }
  const suc = sucursalFallback || ""
  if (suc) {
    const { data: geo } = await sb.from("hr_branch_geofences").select("workday_config").eq("business_id", businessId).eq("sucursal", suc).maybeSingle()
    const cfg = (geo as { workday_config?: Record<string, { working?: boolean; start?: string; end?: string; break?: number }> } | null)?.workday_config
    const dc = cfg ? cfg[String(dow)] : null
    if (dc) return { source: "branch", sucursal: suc, is_working_day: dc.working !== false, start_time: dc.start ?? null, end_time: dc.end ?? null, break_minutes: Number(dc.break || 0) }
  }
  return null
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
    // Las acciones manuales del módulo de Mantenimiento declaran un origen de
    // cambio autorizado (manual_tecnico|manual_admin). Solo bajo este scope la
    // capa CRUD permite escribir en las tablas protegidas de mantenimiento.
    if (MAINTENANCE_MANUAL_ACTIONS.has(action)) {
      const source: MaintenanceChangeSource =
        effectiveContext?.isAdmin || effectiveContext?.isSuperadmin ? "manual_admin" : "manual_tecnico"
      return runWithMaintenanceWriteScope(
        { source, userId: user.id, userEmail: user.email },
        () => dispatchAction(action, params, user),
      )
    }
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
    case "getHrContractPrefill": {
      // Autocompleta datos del contrato desde el empleado central + la solicitud
      // de empleo aprobada (top-level + payload_json). Scoped por business_id.
      const sb = getSupabaseAdmin()
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const employeeId = textValue(params, "employee_id")
      if (!employeeId) throw new Error("employee_id obligatorio")
      const { data: emp } = await sb.from("csl_empleados").select("*").eq("business_id", businessId).eq("empleado_id", employeeId).maybeSingle()
      const solId = emp ? String((emp as Row).solicitud_id || "") : ""
      const { data: sol } = await sb.from("csl_solicitudes_empleo").select("*").eq("business_id", businessId).eq("solicitud_id", solId || employeeId).maybeSingle()
      if (!emp && !sol) return { ok: false, error: "No se encontró el empleado/solicitud en este negocio" }
      const eRow = (emp || {}) as Record<string, unknown>
      const sRow = (sol || {}) as Record<string, unknown>
      const eP = (eRow.payload_json || {}) as Record<string, unknown>
      const sP = (sRow.payload_json || {}) as Record<string, unknown>
      const g = (...keys: string[]) => { for (const src of [eRow, eP, sRow, sP]) { for (const k of keys) { const v = (src as Record<string, unknown>)[k]; const s = v == null ? "" : String(v).trim(); if (s) return s } } return "" }
      const nombre = `${g("nombre", "Nombre")} ${g("apellido", "Apellido")}`.replace(/\s+/g, " ").trim()
      const direccionParts = [g("calle"), g("numeroDir"), g("sector", "Sector"), g("ciudad", "Ciudad", "provincia", "Provincia")].filter(Boolean)
      const direccion = g("direccion", "Direccion") || direccionParts.join(", ")
      const salarioStr = g("salario", "Salario", "pretensionesSalariales")
      const prefill = {
        employee_nombre: nombre,
        cedula: g("cedula", "Cedula"),
        fecha_nacimiento: g("fecha_nacimiento", "fechaNacimiento", "FechaNacimiento"),
        sexo: g("sexo", "Sexo"),
        estado_civil: g("estadoCivil", "estado_civil"),
        nacionalidad: g("nacionalidad", "Nacionalidad"),
        direccion,
        telefono: g("telefono", "Telefono", "celular", "telefonoResidencia"),
        email: g("email", "Email"),
        position_name: g("puesto_solicitado", "puestoSolicitado", "PuestoSolicitado"),
        branch: g("sucursal", "Sucursal"),
        fecha_ingreso: g("fechaIngresoLaboral", "fecha_ingreso"),
        salary: salarioStr ? (Number(String(salarioStr).replace(/[^0-9.]/g, "")) || null) : null,
        bank: g("banco", "Banco"),
        account_type: g("tipoCuenta", "tipo_cuenta"),
        account_number: g("numeroCuenta", "numero_cuenta"),
        account_holder: nombre,
      }
      await hrAudit(user, "contratos", "contract_prefill", "csl_empleados", employeeId, null, { from: emp ? "empleado" : "solicitud" })
      return { ok: true, prefill, source: emp ? "empleado" : "solicitud" }
    }
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
        // Campos enriquecidos para el contrato PDF (snapshot del empleado).
        employee_nombre: textFrom(record, "employee_nombre") || null,
        cedula: textFrom(record, "cedula") || null,
        estado_civil: textFrom(record, "estado_civil") || null,
        direccion: textFrom(record, "direccion") || null,
        telefono: textFrom(record, "telefono") || null,
        email: textFrom(record, "email") || null,
        branch: textFrom(record, "branch") || null,
        payment_frequency: textFrom(record, "payment_frequency") || null,
        payment_method: textFrom(record, "payment_method") || null,
        bank: textFrom(record, "bank") || null,
        account_type: textFrom(record, "account_type") || null,
        account_number: textFrom(record, "account_number") || null,
        account_holder: textFrom(record, "account_holder") || null,
        work_days: textFrom(record, "work_days") || null,
        break_time: textFrom(record, "break_time") || null,
        weekly_rest: textFrom(record, "weekly_rest") || null,
        incentive_applies: Boolean(record.incentive_applies),
        incentive_detail: textFrom(record, "incentive_detail") || null,
        template_version: "v1",
      }
      if (textFrom(record, "id")) row.id = textFrom(record, "id")
      else row.created_by = user.id
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
    case "getHrDocumentSignedUrl": {
      // URL firmada (privada, 2 min) para ver/descargar un documento. Scoped por tenant.
      const id = textValue(params, "id"); if (!id) throw new Error("id obligatorio")
      const wantDownload = textValue(params, "download") === "true"
      const sb = getSupabaseAdmin()
      let q = sb.from("hr_documents").select("file_path, file_name, business_id").eq("id", id)
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const { data: doc, error } = await q.maybeSingle()
      if (error) { if (isMissingTable(error)) return { ok: false, tableMissing: true }; throw error }
      if (!doc) return { ok: false, error: "Documento no encontrado o de otro negocio" }
      const path = String((doc as Row).file_path || "")
      if (!path) return { ok: false, error: "Este documento solo tiene URL externa (sin archivo subido)" }
      const opts = wantDownload ? { download: String((doc as Row).file_name || "documento") } : undefined
      const { data: signed, error: sErr } = await sb.storage.from("hr-documents").createSignedUrl(path, 120, opts)
      if (sErr || !signed?.signedUrl) return { ok: false, error: `No se pudo generar el enlace: ${sErr?.message || "desconocido"}` }
      return { ok: true, url: signed.signedUrl }
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
      // Por defecto se ocultan los ponches anulados (is_deleted). Con
      // include_voided=true se incluyen (para el filtro "Mostrar anulados").
      const includeVoided = textValue(params, "include_voided") === "true" || params.include_voided === true
      if (!includeVoided) q = q.or("is_deleted.is.null,is_deleted.eq.false")
      const { data, error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, records: [], tableMissing: true }; throw error }
      return { ok: true, records: scopeByBranch((data || []) as Row[], (p) => (p as Row).sucursal) }
    }
    case "voidHrPunch": {
      // Anulación LÓGICA (no DELETE físico). Solo admin/superadmin.
      await requireAdmin(user.id)
      const id = textValue(params, "id"); if (!id) throw new Error("id obligatorio")
      const reason = textValue(params, "void_reason").trim()
      if (!reason) throw new Error("El motivo de anulación es obligatorio")
      const sb = getSupabaseAdmin()
      let selQ = sb.from("hr_punches").select("*").eq("id", id)
      if (shouldScopeTenant()) selQ = selQ.eq("business_id", effectiveBusinessId() as string)
      const { data: prev, error: selErr } = await selQ.maybeSingle()
      if (selErr) { if (isMissingTable(selErr)) return { ok: false, tableMissing: true }; throw selErr }
      if (!prev) throw new Error("Ponche no encontrado o de otro negocio")
      let updQ = sb.from("hr_punches").update({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: user.id, void_reason: reason, status: "anulado", updated_at: new Date().toISOString() }).eq("id", id)
      if (shouldScopeTenant()) updQ = updQ.eq("business_id", effectiveBusinessId() as string)
      const { data, error } = await updQ.select().maybeSingle()
      if (error) { if (isMissingTable(error)) return { ok: false, tableMissing: true }; throw error }
      if (!data) throw new Error("No se pudo anular el ponche")
      await hrAudit(user, "ponche", "punch_voided", "hr_punches", id, prev, { void_reason: reason, employee_id: (prev as Row).employee_id, punched_at: (prev as Row).punched_at })
      return { ok: true, record: data }
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
        modality: textFrom(record, "modality") || "manual",
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

    // ── HR · Ponche QR + geocerca + dispositivos autorizados ─────────────
    case "getHrEmployeeQr": {
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const employeeId = textValue(params, "employee_id")
      if (!employeeId) throw new Error("employee_id obligatorio")
      const regenerate = textValue(params, "regenerate") === "true" || params.regenerate === true
      const sb = getSupabaseAdmin()
      const { data: existing, error: selErr } = await sb.from("hr_employee_qr_tokens").select("*").eq("business_id", businessId).eq("employee_id", employeeId).maybeSingle()
      if (selErr && isMissingTable(selErr)) return { ok: false, tableMissing: true, error: "Migración pendiente" }
      if (!existing || regenerate) {
        const token = `CSLQR:${randomBytes(24).toString("hex")}`
        const row = { business_id: businessId, employee_id: employeeId, token, token_hash: hrSha256(token), active: true, regenerated_by: user.id, revoked_at: null, created_at: new Date().toISOString() }
        const { error } = await sb.from("hr_employee_qr_tokens").upsert(row, { onConflict: "business_id,employee_id" })
        if (error) { if (isMissingTable(error)) return { ok: false, tableMissing: true, error: "Migración pendiente" }; throw error }
        await hrAudit(user, "ponche", existing ? "qr_regenerate" : "qr_create", "hr_employee_qr_tokens", employeeId, null, { regenerated: Boolean(existing) })
        return { ok: true, token, regenerated: Boolean(existing) }
      }
      return { ok: true, token: existing.active ? existing.token : null, inactive: !existing.active }
    }
    case "resolveHrQr": {
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const qrToken = textValue(params, "qr_token")
      if (!qrToken) throw new Error("qr_token obligatorio")
      const { data: qr } = await getSupabaseAdmin().from("hr_employee_qr_tokens").select("employee_id, active").eq("business_id", businessId).eq("token_hash", hrSha256(qrToken)).maybeSingle()
      const q = qr as { employee_id: string; active: boolean } | null
      if (!q || !q.active) return { ok: false, error: "QR inválido o regenerado" }
      const info = await vacEmpInfo(businessId, q.employee_id)
      return { ok: true, employee_id: q.employee_id, employee_nombre: info.nombre || q.employee_id, cedula: info.cedula, sucursal: info.sucursal }
    }
    case "getHrPunchDevices": {
      const sb = getSupabaseAdmin()
      let q = sb.from("hr_punch_devices").select("*").order("created_at", { ascending: false })
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const { data, error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, records: [], tableMissing: true }; throw error }
      return { ok: true, records: scopeByBranch((data || []) as Row[], (d) => (d as Row).sucursal) }
    }
    case "getBranchOptions": {
      // Sucursales REALES por negocio (csl_sucursales). Scoped al business activo;
      // en modo "Todos" del superadmin devuelve todas, con su empresa, para agrupar.
      const sb = getSupabaseAdmin()
      const scope = shouldScopeTenant(); const bid = effectiveBusinessId()
      const ctxBO = getBusinessContext()
      // Superadmin puede pedir TODAS las sucursales (para el modal de usuarios).
      const wantAll = textValue(params, "all") === "true" && Boolean(ctxBO?.isSuperadmin)
      const { data: bizs } = await sb.from("businesses").select("id, name, slug")
      const bmap = new Map((bizs || []).map((b) => [String((b as { id: string }).id), b as { id: string; name: string; slug: string }]))
      let q = sb.from("csl_sucursales").select("nombre, business_id").order("nombre", { ascending: true })
      if (scope && bid && !wantAll) q = q.eq("business_id", bid)
      const { data, error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, options: [], tableMissing: true }; throw error }
      const options = (data || [])
        .filter((s) => String((s as { nombre?: string }).nombre || "").trim())
        .map((s) => {
          const row = s as { nombre: string; business_id: string }
          const b = bmap.get(String(row.business_id))
          return { business_id: row.business_id, business_name: b?.name || "", sucursal: row.nombre }
        })
      return { ok: true, options: scopeByBranch(options, (o) => o.sucursal), scoped: Boolean(scope && bid) }
    }
    case "authorizeHrPunchDevice": {
      const record = parsePayload(params)
      const businessId = effectiveBusinessId() || textFrom(record, "business_id")
      if (!businessId) throw new Error("Selecciona la empresa/sucursal del dispositivo")
      const token = `CSLDEV:${randomBytes(24).toString("hex")}`
      const row = {
        business_id: businessId,
        sucursal: textFrom(record, "sucursal") || null,
        device_name: textFrom(record, "device_name") || "Kiosco de ponche",
        device_token_hash: hrSha256(token),
        active: true, device_info: textFrom(record, "device_info") || null,
        last_seen_at: new Date().toISOString(), created_by: user.id,
        updated_at: new Date().toISOString(),
      }
      const { data, error } = await getSupabaseAdmin().from("hr_punch_devices").insert(row).select().single()
      if (error) { if (isMissingTable(error)) return { ok: false, tableMissing: true, error: "Migración pendiente" }; throw error }
      await hrAudit(user, "ponche", "device_authorize", "hr_punch_devices", String((data as { id: string }).id), null, { sucursal: row.sucursal, device_name: row.device_name })
      return { ok: true, device_token: token, device: data }
    }
    case "setHrPunchDeviceActive": {
      const id = textValue(params, "id"); if (!id) throw new Error("id obligatorio")
      const active = textValue(params, "active") === "true" || params.active === true
      let q = getSupabaseAdmin().from("hr_punch_devices").update({ active, updated_at: new Date().toISOString() }).eq("id", id)
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const { error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, tableMissing: true }; throw error }
      await hrAudit(user, "ponche", active ? "device_enable" : "device_disable", "hr_punch_devices", id, null, null)
      return { ok: true }
    }
    case "deleteHrPunchDevice": {
      const id = textValue(params, "id"); if (!id) throw new Error("id obligatorio")
      let q = getSupabaseAdmin().from("hr_punch_devices").delete().eq("id", id)
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const { error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, tableMissing: true }; throw error }
      await hrAudit(user, "ponche", "device_delete", "hr_punch_devices", id, null, null)
      return { ok: true }
    }
    case "regenerateHrPunchDeviceToken": {
      const id = textValue(params, "id"); if (!id) throw new Error("id obligatorio")
      const token = `CSLDEV:${randomBytes(24).toString("hex")}`
      let q = getSupabaseAdmin().from("hr_punch_devices")
        .update({ device_token_hash: hrSha256(token), active: true, updated_at: new Date().toISOString() })
        .eq("id", id)
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const { data, error } = await q.select().maybeSingle()
      if (error) { if (isMissingTable(error)) return { ok: false, tableMissing: true, error: "Migración pendiente" }; throw error }
      if (!data) throw new Error("Dispositivo no encontrado")
      await hrAudit(user, "ponche", "device_regenerate", "hr_punch_devices", id, null, { device_name: (data as { device_name?: string }).device_name })
      // El token anterior queda inválido (cambió el hash). Se devuelve el nuevo raw 1 sola vez.
      return { ok: true, device_token: token, device: data }
    }
    case "getHrBranchGeofences": {
      const sb = getSupabaseAdmin()
      let q = sb.from("hr_branch_geofences").select("*").order("sucursal", { ascending: true })
      if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
      const { data, error } = await q
      if (error) { if (isMissingTable(error)) return { ok: true, records: [], tableMissing: true }; throw error }
      return { ok: true, records: scopeByBranch((data || []) as Row[], (g) => (g as Row).sucursal) }
    }
    case "saveHrBranchGeofence": {
      const record = parsePayload(params)
      const businessId = effectiveBusinessId() || textFrom(record, "business_id")
      if (!businessId) throw new Error("Selecciona la empresa")
      const sucursal = textFrom(record, "sucursal")
      if (!sucursal) throw new Error("Sucursal obligatoria")
      const row: Record<string, unknown> = {
        business_id: businessId, sucursal,
        latitude: numberFrom(record, "latitude"), longitude: numberFrom(record, "longitude"),
        radius_meters: Math.max(1, Math.round(numberFrom(record, "radius_meters") || 80)),
        active: record.active === undefined ? true : Boolean(record.active),
        google_maps_url: textFrom(record, "google_maps_url") || null,
        timezone: textFrom(record, "timezone") || "America/Santo_Domingo",
        direccion: textFrom(record, "direccion") || null,
        telefono: textFrom(record, "telefono") || null,
        email: textFrom(record, "email") || null,
        updated_at: new Date().toISOString(),
      }
      if (record.workday_config !== undefined) row.workday_config = record.workday_config
      const { data, error } = await getSupabaseAdmin().from("hr_branch_geofences").upsert(row, { onConflict: "business_id,sucursal" }).select().single()
      if (error) { if (isMissingTable(error)) return { ok: false, tableMissing: true, error: "Migración pendiente" }; throw error }
      await hrAudit(user, "ponche", "geofence_update", "hr_branch_geofences", sucursal, null, row)
      return { ok: true, record: data }
    }
    case "punchByQr": {
      const record = parsePayload(params)
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const sb = getSupabaseAdmin()
      const qrToken = textFrom(record, "qr_token")
      const deviceToken = textFrom(record, "device_token")
      const punchType = textFrom(record, "punch_type") || "entrada"
      const lat = record.latitude != null && record.latitude !== "" ? Number(record.latitude) : null
      const lng = record.longitude != null && record.longitude !== "" ? Number(record.longitude) : null
      const deviceInfo = textFrom(record, "device_info") || null
      const ip = textFrom(record, "ip") || null

      // Resolver dispositivo autorizado.
      let deviceId: string | null = null, deviceSucursal: string | null = null
      if (deviceToken) {
        const { data: dev } = await sb.from("hr_punch_devices").select("*").eq("business_id", businessId).eq("device_token_hash", hrSha256(deviceToken)).maybeSingle()
        const d = dev as { id: string; active: boolean; sucursal: string | null } | null
        if (d && d.active) { deviceId = d.id; deviceSucursal = d.sucursal; await sb.from("hr_punch_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", d.id) }
      }
      // Resolver empleado por QR.
      let employeeId = "", inactive = false
      if (qrToken) {
        const { data: qr } = await sb.from("hr_employee_qr_tokens").select("*").eq("business_id", businessId).eq("token_hash", hrSha256(qrToken)).maybeSingle()
        const q = qr as { employee_id: string; active: boolean } | null
        if (q) { if (q.active) employeeId = q.employee_id; else inactive = true }
      }
      const info = employeeId ? await vacEmpInfo(businessId, employeeId) : { nombre: "", cedula: "", puesto: "", sucursal: "", fecha_ingreso: "", salario: 0 }
      const nombre = info.nombre || employeeId
      const sucursal = deviceSucursal || info.sucursal || null

      // Validaciones → motivo de rechazo (si aplica).
      let status = "approved", reason: string | null = null, distance: number | null = null
      if (!employeeId) { status = "rejected"; reason = inactive ? "QR inactivo: el empleado o su QR fue regenerado" : "QR inválido o no reconocido" }
      else if (!deviceId) { status = "rejected"; reason = "Dispositivo no autorizado" }
      else {
        // Geocerca de la sucursal del dispositivo.
        const { data: geo } = await sb.from("hr_branch_geofences").select("*").eq("business_id", businessId).eq("sucursal", sucursal || "").maybeSingle()
        const g = geo as { latitude: number; longitude: number; radius_meters: number; active: boolean } | null
        if (g && g.active && (Number(g.latitude) !== 0 || Number(g.longitude) !== 0)) {
          if (lat == null || lng == null) { status = "rejected"; reason = "Ubicación no disponible (activa el GPS y otorga permiso)" }
          else {
            distance = haversineMeters(lat, lng, Number(g.latitude), Number(g.longitude))
            if (distance > Number(g.radius_meters)) { status = "rejected"; reason = `Fuera de la ubicación autorizada (${Math.round(distance)} m > ${g.radius_meters} m)` }
          }
        }
      }
      // Consistencia básica entrada/salida (solo si va a aprobarse).
      if (status === "approved") {
        const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
        const { data: lastRows } = await sb.from("hr_punches").select("type").eq("business_id", businessId).eq("employee_id", employeeId).eq("status", "approved").gte("punched_at", dayStart.toISOString()).order("punched_at", { ascending: false }).limit(1)
        const last = lastRows && lastRows[0] ? String((lastRows[0] as { type: string }).type) : ""
        if (punchType === "entrada" && last === "entrada") { status = "rejected"; reason = "Ya existe una entrada sin salida (corrige desde el panel)" }
        else if (punchType === "salida" && (last === "" || last === "salida")) { status = "rejected"; reason = "No hay una entrada previa registrada hoy" }
      }

      // Horario del empleado → tardanza / horas trabajadas (TZ RD).
      const TZRD = "America/Santo_Domingo"
      const nowDate = new Date()
      const nowMin = (() => { const [h, m] = nowDate.toLocaleTimeString("en-GB", { timeZone: TZRD, hour12: false }).split(":"); return Number(h) * 60 + Number(m) })()
      let scheduledStart: string | null = null, scheduledEnd: string | null = null, scheduleSource: string | null = null
      let lateMin: number | null = null, workedMin: number | null = null, earlyMin: number | null = null, overtimeMin: number | null = null, expectedMin: number | null = null
      if (employeeId && status === "approved") {
        const dateStr = nowDate.toLocaleDateString("en-CA", { timeZone: TZRD })
        const sd = await empScheduleForDate(businessId, employeeId, dateStr, sucursal)
        if (sd) scheduleSource = sd.source
        if (sd && sd.is_working_day) {
          scheduledStart = sd.start_time; scheduledEnd = sd.end_time
          const ss = hhmmToMin(sd.start_time), se = hhmmToMin(sd.end_time)
          // Almuerzo 60 min, salvo turno corrido (entrada 12:30 → sin almuerzo).
          if (ss != null && se != null) expectedMin = Math.max(0, se - ss - lunchMinutesForShift(sd.start_time))
          if (punchType === "entrada" && ss != null) lateMin = Math.max(0, nowMin - ss)
          if (punchType === "salida") {
            if (se != null) earlyMin = Math.max(0, se - nowMin)
            const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
            const { data: ent } = await sb.from("hr_punches").select("punched_at").eq("business_id", businessId).eq("employee_id", employeeId).eq("type", "entrada").eq("status", "approved").gte("punched_at", dayStart.toISOString()).order("punched_at", { ascending: true }).limit(1)
            const entIso = ent && ent[0] ? String((ent[0] as { punched_at: string }).punched_at) : ""
            if (entIso) {
              const [eh, em] = new Date(entIso).toLocaleTimeString("en-GB", { timeZone: TZRD, hour12: false }).split(":")
              const entMin = Number(eh) * 60 + Number(em)
              workedMin = Math.max(0, nowMin - entMin - lunchMinutesForShift(sd.start_time))
              if (expectedMin != null) overtimeMin = Math.max(0, workedMin - expectedMin)
            }
          }
        }
      }

      const punchRow: Record<string, unknown> = {
        business_id: businessId, employee_id: employeeId || "(desconocido)",
        type: punchType, punched_at: nowDate.toISOString(), sucursal,
        source: "qr_kiosk", is_correction: false, modality: "qr",
        latitude: lat, longitude: lng, distance_meters: distance, device_id: deviceId,
        status, rejection_reason: reason, ip, device_info: deviceInfo,
        scheduled_start: scheduledStart, scheduled_end: scheduledEnd,
        expected_minutes: expectedMin, worked_minutes: workedMin,
        late_minutes: lateMin, early_leave_minutes: earlyMin, overtime_minutes: overtimeMin,
      }
      const { error: insErr } = await sb.from("hr_punches").insert(punchRow)
      if (insErr) { if (isMissingTable(insErr)) return { ok: false, tableMissing: true, error: "Migración pendiente" }; throw insErr }
      await hrAudit(user, "ponche", status === "approved" ? "punch_qr" : "punch_rejected", "hr_punches", employeeId || null, null, { type: punchType, status, reason, distance, late: lateMin, worked: workedMin })
      return { ok: status === "approved", status, reason, employee_nombre: nombre, sucursal, distance_meters: distance, type: punchType, late_minutes: lateMin, worked_minutes: workedMin, schedule_source: scheduleSource }
    }

    // ── HR · Horario por empleado ────────────────────────────────────────
    case "getHrEmployeeSchedule": {
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const employeeId = textValue(params, "employee_id")
      if (!employeeId) throw new Error("employee_id obligatorio")
      const sb = getSupabaseAdmin()
      const { data: sched, error } = await sb.from("hr_employee_schedules").select("*").eq("business_id", businessId).eq("employee_id", employeeId).eq("active", true).order("effective_from", { ascending: false }).limit(1).maybeSingle()
      if (error) { if (isMissingTable(error)) return { ok: true, schedule: null, days: [], tableMissing: true }; throw error }
      if (!sched) return { ok: true, schedule: null, days: [] }
      const { data: days } = await sb.from("hr_employee_schedule_days").select("*").eq("schedule_id", (sched as { id: string }).id).order("day_of_week", { ascending: true })
      return { ok: true, schedule: sched, days: days || [] }
    }
    case "getHrAllEmployeeSchedules": {
      // Horarios activos de TODOS los empleados del business activo (para
      // calcular horas semanales en cada tarjeta). Scopeado por business_id.
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const sb = getSupabaseAdmin()
      const { data: scheds, error } = await sb.from("hr_employee_schedules")
        .select("id, employee_id, sucursal, name").eq("business_id", businessId).eq("active", true)
      if (error) { if (isMissingTable(error)) return { ok: true, schedules: [], tableMissing: true }; throw error }
      const schedList = (scheds || []) as Array<{ id: string; employee_id: string; sucursal: string | null; name: string | null }>
      const ids = schedList.map((s) => s.id)
      const daysBySched: Record<string, Record<string, unknown>[]> = {}
      if (ids.length) {
        const { data: days } = await sb.from("hr_employee_schedule_days")
          .select("*").in("schedule_id", ids).order("day_of_week", { ascending: true })
        for (const d of ((days || []) as Record<string, unknown>[])) {
          const sid = String(d.schedule_id)
          ;(daysBySched[sid] ||= []).push(d)
        }
      }
      const schedules = schedList.map((s) => ({ employee_id: s.employee_id, sucursal: s.sucursal, name: s.name, days: daysBySched[s.id] || [] }))
      return { ok: true, schedules }
    }
    case "saveHrEmployeeSchedule": {
      const record = parsePayload(params)
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const employeeId = textFrom(record, "employee_id")
      if (!employeeId) throw new Error("Empleado obligatorio")
      const sb = getSupabaseAdmin()
      const id = textFrom(record, "id")
      const schedRow: Record<string, unknown> = {
        business_id: businessId, employee_id: employeeId,
        sucursal: textFrom(record, "sucursal") || null, name: textFrom(record, "name") || "Horario",
        effective_from: textFrom(record, "effective_from") || null, effective_to: textFrom(record, "effective_to") || null,
        active: record.active === undefined ? true : Boolean(record.active), updated_at: new Date().toISOString(),
      }
      if (id) schedRow.id = id
      const { data: saved, error } = await sb.from("hr_employee_schedules").upsert(schedRow, { onConflict: "id" }).select().single()
      if (error) { if (isMissingTable(error)) return { ok: false, tableMissing: true, error: "Migración pendiente" }; throw error }
      const schedId = (saved as { id: string }).id
      // Días: upsert por (schedule_id, day_of_week) — sin DELETE (no destructivo).
      const days = Array.isArray(record.days) ? record.days as Array<Record<string, unknown>> : []
      for (const d of days) {
        const dow = Number(d.day_of_week)
        if (!Number.isInteger(dow) || dow < 0 || dow > 6) continue
        const isWorking = d.is_working_day === undefined ? true : Boolean(d.is_working_day)
        // Almuerzo 60 min en día trabajado; 0 si turno corrido (entrada 12:30) o libre.
        const lunchMin = isWorking ? lunchMinutesForShift(d.start_time ? String(d.start_time) : null) : 0
        const hasLunch = lunchMin > 0
        await sb.from("hr_employee_schedule_days").upsert({
          schedule_id: schedId, business_id: businessId, day_of_week: dow,
          is_working_day: isWorking,
          start_time: d.start_time ? String(d.start_time) : null, end_time: d.end_time ? String(d.end_time) : null,
          // Ventana de almuerzo solo si el turno lleva almuerzo (no turno corrido / no libre).
          lunch_start: hasLunch && d.lunch_start ? String(d.lunch_start) : null,
          lunch_end: hasLunch && d.lunch_end ? String(d.lunch_end) : null,
          break_minutes: lunchMin, updated_at: new Date().toISOString(),
        }, { onConflict: "schedule_id,day_of_week" })
      }
      await hrAudit(user, "horarios", id ? "update" : "create", "hr_employee_schedules", schedId, null, { employee_id: employeeId })
      return { ok: true, schedule: saved }
    }
    case "getHrAttendanceHours": {
      const businessId = effectiveBusinessId()
      const scope = shouldScopeTenant(); const bid = businessId
      const desde = textValue(params, "desde"); const hasta = textValue(params, "hasta")
      const empF = textValue(params, "employee_id"); const sucF = textValue(params, "sucursal")
      const sb = getSupabaseAdmin()
      let pq = sb.from("hr_punches").select("employee_id,type,punched_at,sucursal,status").eq("status", "approved").order("punched_at", { ascending: true })
      if (scope && bid) pq = pq.eq("business_id", bid)
      if (desde) pq = pq.gte("punched_at", desde)
      if (hasta) pq = pq.lte("punched_at", `${hasta}T23:59:59`)
      if (empF) pq = pq.eq("employee_id", empF)
      const { data: punches, error } = await pq
      if (error) { if (isMissingTable(error)) return { ok: true, records: [], tableMissing: true }; throw error }
      const empRows = await getRows("empleados").catch(() => [] as Row[])
      const nameMap = new Map<string, { nombre: string; cedula: string; sucursal: string }>()
      for (const r of (empRows as Row[])) { const eid = String(r.SolicitudID || r.empleado_id || ""); if (eid) nameMap.set(eid, { nombre: `${r.Nombre || ""} ${r.Apellido || ""}`.trim() || eid, cedula: String(r.Cedula || ""), sucursal: String(r.Sucursal || "") }) }
      const TZ = "America/Santo_Domingo"
      const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ })
      const minOf = (iso: string) => { const [h, m] = new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ, hour12: false }).split(":"); return Number(h) * 60 + Number(m) }
      type P = { employee_id: string; type: string; punched_at: string; sucursal: string | null }
      const groups = new Map<string, { emp: string; day: string; sucursal: string | null; ps: P[] }>()
      for (const raw of ((punches || []) as P[])) { const day = dayOf(raw.punched_at); const k = `${raw.employee_id}|${day}`; if (!groups.has(k)) groups.set(k, { emp: raw.employee_id, day, sucursal: raw.sucursal, ps: [] }); groups.get(k)!.ps.push(raw) }
      const records: Record<string, unknown>[] = []
      for (const g of groups.values()) {
        if (sucF && (g.sucursal || "") !== sucF) continue
        const ent = g.ps.find(x => x.type === "entrada") || g.ps[0]
        const sal = [...g.ps].reverse().find(x => x.type === "salida")
        const bIni = g.ps.find(x => x.type === "inicio_descanso" || x.type === "almuerzo_inicio")
        const bFin = g.ps.find(x => x.type === "fin_descanso" || x.type === "almuerzo_fin")
        const aStart = ent ? minOf(ent.punched_at) : null
        const aEnd = sal ? minOf(sal.punched_at) : null
        const breakTaken = (bIni && bFin) ? Math.max(0, minOf(bFin.punched_at) - minOf(bIni.punched_at)) : 0
        const sd = await empScheduleForDate(bid as string, g.emp, g.day, g.sucursal)
        const ss = sd ? hhmmToMin(sd.start_time) : null, se = sd ? hhmmToMin(sd.end_time) : null
        const expected = (sd && sd.is_working_day && ss != null && se != null) ? Math.max(0, se - ss - lunchMinutesForShift(sd.start_time)) : 0
        const worked = (aStart != null && aEnd != null) ? Math.max(0, aEnd - aStart - breakTaken) : 0
        const late = (aStart != null && ss != null) ? Math.max(0, aStart - ss) : 0
        const early = (aEnd != null && se != null) ? Math.max(0, se - aEnd) : 0
        const overtime = expected > 0 ? Math.max(0, worked - expected) : 0
        let estado = "Presente"
        if (sd && !sd.is_working_day) estado = "Libre"
        else if (!ent) estado = "Ausente"
        else if (!sal) estado = "Incompleto"
        else if (late > 0) estado = "Tarde"
        const nm = nameMap.get(g.emp) || { nombre: g.emp, cedula: "", sucursal: g.sucursal || "" }
        records.push({
          employee_id: g.emp, employee_nombre: nm.nombre, cedula: nm.cedula, sucursal: g.sucursal || nm.sucursal, fecha: g.day,
          scheduled_start: sd?.start_time || null, scheduled_end: sd?.end_time || null,
          actual_start: ent ? ent.punched_at : null, actual_end: sal ? sal.punched_at : null,
          expected_minutes: expected, worked_minutes: worked, late_minutes: late, early_leave_minutes: early, overtime_minutes: overtime,
          estado, schedule_source: sd?.source || null,
        })
      }
      records.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || String(a.employee_nombre).localeCompare(String(b.employee_nombre)))
      return { ok: true, records: scopeByBranch(records, (r) => (r as Row).sucursal) }
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
      // Columnas TSS 2026 (202606050001) — tope SRL y tasas patronales. Solo se
      // incluyen si el caller las envía; si la migración aún no se aplicó en este
      // entorno, el upsert se reintenta sin ellas (fallback defensivo).
      const extra: Record<string, unknown> = {}
      if (record.srl_cap != null) extra.srl_cap = numberFrom(record, "srl_cap")
      if (record.afp_employer_rate != null) extra.afp_employer_rate = numberFrom(record, "afp_employer_rate")
      if (record.sfs_employer_rate != null) extra.sfs_employer_rate = numberFrom(record, "sfs_employer_rate")
      if (record.srl_employer_rate != null) extra.srl_employer_rate = numberFrom(record, "srl_employer_rate")
      if (record.infotep_employer_rate != null) extra.infotep_employer_rate = numberFrom(record, "infotep_employer_rate")
      let { data, error } = await sb.from("hr_payroll_config").upsert({ ...row, ...extra }, { onConflict: "business_id" }).select().single()
      if (error && Object.keys(extra).length) {
        const code = (error as { code?: string }).code
        // 42703 = columna inexistente · PGRST204 = columna fuera del schema cache
        if (code === "42703" || code === "PGRST204") {
          ({ data, error } = await sb.from("hr_payroll_config").upsert(row, { onConflict: "business_id" }).select().single())
        }
      }
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
    case "getHrVacacionSugerida": {
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const employeeId = textValue(params, "employee_id")
      if (!employeeId) throw new Error("employee_id obligatorio")
      const refStr = textValue(params, "fecha_fin") || textValue(params, "period_end")
      const ref = refStr ? new Date(refStr) : new Date()
      const info = await vacEmpInfo(businessId, employeeId)
      const sueldoMensual = info.salario > 0 ? round2(info.salario) : round2(await salarioVigente(businessId, employeeId))
      const anios = round2(antiguedadAnios(info.fecha_ingreso, ref))
      const diasLegales = diasVacacionesRD(anios)
      return {
        ok: true,
        employee_nombre: info.nombre || employeeId,
        cedula: info.cedula, puesto: info.puesto, sucursal: info.sucursal,
        fecha_ingreso: info.fecha_ingreso,
        sueldo_mensual: sueldoMensual, sueldo_diario: round2(sueldoMensual / HR_DAILY_BASE),
        antiguedad_anios: anios, dias_legales: diasLegales,
      }
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
      // Sueldo: usa el del formulario (empleado real) si viene; si no, salario vigente.
      const sueldoMensual = record.sueldo_mensual != null && Number(record.sueldo_mensual) > 0
        ? round2(numberFrom(record, "sueldo_mensual"))
        : round2(await salarioVigente(businessId, employeeId))
      const sueldoDiario = round2(sueldoMensual / HR_DAILY_BASE)
      const monto = round2(sueldoDiario * dias)
      // Snapshot del empleado + cálculo legal de antigüedad (del payload o computado).
      const info = await vacEmpInfo(businessId, employeeId)
      const ref = textFrom(record, "fecha_fin") ? new Date(textFrom(record, "fecha_fin")) : new Date()
      const fechaIngreso = textFrom(record, "fecha_ingreso") || info.fecha_ingreso || ""
      const antiguedad = record.antiguedad_anios != null ? round2(numberFrom(record, "antiguedad_anios")) : round2(antiguedadAnios(fechaIngreso, ref))
      const diasLegales = record.dias_legales != null ? numberFrom(record, "dias_legales") : diasVacacionesRD(antiguedad)
      const nombre = textFrom(record, "employee_nombre") || info.nombre || employeeId
      const status = textFrom(record, "status") || "borrador"
      const isApproved = ["aprobada", "aprobado", "pagada", "pagado"].includes(status)
      const id = textFrom(record, "id")
      let oldValues: unknown = null
      if (id) { const { data: prev } = await sb.from("hr_vacations").select("*").eq("id", id).maybeSingle(); oldValues = prev ?? null }
      const row: Record<string, unknown> = {
        business_id: businessId, employee_id: employeeId, employee_nombre: nombre,
        periodo: textFrom(record, "periodo") || String(ref.getFullYear()),
        dias, fecha_inicio: textFrom(record, "fecha_inicio") || null, fecha_fin: textFrom(record, "fecha_fin") || null,
        sueldo_diario: sueldoDiario, monto, status,
        observations: textFrom(record, "observations") || null,
        created_by: textFrom(record, "created_by") || user.id,
        updated_at: new Date().toISOString(),
      }
      if (isApproved) { row.approved_by = user.id; row.approved_at = new Date().toISOString() }
      if (id) row.id = id
      // Columnas legales (202606050002). Fallback si el DDL aún no se aplicó en este entorno.
      const extra: Record<string, unknown> = {
        sueldo_mensual: sueldoMensual, fecha_ingreso: fechaIngreso || null,
        antiguedad_anios: antiguedad, dias_legales: diasLegales,
        cedula: info.cedula || null, puesto: info.puesto || null, sucursal: info.sucursal || null,
      }
      let { data, error } = await sb.from("hr_vacations").upsert({ ...row, ...extra }, { onConflict: "id" }).select().single()
      if (error) {
        const code = (error as { code?: string }).code
        if (code === "42703" || code === "PGRST204") {
          ({ data, error } = await sb.from("hr_vacations").upsert(row, { onConflict: "id" }).select().single())
        }
      }
      if (error) { if (isMissingTable(error)) return { ok: false, tableMissing: true, error: "Migración pendiente" }; throw error }
      await hrAudit(user, "vacaciones", isApproved ? "approve" : (id ? "update" : "create"), "hr_vacations", String((data as { id: string }).id), oldValues, data)
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
    case "getHrVacacionesTxt": {
      // TXT bancario de vacaciones aprobadas del año. Formato:
      // CUENTA_ORIGEN,CUENTA_DESTINO,MONTO,NOMBRE (sin encabezado).
      const sb = getSupabaseAdmin()
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const year = textValue(params, "year") || String(new Date().getFullYear())
      const { data: cfg } = await sb.from("hr_payroll_config").select("bank_origin_account").eq("business_id", businessId).maybeSingle()
      const origin = (cfg as { bank_origin_account?: string } | null)?.bank_origin_account || ""
      if (!origin) return { ok: false, error: "Debe configurar la cuenta origen antes de generar el TXT bancario (Nómina → Configuración)." }
      const { data: vacs, error } = await sb.from("hr_vacations").select("*").eq("business_id", businessId).eq("periodo", year)
      if (error) { if (isMissingTable(error)) return { ok: false, tableMissing: true, error: "Migración pendiente" }; throw error }
      const approved = scopeByBranch((vacs || []) as Row[], (r) => (r as Row).sucursal)
        .filter((v) => ["aprobada", "aprobado", "pagada", "pagado"].includes(String((v as Row).status)) && Number((v as Row).monto) > 0)
      const lines: string[] = []; const omitidos: string[] = []; let total = 0
      for (const v of approved as Row[]) {
        const { data: acct } = await sb.from("hr_employee_bank_accounts").select("account_number, beneficiary").eq("business_id", businessId).eq("employee_id", String(v.employee_id)).eq("is_primary", true).eq("active", true).maybeSingle()
        const a = acct as { account_number?: string; beneficiary?: string } | null
        if (!a?.account_number) { omitidos.push(String(v.employee_nombre || v.employee_id)); continue }
        const nombre = String(a.beneficiary || v.employee_nombre || v.employee_id).toUpperCase()
        const monto = Number(v.monto || 0)
        lines.push(`${origin},${a.account_number},${monto.toFixed(2)},${nombre}`)
        total += monto
      }
      await hrAudit(user, "vacaciones", "txt_generate", "hr_vacations", year, null, { lineas: lines.length, total })
      return { ok: true, content: lines.join("\n"), lineas: lines.length, total: round2(total), omitidos }
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
    case "getHrDobleSugerido": {
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const employeeId = textValue(params, "employee_id")
      if (!employeeId) throw new Error("employee_id obligatorio")
      const anio = Math.round(numberValue(params, "anio") || new Date().getFullYear())
      const fechaSalida = textValue(params, "fecha_salida")
      const info = await vacEmpInfo(businessId, employeeId)
      const sueldoMensual = info.salario > 0 ? round2(info.salario) : round2(await salarioVigente(businessId, employeeId))
      const meses = info.fecha_ingreso ? mesesTrabajadosAnio(info.fecha_ingreso, anio, fechaSalida) : 12
      return {
        ok: true,
        employee_nombre: info.nombre || employeeId,
        cedula: info.cedula, puesto: info.puesto, sucursal: info.sucursal,
        fecha_ingreso: info.fecha_ingreso,
        sueldo_mensual: sueldoMensual,
        antiguedad_anios: round2(antiguedadAnios(info.fecha_ingreso, new Date())),
        meses_trabajados: meses, completo: meses >= 12,
      }
    }
    case "saveHrChristmasBonus": {
      const record = parsePayload(params)
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const employeeId = textFrom(record, "employee_id")
      if (!employeeId) throw new Error("Empleado obligatorio")
      const anio = Math.round(numberFrom(record, "anio") || new Date().getFullYear())
      const sb = getSupabaseAdmin()
      // Sueldo del formulario (empleado real) si viene; si no, salario vigente.
      const sueldoMensual = record.sueldo_mensual != null && Number(record.sueldo_mensual) > 0
        ? round2(numberFrom(record, "sueldo_mensual"))
        : round2(await salarioVigente(businessId, employeeId))
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
      const info = await vacEmpInfo(businessId, employeeId)
      // Fecha de ingreso laboral: la oficial del empleado; el param solo si se editó.
      const fechaIngreso = textValue(params, "fecha_ingreso") || info.fecha_ingreso
      const fechaSalida = textValue(params, "fecha_salida") || new Date().toISOString().slice(0, 10)
      // Fuente oficial del salario (prioridad): historial salarial vigente /
      // csl_empleados (salarioVigente) → salario de solicitud aprobada → param.
      const mensualParam = numberValue(params, "sueldo_mensual")
      const vigente = round2(await salarioVigente(businessId, employeeId))
      const mensual = vigente > 0 ? vigente : (info.salario > 0 ? round2(info.salario) : round2(mensualParam))
      const calc = computeSeverance(motivo, fechaIngreso, fechaSalida, mensual)
      return {
        ok: true,
        employee_nombre: info.nombre || employeeId,
        cedula: info.cedula, puesto: info.puesto, sucursal: info.sucursal,
        fecha_ingreso: fechaIngreso, sueldo_mensual: mensual, ...calc,
      }
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

    // ── HR · Fase 5 · Desarrollo (CRUD genérico) ─────────────────────────
    case "getHrRecruitment": return devList("hr_recruitment")
    case "saveHrRecruitment": return devSave("hr_recruitment", "reclutamiento", user, parsePayload(params), ["nombre", "puesto", "sucursal", "telefono", "email", "estado", "notas"])
    case "deleteHrRecruitment": return devDelete("hr_recruitment", "reclutamiento", user, textValue(params, "id"))

    case "getHrOnboarding": return devList("hr_onboarding")
    case "saveHrOnboarding": return devSave("hr_onboarding", "onboarding", user, parsePayload(params), ["employee_id", "employee_nombre", "checklist", "estado", "notas"])
    case "deleteHrOnboarding": return devDelete("hr_onboarding", "onboarding", user, textValue(params, "id"))

    case "getHrEvaluations": return devList("hr_evaluations")
    case "saveHrEvaluation": return devSave("hr_evaluations", "evaluacion", user, parsePayload(params), ["employee_id", "employee_nombre", "periodo", "puntaje", "comentarios", "plan_mejora", "estado"])
    case "deleteHrEvaluation": return devDelete("hr_evaluations", "evaluacion", user, textValue(params, "id"))

    case "getHrDisciplinary": return devList("hr_disciplinary")
    case "saveHrDisciplinary": return devSave("hr_disciplinary", "disciplina", user, parsePayload(params), ["employee_id", "employee_nombre", "tipo", "fecha", "descripcion", "evidencia_url", "estado"])
    case "deleteHrDisciplinary": return devDelete("hr_disciplinary", "disciplina", user, textValue(params, "id"))

    case "getHrTrainings": return devList("hr_trainings")
    case "saveHrTraining": return devSave("hr_trainings", "capacitacion", user, parsePayload(params), ["employee_id", "employee_nombre", "curso", "tipo", "fecha_objetivo", "vencimiento", "certificado_url", "estado"])
    case "deleteHrTraining": return devDelete("hr_trainings", "capacitacion", user, textValue(params, "id"))

    case "getHrCommunications": return devList("hr_communications")
    case "saveHrCommunication": return devSave("hr_communications", "comunicacion", user, parsePayload(params), ["titulo", "mensaje", "segmento", "destinatario", "fecha"])
    case "deleteHrCommunication": return devDelete("hr_communications", "comunicacion", user, textValue(params, "id"))

    // ── HR · Sincronizar empleados ← solicitudes APROBADAS ───────────────
    case "syncApprovedEmpleados": {
      const businessId = effectiveBusinessId()
      if (!businessId) throw new Error("business_id no encontrado")
      const sb = getSupabaseAdmin()
      // Solicitudes aprobadas del tenant (multi-tenant estricto).
      const { data: solsRaw, error: solErr } = await sb
        .from("csl_solicitudes_empleo").select("*")
        .eq("business_id", businessId).eq("estado", "Aprobado")
      if (solErr) throw solErr
      const sols = (solsRaw || []) as Array<Record<string, unknown>>
      // Empleados existentes del tenant (para anti-duplicados).
      const { data: empsRaw } = await sb
        .from("csl_empleados").select("empleado_id, solicitud_id, cedula, email, telefono")
        .eq("business_id", businessId)
      const emps = (empsRaw || []) as Array<Record<string, unknown>>
      const norm = (v: unknown) => String(v ?? "").trim().toLowerCase()
      const findMatch = (s: Record<string, unknown>) => emps.find((e) =>
        String(e.empleado_id) === String(s.solicitud_id) ||
        (s.solicitud_id && String(e.solicitud_id) === String(s.solicitud_id)) ||
        (norm(s.cedula) && norm(e.cedula) === norm(s.cedula)) ||
        (norm(s.email) && norm(e.email) === norm(s.email)) ||
        (norm(s.telefono) && norm(e.telefono) === norm(s.telefono)))
      const seen = new Set<string>() // anti-dup dentro de la misma corrida (cédula/email)
      let creados = 0, actualizados = 0, omitidos = 0, errores = 0
      for (const s of sols) {
        const dupKey = norm(s.cedula) || norm(s.email) || norm(s.telefono) || String(s.solicitud_id)
        const row: Record<string, unknown> = {
          business_id: businessId, solicitud_id: s.solicitud_id, origen: "solicitud_empleo", estado: "Activo",
          nombre: s.nombre ?? null, apellido: s.apellido ?? null, cedula: s.cedula ?? null,
          email: s.email ?? null, telefono: s.telefono ?? null, direccion: s.direccion ?? null,
          puesto_solicitado: s.puesto_solicitado ?? null, salario: s.salario ?? null,
          ciudad: s.ciudad ?? null, sector: s.sector ?? null, provincia: s.provincia ?? null,
          sexo: s.sexo ?? null, nacionalidad: s.nacionalidad ?? null, fecha_nacimiento: s.fecha_nacimiento ?? null,
          nivel_educacion: s.nivel_educacion ?? null, especialidad: s.especialidad ?? null,
          fecha_solicitud: s.fecha_solicitud ?? null, observaciones: s.observaciones ?? null,
          updated_at: new Date().toISOString(),
        }
        const match = findMatch(s)
        try {
          if (match) {
            await sb.from("csl_empleados").update(row).eq("empleado_id", match.empleado_id).eq("business_id", businessId)
            actualizados++
            await hrAudit(user, "empleados", "sync_update", "csl_empleados", String(match.empleado_id), { solicitud_id: s.solicitud_id }, { origen: "solicitud_empleo", estado: "Activo" })
          } else {
            if (seen.has(dupKey)) { omitidos++; continue } // ya creado en esta misma corrida
            row.empleado_id = s.solicitud_id
            await sb.from("csl_empleados").insert(row)
            emps.push({ empleado_id: s.solicitud_id, solicitud_id: s.solicitud_id, cedula: s.cedula, email: s.email, telefono: s.telefono })
            creados++
            await hrAudit(user, "empleados", "sync_create", "csl_empleados", String(s.solicitud_id), null, { from_solicitud: s.solicitud_id, nombre: s.nombre, cedula: s.cedula })
          }
          seen.add(dupKey)
        } catch (e) {
          errores++
          console.warn("[syncApprovedEmpleados] fallo", s.solicitud_id, e instanceof Error ? e.message : e)
        }
      }
      return { ok: true, aprobadas: sols.length, creados, actualizados, omitidos, errores }
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
    case "getConsentPeelingCompleto": {
      const id = textValue(params, "id") || textValue(params, "consentId")
      if (!id) throw new Error("id obligatorio")
      const record = await getRecordCompleto("csl_consent_peeling", id)
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
    case "getConsentPeeling":
      return { ok: true, records: await getRows("csl_consent_peeling", { columns: CONSENT_LIST_COLS }) }
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
      if (empleados.length) return { ok: true, records: scopeByBranch(empleados, (e) => (e as Row).Sucursal) }
      const solicitudes = await getRows("solicitudes_empleo")
      const aprobadas = solicitudes.filter((record) => String(record.Estado ?? record.estado) === "Aprobado")
      return { ok: true, records: scopeByBranch(aprobadas, (e) => (e as Row).Sucursal) }
    }
    case "getCurrentUserProfile": {
      const profile = await getProfile(user.id)
      const u = profile ? profileToUser(profile) : null
      if (u) {
        try {
          const { data: bp } = await getSupabaseAdmin().from("user_branch_permissions").select("branch_name").eq("user_id", user.id).eq("active", true)
          ;(u as Row).branches = ((bp || []) as Row[]).map((r) => String(r.branch_name))
        } catch { /* tabla no migrada */ }
      }
      return { ok: true, user: u }
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
      const records = (data || []).map((profile) => profileToUser(profile as Row))
      try {
        const ids = records.map((r) => String((r as Row).id)).filter(Boolean)
        if (ids.length) {
          const { data: bperms } = await supabase.from("user_branch_permissions").select("user_id, branch_name").eq("active", true).in("user_id", ids)
          const byUser = new Map<string, string[]>()
          for (const r of ((bperms || []) as Row[])) { const u = String(r.user_id); if (!byUser.has(u)) byUser.set(u, []); byUser.get(u)!.push(String(r.branch_name)) }
          for (const rec of records) (rec as Row).branches = byUser.get(String((rec as Row).id)) || []
        }
      } catch { /* tabla no migrada */ }
      return { ok: true, records }
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

      // ---- Sucursales permitidas (user_branch_permissions) — sin DELETE ----
      const branchesRaw = Array.isArray(record.branches) ? (record.branches as unknown[]) : []
      const branches = Array.from(new Set(branchesRaw.map((b) => normalizeSucursal(b)).filter(Boolean)))
      if (targetBusinessId) {
        try {
          for (const bn of branches) {
            await supabase.from("user_branch_permissions").upsert(
              { business_id: targetBusinessId, user_id: userId, branch_name: bn, active: true, updated_at: new Date().toISOString() },
              { onConflict: "business_id,user_id,branch_name" })
          }
          const { data: existB } = await supabase.from("user_branch_permissions").select("branch_name").eq("business_id", targetBusinessId).eq("user_id", userId).eq("active", true)
          for (const r of ((existB || []) as Row[])) {
            const bn = String(r.branch_name)
            if (!branches.includes(bn)) await supabase.from("user_branch_permissions").update({ active: false, updated_at: new Date().toISOString() }).eq("business_id", targetBusinessId).eq("user_id", userId).eq("branch_name", bn)
          }
        } catch { /* tabla no migrada */ }
      }
      await hrAudit(user, "usuarios", editingId ? "update" : "create", "user_branch_permissions", userId, null, { branches })
      return { ok: true, record: { ...profileToUser(profile as Row), branches } }
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
        cabina: toUpperFieldOrNull(cabinaRaw),
        operadora: toUpperFieldOrNull(operadoraRaw),
        operadora_id: operadoraIdRaw ? operadoraIdRaw : null,
      }
      // Columnas añadidas por 202605280002_equipos_pulsos_audit.sql.
      // Solo se envían si el caller las pasó — guardar un equipo
      // manualmente NO debe resetear estos timestamps.
      if (ultimaActRaw) row.ultima_actualizacion_pulsos = ultimaActRaw
      if (ultimaSemRaw) row.ultima_semana_pulsos = ultimaSemRaw
      // Tenant del equipo: en "Todos" usa el businessId de la UI o lo deduce si
      // el equipo ya existe; scopeado usa el propio. Se estampa en la fila
      // (PK compuesta business_id+equipo_id).
      const targetBusinessId = await resolveMaintenanceTargetBusiness(params, "equipos", textValue(params, "equipoId"))
      row.business_id = targetBusinessId
      await upsertRow("equipos", row, { targetBusinessId })
      return { ok: true, record: fromDb("equipos", row) }
    }
    case "deleteEquipo": {
      const equipoId = textValue(params, "equipoId")
      await deleteRow("equipos", equipoId, {
        targetBusinessId: await resolveMaintenanceTargetBusiness(params, "equipos", equipoId),
      })
      return { ok: true }
    }
    case "setEquipoEstado": {
      const equipoId = textValue(params, "equipoId")
      await updateRowFields("equipos", equipoId, { estado: textValue(params, "estado") }, {
        targetBusinessId: await resolveMaintenanceTargetBusiness(params, "equipos", equipoId),
      })
      return { ok: true }
    }
    case "updateEquipoCampos": {
      // UPDATE parcial — solo aplica los campos enviados con valor no vacío.
      // A diferencia de saveEquipo (upsert full-row), preserva los campos
      // que NO se mandan. Usado por:
      //   - guardarCuadre (solo actualiza pulsos)
      //   - importador masivo de base (solo actualiza sucursal/cabina/op./serial)
      const equipoId = textValue(params, "equipoId")
      if (!equipoId) throw new Error("equipoId obligatorio para updateEquipoCampos")
      // Tenant del registro: scopea el UPDATE a UNA sola fila. En "Todos" usa el
      // businessId que manda la UI o lo deduce del equipo (frontend viejo).
      const targetBusinessId = await resolveMaintenanceTargetBusiness(params, "equipos", equipoId)
      const fields: Record<string, unknown> = {}
      // Mapeo camelCase del request → snake_case de la DB. Solo se incluye
      // un campo si vino con valor no vacío (= el caller quiere actualizarlo).
      // Esto PRESERVA los campos no enviados (lo usa guardarCuadre, que solo
      // manda pulsos, y el importador, que solo manda lo de la base maestra).
      const mapText: Array<[string, string]> = [
        ["sucursal", "sucursal"],
        ["empresa", "empresa"],
        ["domicilio", "domicilio"],
        ["modelo", "modelo"],
        ["serie", "serie"],
        ["numero", "numero"],
        ["estado", "estado"],
        ["observaciones", "observaciones"],
        ["ultimaActualizacionPulsos", "ultima_actualizacion_pulsos"],
        ["ultimaSemanaPulsos", "ultima_semana_pulsos"],
      ]
      for (const [camel, snake] of mapText) {
        const v = params[camel]
        if (typeof v === "string" && v.length > 0) fields[snake] = v
      }
      // CABINA / OPERADORA / OPERADORA_ID son dropdowns: SÍ deben poder limpiarse
      // a "Sin asignar". El frontend manda el sentinel "__CLEAR__" para vaciarlas
      // (un string vacío se ignora para no romper a quien solo manda pulsos).
      const CLEAR = "__CLEAR__"
      const dropdownFields: Array<[string, string]> = [
        ["cabina", "cabina"],
        ["operadora", "operadora"],
        ["operadoraId", "operadora_id"],
      ]
      for (const [camel, snake] of dropdownFields) {
        const v = params[camel]
        if (typeof v !== "string") continue
        if (v === CLEAR) fields[snake] = null
        else if (v.length > 0) fields[snake] = v
      }
      // CABINA / OPERADORA siempre en MAYÚSCULA (regla global del sistema).
      if (typeof fields.cabina === "string") fields.cabina = toUpperField(fields.cabina)
      if (typeof fields.operadora === "string") fields.operadora = toUpperField(fields.operadora)
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
      await updateRowFields("equipos", equipoId, fields, { targetBusinessId })
      // Devolver el registro fresco (verdad de la DB) para que el frontend
      // actualice el store con lo realmente persistido, no con optimista.
      // Scopeado al mismo tenant → `.maybeSingle()` devuelve exactamente 1 fila
      // aunque el equipo_id colisione entre negocios.
      const record = await getRecordCompleto("equipos", equipoId, { targetBusinessId })
      return { ok: true, record }
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
      const row = { report_id: textValue(params, "reportId"), fecha: dateValue(params.fecha), equipo_id: textValue(params, "equipoId"), sucursal: textValue(params, "sucursal"), empresa: textValue(params, "empresa"), cliente: textValue(params, "cliente"), domicilio: textValue(params, "domicilio"), ciudad: textValue(params, "ciudad", "Santiago"), modelo: textValue(params, "modelo"), serie: textValue(params, "serie"), numero: textValue(params, "numero"), tipo: textValue(params, "tipo", "Preventivo"), estado_equipo: textValue(params, "estadoEquipo", "Operativo"), prioridad: textValue(params, "prioridad", "Baja"), problema: textValue(params, "problema"), correccion: textValue(params, "correccion"), observaciones: textValue(params, "observaciones"), checklist: textValue(params, "checklist"), p_cabeza: numberValue(params, "pcabeza"), p_totales: numberValue(params, "ptotales"), atendio: textValue(params, "atendio"), power_source_number: textValue(params, "powerSourceNumber"), power_source_serial: textValue(params, "powerSourceSerial"), fiber_serial: textValue(params, "fiberSerial"), hv_value: textValue(params, "hv"), joules_value: textValue(params, "joules"), bs_value: textValue(params, "bs"), bc_value: textValue(params, "bc"), hv_ref_value: textValue(params, "hvRef"), vdc_value: textValue(params, "vdc"), voltage_value: textValue(params, "voltage"), tx_value: textValue(params, "tx"), software_version: textValue(params, "software"), piezas_json: textValue(params, "piezasJson", "[]"), partes_texto: textValue(params, "partesTexto"), firma_cliente: textValue(params, "firmaCliente"), firma_tecnico: textValue(params, "firmaTecnico"), fotos: textValue(params, "fotos", "[]") }
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
        ["powerSourceNumber", "power_source_number"],
        ["powerSourceSerial", "power_source_serial"],
        ["fiberSerial", "fiber_serial"],
        ["hv", "hv_value"],
        ["joules", "joules_value"],
        ["bs", "bs_value"],
        ["bc", "bc_value"],
        ["hvRef", "hv_ref_value"],
        ["vdc", "vdc_value"],
        ["voltage", "voltage_value"],
        ["tx", "tx_value"],
        ["software", "software_version"],
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
      const counts = { fichas: 0, masajes: 0, peeling: 0, tatuajes: 0, links: 0 }
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
        await reassign("csl_consent_peeling", "peeling")
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
    case "saveConsentPeeling": {
      const payload = parsePayload(params)
      const clienteId = await resolveClienteId(payload)
      const cliente = await upsertClienteCosmiatriaPreserving(clienteCosmiatriaToDb({ ...payload, ClienteID: clienteId }))
      const row = consentToDb({ ...payload, clienteId: cliente.cliente_id }, "peeling")
      await upsertRow("csl_consent_peeling", row)
      await syncFichasCliente(cliente)
      // Notificación por email — patrón idéntico a masajes / tatuajes / ficha.
      const email = await sendConsentPeelingEmail(row).catch((error: unknown) => ({
        sent: false,
        warning: error instanceof Error ? error.message : "No se pudo enviar el correo",
      }))
      return { ok: true, record: fromDb("csl_consent_peeling", row), email }
    }
    case "deleteConsentPeeling":
      await deleteRow("csl_consent_peeling", textValue(params, "id") || textValue(params, "consentId"))
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

      const [consMas, consPeel, consTat] = await Promise.all([
        safeQueryConsents("csl_consent_masajes"),
        safeQueryConsents("csl_consent_peeling"),
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
        consentPeeling: consPeel.map((row) => fromDb("csl_consent_peeling", row)),
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
      const row = { operadora_id: String(record.OperadoraID ?? params.id ?? `op_${Date.now()}`), nombre: toUpperField(record.Nombre), sucursal: record.Sucursal ?? "", estado: record.Estado ?? "Activa", notas: record.Notas ?? "" }
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
      const row = { lectura_id: String(record.LecturaID ?? params.id ?? `lec_${Date.now()}`), fecha_semana: dateValue(record.FechaSemana), equipo_id: record.EquipoID ?? "", sucursal: record.Sucursal ?? "", cabina: toUpperField(record.Cabina), operadora_id: record.OperadoraID ?? "", lectura_inicial: numberFrom(record, "LecturaInicial"), lectura_final: numberFrom(record, "LecturaFinal"), diferencia_real: numberFrom(record, "DiferenciaReal"), observaciones: record.Observaciones ?? "" }
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
        cabina: toUpperField(record.Cabina),
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
    case "saveSesionesBatch": {
      // Guardado MASIVO de sesiones AgendaPro. Reemplaza el loop fila-a-fila
      // (1 request por sesión). Pre-filtra duplicados por import_hash (en lote y
      // contra la DB) e inserta por chunks. Multi-tenant por business_id.
      const payload = parsePayload(params) as { sesiones?: unknown[] }
      const input = Array.isArray(payload.sesiones) ? payload.sesiones : []
      if (!input.length) return { ok: true, received: 0, inserted: 0, duplicates: 0, errors: 0 }
      const sb = getSupabaseAdmin()
      let businessId = effectiveBusinessId()
      if (!businessId) {
        const { data: prof } = await sb.from("csl_user_profiles").select("business_id").eq("user_id", user.id).single()
        businessId = prof?.business_id ? String(prof.business_id) : null
      }
      if (!businessId) throw new Error("business_id no encontrado")
      const now = new Date().toISOString()
      const mapRow = (raw: unknown) => {
        const r = raw as Record<string, unknown>
        const importHash = typeof r.ImportHash === "string" && r.ImportHash.trim() ? r.ImportHash.trim() : null
        return {
          sesion_id: String(r.SesionID ?? `ses_${Date.now()}_${Math.floor(Math.random() * 1e9)}`),
          business_id: businessId,
          fecha: dateValue(r.Fecha),
          sucursal: r.Sucursal ?? "",
          cabina: toUpperField(r.Cabina),
          operadora_id: r.OperadoraID ?? "",
          cliente: r.Cliente ?? "",
          area_trabajada: r.AreaTrabajada ?? "",
          disparos_reportados: numberFrom(r, "DisparosReportados"),
          duracion: r.Duracion ? Number(r.Duracion) : null,
          equipo_id: r.EquipoID ?? "",
          observaciones: r.Observaciones ?? "",
          contacto_cliente: typeof r.ContactoCliente === "string" && r.ContactoCliente ? r.ContactoCliente : null,
          tratamiento: typeof r.Tratamiento === "string" && r.Tratamiento ? r.Tratamiento : null,
          potencia: typeof r.Potencia === "string" && r.Potencia ? r.Potencia : null,
          spot: typeof r.Spot === "string" && r.Spot ? r.Spot : null,
          archivo_origen: typeof r.ArchivoOrigen === "string" && r.ArchivoOrigen ? r.ArchivoOrigen : null,
          fila_origen: typeof r.FilaOrigen === "number" ? r.FilaOrigen : null,
          import_hash: importHash,
          updated_at: now,
        }
      }
      const rows = input.map(mapRow)
      const received = rows.length
      // Dedupe en-lote por import_hash.
      const seen = new Set<string>(); const deduped: typeof rows = []
      for (const r of rows) { if (r.import_hash) { if (seen.has(r.import_hash)) continue; seen.add(r.import_hash) } deduped.push(r) }
      // Hashes ya existentes en DB (este tenant), por chunks.
      const existing = new Set<string>()
      const hashes = [...seen]
      for (let i = 0; i < hashes.length; i += 200) {
        const part = hashes.slice(i, i + 200)
        const { data } = await sb.from("csl_sesiones_cliente").select("import_hash").eq("business_id", businessId).in("import_hash", part)
        for (const d of ((data || []) as { import_hash: string | null }[])) if (d.import_hash) existing.add(d.import_hash)
      }
      const toInsert = deduped.filter(r => !r.import_hash || !existing.has(r.import_hash))
      let inserted = 0, errors = 0
      for (let i = 0; i < toInsert.length; i += 500) {
        const chunk = toInsert.slice(i, i + 500)
        const { data, error } = await sb.from("csl_sesiones_cliente").insert(chunk).select("sesion_id")
        if (error) {
          // Fallback fila-a-fila para no perder el chunk completo por 1 fila mala.
          for (const one of chunk) {
            const { error: e1 } = await sb.from("csl_sesiones_cliente").insert(one)
            if (!e1) inserted++
            else if ((e1 as { code?: string }).code !== "23505") errors++
          }
        } else inserted += (data?.length || 0)
      }
      const duplicates = Math.max(0, received - inserted - errors)
      return { ok: true, received, inserted, duplicates, errors }
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
        cabina: toUpperFieldOrNull(record.Cabina),
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
      // business_id ACTIVO (el que la UI seleccionó), NO el del perfil del
      // usuario. Para un superadmin viendo Depicenter, debe leer Depicenter.
      const bizId = effectiveBusinessId()
      if (!bizId) throw new Error("business_id no encontrado")
      const { data, error } = await sb
        .from("csl_pulse_readings")
        .select("*")
        .eq("business_id", bizId)
        .order("period_start", { ascending: false })
      if (error) throw error
      return { ok: true, records: data || [] }
    }

    case "savePulseReading": {
      const record = parsePayload(params)
      const sb = getSupabaseAdmin()
      // business_id ACTIVO (el que la UI seleccionó), NO el del perfil del
      // usuario. Antes esto tomaba profile.business_id (CSL para el superadmin),
      // así que editar una lectura de Depicenter intentaba guardar bajo CSL y la
      // fila real de Depicenter nunca se actualizaba (el FIN "no se guardaba").
      const bizId = effectiveBusinessId()
      if (!bizId) throw new Error("business_id no encontrado")

      const row: Record<string, unknown> = {
        business_id: bizId,
        equipo_id: textFrom(record, "equipo_id"),
        serial: textFrom(record, "serial") || null,
        sucursal: textFrom(record, "sucursal"),
        cabina: toUpperFieldOrNull(textFrom(record, "cabina")),
        operadora: toUpperFieldOrNull(textFrom(record, "operadora")),
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
      // No forzamos `id`: el conflicto se resuelve por la clave compuesta
      // (business_id, equipo_id, period_start, period_end). Incluir un id podría
      // intentar cambiar el PK de la fila existente. En INSERT nuevo, la DB
      // genera el id por default.

      const { data, error } = await sb
        .from("csl_pulse_readings")
        .upsert(row, { onConflict: "business_id,equipo_id,period_start,period_end" })
        .select()
        .single()
      if (error) throw error
      if (!data) throw new Error("La lectura no se actualizó (0 filas afectadas).")

      // POLÍTICA MANTENIMIENTO (estricto total): guardar una lectura de
      // PulseControl YA NO modifica csl_equipos. Antes este bloque
      // sobrescribía p_cabeza/sucursal/cabina/operadora/serie/fallas del
      // equipo automáticamente — eso pisaba datos del técnico. La lectura se
      // persiste en csl_pulse_readings; el equipo solo lo edita el técnico
      // manualmente desde el módulo de Mantenimiento.
      return { ok: true, record: data }
    }

    case "deletePulseReading": {
      const id = textValue(params, "id")
      if (!id) throw new Error("id obligatorio")
      const sb = getSupabaseAdmin()
      const bizId = effectiveBusinessId()
      if (!bizId) throw new Error("business_id no encontrado")
      const { error } = await sb
        .from("csl_pulse_readings")
        .delete()
        .eq("id", id)
        .eq("business_id", bizId)
      if (error) throw error
      return { ok: true }
    }

    case "recalculatePulseContinuity": {
      const sb = getSupabaseAdmin()
      // business_id ACTIVO: recalcular continuidad SOLO del negocio activo.
      const bizId = effectiveBusinessId()
      if (!bizId) throw new Error("business_id no encontrado")

      const { data: all, error: fetchErr } = await sb
        .from("csl_pulse_readings")
        .select("*")
        .eq("business_id", bizId)
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
      const bizId = effectiveBusinessId()
      if (!bizId) throw new Error("business_id no encontrado")
      const { data, error } = await sb
        .from("csl_operator_shots")
        .select("*")
        .eq("business_id", bizId)
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
      // business_id ACTIVO (no el del perfil del usuario): el superadmin opera
      // sobre el negocio seleccionado en la UI.
      const bizId = effectiveBusinessId()
      if (!bizId) throw new Error("business_id no encontrado")
      const profile = { business_id: bizId }
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
      const bizId = effectiveBusinessId()
      if (!bizId) throw new Error("business_id no encontrado")
      const profile = { business_id: bizId }
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
      // business_id ACTIVO: los shots de Depicenter se guardan en Depicenter,
      // NO bajo el perfil del superadmin (CSL). Esta era la fuente de la
      // contaminación cross-tenant semanal de csl_operator_shots.
      const bizId = effectiveBusinessId()
      if (!bizId) throw new Error("business_id no encontrado")
      const profile = { business_id: bizId }

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
      // business_id ACTIVO: recalcular disp_operador SOLO del negocio activo.
      const bizId = effectiveBusinessId()
      if (!bizId) throw new Error("business_id no encontrado")
      const profile = { business_id: bizId }

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

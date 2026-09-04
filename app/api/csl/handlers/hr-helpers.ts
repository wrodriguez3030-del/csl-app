/**
 * RR.HH. — ayudantes de dominio.
 *
 * Las funciones de cálculo laboral dominicano (preaviso, cesantía, vacaciones,
 * regalía, ISR anual, antigüedad) y las de auditoría y horario que usan las 96
 * acciones de RR.HH. del despachador.
 *
 * Se sacan aquí como primer paso para partir RR.HH., que son 1.696 líneas del
 * `switch`. Los `case` en sí NO se han movido todavía: están en 16 bloques
 * repartidos y el archivo tiene 171 casos encadenados, así que un traslado
 * mecánico rompería cadenas que ninguna prueba cubre — y es el módulo que corre
 * la nómina. Estos ayudantes, en cambio, son funciones y `tsc` verifica cada
 * referencia.
 */
import { createHash } from "node:crypto"
import { getSupabaseAdmin } from "@/lib/server/supabase"
import { textFrom } from "@/lib/server/csl-helpers"
import type { ActionUser, Row } from "@/lib/server/csl-types"
import { effectiveBusinessId, shouldScopeTenant, isMissingTable, round2 } from "../_context"

/** SHA-256 hex — usado para hashear el PIN de ponche (nunca se guarda plano). */
export function hrSha256(value: string): string {
  return createHash("sha256").update(String(value), "utf8").digest("hex")
}
/** ¿El error de Supabase es "tabla no existe" (migración pendiente)? */
/** Base estándar de días hábiles RD para el sueldo diario. */
export const HR_DAILY_BASE = 23.83

/**
 * Registra una acción crítica en hr_audit_logs. Nunca rompe la operación
 * principal si la auditoría falla (best-effort). business_id desde contexto.
 */
export async function hrAudit(
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
export async function devList(table: string) {
  const sb = getSupabaseAdmin()
  let q = sb.from(table).select("*").order("created_at", { ascending: false })
  if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
  const { data, error } = await q
  if (error) { if (isMissingTable(error)) return { ok: true, records: [], tableMissing: true }; throw error }
  return { ok: true, records: data || [] }
}
export async function devSave(table: string, module: string, user: ActionUser, record: Row, fields: string[]) {
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
export async function devDelete(table: string, module: string, user: ActionUser, id: string) {
  if (!id) throw new Error("id obligatorio")
  let q = getSupabaseAdmin().from(table).delete().eq("id", id)
  if (shouldScopeTenant()) q = q.eq("business_id", effectiveBusinessId() as string)
  const { error } = await q
  if (error) { if (isMissingTable(error)) return { ok: true, tableMissing: true }; throw error }
  await hrAudit(user, module, "delete", table, id, null, null)
  return { ok: true }
}

/** Salario mensual VIGENTE: hr_employee_salary_history (effective_to null) → fallback csl_empleados.salario. */
export async function salarioVigente(businessId: string, employeeId: string): Promise<number> {
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
export function navidadProporcional(ing: Date | null, sal: Date, mensual: number) {
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
export function computeSeverance(motivo: string, fechaIngreso: string, fechaSalida: string, mensual: number) {
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
  const tieneIngreso = !!ing && !Number.isNaN(ing.getTime())
  const mesesServicio = tieneIngreso ? mesesServicioCompletos(ing as Date, sal) : 0
  const vacacionesDias = diasVacacionesRD(t, mesesServicio)
  const nav = navidadProporcional(ing, sal, mensual)
  // Tiempo laborado en años/meses/días (criterio Ministerio).
  const td = tieneIngreso ? tiempoDetallado(ing as Date, sal) : { anios: 0, meses: 0, dias: 0 }
  return {
    anios_servicio: round2(t),
    tiempo_anios: td.anios, tiempo_meses: td.meses, tiempo_dias: td.dias,
    salario_diario: round2(diarioFull),
    preaviso_dias: preavisoDias, preaviso_monto: round2(diarioFull * preavisoDias),
    cesantia_dias: cesantiaDias, cesantia_monto: round2(diarioFull * cesantiaDias),
    vacaciones_dias: vacacionesDias, vacaciones_monto: round2(diarioFull * vacacionesDias),
    navidad_meses: nav.meses, navidad_dias: nav.dias, navidad_monto: nav.monto,
  }
}

/** ISR anual según escala de tramos [{li, ls, tasa, cuota}]. Devuelve 0 si exento. */
export function applyIsrAnnual(taxable: number, brackets: Array<{ li: number; ls: number | null; tasa: number; cuota: number }>): number {
  if (!Array.isArray(brackets) || taxable <= 0) return 0
  for (const b of brackets) {
    const within = taxable >= Number(b.li) && (b.ls == null || taxable <= Number(b.ls))
    if (within) return round2(Number(b.cuota) + (taxable - Number(b.li)) * Number(b.tasa))
  }
  return 0
}

/** Cuenta días distintos con al menos una marca de ponche en el rango (TZ RD). */
export async function diasDesdeAsistencia(businessId: string, employeeId: string, desde: string, hasta: string): Promise<number> {
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

/**
 * Días de vacaciones legales RD según antigüedad (Código de Trabajo).
 * 1-5 años = 14 días; >=5 años = 18 días. Para menos de 1 año se aplica la
 * escala proporcional (art. 177/180 C.T.): 5 meses = 6 días, 6 = 7, 7 = 8,
 * 8 = 9, 9 = 10, 10 = 11, 11 = 12. < 5 meses no genera derecho.
 */
export function diasVacacionesRD(anios: number, mesesCompletos?: number): number {
  if (anios >= 5) return 18
  if (anios >= 1) return 14
  if (mesesCompletos != null && mesesCompletos >= 5) return Math.min(12, mesesCompletos + 1)
  return 0
}
/** Meses completos de servicio (escala proporcional de vacaciones < 1 año). */
export function mesesServicioCompletos(ing: Date, sal: Date): number {
  let m = (sal.getUTCFullYear() - ing.getUTCFullYear()) * 12 + (sal.getUTCMonth() - ing.getUTCMonth())
  if (sal.getUTCDate() < ing.getUTCDate()) m -= 1
  return Math.max(0, m)
}
/** Tiempo laborado en años/meses/días (criterio Ministerio: mes 30 días, día inclusivo). */
export function tiempoDetallado(ing: Date, sal: Date): { anios: number; meses: number; dias: number } {
  const t = Math.max(0, (sal.getTime() - ing.getTime()) / (365.25 * 24 * 3600 * 1000))
  const anios = Math.floor(t + 1e-9)
  const anchor = new Date(Date.UTC(ing.getUTCFullYear() + anios, ing.getUTCMonth(), ing.getUTCDate()))
  let meses = (sal.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (sal.getUTCMonth() - anchor.getUTCMonth())
  let dias = sal.getUTCDate() - anchor.getUTCDate() + 1 // inclusivo (criterio Ministerio)
  while (dias >= 30) { meses += 1; dias -= 30 }
  while (dias < 0) { meses -= 1; dias += 30 }
  if (meses < 0) { meses = 0; dias = 0 }
  return { anios, meses, dias }
}
/**
 * Meses trabajados dentro de un año (para doble sueldo / salario de Navidad).
 * Desde el mes de ingreso (si ingresó ese año) hasta diciembre, o hasta el mes
 * de salida si existe. Año completo = 12.
 */
export function mesesTrabajadosAnio(fechaIngreso: string, anio: number, fechaSalida?: string): number {
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
export function antiguedadAnios(fechaIngreso: string, ref: Date): number {
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
export async function vacEmpInfo(businessId: string, employeeId: string) {
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
export function hhmmToMin(hhmm: unknown): number | null {
  const s = String(hhmm ?? "").trim()
  if (!s) return null
  const [h, m] = s.split(":")
  const n = Number(h) * 60 + Number(m || 0)
  return Number.isFinite(n) ? n : null
}
export type SchedDay = { source: "employee" | "branch"; sucursal: string | null; is_working_day: boolean; start_time: string | null; end_time: string | null; break_minutes: number }
/** Horario efectivo de un empleado para una fecha (YYYY-MM-DD); fallback a la sucursal. */
export async function empScheduleForDate(businessId: string, employeeId: string, dateStr: string, sucursalFallback: string | null): Promise<SchedDay | null> {
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

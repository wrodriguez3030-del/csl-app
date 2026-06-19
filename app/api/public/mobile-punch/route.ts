/**
 * POST /api/public/mobile-punch — Ponche desde el CELULAR del empleado (sin login).
 *
 * A diferencia del kiosco, autentica por qr_token (no por dispositivo). Resuelve
 * business + empleado del QR, lee la configuración de modalidades
 * (hr_punch_modality_config, alcance empleado > sucursal > global) y la APLICA:
 *   · modalidad usada debe estar habilitada
 *   · require_location → exige GPS
 *   · sin allow_remote_punch → exige estar dentro de la geocerca
 *   · require_biometric o modalidad mobile_biometric → exige ticket WebAuthn válido
 * Calcula tardanza/horas igual que el kiosco y registra la marca.
 *
 * body: { mode:"resolve"|"punch", qr_token, punch_type?, modality?, latitude?, longitude?, accuracy?, biometric_ticket?, device_info? }
 */
import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/server/supabase"
import { haversineMeters } from "@/lib/hr-geo"
import { lunchMinutesForShift } from "@/lib/work-hours"
import { resolveQrEmployee } from "@/lib/server/webauthn"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const runtime = "nodejs"

const json = (d: Record<string, unknown>, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } })
const hhmm = (v: unknown): number | null => { const s = String(v ?? "").trim(); if (!s) return null; const [h, m] = s.split(":"); const n = Number(h) * 60 + Number(m || 0); return Number.isFinite(n) ? n : null }
type SB = ReturnType<typeof getSupabaseAdmin>

/** Sucursal del empleado: horario activo → payload_json → null. */
async function empSucursal(sb: SB, businessId: string, employeeId: string): Promise<{ nombre: string; sucursal: string | null }> {
  let sucursal: string | null = null
  const { data: sched } = await sb.from("hr_employee_schedules").select("sucursal").eq("business_id", businessId).eq("employee_id", employeeId).eq("active", true).order("effective_from", { ascending: false }).limit(1).maybeSingle()
  if (sched && (sched as { sucursal?: string }).sucursal) sucursal = String((sched as { sucursal: string }).sucursal)
  const { data: emp } = await sb.from("csl_empleados").select("nombre, apellido, payload_json").eq("business_id", businessId).eq("empleado_id", employeeId).maybeSingle()
  const e = emp as { nombre?: string; apellido?: string; payload_json?: Record<string, unknown> } | null
  let nombre = employeeId
  if (e) {
    nombre = `${e.nombre ?? ""} ${e.apellido ?? ""}`.trim() || employeeId
    if (!sucursal && e.payload_json) sucursal = (e.payload_json.sucursal || e.payload_json.Sucursal) as string || null
  }
  if (nombre === employeeId) {
    const { data: sol } = await sb.from("csl_solicitudes_empleo").select("nombre, apellido, payload_json").eq("business_id", businessId).eq("solicitud_id", employeeId).maybeSingle()
    const s = sol as { nombre?: string; apellido?: string; payload_json?: Record<string, unknown> } | null
    if (s) { nombre = `${s.nombre ?? ""} ${s.apellido ?? ""}`.trim() || employeeId; if (!sucursal && s.payload_json) sucursal = (s.payload_json.sucursal || s.payload_json.Sucursal) as string || null }
  }
  return { nombre, sucursal }
}

/** Config de modalidades efectiva: empleado > sucursal > global (solo activas). */
async function resolveModalityConfig(sb: SB, businessId: string, sucursal: string | null, employeeId: string) {
  const { data } = await sb.from("hr_punch_modality_config").select("*").eq("business_id", businessId)
  const rows = ((data || []) as Record<string, unknown>[]).filter((r) => r.active !== false)
  const byEmp = rows.find((r) => r.employee_id === employeeId)
  const bySuc = rows.find((r) => !r.employee_id && r.sucursal && sucursal && r.sucursal === sucursal)
  const global = rows.find((r) => !r.employee_id && !r.sucursal)
  return (byEmp || bySuc || global || null) as Record<string, unknown> | null
}

async function schedDay(sb: SB, businessId: string, employeeId: string, dateStr: string, sucursal: string | null) {
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay()
  const { data: scheds } = await sb.from("hr_employee_schedules").select("id, effective_from, effective_to").eq("business_id", businessId).eq("employee_id", employeeId).eq("active", true).order("effective_from", { ascending: false })
  for (const s of ((scheds || []) as Array<{ id: string; effective_from: string | null; effective_to: string | null }>)) {
    const from = s.effective_from ? String(s.effective_from).slice(0, 10) : null
    const to = s.effective_to ? String(s.effective_to).slice(0, 10) : null
    if (from && dateStr < from) continue
    if (to && dateStr > to) continue
    const { data: d } = await sb.from("hr_employee_schedule_days").select("*").eq("schedule_id", s.id).eq("day_of_week", dow).maybeSingle()
    const day = d as { is_working_day?: boolean; start_time?: string; end_time?: string } | null
    if (day) return { working: day.is_working_day !== false, start: day.start_time ?? null, end: day.end_time ?? null }
    return { working: false, start: null, end: null }
  }
  if (sucursal) {
    const { data: geo } = await sb.from("hr_branch_geofences").select("workday_config").eq("business_id", businessId).eq("sucursal", sucursal).maybeSingle()
    const cfg = (geo as { workday_config?: Record<string, { working?: boolean; start?: string; end?: string }> } | null)?.workday_config
    const dc = cfg ? cfg[String(dow)] : null
    if (dc) return { working: dc.working !== false, start: dc.start ?? null, end: dc.end ?? null }
  }
  return null
}

export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch { return json({ ok: false, code: "bad_request", error: "Cuerpo inválido" }, 400) }
  const emp = await resolveQrEmployee(String(body.qr_token || ""))
  if (!emp) return json({ ok: false, code: "qr_invalid", error: "QR inválido o revocado" })

  const sb = getSupabaseAdmin()
  const businessId = emp.businessId
  const employeeId = emp.employeeId
  const { nombre, sucursal } = await empSucursal(sb, businessId, employeeId)

  if (String(body.mode || "punch") === "resolve") {
    const cfg = await resolveModalityConfig(sb, businessId, sucursal, employeeId)
    return json({
      ok: true, employee_nombre: nombre, sucursal,
      config: cfg ? {
        allow_gps: cfg.allow_gps !== false, allow_mobile_biometric: cfg.allow_mobile_biometric === true,
        allow_remote_punch: cfg.allow_remote_punch === true, require_location: cfg.require_location !== false,
        require_biometric: cfg.require_biometric === true,
      } : null,
    })
  }

  const cfg = await resolveModalityConfig(sb, businessId, sucursal, employeeId)
  const allowGps = !cfg || cfg.allow_gps !== false
  const allowBio = Boolean(cfg && cfg.allow_mobile_biometric === true)
  const allowRemote = Boolean(cfg && cfg.allow_remote_punch === true)
  const requireLocation = !cfg || cfg.require_location !== false
  const requireBiometric = Boolean(cfg && cfg.require_biometric === true)

  const modality = String(body.modality || "gps")
  if (modality === "mobile_biometric" && !allowBio) return json({ ok: false, code: "modality_off", error: "La biometría móvil no está habilitada para ti" })
  if (modality === "gps" && !allowGps) return json({ ok: false, code: "modality_off", error: "El ponche por GPS no está habilitado" })

  const punchType = String(body.punch_type || "entrada")
  const lat = body.latitude != null && body.latitude !== "" ? Number(body.latitude) : null
  const lng = body.longitude != null && body.longitude !== "" ? Number(body.longitude) : null
  const accuracy = body.accuracy != null && body.accuracy !== "" ? Number(body.accuracy) : null
  let status = "approved", reason: string | null = null, distance: number | null = null, code = "ok"

  // Biometría obligatoria → exige ticket WebAuthn válido.
  let verifiedBiometric = false
  if (requireBiometric || modality === "mobile_biometric") {
    const ticket = String(body.biometric_ticket || "")
    if (!ticket) { return json({ ok: false, code: "need_biometric", error: "Verifica tu biometría antes de ponchar" }) }
    const { data: tk } = await sb.from("hr_webauthn_challenges").select("id, expires_at").eq("business_id", businessId).eq("employee_id", employeeId).eq("kind", "punch_ticket").eq("challenge", ticket).maybeSingle()
    const t = tk as { id: string; expires_at: string } | null
    if (!t) return json({ ok: false, code: "bad_ticket", error: "Verificación biométrica inválida o expirada" })
    await sb.from("hr_webauthn_challenges").delete().eq("id", t.id)
    if (new Date(t.expires_at).getTime() < Date.now()) return json({ ok: false, code: "bad_ticket", error: "La verificación biométrica expiró" })
    verifiedBiometric = true
  }

  // Ubicación / geocerca.
  if (requireLocation && (lat == null || lng == null)) {
    status = "rejected"; code = "no_gps"; reason = "Ubicación no disponible (activa el GPS y otorga permiso)"
  }
  if (status === "approved") {
    const { data: geo } = await sb.from("hr_branch_geofences").select("latitude, longitude, radius_meters, active").eq("business_id", businessId).eq("sucursal", sucursal || "").maybeSingle()
    const g = geo as { latitude: number; longitude: number; radius_meters: number; active: boolean } | null
    if (g && g.active && (Number(g.latitude) !== 0 || Number(g.longitude) !== 0) && lat != null && lng != null) {
      distance = haversineMeters(lat, lng, Number(g.latitude), Number(g.longitude))
      if (distance > Number(g.radius_meters) && !allowRemote) {
        status = "rejected"; code = "geofence"; reason = `Fuera de la ubicación autorizada (${Math.round(distance)} m > ${g.radius_meters} m). El ponche remoto no está habilitado.`
      }
    }
  }

  // Consistencia entrada/salida.
  if (status === "approved") {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
    const { data: lastRows } = await sb.from("hr_punches").select("type").eq("business_id", businessId).eq("employee_id", employeeId).eq("status", "approved").gte("punched_at", dayStart.toISOString()).order("punched_at", { ascending: false }).limit(1)
    const last = lastRows && lastRows[0] ? String((lastRows[0] as { type: string }).type) : ""
    if (punchType === "entrada" && last === "entrada") { status = "rejected"; code = "dup_in"; reason = "Ya existe una entrada sin salida" }
    else if (punchType === "salida" && (last === "" || last === "salida")) { status = "rejected"; code = "no_in"; reason = "No hay una entrada previa registrada hoy" }
  }

  // Horario → tardanza / horas.
  const TZ = "America/Santo_Domingo"
  const nowDate = new Date()
  const nowMin = (() => { const [h, m] = nowDate.toLocaleTimeString("en-GB", { timeZone: TZ, hour12: false }).split(":"); return Number(h) * 60 + Number(m) })()
  let scheduledStart: string | null = null, scheduledEnd: string | null = null, lateMin: number | null = null, workedMin: number | null = null, earlyMin: number | null = null, overtimeMin: number | null = null, expectedMin: number | null = null
  if (status === "approved") {
    const dateStr = nowDate.toLocaleDateString("en-CA", { timeZone: TZ })
    const sd = await schedDay(sb, businessId, employeeId, dateStr, sucursal)
    if (sd && sd.working) {
      scheduledStart = sd.start; scheduledEnd = sd.end
      const ss = hhmm(sd.start), se = hhmm(sd.end)
      if (ss != null && se != null) expectedMin = Math.max(0, se - ss - lunchMinutesForShift(sd.start))
      if (punchType === "entrada" && ss != null) lateMin = Math.max(0, nowMin - ss)
      if (punchType === "salida") {
        if (se != null) earlyMin = Math.max(0, se - nowMin)
        const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
        const { data: ent } = await sb.from("hr_punches").select("punched_at").eq("business_id", businessId).eq("employee_id", employeeId).eq("type", "entrada").eq("status", "approved").gte("punched_at", dayStart.toISOString()).order("punched_at", { ascending: true }).limit(1)
        const entIso = ent && ent[0] ? String((ent[0] as { punched_at: string }).punched_at) : ""
        if (entIso) { const [eh, em] = new Date(entIso).toLocaleTimeString("en-GB", { timeZone: TZ, hour12: false }).split(":"); workedMin = Math.max(0, nowMin - (Number(eh) * 60 + Number(em)) - lunchMinutesForShift(sd.start)); if (expectedMin != null) overtimeMin = Math.max(0, workedMin - expectedMin) }
      }
    }
  }

  const { error: insErr } = await sb.from("hr_punches").insert({
    business_id: businessId, employee_id: employeeId, type: punchType, punched_at: nowDate.toISOString(), sucursal,
    source: "mobile", modality, verified_biometric: verifiedBiometric,
    validation_result: status === "approved" ? "ok" : "rejected",
    latitude: lat, longitude: lng, accuracy_meters: accuracy, distance_meters: distance,
    status, rejection_reason: reason, device_name: String(body.device_info || "") || null, device_info: String(body.device_info || "") || null,
    scheduled_start: scheduledStart, scheduled_end: scheduledEnd, expected_minutes: expectedMin,
    worked_minutes: workedMin, late_minutes: lateMin, early_leave_minutes: earlyMin, overtime_minutes: overtimeMin,
  })
  if (insErr) {
    if ((insErr as { code?: string }).code === "42P01") return json({ ok: false, code: "table_missing", error: "Falta la tabla de ponches (migración pendiente)" })
    return json({ ok: false, code: "db_error", error: `No se pudo registrar la marca: ${insErr.message}` }, 500)
  }
  try { await sb.from("hr_audit_logs").insert({ business_id: businessId, module: "ponche", action: status === "approved" ? "punch_mobile" : "punch_rejected", entity_type: "hr_punches", entity_id: employeeId, new_values: { type: punchType, modality, status, reason, distance, biometric: verifiedBiometric, late: lateMin, worked: workedMin } }) } catch { /* best-effort */ }

  return json({ ok: status === "approved", status, code, reason, employee_nombre: nombre, sucursal, distance_meters: distance, type: punchType, modality, verified_biometric: verifiedBiometric, late_minutes: lateMin, worked_minutes: workedMin })
}

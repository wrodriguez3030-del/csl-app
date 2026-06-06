/**
 * POST /api/public/punch  — Kiosco de ponche SIN login.
 *
 * Autentica por device_token (dispositivo autorizado), no por sesión de usuario.
 * El device_token determina el business_id y la sucursal → multi-tenant seguro.
 * Valida QR del empleado, geocerca (Haversine) y horario, y registra la marca.
 * Devuelve JSON con error ESPECÍFICO (no genérico).
 *
 * body: { mode: "resolve"|"punch", device_token, qr_token, punch_type?, latitude?, longitude?, device_info? }
 */
import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/server/supabase"
import { haversineMeters } from "@/lib/hr-geo"
import { createHash } from "node:crypto"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const runtime = "nodejs"

const sha = (v: string) => createHash("sha256").update(v, "utf8").digest("hex")
const json = (d: Record<string, unknown>, status = 200) => NextResponse.json(d, { status, headers: { "Cache-Control": "no-store" } })
const hhmm = (v: unknown): number | null => { const s = String(v ?? "").trim(); if (!s) return null; const [h, m] = s.split(":"); const n = Number(h) * 60 + Number(m || 0); return Number.isFinite(n) ? n : null }

type SB = ReturnType<typeof getSupabaseAdmin>

async function empInfo(sb: SB, businessId: string, employeeId: string) {
  const t = (...v: unknown[]) => { for (const x of v) { const s = x == null ? "" : String(x).trim(); if (s) return s } return "" }
  const { data: emp } = await sb.from("csl_empleados").select("nombre, apellido").eq("business_id", businessId).eq("empleado_id", employeeId).maybeSingle()
  const e = emp as { nombre?: string; apellido?: string } | null
  if (e) { const n = `${e.nombre ?? ""} ${e.apellido ?? ""}`.trim(); if (n) return { nombre: n, sucursal: "" } }
  const { data: sol } = await sb.from("csl_solicitudes_empleo").select("nombre, apellido, payload_json").eq("business_id", businessId).eq("solicitud_id", employeeId).maybeSingle()
  const s = sol as { nombre?: string; apellido?: string; payload_json?: Record<string, unknown> } | null
  if (s) return { nombre: `${s.nombre ?? ""} ${s.apellido ?? ""}`.trim() || employeeId, sucursal: t((s.payload_json || {}).sucursal, (s.payload_json || {}).Sucursal) }
  return { nombre: employeeId, sucursal: "" }
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
    const day = d as { is_working_day?: boolean; start_time?: string; end_time?: string; break_minutes?: number } | null
    if (day) return { working: day.is_working_day !== false, start: day.start_time ?? null, end: day.end_time ?? null, brk: Number(day.break_minutes || 0) }
    return { working: false, start: null, end: null, brk: 0 }
  }
  if (sucursal) {
    const { data: geo } = await sb.from("hr_branch_geofences").select("workday_config").eq("business_id", businessId).eq("sucursal", sucursal).maybeSingle()
    const cfg = (geo as { workday_config?: Record<string, { working?: boolean; start?: string; end?: string; break?: number }> } | null)?.workday_config
    const dc = cfg ? cfg[String(dow)] : null
    if (dc) return { working: dc.working !== false, start: dc.start ?? null, end: dc.end ?? null, brk: Number(dc.break || 0) }
  }
  return null
}

export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch { return json({ ok: false, code: "bad_request", error: "Cuerpo inválido" }, 400) }
  const mode = String(body.mode || "punch")
  const deviceToken = String(body.device_token || "")
  const qrToken = String(body.qr_token || "")
  if (!deviceToken) return json({ ok: false, code: "no_device", error: "Este dispositivo no está autorizado. Pídele al admin “Autorizar dispositivo”." })
  if (!qrToken) return json({ ok: false, code: "no_qr", error: "No se recibió el código del QR" })

  const sb = getSupabaseAdmin()

  // 1) Dispositivo autorizado → business_id + sucursal.
  type Dev = { id: string; active: boolean; sucursal: string | null; business_id: string }
  let dev: Dev | null = null
  try {
    const { data, error } = await sb.from("hr_punch_devices").select("id, active, sucursal, business_id").eq("device_token_hash", sha(deviceToken)).maybeSingle()
    if (error) { if ((error as { code?: string }).code === "42P01") return json({ ok: false, code: "table_missing", error: "Falta la tabla de dispositivos (migración pendiente en db-cls)" }); throw error }
    dev = (data as Dev | null)
  } catch (e) { return json({ ok: false, code: "db_error", error: `Error de base de datos: ${e instanceof Error ? e.message : "desconocido"}` }, 500) }
  if (!dev || !dev.active) return json({ ok: false, code: "device", error: "Dispositivo no autorizado" })
  const businessId = dev.business_id
  const sucursal = dev.sucursal

  // 2) QR → empleado (scoped al business del dispositivo).
  const { data: qr } = await sb.from("hr_employee_qr_tokens").select("employee_id, active").eq("business_id", businessId).eq("token_hash", sha(qrToken)).maybeSingle()
  const q = qr as { employee_id: string; active: boolean } | null
  if (!q) return json({ ok: false, code: "qr_invalid", error: "QR inválido o no pertenece a esta sucursal" })
  if (!q.active) return json({ ok: false, code: "qr_revoked", error: "QR revocado o regenerado" })
  const employeeId = q.employee_id
  const info = await empInfo(sb, businessId, employeeId)

  await sb.from("hr_punch_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", dev.id)

  if (mode === "resolve") return json({ ok: true, employee_nombre: info.nombre, sucursal })

  // 3) Punch.
  const punchType = String(body.punch_type || "entrada")
  const lat = body.latitude != null && body.latitude !== "" ? Number(body.latitude) : null
  const lng = body.longitude != null && body.longitude !== "" ? Number(body.longitude) : null
  let status = "approved", reason: string | null = null, distance: number | null = null, code = "ok"

  const { data: geo } = await sb.from("hr_branch_geofences").select("latitude, longitude, radius_meters, active").eq("business_id", businessId).eq("sucursal", sucursal || "").maybeSingle()
  const g = geo as { latitude: number; longitude: number; radius_meters: number; active: boolean } | null
  if (g && g.active && (Number(g.latitude) !== 0 || Number(g.longitude) !== 0)) {
    if (lat == null || lng == null) { status = "rejected"; code = "no_gps"; reason = "Ubicación no disponible (activa el GPS y otorga permiso)" }
    else { distance = haversineMeters(lat, lng, Number(g.latitude), Number(g.longitude)); if (distance > Number(g.radius_meters)) { status = "rejected"; code = "geofence"; reason = `Fuera de la ubicación autorizada (${Math.round(distance)} m > ${g.radius_meters} m)` } }
  }

  if (status === "approved") {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
    const { data: lastRows } = await sb.from("hr_punches").select("type").eq("business_id", businessId).eq("employee_id", employeeId).eq("status", "approved").gte("punched_at", dayStart.toISOString()).order("punched_at", { ascending: false }).limit(1)
    const last = lastRows && lastRows[0] ? String((lastRows[0] as { type: string }).type) : ""
    if (punchType === "entrada" && last === "entrada") { status = "rejected"; code = "dup_in"; reason = "Ya existe una entrada sin salida (corrige desde el panel)" }
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
      if (ss != null && se != null) expectedMin = Math.max(0, se - ss - sd.brk)
      if (punchType === "entrada" && ss != null) lateMin = Math.max(0, nowMin - ss)
      if (punchType === "salida") {
        if (se != null) earlyMin = Math.max(0, se - nowMin)
        const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
        const { data: ent } = await sb.from("hr_punches").select("punched_at").eq("business_id", businessId).eq("employee_id", employeeId).eq("type", "entrada").eq("status", "approved").gte("punched_at", dayStart.toISOString()).order("punched_at", { ascending: true }).limit(1)
        const entIso = ent && ent[0] ? String((ent[0] as { punched_at: string }).punched_at) : ""
        if (entIso) { const [eh, em] = new Date(entIso).toLocaleTimeString("en-GB", { timeZone: TZ, hour12: false }).split(":"); workedMin = Math.max(0, nowMin - (Number(eh) * 60 + Number(em)) - sd.brk); if (expectedMin != null) overtimeMin = Math.max(0, workedMin - expectedMin) }
      }
    }
  }

  const { error: insErr } = await sb.from("hr_punches").insert({
    business_id: businessId, employee_id: employeeId, type: punchType, punched_at: nowDate.toISOString(), sucursal,
    source: "qr_kiosk", is_correction: false, latitude: lat, longitude: lng, distance_meters: distance, device_id: dev.id,
    status, rejection_reason: reason, device_info: String(body.device_info || "") || null,
    scheduled_start: scheduledStart, scheduled_end: scheduledEnd, expected_minutes: expectedMin,
    worked_minutes: workedMin, late_minutes: lateMin, early_leave_minutes: earlyMin, overtime_minutes: overtimeMin,
  })
  if (insErr) {
    if ((insErr as { code?: string }).code === "42P01") return json({ ok: false, code: "table_missing", error: "Falta la tabla de ponches (migración pendiente en db-cls)" })
    return json({ ok: false, code: "db_error", error: `No se pudo registrar la marca: ${insErr.message}` }, 500)
  }
  try { await sb.from("hr_audit_logs").insert({ business_id: businessId, module: "ponche", action: status === "approved" ? "punch_qr" : "punch_rejected", entity_type: "hr_punches", entity_id: employeeId, new_values: { type: punchType, status, reason, distance, late: lateMin, worked: workedMin } }) } catch { /* best-effort */ }

  return json({ ok: status === "approved", status, code, reason, employee_nombre: info.nombre, sucursal, distance_meters: distance, type: punchType, late_minutes: lateMin, worked_minutes: workedMin })
}

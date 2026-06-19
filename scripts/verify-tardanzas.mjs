// Verificación de datos reales (NO modifica nada) — replica getHrAttendanceHours
// para confirmar el KPI "Días con tardanza" por negocio. Lee db-cls vía service_role.
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/).filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
console.log("Supabase host:", URL_.replace(/(https?:\/\/[^.]+).*/, "$1...(self-hosted db-cls)"))
console.log("¿Es Cloud (*.supabase.co)?:", URL_.includes(".supabase.co") ? "SÍ ⚠️" : "NO ✅")
const sb = createClient(URL_, KEY, { auth: { persistSession: false } })

const TZ = "America/Santo_Domingo"
const dayOf = iso => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ })
const minOf = iso => { const [h, m] = new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ, hour12: false }).split(":"); return +h * 60 + +m }
const hhmmToMin = s => { s = String(s ?? "").trim(); if (!s) return null; const [h, m] = s.split(":"); const n = +h * 60 + (+m || 0); return Number.isFinite(n) ? n : null }
const DEFAULT_LUNCH = 60, NO_LUNCH_FROM = 12 * 60 + 30

async function schedFor(businessId, employeeId, dateStr, sucFallback) {
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay()
  const { data: scheds } = await sb.from("hr_employee_schedules")
    .select("id, sucursal, effective_from, effective_to")
    .eq("business_id", businessId).eq("employee_id", employeeId).eq("active", true)
    .order("effective_from", { ascending: false })
  for (const s of (scheds || [])) {
    const from = s.effective_from ? String(s.effective_from).slice(0, 10) : null
    const to = s.effective_to ? String(s.effective_to).slice(0, 10) : null
    if (from && dateStr < from) continue
    if (to && dateStr > to) continue
    const { data: day } = await sb.from("hr_employee_schedule_days").select("*").eq("schedule_id", s.id).eq("day_of_week", dow).maybeSingle()
    if (day) return { is_working_day: day.is_working_day !== false, start_time: day.start_time ?? null }
    return { is_working_day: false, start_time: null }
  }
  if (sucFallback) {
    const { data: geo } = await sb.from("hr_branch_geofences").select("workday_config").eq("business_id", businessId).eq("sucursal", sucFallback).maybeSingle()
    const dc = geo?.workday_config?.[String(dow)]
    if (dc) return { is_working_day: dc.working !== false, start_time: dc.start ?? null }
  }
  return null
}

async function countLate(businessId, label) {
  const desde = "2026-05-20", hasta = "2026-06-19"
  let pq = sb.from("hr_punches").select("employee_id,type,punched_at,sucursal,status").eq("status", "approved")
    .eq("business_id", businessId).gte("punched_at", desde).lte("punched_at", `${hasta}T23:59:59`).order("punched_at", { ascending: true })
  const { data: punches, error } = await pq
  if (error) { console.log(`\n[${label}] ERROR:`, error.message); return }
  const groups = new Map()
  for (const p of (punches || [])) { const k = `${p.employee_id}|${dayOf(p.punched_at)}`; if (!groups.has(k)) groups.set(k, { emp: p.employee_id, day: dayOf(p.punched_at), suc: p.sucursal, ps: [] }); groups.get(k).ps.push(p) }
  let lateDays = 0, totalDays = 0
  const lateList = []
  for (const g of groups.values()) {
    const ent = g.ps.find(x => x.type === "entrada") || g.ps[0]
    const aStart = ent ? minOf(ent.punched_at) : null
    const sd = await schedFor(businessId, g.emp, g.day, g.suc)
    const ss = sd ? hhmmToMin(sd.start_time) : null
    const late = (aStart != null && ss != null) ? Math.max(0, aStart - ss) : 0
    totalDays++
    if (late > 0) { lateDays++; lateList.push(`${g.day} ${g.emp.slice(0, 8)} suc=${g.suc || "—"} prog=${sd?.start_time} real=${String(Math.floor(aStart / 60)).padStart(2, "0")}:${String(aStart % 60).padStart(2, "0")} +${late}min`) }
  }
  console.log(`\n[${label}] business_id=${businessId}`)
  console.log(`  Días-empleado totales en rango: ${totalDays}`)
  console.log(`  ►► KPI "Días con tardanza": ${lateDays}`)
  lateList.slice(0, 15).forEach(l => console.log("   ·", l))
  if (lateList.length > 15) console.log(`   … y ${lateList.length - 15} más`)
}

await countLate("66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6", "CIBAO (csl)")
await countLate("03b96698-c5df-4b4b-84df-1160a7ad56b9", "DEPICENTER")
console.log("\n✓ Verificación de datos reales completada (sin modificar nada).")

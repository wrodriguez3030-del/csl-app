/**
 * Carga/actualiza los horarios semanales de los empleados de CSL (R Vidal,
 * Jardines, Villa Olga) con 1 hora de almuerzo por día trabajado.
 *
 * NO destructivo: upsert por (schedule_id, day_of_week) y reuso del horario
 * activo existente por empleado (no crea duplicados). Solo tenant CSL.
 *
 * Uso: node scripts/_seed-horarios-2026.js
 */
const { runSql } = require("./db-query")

const CSL = "66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6"
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'"

// day_of_week: Dom=0, Lun=1 … Sáb=6. Cada empleado: L,M,X,J,V,S (Dom siempre libre).
// Cada turno: "HH:MM-HH:MM" o null (LIBRE).
const EMP = [
  // ── R VIDAL ──────────────────────────────────────────────────────────────
  { id: "sol_1777322087088", task: "LUISA",    suc: "Rafael Vidal", d: ["09:00-18:00","09:00-20:00","09:00-16:00","09:00-18:00",null,"08:00-16:00"] },
  { id: "sol_1777301699636", task: "YANIBEL",  suc: "Rafael Vidal", d: ["12:30-20:00",null,"12:30-20:00","12:30-20:00","09:00-20:00","08:00-16:00"] },
  { id: "sol_1777321360063", task: "KARLA",    suc: "Rafael Vidal", d: ["09:00-13:00","09:00-13:00",null,"09:00-13:00","09:00-13:00","08:00-16:00"] },
  { id: "sol_1777397765546", task: "DIANA",    suc: "Rafael Vidal", d: ["10:30-20:00","09:00-18:00",null,"09:00-18:00","09:00-18:00","08:00-16:00"] },
  { id: "sol_1777323239749", task: "EMELY",    suc: "Rafael Vidal", d: ["12:30-20:00","12:30-20:00","09:00-20:00","09:00-18:00",null,"08:00-16:00"] },
  // Ashley: mismo horario que Emely (pedido del usuario).
  { id: "sol_1777398965952", task: "ASHLEY",   suc: "Rafael Vidal", d: ["12:30-20:00","12:30-20:00","09:00-20:00","09:00-18:00",null,"08:00-16:00"] },
  { id: "sol_1777398310745", task: "RIQUELMI", suc: "Rafael Vidal", d: ["12:30-20:00","09:00-20:00","12:30-20:00",null,"12:30-20:00","08:00-16:00"] },
  { id: "sol_1777321538864", task: "MADELIN",  suc: "Rafael Vidal", d: ["09:00-18:00",null,"09:00-18:00","10:30-20:00","09:00-18:00","08:00-16:00"] },
  { id: "sol_1777397196207", task: "ROSA",     suc: "Rafael Vidal", d: [null,"13:00-20:00","09:00-20:00","12:30-20:00","12:30-20:00","08:00-16:00"] },
  // ── JARDINES ─────────────────────────────────────────────────────────────
  { id: "sol_1777233711542", task: "LESLIE",   suc: "Los Jardines", d: ["09:00-18:00","09:00-18:00","09:00-20:00",null,"09:00-16:00","09:00-16:00"] },
  { id: "sol_1777322259932", task: "YADIBLE",  suc: "Los Jardines", d: ["12:30-20:00","12:30-20:00",null,"09:00-20:00","12:30-20:00","08:00-16:00"] },
  { id: "sol_1777383400024", task: "LILIAN",   suc: "Los Jardines", d: ["09:00-18:00","09:00-20:00",null,"09:00-16:00","09:00-18:00","08:00-16:00"] },
  { id: "sol_1777322084696", task: "NAYELIN",  suc: "Los Jardines", d: ["12:30-20:00",null,"12:30-20:00","12:30-20:00","12:30-20:00","08:00-16:00"] },
  { id: "sol_1777396867298", task: "YAMILKA",  suc: "Los Jardines", d: ["09:00-18:00","09:00-18:00","09:00-16:00","09:00-20:00",null,"08:00-16:00"] },
  { id: "sol_1777397180371", task: "KETHERINE",suc: "Los Jardines", d: ["12:30-20:00","12:30-20:00","12:30-20:00",null,"09:00-20:00","09:00-16:00"] },
  { id: "sol_1777321930740", task: "JOHELY",   suc: "Los Jardines", d: ["12:30-20:00",null,"09:00-20:00","12:30-20:00","12:30-20:00","08:00-16:00"] },
  { id: "sol_1777472516266", task: "BENITA",   suc: "Los Jardines", d: ["12:30-20:00",null,"09:00-17:30","12:30-20:00","13:00-20:00","08:00-16:00"] },
  // ── VILLA OLGA ───────────────────────────────────────────────────────────
  { id: "sol_1777321182771", task: "ANGELICA", suc: "Villa Olga",   d: ["09:00-18:00","09:00-18:00","09:00-16:00","09:00-20:00",null,"08:00-16:00"] },
  { id: "sol_1777234371834", task: "GIPSY",    suc: "Villa Olga",   d: ["12:30-20:00","12:30-20:00","12:30-20:00",null,"09:00-20:00","08:00-16:00"] },
  { id: "sol_1777230564766", task: "YESSICA",  suc: "Villa Olga",   d: ["09:00-16:00",null,"09:00-20:00","09:00-18:00","09:00-18:00","08:00-16:00"] },
  { id: "sol_1777230935407", task: "SAHOMY",   suc: "Villa Olga",   d: ["12:30-20:00","09:00-20:00",null,"12:30-20:00","12:30-20:00","08:00-16:00"] },
  { id: "sol_1777240105858", task: "AIDYLEE",  suc: "Villa Olga",   d: ["13:30-20:00","13:30-20:00","13:30-20:00","13:30-20:00","13:30-20:00","08:00-16:00"] },
  { id: "sol_1777248960268", task: "DAYHANA",  suc: "Villa Olga",   d: ["12:30-20:00","12:30-20:00","09:00-18:00",null,"12:30-20:00","08:00-16:00"] },
]

// Ventana de almuerzo (1 h) según el turno. Reglas oficiales de la tarea.
const LUNCH = {
  "08:00-16:00": ["12:00","13:00"],
  "09:00-16:00": ["12:00","13:00"],
  "09:00-17:30": ["13:00","14:00"],
  "09:00-18:00": ["13:00","14:00"],
  "09:00-20:00": ["13:00","14:00"],
  "10:30-20:00": ["14:30","15:30"],
  "12:30-20:00": ["16:00","17:00"],
  "13:00-20:00": ["16:00","17:00"],
  "13:30-20:00": ["16:30","17:30"],
}
const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t); return Number(m[1]) * 60 + Number(m[2]) }
const fmt = (mins) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`
// Almuerzo de 1 h: usa la regla oficial; si el turno no está en la tabla,
// centra 60 min dentro del turno (caso turnos cortos 09:00-13:00).
// REGLA: el personal que ENTRA a las 12:30 PM no tiene hora de almuerzo → null.
function lunchWindow(shift) {
  const [a, b] = shift.split("-")
  if (a === "12:30") return null
  if (LUNCH[shift]) return LUNCH[shift]
  const s = toMin(a), e = toMin(b)
  const ls = s + Math.max(0, Math.floor((e - s - 60) / 2))
  return [fmt(ls), fmt(ls + 60)]
}

async function getOrCreateSchedule(emp) {
  const sel = await runSql(`select id from hr_employee_schedules where business_id=${q(CSL)} and employee_id=${q(emp.id)} and active=true order by created_at asc limit 1`)
  if (Array.isArray(sel) && sel[0] && sel[0].id) {
    await runSql(`update hr_employee_schedules set sucursal=${q(emp.suc)}, name='Horario semanal', active=true, updated_at=now() where id=${q(sel[0].id)}`)
    return { id: sel[0].id, created: false }
  }
  const ins = await runSql(`insert into hr_employee_schedules (id, business_id, employee_id, sucursal, name, active, effective_from, created_at, updated_at) values (gen_random_uuid(), ${q(CSL)}, ${q(emp.id)}, ${q(emp.suc)}, 'Horario semanal', true, current_date, now(), now()) returning id`)
  return { id: ins[0].id, created: true }
}

async function upsertDays(schedId, emp) {
  // Dom (0) siempre libre; L-S (1..6) según emp.d[0..5].
  const rows = []
  rows.push(`(${q(schedId)}, ${q(CSL)}, 0, false, null, null, null, null, 0, now())`)
  for (let i = 0; i < 6; i++) {
    const dow = i + 1
    const shift = emp.d[i]
    if (!shift) { rows.push(`(${q(schedId)}, ${q(CSL)}, ${dow}, false, null, null, null, null, 0, now())`); continue }
    const [s, e] = shift.split("-")
    const lunch = lunchWindow(shift)
    if (!lunch) { rows.push(`(${q(schedId)}, ${q(CSL)}, ${dow}, true, ${q(s)}, ${q(e)}, null, null, 0, now())`); continue }
    rows.push(`(${q(schedId)}, ${q(CSL)}, ${dow}, true, ${q(s)}, ${q(e)}, ${q(lunch[0])}, ${q(lunch[1])}, 60, now())`)
  }
  await runSql(`insert into hr_employee_schedule_days
    (schedule_id, business_id, day_of_week, is_working_day, start_time, end_time, lunch_start, lunch_end, break_minutes, updated_at)
    values ${rows.join(", ")}
    on conflict (schedule_id, day_of_week) do update set
      is_working_day=excluded.is_working_day, start_time=excluded.start_time, end_time=excluded.end_time,
      lunch_start=excluded.lunch_start, lunch_end=excluded.lunch_end, break_minutes=excluded.break_minutes, updated_at=now()`)
}

;(async () => {
  let created = 0, updated = 0
  for (const emp of EMP) {
    const { id, created: isNew } = await getOrCreateSchedule(emp)
    await upsertDays(id, emp)
    if (isNew) created++; else updated++
    console.log(`${isNew ? "CREADO " : "ACTUAL."} ${emp.task.padEnd(10)} ${emp.suc.padEnd(14)} sched=${id}`)
  }
  console.log(`\nOK · ${EMP.length} empleados · ${created} horarios creados · ${updated} actualizados`)
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1) })

/**
 * Backfill final Depicenter: rellena csl_pulse_readings.disp_operador
 * desde csl_operator_shots para cada reading que matchee por
 * (business_id, period_start, period_end, sucursal_norm, operadora_norm).
 *
 * Solo afecta filas donde disp_operador es null. Idempotente.
 */
const fs = require("fs"), path = require("path")
const env = path.join(__dirname, "../.env.local")
if (fs.existsSync(env)) for (const ln of fs.readFileSync(env, "utf8").split(/\r?\n/)) {
  const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }

async function get(p) {
  const r = await fetch(URL + p, { headers: H })
  if (!r.ok) throw new Error(`GET ${p}: HTTP ${r.status} ${await r.text()}`)
  return r.json()
}
async function patch(p, body) {
  const r = await fetch(URL + p, { method: "PATCH", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`PATCH ${p}: HTTP ${r.status} ${await r.text()}`)
  return r.json()
}

// Normalizadores idénticos a lib/normalize-pulse.ts
const HEADER_SKIP = new Set(["SUCURSAL","OPERADORA","OPERADOR","EQUIPO","EQUIPOID","CABINA","PULSOS","ESTADO","FALLAS","SERIAL","SEMANA","FECHA","CLIENTE","TRATAMIENTO","POTENCIA","SPOT","DISPAROS","SECUENCIAL","CONTACTO","TOTAL","TOTALES"])
const OP_ALIAS = { KATHERINE: "KATHERIN", EMELY: "EMELI", RIQUELMI: "ROQUELMI", YESICA: "YESSICA", SAOMY: "SAHOMY" }
const OP_SKIP = new Set(["SISTEMA","SYSTEM","ADMIN","OPERADORA","OPERADOR","EQUIPO","EQUIPOID","SUCURSAL"])
const BRAND = /^(?:cibao\s+spa\s+l[aá]ser|cibao\s+spa\s+laser|depicenter|csl)\s*[-–—]?\s*/i
const clu = s => String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toUpperCase().replace(/\s+/g," ").trim()
function ns(v) {
  const s = String(v||"").trim(); if (!s) return ""
  const upR = clu(s); if (!upR || HEADER_SKIP.has(upR)) return ""
  if (upR.includes("DEPICENTER")) return "DEPICENTER"
  if (upR.includes("SKIN") && upR.includes("LASER")) return "DEPICENTER"
  const st = s.replace(BRAND,"").trim() || s; const up = clu(st)
  if (!up || HEADER_SKIP.has(up)) return ""
  if (up.includes("JARDINES")) return "LOS JARDINES"
  if (up === "R VIDAL" || ["RAFAEL","VIDAL","PLAZA","MEDITERR"].some(t=>up.includes(t))) return "RAFAEL VIDAL"
  if ((up.includes("VILLA") && up.includes("OLGA")) || up === "V OLGA") return "VILLA OLGA"
  if (up.includes("LA VEGA")) return "LA VEGA"
  return up
}
function no(v){const up=clu(v); if(!up||OP_SKIP.has(up)) return ""; return OP_ALIAS[up]||up}

;(async () => {
  const businesses = await get("/rest/v1/businesses?select=id,slug")
  const targets = businesses.filter(b => b.slug === "depicenter" || b.slug === "csl")

  let totalUpdated = 0, totalUnchanged = 0, totalSkipped = 0
  for (const tenant of targets) {
    console.log(`\n=== Tenant: ${tenant.slug} (${tenant.id}) ===`)
    const readings = await get(`/rest/v1/csl_pulse_readings?select=id,equipo_id,sucursal,operadora,period_start,period_end,disp_laser,disp_operador&business_id=eq.${tenant.id}`)
    const shots = await get(`/rest/v1/csl_operator_shots?select=period_start,period_end,sucursal_normalizada,operadora_normalizada,disparos&business_id=eq.${tenant.id}`)
    const shotsIdx = new Map()
    for (const s of shots) {
      const k = `${s.period_start}|${s.period_end}|${(s.sucursal_normalizada||"").toUpperCase()}|${(s.operadora_normalizada||"").toUpperCase()}`
      shotsIdx.set(k, Number(s.disparos)||0)
    }

    for (const r of readings) {
      const sn = ns(r.sucursal), on = no(r.operadora)
      if (!sn || !on) { totalSkipped++; continue }
      const k = `${r.period_start}|${r.period_end}|${sn}|${on}`
      const newDisp = shotsIdx.get(k)
      if (newDisp == null) { totalSkipped++; continue }
      const current = r.disp_operador == null ? null : Number(r.disp_operador)
      const target = newDisp > 0 ? newDisp : null
      if (current === target) { totalUnchanged++; continue }
      const laser = Number(r.disp_laser) || 0
      const pct = target != null && laser > 0 ? Math.round(((target - laser)/laser)*10000)/100 : null
      await patch(`/rest/v1/csl_pulse_readings?id=eq.${r.id}`, { disp_operador: target, diferencia_pct: pct, updated_at: new Date().toISOString() })
      console.log(`  ✓ eq=${r.equipo_id} ${r.period_start} ${sn}|${on}: ${current||"null"} → ${target}  (pct=${pct})`)
      totalUpdated++
    }
  }
  console.log(`\nResumen: updated=${totalUpdated}  unchanged=${totalUnchanged}  skipped=${totalSkipped}`)
})().catch(e => { console.error("ERROR:", e.message); process.exit(1) })

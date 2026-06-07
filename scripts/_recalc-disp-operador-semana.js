// Recalcula csl_pulse_readings.disp_operador para la semana 2026-06-01..06 (Cibao)
// desde csl_operator_shots (ya corregido a 242,574). Replica recalculateDispOperador.
// No destructivo (UPDATE). Solo esta semana.
const fs = require("fs")
for (const ln of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "") }
const U = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim(), K = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
const H = { apikey: K, Authorization: "Bearer " + K, "Content-Type": "application/json" }
const rmAcc = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "")
const cleanUpper = s => rmAcc(String(s || "")).toUpperCase().replace(/\s+/g, " ").trim()
const OP_ALIAS = { KATHERIN: "KATHERINE", EMELI: "EMELY", ROQUELMI: "RIQUELMI", YESICA: "YESSICA", SAOMY: "SAHOMY" }
const OP_SKIP = new Set(["", "SISTEMA", "OPERADOR", "OPERADORA"])
const normOp = v => { const up = cleanUpper(v); if (OP_SKIP.has(up)) return ""; return OP_ALIAS[up] || up }
function normSuc(v) {
  const upRaw = cleanUpper(v); if (!upRaw) return ""
  if (upRaw.includes("DEPICENTER")) return "DEPICENTER"
  if (upRaw.includes("SKIN") && upRaw.includes("LASER")) return "DEPICENTER"
  const stripped = String(v || "").replace(/^.+\s+-\s+/i, "").trim() || String(v || "")
  const up = cleanUpper(stripped)
  if (up.includes("JARDINES")) return "LOS JARDINES"
  if (up === "R VIDAL" || up.includes("RAFAEL") || up.includes("VIDAL") || up.includes("PLAZA") || up.includes("MEDITERR")) return "RAFAEL VIDAL"
  if ((up.includes("VILLA") && up.includes("OLGA")) || up === "V OLGA") return "VILLA OLGA"
  if (up.includes("LA VEGA")) return "LA VEGA"
  return up
}
const get = async p => (await fetch(U + p, { headers: H })).json()
const PS = "2026-06-01", PE = "2026-06-06"
;(async () => {
  const cibao = (await get("/rest/v1/businesses?select=id&slug=eq.csl"))[0]
  const shots = await get("/rest/v1/csl_operator_shots?select=sucursal_normalizada,operadora_normalizada,disparos&business_id=eq." + cibao.id + "&period_start=eq." + PS + "&period_end=eq." + PE)
  const shotsByKey = new Map()
  for (const s of shots) { const k = cleanUpper(s.sucursal_normalizada) + "|" + cleanUpper(s.operadora_normalizada); shotsByKey.set(k, (shotsByKey.get(k) || 0) + (Number(s.disparos) || 0)) }
  const readings = await get("/rest/v1/csl_pulse_readings?select=id,sucursal,operadora,disp_laser,disp_operador,period_start,period_end&business_id=eq." + cibao.id + "&period_start=eq." + PS)
  let updated = 0, total = 0
  for (const r of readings) {
    const suc = normSuc(r.sucursal), op = normOp(r.operadora)
    if (!suc || !op) continue
    const newVal = shotsByKey.get(suc + "|" + op) || 0
    total += newVal
    const dispLaser = Number(r.disp_laser) || 0
    const pct = newVal > 0 && dispLaser > 0 ? Math.round(((newVal - dispLaser) / dispLaser) * 10000) / 100 : null
    const res = await fetch(U + "/rest/v1/csl_pulse_readings?id=eq." + r.id + "&business_id=eq." + cibao.id, { method: "PATCH", headers: H, body: JSON.stringify({ disp_operador: newVal > 0 ? newVal : null, diferencia_pct: pct, updated_at: new Date().toISOString() }) })
    if (res.ok) { updated++; console.log("  " + r.operadora + " (" + r.sucursal + "): " + r.disp_operador + " -> " + newVal) }
    else console.log("  fallo " + r.id + ": " + res.status + " " + (await res.text()).slice(0, 100))
  }
  console.log("\nactualizadas: " + updated + " | suma disp_operador semana = " + total)
})().catch(e => { console.error(e.message); process.exit(1) })

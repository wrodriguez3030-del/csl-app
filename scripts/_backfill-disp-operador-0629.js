/**
 * Backfill del incidente DISP OPERADOR = 0 (semana 29-jun → 04-jul 2026).
 *
 * 1. Corrige los csl_pulse_readings guardados con period_start=2026-07-29
 *    (parser aplicaba el mes del filename a ambos días; la semana real es
 *    29-jun → 04-jul) → period_start=2026-06-29 + period_label correcto.
 * 2. Recalcula disp_operador y diferencia_pct de TODOS los readings de ambos
 *    tenants: match exacto con csl_operator_shots, luego por semana
 *    (period_start+sucursal+operadora), luego suma de csl_sesiones_cliente.
 *
 * Idempotente. No toca tablas fuente (shots/sesiones). No escribe 0: si no
 * hay datos deja null. Solo actualiza filas cuyo valor cambia.
 *
 * Uso: node scripts/_backfill-disp-operador-0629.js [--dry-run]
 */

const fs = require("fs"), path = require("path")
const DRY = process.argv.includes("--dry-run")

const env = path.join(__dirname, "../.env.local")
if (fs.existsSync(env)) {
  for (const ln of fs.readFileSync(env, "utf8").split(/\r?\n/)) {
    const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
  }
}
const U = process.env.NEXT_PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!U || !K) { console.error("Faltan env vars de Supabase"); process.exit(1) }
if (/\.supabase\.co/.test(U)) { console.error("ABORTADO: apunta a Supabase Cloud; debe ser el self-hosted"); process.exit(1) }
console.log("Supabase:", new URL(U).host, DRY ? "(DRY-RUN)" : "")

const H = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" }
async function get(p) {
  const r = await fetch(U + p, { headers: H })
  if (!r.ok) throw new Error(`GET ${r.status} ${p}: ${(await r.text()).slice(0, 300)}`)
  return r.json()
}
async function getAll(p) {
  // Paginación explícita: PostgREST corta en 1000 filas por defecto y un
  // corte silencioso aquí produciría sumas incompletas.
  const out = []
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(U + p + `${p.includes("?") ? "&" : "?"}limit=1000&offset=${offset}`, { headers: H })
    if (!r.ok) throw new Error(`GET ${r.status} ${p}: ${(await r.text()).slice(0, 300)}`)
    const page = await r.json()
    out.push(...page)
    if (page.length < 1000) return out
  }
}
async function patch(p, body) {
  if (DRY) return true
  const r = await fetch(U + p, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`PATCH ${r.status} ${p}: ${(await r.text()).slice(0, 300)}`)
  return true
}

// Réplica de lib/normalize-pulse.ts (scripts no importan TS)
const rmAcc = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
const cleanUpper = s => rmAcc(s).toUpperCase().replace(/\s+/g, " ").trim()
const BRAND = /^(?:cibao\s+spa\s+l[aá]ser|cibao\s+spa\s+laser|depicenter|csl)\s*[-–—]?\s*/i
function normSuc(v) {
  const s = String(v || "").trim(); if (!s) return ""
  const upRaw = cleanUpper(s)
  if (upRaw.includes("DEPICENTER")) return "DEPICENTER"
  if (upRaw.includes("SKIN") && upRaw.includes("LASER")) return "DEPICENTER"
  const up = cleanUpper(s.replace(BRAND, "").trim() || s)
  if (up.includes("JARDINES")) return "LOS JARDINES"
  if (up === "R VIDAL" || up.includes("RAFAEL") || up.includes("VIDAL") || up.includes("PLAZA") || up.includes("MEDITERR")) return "RAFAEL VIDAL"
  if ((up.includes("VILLA") && up.includes("OLGA")) || up === "V OLGA") return "VILLA OLGA"
  if (up.includes("LA VEGA")) return "LA VEGA"
  return up
}
const OP_ALIAS = { KATHERINE: "KATHERIN", EMELY: "EMELI", RIQUELMI: "ROQUELMI", YESICA: "YESSICA", SAOMY: "SAHOMY" }
const OP_SKIP = new Set(["SISTEMA", "SYSTEM", "ADMIN", "OPERADORA", "OPERADOR", "EQUIPO", "EQUIPOID", "SUCURSAL"])
const normOp = v => { const up = cleanUpper(v); if (!up || OP_SKIP.has(up)) return ""; return OP_ALIAS[up] ?? up }

async function main() {
  // ── 1) Corregir la semana invertida 2026-07-29 → 2026-06-29 ─────────────
  console.log("\n[1] Corrección de fechas de la semana 29-jun → 04-jul")
  const broken = await get("/rest/v1/csl_pulse_readings?select=id,period_start,period_end,sucursal,operadora&period_start=eq.2026-07-29&period_end=eq.2026-07-04")
  console.log(`  filas con period_start=2026-07-29: ${broken.length}`)
  for (const r of broken) {
    console.log(`  fix ${r.sucursal} | ${r.operadora} (${r.id})`)
    await patch(`/rest/v1/csl_pulse_readings?id=eq.${r.id}`, {
      period_start: "2026-06-29",
      period_label: "29/06/2026 al 04/07/2026",
      updated_at: new Date().toISOString(),
    })
  }

  // ── 2) Recalcular disp_operador en todos los readings, por tenant ───────
  const businesses = await get("/rest/v1/businesses?select=id,slug")
  let totalUpdated = 0
  for (const biz of businesses) {
    console.log(`\n[2] Recalc tenant ${biz.slug}`)
    const readings = await getAll(`/rest/v1/csl_pulse_readings?select=id,period_start,period_end,sucursal,operadora,operadora_corregida,disp_operador,disp_laser&business_id=eq.${biz.id}`)
    const shots = await getAll(`/rest/v1/csl_operator_shots?select=period_start,period_end,sucursal_normalizada,operadora_normalizada,disparos,updated_at&business_id=eq.${biz.id}`)
    const sesiones = await getAll(`/rest/v1/csl_sesiones_cliente?select=fecha,sucursal,operadora_id,disparos_reportados&business_id=eq.${biz.id}`)
    console.log(`  readings=${readings.length} shots=${shots.length} sesiones=${sesiones.length}`)

    const exactKey = new Map(), weekKey = new Map()
    for (const s of shots) {
      const start = String(s.period_start).slice(0, 10)
      const suc = normSuc(s.sucursal_normalizada), op = normOp(s.operadora_normalizada)
      if (!suc || !op) continue
      const ek = `${start}|${String(s.period_end).slice(0, 10)}|${suc}|${op}`
      exactKey.set(ek, (exactKey.get(ek) || 0) + Number(s.disparos || 0))
      const wk = `${start}|${suc}|${op}`, upd = String(s.updated_at || "")
      const prev = weekKey.get(wk)
      if (!prev || upd > prev.updated) weekKey.set(wk, { disparos: Number(s.disparos || 0), updated: upd })
    }

    let updated = 0, unchanged = 0, sinDatos = 0
    for (const r of readings) {
      const desde = String(r.period_start).slice(0, 10), hasta = String(r.period_end).slice(0, 10)
      const suc = normSuc(r.sucursal), op = normOp(r.operadora_corregida || r.operadora)
      if (!suc || !op) { sinDatos++; continue }
      let suma = exactKey.get(`${desde}|${hasta}|${suc}|${op}`)
        ?? weekKey.get(`${desde}|${suc}|${op}`)?.disparos
        ?? 0
      if (suma === 0) {
        for (const s of sesiones) {
          const f = String(s.fecha || "").slice(0, 10)
          if (!f || f < desde || f > hasta) continue
          if (normSuc(s.sucursal) !== suc || normOp(s.operadora_id) !== op) continue
          suma += Number(s.disparos_reportados) || 0
        }
      }
      const current = r.disp_operador == null ? null : Number(r.disp_operador)
      const nuevo = suma > 0 ? suma : null // nunca escribir 0: sin datos = null
      if (current === nuevo) { unchanged++; if (nuevo == null) sinDatos++; continue }
      const laser = Number(r.disp_laser) || 0
      const pct = nuevo != null && laser > 0 ? Math.round(((nuevo - laser) / laser) * 10000) / 100 : null
      console.log(`  ${desde} ${suc}|${op}: ${current} -> ${nuevo}${nuevo == null ? " (sin datos)" : ""}`)
      await patch(`/rest/v1/csl_pulse_readings?id=eq.${r.id}&business_id=eq.${biz.id}`, {
        disp_operador: nuevo, diferencia_pct: pct, updated_at: new Date().toISOString(),
      })
      updated++
    }
    console.log(`  actualizados=${updated} sin cambio=${unchanged} sin datos (quedan null)=${sinDatos}`)
    totalUpdated += updated
  }
  console.log(`\nTOTAL actualizados: ${totalUpdated}${DRY ? " (dry-run, nada escrito)" : ""}`)
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1) })

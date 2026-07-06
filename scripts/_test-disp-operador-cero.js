/**
 * Prueba anti-regresión: DISP OPERADOR no puede quedar en 0 cuando existen
 * disparos reales de la operadora para la misma semana/sucursal/operadora.
 *
 * Parte 1 (unit, sin red): detectPeriodFromFilename maneja semanas que cruzan
 *   de mes/año y jamás devuelve un período invertido (la causa raíz del
 *   incidente de la semana 29-jun → 04-jul 2026).
 * Parte 2 (e2e, db-cls): ningún csl_pulse_readings con shots > 0 para su
 *   (period_start, sucursal, operadora) puede tener disp_operador nulo/0,
 *   y ningún reading puede tener period_start > period_end.
 *
 * Uso: node scripts/_test-disp-operador-cero.js
 * (Parte 1 requiere Node >= 23.6 por el type-stripping nativo de .ts)
 */

const fs = require("fs"), path = require("path")
let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✓ ${msg}`) } else { fail++; console.log(`  ✗ ${msg}`) } }

async function unitTests() {
  console.log("[1] detectPeriodFromFilename")
  const { detectPeriodFromFilename } = require("../lib/equipos-dashboard-parser.ts")

  const normal = detectPeriodFromFilename("25_30_Mayo_2026.xlsx")
  ok(normal?.start === "2026-05-25" && normal?.end === "2026-05-30", `semana normal: ${JSON.stringify(normal)}`)

  const cruzaMes = detectPeriodFromFilename("29_04_Julio_2026.xlsx")
  ok(cruzaMes?.start === "2026-06-29", `cruce de mes start=2026-06-29 (fue el bug: daba 2026-07-29): ${cruzaMes?.start}`)
  ok(cruzaMes?.end === "2026-07-04", `cruce de mes end=2026-07-04: ${cruzaMes?.end}`)
  ok(cruzaMes?.label === "29/06/2026 al 04/07/2026", `label con meses reales: ${cruzaMes?.label}`)

  const cruzaAno = detectPeriodFromFilename("29_03_Enero_2027.xlsx")
  ok(cruzaAno?.start === "2026-12-29" && cruzaAno?.end === "2027-01-03", `cruce de año: ${JSON.stringify(cruzaAno)}`)

  ok(detectPeriodFromFilename("sin_periodo.xlsx") === null, "nombre sin período → null")

  // Invariante: NUNCA un período invertido, para cualquier combinación de días
  let invertidos = 0
  for (let d1 = 1; d1 <= 31; d1++) for (let d2 = 1; d2 <= 31; d2++) {
    const p = detectPeriodFromFilename(`${d1}_${d2}_Junio_2026.xlsx`)
    if (p && p.start > p.end) invertidos++
  }
  ok(invertidos === 0, `ningún período invertido en 31x31 combinaciones (invertidos=${invertidos})`)
}

async function dbTests() {
  console.log("[2] db-cls: readings vs operator_shots")
  const env = path.join(__dirname, "../.env.local")
  if (fs.existsSync(env)) {
    for (const ln of fs.readFileSync(env, "utf8").split(/\r?\n/)) {
      const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
    }
  }
  const U = process.env.NEXT_PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!U || !K) { console.log("  (sin credenciales — se omite la parte e2e)"); return }
  ok(!/\.supabase\.co/.test(U), `Supabase self-hosted (${new URL(U).host}), no Cloud`)
  const H = { apikey: K, Authorization: `Bearer ${K}` }
  const getAll = async p => {
    const out = []
    for (let offset = 0; ; offset += 1000) {
      const r = await fetch(U + p + `${p.includes("?") ? "&" : "?"}limit=1000&offset=${offset}`, { headers: H })
      if (!r.ok) throw new Error(`GET ${r.status} ${p}`)
      const page = await r.json()
      out.push(...page)
      if (page.length < 1000) return out
    }
  }

  // Normalización mínima (réplica de lib/normalize-pulse.ts)
  const rmAcc = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  const cleanUpper = s => rmAcc(s).toUpperCase().replace(/\s+/g, " ").trim()
  const BRAND = /^(?:cibao\s+spa\s+l[aá]ser|cibao\s+spa\s+laser|depicenter|csl)\s*[-–—]?\s*/i
  const normSuc = v => {
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
  const normOp = v => { const up = cleanUpper(v); return OP_ALIAS[up] ?? up }

  const businesses = await getAll("/rest/v1/businesses?select=id,slug")
  for (const biz of businesses) {
    const readings = await getAll(`/rest/v1/csl_pulse_readings?select=period_start,period_end,sucursal,operadora,operadora_corregida,disp_operador&business_id=eq.${biz.id}`)
    const shots = await getAll(`/rest/v1/csl_operator_shots?select=period_start,sucursal_normalizada,operadora_normalizada,disparos&business_id=eq.${biz.id}`)
    const shotsByWeek = new Map()
    for (const s of shots) {
      const k = `${String(s.period_start).slice(0, 10)}|${normSuc(s.sucursal_normalizada)}|${normOp(s.operadora_normalizada)}`
      shotsByWeek.set(k, (shotsByWeek.get(k) || 0) + Number(s.disparos || 0))
    }

    const invertidos = readings.filter(r => String(r.period_start).slice(0, 10) > String(r.period_end).slice(0, 10))
    ok(invertidos.length === 0, `${biz.slug}: 0 readings con período invertido (hay ${invertidos.length})`)

    const cerosFalsos = []
    for (const r of readings) {
      const k = `${String(r.period_start).slice(0, 10)}|${normSuc(r.sucursal)}|${normOp(r.operadora_corregida || r.operadora)}`
      const disparosReales = shotsByWeek.get(k) || 0
      const stored = Number(r.disp_operador) || 0
      if (disparosReales > 0 && stored === 0) {
        cerosFalsos.push(`${k} shots=${disparosReales} stored=${r.disp_operador}`)
      }
    }
    ok(cerosFalsos.length === 0,
      `${biz.slug}: 0 readings con DISP OPERADOR en cero teniendo disparos reales (hay ${cerosFalsos.length})`)
    for (const c of cerosFalsos.slice(0, 10)) console.log(`      → ${c}`)
  }
}

;(async () => {
  await unitTests()
  await dbTests()
  console.log(`\n${pass} pass, ${fail} fail`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error("ERROR:", e.message); process.exit(1) })

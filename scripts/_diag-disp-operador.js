/**
 * Diagnóstico DISP OPERADOR = 0 en Auditoría PULSE.
 *
 * Para cada tenant (CIBAO/DEPICENTER) y cada semana en csl_pulse_readings:
 *   - readings: disp_operador guardado por (sucursal, operadora)
 *   - shots:    suma de csl_operator_shots por (sucursal_norm, operadora_norm)
 *   - sesiones: suma de csl_sesiones_cliente por rango de fechas + match key
 * Marca dónde el valor real se pierde (existe en shots/sesiones pero el
 * reading muestra 0/null y viceversa). Solo lectura, no modifica nada.
 */

const fs = require("fs"), path = require("path")

const env = path.join(__dirname, "../.env.local")
if (fs.existsSync(env)) {
  for (const ln of fs.readFileSync(env, "utf8").split(/\r?\n/)) {
    const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !KEY) { console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1) }
console.log("Supabase host:", new URL(SUPABASE_URL).host, "(debe ser self-hosted db-cls, NO *.supabase.co)")

async function api(pathname) {
  const r = await fetch(SUPABASE_URL + pathname, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  })
  if (!r.ok) throw new Error(`HTTP ${r.status} ${pathname}: ${(await r.text()).slice(0, 300)}`)
  return r.json()
}

// Réplica mínima de lib/normalize-pulse.ts (los scripts no pueden importar TS)
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
const normOp = v => { const up = cleanUpper(v); return OP_ALIAS[up] ?? up }

async function main() {
  const businesses = await api("/rest/v1/businesses?select=id,slug,name")
  for (const b of businesses) console.log(`  business: ${b.slug}  ${b.id}  "${b.name}"`)

  for (const biz of businesses) {
    console.log("\n" + "=".repeat(90))
    console.log(`TENANT ${biz.slug.toUpperCase()} (${biz.id})`)

    const readings = await api(`/rest/v1/csl_pulse_readings?select=id,period_start,period_end,sucursal,operadora,operadora_corregida,disp_operador,disp_laser,equipo_id,cabina&business_id=eq.${biz.id}&order=period_start.desc`)
    const shots = await api(`/rest/v1/csl_operator_shots?select=period_start,period_end,sucursal_normalizada,operadora_normalizada,sesiones,disparos&business_id=eq.${biz.id}`)
    const sesiones = await api(`/rest/v1/csl_sesiones_cliente?select=fecha,sucursal,operadora_id,disparos_reportados&business_id=eq.${biz.id}`)
    console.log(`readings=${readings.length}  operator_shots=${shots.length}  sesiones_cliente=${sesiones.length}`)

    // Índices
    const shotsByKey = new Map()
    for (const s of shots) {
      const k = `${String(s.period_start).slice(0,10)}|${String(s.period_end).slice(0,10)}|${normSuc(s.sucursal_normalizada)}|${normOp(s.operadora_normalizada)}`
      shotsByKey.set(k, (shotsByKey.get(k) || 0) + Number(s.disparos || 0))
    }
    const shotWeeks = [...new Set(shots.map(s => String(s.period_start).slice(0,10)))].sort()
    const readingWeeks = [...new Set(readings.map(r => String(r.period_start).slice(0,10)))].sort()
    console.log(`semanas readings: ${readingWeeks.join(", ") || "(ninguna)"}`)
    console.log(`semanas shots:    ${shotWeeks.join(", ") || "(ninguna)"}`)

    // Por semana: comparar
    const byWeek = new Map()
    for (const r of readings) {
      const wk = String(r.period_start).slice(0,10)
      if (!byWeek.has(wk)) byWeek.set(wk, [])
      byWeek.get(wk).push(r)
    }
    for (const [wk, rows] of [...byWeek.entries()].sort((a,b)=>b[0].localeCompare(a[0]))) {
      console.log(`\n-- Semana ${wk} (${rows.length} readings)`)
      let zeros = 0, ok = 0, mismatches = []
      for (const r of rows) {
        const desde = String(r.period_start).slice(0,10), hasta = String(r.period_end).slice(0,10)
        const opEf = r.operadora_corregida || r.operadora
        const suc = normSuc(r.sucursal), op = normOp(opEf)
        const stored = r.disp_operador == null ? null : Number(r.disp_operador)
        const shotSum = shotsByKey.get(`${desde}|${hasta}|${suc}|${op}`) ?? null
        let sesSum = 0
        for (const s of sesiones) {
          const f = String(s.fecha || "").slice(0,10)
          if (!f || f < desde || f > hasta) continue
          if (normSuc(s.sucursal) !== suc || normOp(s.operadora_id) !== op) continue
          sesSum += Number(s.disparos_reportados) || 0
        }
        const effective = (stored && stored > 0) ? stored : (shotSum ?? sesSum)
        if (!effective) zeros++; else ok++
        if ((!stored || stored === 0) && ((shotSum ?? 0) > 0 || sesSum > 0)) {
          mismatches.push(`   PIERDE: ${suc}|${op} eq=${r.equipo_id} stored=${stored} shots=${shotSum} sesiones=${sesSum}`)
        } else if (!effective) {
          mismatches.push(`   CERO REAL: ${suc}|${op} eq=${r.equipo_id} stored=${stored} shots=${shotSum} sesiones=${sesSum} laser=${r.disp_laser}`)
        }
      }
      console.log(`   con valor=${ok}  en cero=${zeros}`)
      for (const m of mismatches.slice(0, 30)) console.log(m)
      if (mismatches.length > 30) console.log(`   ... ${mismatches.length - 30} más`)
    }

    // Shots huérfanos: semanas con shots pero sin readings de esa semana
    const orphanWeeks = shotWeeks.filter(w => !readingWeeks.includes(w))
    if (orphanWeeks.length) console.log(`\n⚠ semanas con shots SIN readings: ${orphanWeeks.join(", ")}`)
  }

  // Cross-tenant: shots cuya sucursal no corresponde al tenant del business_id
  console.log("\n" + "=".repeat(90))
  console.log("CHEQUEO CROSS-TENANT operator_shots")
  const allShots = await api(`/rest/v1/csl_operator_shots?select=business_id,period_start,sucursal_normalizada,operadora_normalizada,disparos`)
  const bizBySlug = Object.fromEntries(businesses.map(b => [b.slug, b.id]))
  const TEN = { csl: ["LOS JARDINES","RAFAEL VIDAL","VILLA OLGA"], depicenter: ["DEPICENTER","LA VEGA"] }
  let cross = 0
  for (const s of allShots) {
    const suc = normSuc(s.sucursal_normalizada)
    const owner = Object.entries(TEN).find(([,list]) => list.includes(suc))?.[0]
    if (owner && bizBySlug[owner] && s.business_id !== bizBySlug[owner]) {
      cross++
      console.log(`  MAL RUTEADO: ${String(s.period_start).slice(0,10)} ${suc}|${s.operadora_normalizada} disparos=${s.disparos} business_id=${s.business_id} (dueño=${owner})`)
    }
  }
  if (!cross) console.log("  OK: todos los shots están bajo el business_id de su sucursal")
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1) })

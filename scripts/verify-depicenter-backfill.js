/**
 * Verifica el estado de Depicenter después del backfill aplicado por el
 * usuario, y verifica que Cibao siga intacto.
 *
 * Solo lee, no modifica.
 */
const fs = require("fs"), path = require("path")
const env = path.join(__dirname, "../.env.local")
if (fs.existsSync(env)) for (const ln of fs.readFileSync(env, "utf8").split(/\r?\n/)) {
  const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

async function get(pathname) {
  const r = await fetch(URL + pathname, { headers: H })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  return r.json()
}

function ok(label, cond, detail = "") {
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? "  — " + detail : ""}`)
  return cond
}

;(async () => {
  const businesses = await get("/rest/v1/businesses?select=id,slug,name")
  const depi = businesses.find(b => b.slug === "depicenter")
  const cibao = businesses.find(b => b.slug === "csl")
  console.log(`\nDepicenter business_id: ${depi.id}`)
  console.log(`Cibao business_id:      ${cibao.id}\n`)

  // ── 1. csl_equipos Depicenter ──────────────────────────────────────────
  console.log("[1] csl_equipos Depicenter")
  const equiposD = await get(`/rest/v1/csl_equipos?select=equipo_id,sucursal,cabina,operadora,p_cabeza&business_id=eq.${depi.id}&order=equipo_id`)
  for (const e of equiposD) {
    console.log(`    eq=${e.equipo_id}  sucursal="${e.sucursal}"  cabina="${e.cabina || ""}"  operadora="${e.operadora || ""}"  p_cabeza=${e.p_cabeza}`)
  }
  ok(`    Ningún equipo con sucursal "La Vega"`,
    !equiposD.some(e => /la\s*vega/i.test(e.sucursal || "")))
  ok(`    Ningún equipo con operadora "Pendiente"`,
    !equiposD.some(e => /pendiente/i.test(e.operadora || "")))
  ok(`    Todos los equipos con sucursal "Depicenter"`,
    equiposD.every(e => /depicenter/i.test(e.sucursal || "")))

  // ── 2. csl_operator_shots Depicenter ──────────────────────────────────
  console.log("\n[2] csl_operator_shots Depicenter")
  const shotsD = await get(`/rest/v1/csl_operator_shots?select=period_start,period_end,sucursal_normalizada,operadora_normalizada,sesiones,disparos&business_id=eq.${depi.id}&order=period_start.desc`)
  console.log(`    Total: ${shotsD.length} shots`)
  for (const s of shotsD.slice(0, 6)) {
    console.log(`    ${s.period_start} a ${s.period_end} | ${s.sucursal_normalizada.padEnd(15)} ${s.operadora_normalizada.padEnd(12)} ${String(s.sesiones).padStart(4)} ses ${String(s.disparos).padStart(8)} disp`)
  }
  ok(`    Ningún shot con sucursal "SKIN LASER"`,
    !shotsD.some(s => /skin\s*laser/i.test(s.sucursal_normalizada || "")))
  ok(`    Todos los shots con sucursal "DEPICENTER"`,
    shotsD.every(s => /depicenter/i.test(s.sucursal_normalizada || "")))

  // ── 3. csl_pulse_readings Depicenter ──────────────────────────────────
  console.log("\n[3] csl_pulse_readings Depicenter")
  const readingsD = await get(`/rest/v1/csl_pulse_readings?select=equipo_id,sucursal,operadora,period_start,period_end,lectura_inicial,lectura_final,disp_laser,disp_operador,diferencia_pct&business_id=eq.${depi.id}&order=period_start.desc,equipo_id`)
  console.log(`    Total: ${readingsD.length} readings`)
  for (const r of readingsD) {
    console.log(`    eq=${r.equipo_id}  ${r.period_start} a ${r.period_end}  suc="${r.sucursal}"  op="${r.operadora}"  ini=${r.lectura_inicial}  fin=${r.lectura_final}  laser=${r.disp_laser}  op=${r.disp_operador || "null"}`)
  }
  ok(`    Ningún reading con operadora "Pendiente"`,
    !readingsD.some(r => /pendiente/i.test(r.operadora || "")))
  ok(`    Hay readings con SELENIA / CLARIBEL / NOELIA`,
    readingsD.some(r => /selenia|claribel|noelia/i.test(r.operadora || "")))

  // ── 4. Auditoría: match readings ↔ shots por (period+sucursal_norm+op_norm)
  console.log("\n[4] Match readings ↔ shots para Auditoría/IA")
  const HEADER_SKIP = new Set(["SUCURSAL","OPERADORA","OPERADOR","EQUIPO","EQUIPOID","CABINA","PULSOS","ESTADO","FALLAS","SERIAL","SEMANA","FECHA","CLIENTE","TRATAMIENTO","POTENCIA","SPOT","DISPAROS","SECUENCIAL","CONTACTO","TOTAL","TOTALES"])
  const OP_ALIAS = { KATHERINE: "KATHERIN", EMELY: "EMELI", RIQUELMI: "ROQUELMI", YESICA: "YESSICA", SAOMY: "SAHOMY" }
  const OP_SKIP = new Set(["SISTEMA","SYSTEM","ADMIN","OPERADORA","OPERADOR","EQUIPO","EQUIPOID","SUCURSAL"])
  const BRAND = /^(?:cibao\s+spa\s+l[aá]ser|cibao\s+spa\s+laser|depicenter|csl)\s*[-–—]?\s*/i
  function clu(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim()
  }
  function ns(v) {
    const s = String(v || "").trim()
    if (!s) return ""
    const upR = clu(s)
    if (!upR || HEADER_SKIP.has(upR)) return ""
    if (upR.includes("DEPICENTER")) return "DEPICENTER"
    if (upR.includes("SKIN") && upR.includes("LASER")) return "DEPICENTER"
    const st = s.replace(BRAND, "").trim() || s
    const up = clu(st)
    if (!up || HEADER_SKIP.has(up)) return ""
    if (up.includes("JARDINES")) return "LOS JARDINES"
    if (up === "R VIDAL" || ["RAFAEL","VIDAL","PLAZA","MEDITERR"].some(t => up.includes(t))) return "RAFAEL VIDAL"
    if ((up.includes("VILLA") && up.includes("OLGA")) || up === "V OLGA") return "VILLA OLGA"
    if (up.includes("LA VEGA")) return "LA VEGA"
    return up
  }
  function no(v) {
    const up = clu(v); if (!up || OP_SKIP.has(up)) return ""
    return OP_ALIAS[up] || up
  }
  function key(suc, op) { const s = ns(suc), o = no(op); return s && o ? `${s}|${o}` : "" }

  // Index shots
  const shotIndex = new Map()
  for (const s of shotsD) {
    const k = `${s.period_start}|${s.period_end}|${(s.sucursal_normalizada||"").toUpperCase()}|${(s.operadora_normalizada||"").toUpperCase()}`
    shotIndex.set(k, s)
  }
  let matched = 0, unmatched = 0
  for (const r of readingsD) {
    const matchKey = key(r.sucursal, r.operadora)
    if (!matchKey) { console.log(`    eq=${r.equipo_id} matchKey VACÍO`); unmatched++; continue }
    const [sn, on] = matchKey.split("|")
    const lookupKey = `${r.period_start}|${r.period_end}|${sn}|${on}`
    const shot = shotIndex.get(lookupKey)
    if (shot) {
      console.log(`    ✓ eq=${r.equipo_id}  ${r.period_start}  ${sn}|${on}  disp_operador=${shot.disparos} (reading.disp_operador=${r.disp_operador})`)
      matched++
    } else {
      console.log(`    ✗ eq=${r.equipo_id}  ${r.period_start}  ${sn}|${on}  → SIN MATCH en shots`)
      unmatched++
    }
  }
  ok(`    Match rate: ${matched}/${matched + unmatched}`, matched > 0 && unmatched === 0)
  ok(`    reading.disp_operador poblado para todos los matches`,
    readingsD.every(r => r.disp_operador != null && r.disp_operador > 0))

  // ── 5. Cibao no se rompió ─────────────────────────────────────────────
  console.log("\n[5] Cibao intacto")
  const equiposC = await get(`/rest/v1/csl_equipos?select=equipo_id,sucursal&business_id=eq.${cibao.id}`)
  const readingsCcount = (await get(`/rest/v1/csl_pulse_readings?select=id&business_id=eq.${cibao.id}`)).length
  const shotsCcount = (await get(`/rest/v1/csl_operator_shots?select=id&business_id=eq.${cibao.id}`)).length
  console.log(`    csl: ${equiposC.length} equipos · ${readingsCcount} readings · ${shotsCcount} shots`)
  ok(`    Cibao tiene sucursales LOS JARDINES / RAFAEL VIDAL / VILLA OLGA / LA VEGA`,
    equiposC.some(e => /jardines|rafael|villa|la vega/i.test(e.sucursal || "")))
})().catch(e => { console.error("ERROR:", e.message); process.exit(1) })

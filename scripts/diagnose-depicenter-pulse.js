/**
 * Diagnóstico end-to-end del flujo PulseControl en Depicenter.
 *
 * Verifica:
 *   1. business_id de Depicenter y Cibao
 *   2. Equipos en csl_equipos por tenant
 *   3. Lecturas en csl_pulse_readings por tenant
 *   4. Shots en csl_operator_shots por tenant
 *   5. Sesiones en csl_sesiones_cliente por tenant
 *   6. user_profiles asociados a cada business
 *
 * No modifica nada — solo lee.
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

async function api(pathname, opts = {}) {
  const r = await fetch(SUPABASE_URL + pathname, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...opts.headers },
    ...opts,
  })
  if (!r.ok) {
    const t = await r.text()
    throw new Error(`HTTP ${r.status} ${pathname}: ${t.slice(0, 300)}`)
  }
  return r.json()
}

function fmt(arr, n = 5) {
  if (!arr || !arr.length) return "  (vacío)"
  return arr.slice(0, n).map(r => "  " + JSON.stringify(r).slice(0, 200)).join("\n") +
    (arr.length > n ? `\n  ... (${arr.length - n} más)` : "")
}

async function main() {
  console.log("=".repeat(80))
  console.log("DIAGNÓSTICO DEPICENTER PULSECONTROL")
  console.log("=".repeat(80))

  // ── 1. Businesses
  console.log("\n[1] businesses")
  const businesses = await api("/rest/v1/businesses?select=*")
  console.log("  columnas:", Object.keys(businesses[0] || {}).join(", "))
  for (const b of businesses) {
    console.log(`  ${(b.slug || "?").padEnd(20)} id=${b.id}  name="${b.name}"`)
  }
  const cibao = businesses.find(b => b.slug === "csl" || b.slug === "cibao-spa-laser" || /cibao/i.test(b.name || ""))
  const depi = businesses.find(b => b.slug === "depicenter" || /depicenter/i.test(b.name || ""))
  if (!depi) { console.log("\n⚠ Depicenter NO existe en businesses"); return }
  console.log(`\nCibao business_id: ${cibao?.id}`)
  console.log(`Depicenter business_id: ${depi.id}`)

  // ── 2. user_profiles por tenant
  console.log("\n[2] csl_user_profiles por tenant")
  const profiles = await api(`/rest/v1/csl_user_profiles?select=user_id,business_id,activo&order=business_id`)
  const byBiz = {}
  for (const p of profiles) {
    const k = p.business_id || "null"
    byBiz[k] = (byBiz[k] || 0) + 1
  }
  for (const [bid, count] of Object.entries(byBiz)) {
    const b = businesses.find(x => x.id === bid)
    console.log(`  ${(b?.slug || bid).padEnd(20)} ${count} perfiles`)
  }

  // ── 3. Equipos en csl_equipos por tenant
  console.log("\n[3] csl_equipos por tenant")
  for (const tenant of [cibao, depi].filter(Boolean)) {
    const rows = await api(`/rest/v1/csl_equipos?select=equipo_id,sucursal,cabina,operadora,p_cabeza,ultima_semana_pulsos&business_id=eq.${tenant.id}&order=equipo_id`)
    console.log(`\n  ${tenant.slug} (${tenant.id}): ${rows.length} equipos`)
    console.log(fmt(rows, 15))
  }

  // ── 4. csl_pulse_readings por tenant
  console.log("\n[4] csl_pulse_readings por tenant")
  for (const tenant of [cibao, depi].filter(Boolean)) {
    const rows = await api(`/rest/v1/csl_pulse_readings?select=equipo_id,sucursal,operadora,period_start,period_end,lectura_inicial,lectura_final,disp_laser,disp_operador&business_id=eq.${tenant.id}&order=period_start.desc,equipo_id`)
    console.log(`\n  ${tenant.slug}: ${rows.length} lecturas`)
    console.log(fmt(rows, 10))
  }

  // ── 5. csl_operator_shots por tenant
  console.log("\n[5] csl_operator_shots por tenant")
  for (const tenant of [cibao, depi].filter(Boolean)) {
    const rows = await api(`/rest/v1/csl_operator_shots?select=period_start,period_end,sucursal_normalizada,operadora_normalizada,sesiones,disparos&business_id=eq.${tenant.id}&order=period_start.desc`)
    console.log(`\n  ${tenant.slug}: ${rows.length} shots`)
    console.log(fmt(rows, 10))
  }

  // ── 6. csl_sesiones_cliente por tenant (últimas)
  console.log("\n[6] csl_sesiones_cliente por tenant")
  for (const tenant of [cibao, depi].filter(Boolean)) {
    const rows = await api(`/rest/v1/csl_sesiones_cliente?select=fecha,sucursal,operadora_id,disparos_reportados&business_id=eq.${tenant.id}&order=fecha.desc&limit=10`)
    const countR = await api(`/rest/v1/csl_sesiones_cliente?select=fecha&business_id=eq.${tenant.id}`, {
      headers: { Prefer: "count=exact" }
    })
    console.log(`\n  ${tenant.slug}: ${countR.length} sesiones total (mostrando 10 más recientes)`)
    console.log(fmt(rows, 10))
  }
}

main().catch(e => { console.error(e); process.exit(1) })

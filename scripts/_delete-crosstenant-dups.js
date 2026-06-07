// Borra los 8 duplicados huerfanos de csl_pulse_readings (business_id Cibao +
// sucursal DEPICENTER). Verifica que Depicenter conserva sus originales y que
// su conteo NO cambia. DELETE acotado por business_id=Cibao (nunca toca Depi).
const fs = require("fs")
for (const ln of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "") }
const U = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim(), K = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
const H = { apikey: K, Authorization: "Bearer " + K, "Content-Type": "application/json" }
const get = async p => (await fetch(U + p, { headers: H })).json()
const isDepiSuc = s => { const u = String(s || "").toUpperCase(); return u.includes("DEPICENTER") || u.includes("VEGA") || u.includes("SKIN") }
;(async () => {
  const biz = await get("/rest/v1/businesses?select=id,slug"); const C = biz.find(b => b.slug === "csl").id, D = biz.find(b => b.slug === "depicenter").id

  // Conteo Depicenter ANTES (para probar que no se toca)
  const depiBeforeRaw = await fetch(U + "/rest/v1/csl_pulse_readings?select=id&business_id=eq." + D, { method: "HEAD", headers: { ...H, Prefer: "count=exact" } })
  const depiBefore = depiBeforeRaw.headers.get("content-range")

  // Las 8 filas a borrar (Cibao + sucursal Depicenter)
  const polluted = (await get("/rest/v1/csl_pulse_readings?select=id,equipo_id,sucursal,period_start,period_end,operadora&business_id=eq." + C)).filter(r => isDepiSuc(r.sucursal))
  console.log("A borrar: " + polluted.length + " filas")

  // Verificar que Depicenter tiene la original de cada (equipo,periodo)
  const depi = await get("/rest/v1/csl_pulse_readings?select=equipo_id,period_start,period_end&business_id=eq." + D)
  const dk = new Set(depi.map(r => r.equipo_id + "|" + String(r.period_start).slice(0, 10) + "|" + String(r.period_end).slice(0, 10)))
  let conOriginal = 0
  for (const r of polluted) { if (dk.has(r.equipo_id + "|" + String(r.period_start).slice(0, 10) + "|" + String(r.period_end).slice(0, 10))) conOriginal++ }
  console.log("Con original en Depicenter: " + conOriginal + "/" + polluted.length)
  if (conOriginal !== polluted.length) { console.log("ABORTO: no todas tienen original en Depicenter. Revisar manualmente."); return }

  // Borrar por id, acotado a business_id=Cibao (doble seguridad)
  let del = 0
  for (const r of polluted) {
    const res = await fetch(U + "/rest/v1/csl_pulse_readings?id=eq." + r.id + "&business_id=eq." + C, { method: "DELETE", headers: H })
    if (res.ok) { del++; console.log("  borrada eq" + r.equipo_id + "/" + r.operadora + " " + String(r.period_start).slice(0, 10)) }
    else console.log("  fallo " + r.id + ": " + res.status + " " + (await res.text()).slice(0, 100))
  }

  // Verificacion final
  const stillC = await get("/rest/v1/csl_pulse_readings?select=id&business_id=eq." + C + "&sucursal=ilike.*DEPICENTER*")
  const depiAfterRaw = await fetch(U + "/rest/v1/csl_pulse_readings?select=id&business_id=eq." + D, { method: "HEAD", headers: { ...H, Prefer: "count=exact" } })
  console.log("\n=== RESULTADO ===")
  console.log("borradas = " + del)
  console.log("Cibao con sucursal DEPICENTER restantes = " + (Array.isArray(stillC) ? stillC.length : "?"))
  console.log("Depicenter total ANTES  = " + depiBefore)
  console.log("Depicenter total DESPUES= " + depiAfterRaw.headers.get("content-range") + "  (debe ser igual)")
})().catch(e => { console.error(e.message); process.exit(1) })

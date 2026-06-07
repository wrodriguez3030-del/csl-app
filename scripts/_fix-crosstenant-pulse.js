// Corrige polucion cross-tenant en PulseControl (no destructivo, sin DELETE):
// 1) Reasigna a Depicenter las 8 lecturas mal etiquetadas como Cibao (sucursal
//    DEPICENTER, equipos 1/2/3). Verifica conflicto unico antes de mover.
// 2) Limpia operadoras de Depicenter (CLARIBEL/NOELIA) en equipos Cibao TALLER.
const fs = require("fs")
for (const ln of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "") }
const U = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim(), K = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
const H = { apikey: K, Authorization: "Bearer " + K, "Content-Type": "application/json" }
const get = async p => (await fetch(U + p, { headers: H })).json()
const patch = async (p, b) => { const r = await fetch(U + p, { method: "PATCH", headers: H, body: JSON.stringify(b) }); return { ok: r.ok, status: r.status, txt: r.ok ? "" : (await r.text()).slice(0, 120) } }
const isDepiSuc = s => { const u = String(s || "").toUpperCase(); return u.includes("DEPICENTER") || u.includes("VEGA") || u.includes("SKIN") }
;(async () => {
  const biz = await get("/rest/v1/businesses?select=id,slug"); const C = biz.find(b => b.slug === "csl").id, D = biz.find(b => b.slug === "depicenter").id

  // 1) Lecturas Cibao con sucursal Depicenter
  const polluted = (await get("/rest/v1/csl_pulse_readings?select=id,equipo_id,sucursal,period_start,period_end,operadora&business_id=eq." + C)).filter(r => isDepiSuc(r.sucursal))
  // Lecturas existentes de Depicenter para detectar conflicto (equipo_id,period)
  const depiExisting = await get("/rest/v1/csl_pulse_readings?select=equipo_id,period_start,period_end&business_id=eq." + D)
  const depiKeys = new Set(depiExisting.map(r => r.equipo_id + "|" + String(r.period_start).slice(0, 10) + "|" + String(r.period_end).slice(0, 10)))
  console.log("== Reasignar lecturas Cibao->Depicenter (" + polluted.length + ") ==")
  let moved = 0, conflicts = 0
  for (const r of polluted) {
    const k = r.equipo_id + "|" + String(r.period_start).slice(0, 10) + "|" + String(r.period_end).slice(0, 10)
    if (depiKeys.has(k)) { console.log("  CONFLICTO (ya existe en Depi) eq" + r.equipo_id + " " + r.period_start + " -> NO movida"); conflicts++; continue }
    const res = await patch("/rest/v1/csl_pulse_readings?id=eq." + r.id, { business_id: D, updated_at: new Date().toISOString() })
    if (res.ok) { console.log("  movida eq" + r.equipo_id + "/" + r.operadora + " " + r.period_start); moved++; depiKeys.add(k) }
    else console.log("  fallo eq" + r.equipo_id + ": " + res.status + " " + res.txt)
  }
  console.log("  movidas=" + moved + " conflictos=" + conflicts)

  // 2) Limpiar operadoras de Depicenter en equipos Cibao
  const depiOps = new Set(["CLARIBEL", "NOELIA", "SELENIA", "EVELINA"])
  const cEq = (await get("/rest/v1/csl_equipos?select=equipo_id,sucursal,operadora&business_id=eq." + C)).filter(e => e.operadora && depiOps.has(String(e.operadora).toUpperCase()))
  console.log("\n== Limpiar operadoras Depicenter en equipos Cibao (" + cEq.length + ") ==")
  for (const e of cEq) {
    const res = await patch("/rest/v1/csl_equipos?business_id=eq." + C + "&equipo_id=eq." + encodeURIComponent(e.equipo_id), { operadora: null, operadora_id: null, updated_at: new Date().toISOString() })
    console.log("  eq" + e.equipo_id + " (" + e.sucursal + ") " + e.operadora + " -> null: " + (res.ok ? "ok" : res.status + " " + res.txt))
  }

  // 3) Verificacion final
  const stillC = (await get("/rest/v1/csl_pulse_readings?select=id&business_id=eq." + C + "&sucursal=ilike.*DEPICENTER*"))
  console.log("\nVERIFICACION: lecturas Cibao con sucursal DEPICENTER restantes = " + (Array.isArray(stillC) ? stillC.length : "?"))
})().catch(e => { console.error(e.message); process.exit(1) })

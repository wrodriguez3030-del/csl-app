// Migra csl_operator_shots de alias viejo -> nombre OFICIAL (no destructivo).
// KATHERIN->KATHERINE, EMELI->EMELY, ROQUELMI->RIQUELMI, YESICA->YESSICA, SAOMY->SAHOMY.
// Salta filas cuyo destino ya existe (mismo business+period+sucursal+operadora oficial)
// para no chocar con el unique (p.ej. la semana actual ya corregida).
const fs = require("fs")
for (const ln of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "") }
const U = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim(), K = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
const H = { apikey: K, Authorization: "Bearer " + K, "Content-Type": "application/json" }
const ALIAS = { KATHERIN: "KATHERINE", EMELI: "EMELY", ROQUELMI: "RIQUELMI", YESICA: "YESSICA", SAOMY: "SAHOMY" }
const get = async p => (await fetch(U + p, { headers: H })).json()
;(async () => {
  const all = await get("/rest/v1/csl_operator_shots?select=id,business_id,period_start,period_end,sucursal_normalizada,operadora_normalizada,disparos")
  const keyOf = r => [r.business_id, r.period_start, r.period_end, r.sucursal_normalizada, r.operadora_normalizada].join("|")
  const existing = new Set(all.map(keyOf))
  let migrated = 0, skipped = 0
  for (const r of all) {
    const off = ALIAS[r.operadora_normalizada]
    if (!off) continue
    const targetKey = [r.business_id, r.period_start, r.period_end, r.sucursal_normalizada, off].join("|")
    if (existing.has(targetKey)) { skipped++; continue } // ya existe oficial -> no chocar
    const res = await fetch(U + "/rest/v1/csl_operator_shots?id=eq." + r.id, { method: "PATCH", headers: H, body: JSON.stringify({ operadora_normalizada: off, updated_at: new Date().toISOString() }) })
    if (res.ok) { migrated++; existing.add(targetKey) } else { console.log("  fallo " + r.id + ": " + res.status + " " + (await res.text()).slice(0, 100)) }
  }
  console.log("Migradas alias->oficial: " + migrated + " | saltadas (ya existia oficial): " + skipped)
})().catch(e => { console.error(e.message); process.exit(1) })

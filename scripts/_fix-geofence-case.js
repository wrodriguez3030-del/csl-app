// NO destructivo: renombra geocercas cuyo sucursal coincide (case-insensitive)
// con una sucursal real de csl_sucursales del MISMO business, al case exacto.
// Preserva coordenadas/config. No borra nada.
const fs = require("fs")
for (const ln of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "") }
const U = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim(), K = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
const H = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" }
const get = async p => { const r = await fetch(U + p, { headers: H }); if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`); return r.json() }
const patch = async (p, b) => { const r = await fetch(U + p, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(b) }); if (!r.ok) throw new Error(`PATCH ${p}: ${r.status} ${await r.text()}`) }
;(async () => {
  const biz = await get("/rest/v1/businesses?select=id,slug")
  let fixed = 0
  for (const x of biz) {
    const reals = (await get(`/rest/v1/csl_sucursales?select=nombre&business_id=eq.${x.id}`)).map(s => (s.nombre || "").trim()).filter(Boolean)
    const realByUpper = new Map(reals.map(n => [n.toUpperCase(), n]))
    const geos = await get(`/rest/v1/hr_branch_geofences?select=id,sucursal&business_id=eq.${x.id}`)
    for (const g of geos) {
      const cur = (g.sucursal || "").trim()
      const real = realByUpper.get(cur.toUpperCase())
      if (real && real !== cur) {
        await patch(`/rest/v1/hr_branch_geofences?id=eq.${g.id}`, { sucursal: real, updated_at: new Date().toISOString() })
        console.log(`  ✓ ${x.slug}: "${cur}" → "${real}"`)
        fixed++
      }
    }
  }
  console.log(`\nGeocercas renombradas (case real): ${fixed}`)
})().catch(e => { console.error("ERROR:", e.message); process.exit(1) })

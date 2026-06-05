const fs = require("fs"), path = require("path")
const env = path.join(__dirname, "../.env.local")
if (fs.existsSync(env)) for (const ln of fs.readFileSync(env, "utf8").split(/\r?\n/)) {
  const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
}
const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }
const get = async (p) => { const r = await fetch(URL + p, { headers: H }); if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`); return r.json() }
;(async () => {
  const b = await get("/rest/v1/businesses?select=id,slug,name")
  console.log("BUSINESSES:", JSON.stringify(b))
  const c = await get("/rest/v1/hr_payroll_config?select=*")
  console.log("CONFIG_COUNT:", Array.isArray(c) ? c.length : c)
  if (Array.isArray(c) && c[0]) console.log("CONFIG_COLUMNS:", Object.keys(c[0]).join(","))
  if (Array.isArray(c)) for (const r of c) console.log("ROW:", JSON.stringify(r))
})().catch(e => { console.error("ERR", e.message); process.exit(1) })

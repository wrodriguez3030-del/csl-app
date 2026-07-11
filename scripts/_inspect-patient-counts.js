/** Inspección de sales_commission_patient_counts en db-cls (solo lectura). */
const fs = require("fs"), path = require("path")
const env = path.join(__dirname, "../.env.local")
if (fs.existsSync(env)) for (const ln of fs.readFileSync(env, "utf8").split(/\r?\n/)) {
  const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
}
const { createClient } = require("@supabase/supabase-js")
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
;(async () => {
  const { data, error } = await sb.from("sales_commission_patient_counts").select("*").limit(2)
  if (error) { console.log("err", error.message); process.exit(1) }
  console.log("columnas:", data.length ? Object.keys(data[0]).join(", ") : "(vacía)")
  if (data.length) console.log("ejemplo:", JSON.stringify(data[0]))
  const { data: src } = await sb.from("sales_commission_patient_counts").select("source,period_month,period_year,branch")
  const by = {}, periods = new Set()
  for (const r of src || []) { by[r.source || "(null)"] = (by[r.source || "(null)"] || 0) + 1; periods.add(`${r.period_year}-${r.period_month}`) }
  console.log("filas por source:", JSON.stringify(by))
  console.log("períodos:", [...periods].sort().join(", "))
})()

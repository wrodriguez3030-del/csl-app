/** Verifica si la migración 202607110002 (módulo incentivos) está aplicada en db-cls. Solo lectura. */
const fs = require("fs"), path = require("path")
const env = path.join(__dirname, "../.env.local")
if (fs.existsSync(env)) for (const ln of fs.readFileSync(env, "utf8").split(/\r?\n/)) {
  const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
}
const { createClient } = require("@supabase/supabase-js")
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
;(async () => {
  const tables = ["sales_commission_collaborators", "sales_commission_runs", "sales_commission_run_items"]
  for (const t of tables) {
    const { error, count } = await sb.from(t).select("*", { count: "exact", head: true })
    console.log(`${t}: ${error ? "❌ NO EXISTE (" + error.message + ")" : "✅ existe, filas=" + count}`)
  }
  // patient_counts nuevas columnas
  const { data: pc, error: pcErr } = await sb.from("sales_commission_patient_counts").select("service,observation").limit(1)
  console.log(`patient_counts.service/observation: ${pcErr ? "❌ " + pcErr.message : "✅ columnas presentes"}`)
  // regla laser_split
  const { data: rules, error: rErr } = await sb.from("sales_commission_rules").select("rule_type,name").eq("rule_type", "laser_split")
  console.log(`regla laser_split: ${rErr ? "❌ " + rErr.message : (rules && rules.length ? "✅ sembrada (" + rules.length + ")" : "❌ no sembrada")}`)
  // canonización de sucursales
  const { data: branches } = await sb.from("sales_commission_sales").select("branch").limit(5000)
  const uniq = [...new Set((branches || []).map((b) => b.branch))]
  console.log("sucursales distintas en ventas:", JSON.stringify(uniq))
})()

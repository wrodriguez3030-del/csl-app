/** Muestra la escala láser y reglas de reparto vigentes en db-cls (solo lectura). */
const fs = require("fs"), path = require("path")
const env = path.join(__dirname, "../.env.local")
if (fs.existsSync(env)) for (const ln of fs.readFileSync(env, "utf8").split(/\r?\n/)) {
  const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
}
const { createClient } = require("@supabase/supabase-js")
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
;(async () => {
  const { data } = await sb.from("sales_commission_rules")
    .select("name,rule_type,min_amount,percentage,fixed_amount,active")
    .in("rule_type", ["laser_scale", "laser_split_mode", "laser_zero_patients_fixed", "card_percentage"])
    .order("rule_type").order("min_amount")
  for (const r of data || []) {
    const val = r.rule_type === "laser_scale"
      ? `umbral RD$${Number(r.min_amount).toLocaleString()} → ${(Number(r.percentage) * 100).toFixed(0)}%`
      : r.percentage != null ? `${(Number(r.percentage) * 100).toFixed(0)}%` : `flag=${r.fixed_amount}`
    console.log(`${r.active ? "✅ ACTIVA " : "⛔ inactiva"} · ${r.rule_type} · ${val} · "${r.name}"`)
  }
})()

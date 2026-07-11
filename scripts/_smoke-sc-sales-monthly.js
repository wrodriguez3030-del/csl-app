/** Smoke-test de la función sc_sales_monthly contra db-cls (solo lectura). */
const fs = require("fs"), path = require("path")
const env = path.join(__dirname, "../.env.local")
if (fs.existsSync(env)) for (const ln of fs.readFileSync(env, "utf8").split(/\r?\n/)) {
  const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
}
const { createClient } = require("@supabase/supabase-js")
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
;(async () => {
  const { data: biz, error: bizErr } = await sb.from("businesses").select("id,slug")
  if (bizErr) { console.log("businesses error:", bizErr.message); process.exit(1) }
  console.log("negocios:", (biz || []).map((b) => b.slug).join(", "))
  for (const b of biz || []) {
    const { data, error } = await sb.rpc("sc_sales_monthly", { p_business: b.id, p_from: "2026-01-01", p_to_ex: "2026-08-01" })
    if (error) { console.log(b.slug, "RPC error:", error.message); process.exit(1) }
    const byMonth = {}
    for (const r of data) byMonth[`${r.y}-${String(r.m).padStart(2, "0")}`] = Math.round(((byMonth[`${r.y}-${String(r.m).padStart(2, "0")}`] || 0) + Number(r.gross)) * 100) / 100
    console.log(b.slug, "→ grupos:", data.length, "meses:", JSON.stringify(byMonth))
  }
})()

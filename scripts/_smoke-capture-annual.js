/** Smoke de la vista ANUAL de pacientes (replica el merge del server, solo lectura). */
const fs = require("fs"), path = require("path")
const env = path.join(__dirname, "../.env.local")
if (fs.existsSync(env)) for (const ln of fs.readFileSync(env, "utf8").split(/\r?\n/)) {
  const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
}
const { createClient } = require("@supabase/supabase-js")
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
;(async () => {
  const { data: biz } = await sb.from("businesses").select("id").eq("slug", "csl").single()
  const { data } = await sb.from("sales_commission_patient_counts")
    .select("provider_name,branch,patient_count,source,period_month")
    .eq("business_id", biz.id).eq("period_year", 2026)
  const perMonth = new Map()
  for (const r of data || []) {
    const k = `${r.provider_name}|${r.branch}|${r.period_month}`
    const e = perMonth.get(k) || { manual: null, reservas: null }
    if (r.source === "manual") e.manual = Number(r.patient_count) || 0
    else e.reservas = Number(r.patient_count) || 0
    perMonth.set(k, e)
  }
  const sum = new Map()
  for (const [k, e] of perMonth) {
    const [name, b] = k.split("|")
    const eff = e.manual != null ? e.manual : (e.reservas || 0)
    sum.set(`${name}|${b}`, (sum.get(`${name}|${b}`) || 0) + eff)
  }
  const rows = [...sum.entries()].sort((a, b) => b[1] - a[1])
  const total = rows.reduce((s, [, v]) => s + v, 0)
  console.log(`Anual 2026 (todas las sucursales): ${rows.length} colaboradores, total ${total} pacientes`)
  rows.slice(0, 6).forEach(([k, v]) => console.log(`  ${k.replace("|", " · ")}: ${v}`))
  const ok = total > 0 && rows.length > 5
  console.log(ok ? "\n✓ la vista anual TIENE datos (el filtro Todos ya no queda en cero)" : "\n✗ sin datos")
  process.exit(ok ? 0 : 1)
})()

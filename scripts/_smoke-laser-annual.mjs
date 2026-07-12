/** Smoke del resumen ANUAL láser (replica getCommissionLaserAnnual, solo lectura). */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createClient } from "@supabase/supabase-js"
import { netAmount } from "../lib/commission/run-engine.ts"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const env = path.join(__dirname, "../.env.local")
if (fs.existsSync(env)) for (const ln of fs.readFileSync(env, "utf8").split(/\r?\n/)) {
  const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const round2 = (n) => Math.round(n * 100) / 100
let pass = 0, fail = 0
const t = (n, c, x = "") => { (c ? pass++ : fail++); console.log(`  ${c ? "✓" : "✗"} ${n}${x ? " " + x : ""}`) }

const YEAR = 2026
const BRANCHES = ["RAFAEL VIDAL", "LOS JARDINES", "VILLA OLGA"]
;(async () => {
  const { data: biz } = await sb.from("businesses").select("id").eq("slug", "csl").single()
  const { data: ruleRows } = await sb.from("sales_commission_rules")
    .select("rule_type,min_amount,percentage").eq("business_id", biz.id).eq("active", true)
  const cardPct = Number(ruleRows.find((r) => r.rule_type === "card_percentage")?.percentage ?? 0.27)
  const scale = ruleRows.filter((r) => r.rule_type === "laser_scale")
    .map((r) => ({ threshold: Number(r.min_amount), percentage: Number(r.percentage) })).sort((a, b) => a.threshold - b.threshold)

  const rows = []
  for (let off = 0; ; off += 1000) {
    const { data } = await sb.from("sales_commission_sales")
      .select("branch,payment_method,gross_amount,sale_date")
      .eq("business_id", biz.id).eq("category", "DEPILACION_LASER")
      .gte("sale_date", `${YEAR}-01-01`).lt("sale_date", `${YEAR + 1}-01-01`)
      .order("id", { ascending: true }).range(off, off + 999)
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  console.log(`ventas láser ${YEAR}: ${rows.length} filas`)
  const base = new Map()
  for (const r of rows) {
    const m = Number(String(r.sale_date || "").slice(5, 7))
    const k = `${r.branch}|${m}`
    base.set(k, round2((base.get(k) || 0) + netAmount(Number(r.gross_amount) || 0, String(r.payment_method || "OTROS"), cardPct)))
  }
  const tramoOf = (v) => scale.filter((s) => v >= s.threshold).sort((a, b) => b.threshold - a.threshold)[0] || null
  let fundYear = 0
  for (let m = 1; m <= 12; m++) {
    const line = BRANCHES.map((b) => {
      const v = base.get(`${b}|${m}`) || 0
      const tr = tramoOf(v)
      const f = tr ? round2(v * tr.percentage) : 0
      fundYear = round2(fundYear + f)
      return `${b.split(" ")[0]} ${f.toFixed(2)}`
    }).join(" · ")
    if (BRANCHES.some((b) => (base.get(`${b}|${m}`) || 0) > 0)) console.log(`  ${String(m).padStart(2, "0")}/${YEAR}: ${line}`)
  }
  console.log(`FONDO TOTAL ${YEAR}: ${fundYear.toFixed(2)}`)
  // Junio debe coincidir con el smoke mensual (21,347.24 / 9,219.52 / 6,982.00)
  const junRV = round2((base.get(`RAFAEL VIDAL|6`) || 0) * (tramoOf(base.get(`RAFAEL VIDAL|6`) || 0)?.percentage || 0))
  t("Junio RV = 21,347.24 (consistente con el mensual)", junRV === 21347.24, `(${junRV})`)
  t("hay fondo en varios meses", [...base.keys()].map((k) => k.split("|")[1]).filter((v, i, a) => a.indexOf(v) === i).length >= 4)
  t("fondo anual > 0", fundYear > 0)
  console.log(`\n${pass} pasaron · ${fail} fallaron`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })

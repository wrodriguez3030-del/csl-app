/**
 * Smoke del CÁLCULO MENSUAL DE INCENTIVOS contra db-cls (solo lectura).
 * Replica la lógica de commission.ts (readRunSales/readRoster/readRunRules/
 * readPatientsForRun) y corre el motor puro computeRun sobre datos reales.
 * Ejecutar: npx tsx scripts/_smoke-calculo-mensual.mjs
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createClient } from "@supabase/supabase-js"
import { computeRun } from "../lib/commission/run-engine.ts"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const env = path.join(__dirname, "../.env.local")
if (fs.existsSync(env)) for (const ln of fs.readFileSync(env, "utf8").split(/\r?\n/)) {
  const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

let pass = 0, fail = 0
const t = (name, cond, extra = "") => { (cond ? pass++ : fail++); console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? " " + extra : ""}`) }

async function readRunRules(business_id) {
  const { data } = await sb.from("sales_commission_rules")
    .select("rule_type,category,percentage,fixed_amount,min_amount,effective_from").eq("business_id", business_id).eq("active", true)
  const rows = data || []
  const latest = (type) => rows.filter((r) => r.rule_type === type).sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0]
  const categoryPct = {}
  for (const r of rows.filter((r) => r.rule_type === "category_commission")) if (r.category != null && r.percentage != null) categoryPct[r.category] = Number(r.percentage)
  const laserScale = rows.filter((r) => r.rule_type === "laser_scale" && r.min_amount != null && r.percentage != null)
    .map((r) => ({ threshold: Number(r.min_amount), percentage: Number(r.percentage) })).sort((a, b) => a.threshold - b.threshold)
  const card = latest("card_percentage"), prod = latest("product_unit_incentive")
  const wPer = latest("laser_weight_personas")?.percentage, wPac = latest("laser_weight_pacientes")?.percentage
  let frac
  if (wPer != null || wPac != null) { const p = Number(wPer ?? 0), q = Number(wPac ?? 0); frac = p + q > 0 ? q / (p + q) : 0.5 }
  else { const s = latest("laser_split")?.percentage; frac = s != null ? Number(s) : 0.5 }
  const zero = latest("laser_zero_patients_fixed")?.fixed_amount
  const modeFlag = latest("laser_split_mode")?.fixed_amount
  return {
    cardPct: card?.percentage != null ? Number(card.percentage) : 0.27,
    productUnitAmount: prod?.fixed_amount != null ? Number(prod.fixed_amount) : 100,
    categoryPct, laserScale, laserSplitPatientsFraction: frac,
    zeroPatientsGetsFixed: zero == null ? true : Number(zero) !== 0,
    laserDistributionMode: modeFlag == null || Number(modeFlag) !== 0 ? "equitativo" : "pesos",
  }
}

async function readRunSales(business_id, branch, month, year) {
  const from = `${year}-${String(month).padStart(2, "0")}-01`
  const toEx = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`
  const out = []
  for (let off = 0; ; off += 1000) {
    const { data } = await sb.from("sales_commission_sales")
      .select("branch,category,gross_amount,payment_method,provider_normalized,provider_original,quantity")
      .eq("business_id", business_id).eq("branch", branch).gte("sale_date", from).lt("sale_date", toEx)
      .order("id", { ascending: true }).range(off, off + 999)
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out.map((r) => ({
    branch: String(r.branch || ""), category: String(r.category || "OTROS"), payment: String(r.payment_method || "OTROS"),
    amount: Number(r.gross_amount) || 0, quantity: Number(r.quantity) || 0,
    providerOriginal: r.provider_original == null ? null : String(r.provider_original),
    provider: r.provider_normalized == null ? null : String(r.provider_normalized),
  }))
}

async function readRoster(business_id, branch) {
  const { data } = await sb.from("sales_commission_collaborators").select("*")
    .eq("business_id", business_id).eq("branch", branch).eq("active", true).is("deleted_at", null)
  return (data || []).map((r) => ({
    id: String(r.id), name: String(r.name || ""), branch: String(r.branch || ""),
    services: Array.isArray(r.services) ? r.services : [],
    linearParticipation: r.linear_participation !== false, patientParticipation: r.patient_participation !== false,
    fixedPercentage: r.fixed_percentage == null ? null : Number(r.fixed_percentage), active: r.active !== false,
    cleaningContribution: r.cleaning_contribution == null ? 400 : Number(r.cleaning_contribution),
    bonusExtra: Number(r.bonus_extra) || 0, evaluationPct: r.evaluation_pct == null ? 100 : Number(r.evaluation_pct),
    productUnitAmount: r.product_unit_amount == null ? null : Number(r.product_unit_amount),
  }))
}

async function readPatients(business_id, branch, month, year) {
  const { data } = await sb.from("sales_commission_patient_counts").select("provider_name,patient_count,source")
    .eq("business_id", business_id).eq("branch", branch).eq("period_month", month).eq("period_year", year)
  const rows = data || []
  const hasManual = rows.some((r) => r.source === "manual")
  const use = hasManual ? rows.filter((r) => r.source === "manual") : rows
  return {
    patients: use.map((r) => ({ collaborator: String(r.provider_name || ""), patients: Number(r.patient_count) || 0 })).filter((p) => p.collaborator),
    source: hasManual ? "manual" : rows.length ? "reservas" : "ninguna",
  }
}

;(async () => {
  const { data: biz } = await sb.from("businesses").select("id,slug").eq("slug", "csl").single()
  if (!biz) { console.log("No se encontró el negocio csl"); process.exit(1) }
  const business_id = biz.id

  // Período con más datos según los tests: Jun 2026.
  const MONTH = 6, YEAR = 2026
  const rules = await readRunRules(business_id)
  console.log(`Reglas: tarjeta ${(rules.cardPct * 100).toFixed(0)}%, producto RD$${rules.productUnitAmount}, split ${rules.laserSplitPatientsFraction}, tramos ${rules.laserScale.length}, categorías ${Object.keys(rules.categoryPct).length}`)
  t("reglas: escala láser cargada", rules.laserScale.length >= 1)
  t("reglas: categorías cargadas", Object.keys(rules.categoryPct).length >= 1)

  for (const branch of ["RAFAEL VIDAL", "LOS JARDINES", "VILLA OLGA"]) {
    const [sales, collaborators, pat] = await Promise.all([
      readRunSales(business_id, branch, MONTH, YEAR),
      readRoster(business_id, branch),
      readPatients(business_id, branch, MONTH, YEAR),
    ])
    const r = computeRun({ branch, sales, collaborators, patients: pat.patients, patientsSource: pat.source, rules })
    console.log(`\n── ${branch} · ${String(MONTH).padStart(2, "0")}/${YEAR}: ${sales.length} ventas, ${collaborators.length} colaboradores, pacientes ${r.laser.patientsTotal} (${pat.source}) · modo ${r.laser.mode} (${r.laser.eligibleCount} elegibles, cuota ${r.laser.perCapita.toFixed(2)})`)
    console.log(`   base láser ${r.laser.base.toFixed(2)} → tramo ${(r.laser.pct * 100).toFixed(0)}% → fondo ${r.laser.fund.toFixed(2)} (pac ${r.laser.fundPatients.toFixed(2)} / lin ${r.laser.fundLinear.toFixed(2)})`)
    console.log(`   fondo personas ${r.laser.fundLinear.toFixed(2)} + pacientes ${r.laser.fundPatients.toFixed(2)} (pesos ${((1 - rules.laserSplitPatientsFraction) * 100).toFixed(0)}/${(rules.laserSplitPatientsFraction * 100).toFixed(0)})`)
    const laserDist = r.items.reduce((s, i) => s + i.laserTotal, 0)
    console.log(`   ítems ${r.items.length} · láser repartido ${laserDist.toFixed(2)} (cuadre vs fondo ${(r.laser.fund - laserDist).toFixed(2)}) · neto total ${r.totals.netTotal.toFixed(2)} · alertas ${r.alerts.length}`)
    if (r.alerts.length) r.alerts.slice(0, 3).forEach((a) => console.log(`     ⚠ ${a}`))
    t(`${branch}: láser repartido = fondo EXACTO (cuadre 0.00)`, Math.abs(r.laser.fund - laserDist) <= 0.01, `(${(r.laser.fund - laserDist).toFixed(2)})`)
    // Invariantes del motor:
    t(`${branch}: fondo ≤ base × 5%`, r.laser.fund <= r.laser.base * 0.05 + 0.01)
    t(`${branch}: fondo pac + lin = fondo (o 0 con alerta)`, Math.abs((r.laser.fundPatients + r.laser.fundLinear) - r.laser.fund) < 0.02 || r.laser.fund === 0 || r.alerts.length > 0)
    t(`${branch}: base neta ≤ base bruta (tarjeta netea)`, r.baseTotal.totalNeto <= r.baseTotal.totalBruto + 0.01)
    const sumNet = r.items.reduce((s, i) => s + i.netTotal, 0)
    t(`${branch}: Σ neto ítems = neto total`, Math.abs(sumNet - r.totals.netTotal) < 0.02, `(${sumNet.toFixed(2)} vs ${r.totals.netTotal.toFixed(2)})`)
  }

  console.log(`\n${pass} pasaron · ${fail} fallaron`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })

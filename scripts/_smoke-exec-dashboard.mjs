/**
 * Smoke-test SOLO LECTURA del dashboard ejecutivo de Comisión de Ventas.
 * Ejecuta getCommissionExecutiveDashboard con el BusinessContext de csl y
 * verifica que los agregados cuadren contra datos reales de db-cls.
 * Uso: pnpm tsx scripts/_smoke-exec-dashboard.mjs
 */
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dir = path.dirname(fileURLToPath(import.meta.url))
const env = path.join(dir, "../.env.local")
if (existsSync(env)) for (const ln of readFileSync(env, "utf8").split(/\r?\n/)) {
  const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
}

const { runWithBusinessContext } = await import("../lib/server/business-context.ts")
const { getCommissionExecutiveDashboard } = await import("../lib/server/commission.ts")
const { getSupabaseAdmin } = await import("../lib/server/supabase.ts")

const { data: biz } = await getSupabaseAdmin().from("businesses").select("id,slug")
const csl = (biz || []).find((b) => b.slug === "csl")
if (!csl) { console.log("✗ negocio csl no encontrado"); process.exit(1) }

const ctx = {
  businessId: csl.id, businessSlug: "csl",
  isSuperadmin: true, isAdmin: true, crossTenant: false,
  userId: "smoke", permissions: [], branchScope: { all: true, branches: [] },
}

let pass = 0, fail = 0
const t = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${extra}`) }
}

// Junio 2026 (mes completo → comparativas activas)
const jun = await runWithBusinessContext(ctx, () =>
  getCommissionExecutiveDashboard({ month: 6, year: 2026, from: "2026-06-01", to: "2026-06-30" }))
console.log("── Ejecutivo · Junio 2026")
t("ok", jun.ok === true)
t("ventas jun = 2,558,505 (RPC validado)", jun.kpis.salesTotal === 2558505, `(${jun.kpis.salesTotal})`)
t("período full month → deltas presentes", jun.period.isFullMonth && jun.deltas !== null)
t("prevLabel = May 2026", jun.prevLabel === "May 2026")
t("tendencia = 6 meses", jun.trend.length === 6, JSON.stringify(jun.trend.map((x) => x.label)))
t("tendencia jun = ventas del período", jun.trend[5]?.sales === jun.kpis.salesTotal)
t("tendencia ene = 1,691,000", jun.trend[0]?.sales === 1691000, `(${jun.trend[0]?.sales})`)
t("composición = 4 categorías", jun.composition.length === 4)
t("byBranch no vacío y ordenado desc", jun.byBranch.length > 0 && jun.byBranch.every((b, i, a) => i === 0 || a[i - 1].gross >= b.gross))
t("settlement: bruto − descuentos − limpieza = neto",
  Math.abs((jun.settlement.gross - jun.settlement.discounts - jun.settlement.cleaning) - jun.settlement.net) < 0.01,
  JSON.stringify(jun.settlement))
t("insights = 3", jun.insights.length === 3, JSON.stringify(jun.insights.map((i) => i.title)))
t("% tarjeta entre 0 y 100", jun.kpis.cardSharePct >= 0 && jun.kpis.cardSharePct <= 100, `(${jun.kpis.cardSharePct})`)
t("ticket promedio > 0", jun.kpis.ticketAvg > 0, `(${jun.kpis.ticketAvg})`)
console.log("   KPIs:", JSON.stringify(jun.kpis))
console.log("   deltas:", JSON.stringify(jun.deltas))
console.log("   top:", JSON.stringify(jun.topProviders.map((p) => `${p.provider}=${p.net}`)))

// Rango multi-mes (sin comparativas) y "todo"
const q2 = await runWithBusinessContext(ctx, () =>
  getCommissionExecutiveDashboard({ month: 6, year: 2026, from: "2026-04-01", to: "2026-06-30" }))
console.log("── Ejecutivo · Q2 (rango)")
t("rango → sin deltas", q2.deltas === null)
t("ventas Q2 = abr+may+jun", q2.kpis.salesTotal === Math.round((3090650 + 5128621 + 2558505) * 100) / 100, `(${q2.kpis.salesTotal})`)

const todo = await runWithBusinessContext(ctx, () => getCommissionExecutiveDashboard({}))
console.log("── Ejecutivo · Todo el historial")
t("todo → ok, sin deltas, ventas = 6 meses", todo.ok && todo.deltas === null && todo.kpis.salesTotal === 19486006, `(${todo.kpis.salesTotal})`)

console.log(`\n${pass} pasaron · ${fail} fallaron`)
process.exit(fail ? 1 : 0)

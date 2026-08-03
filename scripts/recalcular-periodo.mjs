/**
 * Recalcula el período de incentivos de un negocio usando los HANDLERS REALES
 * del servidor (`getCommissionRunPreview` / `saveCommissionRun`) dentro de
 * `runWithBusinessContext`, igual que hace /api/csl. No reimplementa nada.
 *
 * Sin `--save` solo MUESTRA el cálculo y lo compara con lo guardado: es seguro
 * y no escribe nada. Úsalo así primero, siempre.
 *
 * Uso:
 *   node --import tsx scripts/recalcular-periodo.mjs <csl|depicenter> <mes> <año> [--save]
 *
 * Ej.:
 *   node --import tsx scripts/recalcular-periodo.mjs csl 7 2026
 *   node --import tsx scripts/recalcular-periodo.mjs csl 7 2026 --save
 */
import fs from "node:fs"

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim()
}

const { runWithBusinessContext } = await import("../lib/server/business-context.ts")
const commission = await import("../lib/server/commission.ts")
const { runSql } = await import("./db-query.js")

const TENANTS = {
  csl: { businessId: "66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6", businessSlug: "csl" },
  depicenter: { businessId: "03b96698-c5df-4b4b-84df-1160a7ad56b9", businessSlug: "depicenter" },
}

const [slug, mesArg, anioArg] = process.argv.slice(2)
const doSave = process.argv.includes("--save")
const T = TENANTS[String(slug || "").toLowerCase()]
const month = Number(mesArg), year = Number(anioArg)
if (!T || !month || !year) {
  console.error("Uso: node --import tsx scripts/recalcular-periodo.mjs <csl|depicenter> <mes> <año> [--save]")
  process.exit(1)
}

const USER = { id: "script:recalcular-periodo", email: "script:recalcular-periodo" }
const money = (n) => Number(n || 0).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Lo guardado hoy, para contrastar.
const saved = await runSql(`select r.branch, ri.collaborator_name n, ri.net_total, ri.laser_total
  from sales_commission_run_items ri join sales_commission_runs r on r.id = ri.run_id
  where r.business_id = '${T.businessId}' and r.deleted_at is null and r.status <> 'anulado'
    and r.period_month = ${month} and r.period_year = ${year}`)
const savedMap = new Map(saved.map((r) => [`${r.branch}|${r.n}`, r]))

const ctx = { ...T, isSuperadmin: true, isAdmin: true, bypassTenantFilter: false, branchScope: { all: true, branches: [] } }

await runWithBusinessContext(ctx, async () => {
  const prev = await commission.getCommissionRunPreview({ month, year })
  const results = prev.multi ? prev.results : [{ branch: prev.result.branch, result: prev.result }]

  let totalAntes = 0, totalAhora = 0
  for (const { branch, result } of results) {
    const L = result.laser
    console.log(`\n══ ${slug.toUpperCase()} · ${branch} · ${String(month).padStart(2, "0")}/${year} ══`)
    console.log(`   base láser ${money(L.base)} · tramo ${(L.pct * 100).toFixed(0)}% · fondo ${money(L.fund)} · pacientes: ${L.patientsSource || "—"}`)
    console.log(`   ${"COLABORADORA".padEnd(14)} ${"PAC".padStart(5)} ${"LÁSER".padStart(12)} ${"NETO AHORA".padStart(13)} ${"NETO GUARDADO".padStart(14)} ${"Δ".padStart(12)}`)
    for (const it of result.items) {
      const s = savedMap.get(`${branch}|${it.name}`)
      const antes = s ? Number(s.net_total) : null
      const ahora = Number(it.netTotal) || 0
      totalAhora += ahora
      totalAntes += antes ?? 0
      const delta = antes == null ? null : ahora - antes
      const marca = delta == null ? "(nueva)" : Math.abs(delta) < 0.01 ? "=" : (delta > 0 ? "+" : "") + money(delta)
      console.log(`   ${String(it.name).padEnd(14)} ${String(it.patients ?? 0).padStart(5)} ${money(it.laserTotal).padStart(12)} ${money(ahora).padStart(13)} ${(antes == null ? "—" : money(antes)).padStart(14)} ${marca.padStart(12)}`)
    }
    for (const a of result.alerts || []) console.log(`   ⚠️  ${a}`)

    if (doSave) {
      const res = await commission.saveCommissionRun({ branch, month, year }, USER)
      console.log(`   💾 ${res?.ok ? "run guardado" : JSON.stringify(res)}`)
    }
  }

  console.log(`\n   TOTAL guardado: ${money(totalAntes)}   →   TOTAL ahora: ${money(totalAhora)}   (Δ ${money(totalAhora - totalAntes)})`)
  if (!doSave) console.log("\n   (solo lectura — repetir con --save para guardar)")
})

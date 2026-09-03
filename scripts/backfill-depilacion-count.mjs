/**
 * Rellena `sales_commission_patient_counts.depilacion_count` en los períodos ya
 * importados, contando desde las reservas guardadas con el MISMO clasificador
 * que usan las ventas (`isDepilacionService`). Así el criterio vive en un solo
 * sitio en vez de duplicarse en SQL.
 *
 *   node --import tsx scripts/backfill-depilacion-count.mjs [--dry]
 */
import fs from "node:fs"
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim()
}
const { isDepilacionService } = await import("../lib/commission/classification.ts")
const { runSql } = await import("./db-query.js")

const DRY = process.argv.includes("--dry")
const esc = (s) => String(s).replace(/'/g, "''")

const reservas = await runSql(`
  select extract(year from appointment_date)::int y, extract(month from appointment_date)::int m,
         provider_normalized p, branch_normalized b, service_name s, count(*)::int n
  from sales_commission_reservations
  where attendance_status = 'ASISTE' and provider_normalized is not null and appointment_date is not null
  group by 1,2,3,4,5`)

const depil = new Map()
const total = new Map()
for (const r of reservas) {
  const key = `${r.y}|${r.m}|${r.p}|${r.b || ""}`
  total.set(key, (total.get(key) || 0) + r.n)
  if (isDepilacionService(r.s)) depil.set(key, (depil.get(key) || 0) + r.n)
}

const filas = await runSql(`
  select id, period_year y, period_month m, provider_name p, branch b, patient_count pc, depilacion_count dc
  from sales_commission_patient_counts where source = 'reservas'`)

const cambios = []
for (const f of filas) {
  const key = `${f.y}|${f.m}|${f.p}|${f.b || ""}`
  if (!total.has(key)) { cambios.push({ ...f, nuevo: null, nota: "sin reservas que casen" }); continue }
  const nuevo = depil.get(key) || 0
  if (f.dc === nuevo) continue
  cambios.push({ ...f, nuevo, nota: nuevo === f.pc ? "" : `${f.pc} atenciones → ${nuevo} de depilación` })
}

const aplicables = cambios.filter((c) => c.nuevo !== null)
const huerfanas = cambios.filter((c) => c.nuevo === null)
const cambian = aplicables.filter((c) => c.nuevo !== c.pc)

console.log(`${filas.length} filas de pacientes · ${aplicables.length} a rellenar · ${cambian.length} donde el número CAMBIA`)
if (huerfanas.length) console.log(`⚠️  ${huerfanas.length} filas sin reservas que casen (se dejan intactas): ${huerfanas.slice(0, 5).map((h) => `${h.y}-${h.m} ${h.p}`).join(", ")}`)
console.log("\nDonde cambia el reparto:")
for (const c of cambian.sort((a, b) => (b.pc - b.nuevo) - (a.pc - a.nuevo)).slice(0, 30)) {
  console.log(`  ${c.y}-${String(c.m).padStart(2, "0")}  ${(c.b || "").padEnd(14)}${String(c.p).padEnd(12)} ${String(c.pc).padStart(4)} → ${String(c.nuevo).padStart(4)}`)
}
if (DRY) { console.log("\n(dry-run: no se escribe)"); process.exit(0) }

for (let i = 0; i < aplicables.length; i += 200) {
  const parte = aplicables.slice(i, i + 200)
  const cases = parte.map((c) => `when '${c.id}'::uuid then ${c.nuevo}`).join(" ")
  const ids = parte.map((c) => `'${esc(c.id)}'::uuid`).join(",")
  await runSql(`update sales_commission_patient_counts set depilacion_count = case id ${cases} end, updated_at = now() where id in (${ids})`)
}
console.log(`\n✅ ${aplicables.length} filas actualizadas`)

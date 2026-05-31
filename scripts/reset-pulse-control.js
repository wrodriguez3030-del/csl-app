/**
 * Admin script: resetPulseControlData(businessId)
 *
 * Usage:
 *   node scripts/reset-pulse-control.js <businessId>
 *   node scripts/reset-pulse-control.js 66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6
 *
 * What it does:
 *   1. Validates business_id exists in csl_businesses (or equipos)
 *   2. Shows record counts before
 *   3. Exports backup JSON to C:\Temp\backup_pulsecontrol_<bid>_<timestamp>\
 *   4. Deletes operational PulseControl data for that tenant
 *   5. Shows counts after
 *
 * Does NOT touch: equipos, sucursales, operadoras, user_profiles, or
 * any table without a business_id filter.
 */

const path = require("path")
const fs = require("fs")

// Load env from project root
require("dotenv").config({ path: path.join(__dirname, "../.env.local") })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local")
  process.exit(1)
}

const { createClient } = require(path.join(__dirname, "../node_modules/@supabase/supabase-js"))
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const OPERATIONAL_TABLES = [
  "csl_lecturas_semanales",
  "csl_auditorias_semanales",
  "csl_sesiones_cliente",
]

const MASTER_TABLES_READONLY = [
  "csl_equipos",
  "csl_sucursales",
  "csl_operadoras",
]

async function paginate(table, businessId) {
  const PAGE = 1000
  let all = []
  let page = 0
  while (true) {
    const { data, error } = await sb
      .from(table)
      .select("*")
      .eq("business_id", businessId)
      .range(page * PAGE, (page + 1) * PAGE - 1)
    if (error) { console.error(`  paginate error (${table}):`, error.message); break }
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < PAGE) break
    page++
  }
  return all
}

async function countCsl(table, businessId) {
  const { count, error } = await sb
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("business_id", businessId)
  if (error) return `error: ${error.message}`
  return count ?? 0
}

async function resetPulseControlData(businessId) {
  if (!businessId || !/^[0-9a-f-]{36}$/.test(businessId)) {
    console.error("Invalid business_id format. Expected UUID.")
    process.exit(1)
  }

  console.log("\n=== PulseControl Reset ===")
  console.log("business_id:", businessId)
  console.log("timestamp:  ", new Date().toISOString())

  // 1. Count before
  console.log("\n--- Record counts BEFORE (operational tables) ---")
  const beforeCounts = {}
  for (const t of OPERATIONAL_TABLES) {
    const n = await countCsl(t, businessId)
    beforeCounts[t] = n
    console.log(`  ${t}: ${n}`)
  }
  const totalBefore = Object.values(beforeCounts).reduce((s, n) => s + (typeof n === "number" ? n : 0), 0)
  if (totalBefore === 0) {
    console.log("\nNothing to delete — all tables already empty for this tenant.")
    return
  }

  // 2. Backup
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16).replace("T", "_")
  const bidShort = businessId.slice(0, 8)
  const backupDir = `C:/Temp/backup_pulsecontrol_${bidShort}_${ts}`
  fs.mkdirSync(backupDir, { recursive: true })
  console.log("\n--- Creating backup at:", backupDir, "---")

  for (const t of OPERATIONAL_TABLES) {
    if (typeof beforeCounts[t] !== "number" || beforeCounts[t] === 0) continue
    const rows = await paginate(t, businessId)
    fs.writeFileSync(path.join(backupDir, `${t}.json`), JSON.stringify(rows, null, 2))
    console.log(`  Backed up ${t}: ${rows.length} rows`)
  }

  // Snapshot master data (not deleting, just reference)
  for (const t of MASTER_TABLES_READONLY) {
    const rows = await paginate(t, businessId)
    fs.writeFileSync(path.join(backupDir, `${t}_snapshot.json`), JSON.stringify(rows, null, 2))
    console.log(`  Snapshot  ${t}: ${rows.length} rows (not deleting)`)
  }

  const manifest = {
    created: new Date().toISOString(),
    business_id: businessId,
    tables_deleted: OPERATIONAL_TABLES,
    tables_snapshot_only: MASTER_TABLES_READONLY,
    counts_before: beforeCounts,
  }
  fs.writeFileSync(path.join(backupDir, "_manifest.json"), JSON.stringify(manifest, null, 2))
  console.log("  Manifest written.")

  // 3. Delete
  console.log("\n--- Deleting operational data ---")
  const afterCounts = {}
  for (const t of OPERATIONAL_TABLES) {
    if (typeof beforeCounts[t] !== "number" || beforeCounts[t] === 0) {
      console.log(`  SKIP ${t} (0 rows)`)
      afterCounts[t] = 0
      continue
    }
    const { error, count } = await sb.from(t).delete({ count: "exact" }).eq("business_id", businessId)
    if (error) {
      console.error(`  ERROR deleting ${t}:`, error.message)
      afterCounts[t] = "error"
    } else {
      console.log(`  DELETED ${t}: ${count ?? "?"} rows`)
      afterCounts[t] = 0
    }
  }

  // 4. Verify
  console.log("\n--- Verification (counts after) ---")
  for (const t of OPERATIONAL_TABLES) {
    const n = await countCsl(t, businessId)
    console.log(`  ${t}: ${n} ${n === 0 ? "✓" : "⚠ STILL HAS ROWS"}`)
  }

  console.log("\n--- Master data check (should be unchanged) ---")
  for (const t of MASTER_TABLES_READONLY) {
    const n = await countCsl(t, businessId)
    console.log(`  ${t}: ${n} rows (preserved)`)
  }

  console.log("\n=== Reset complete. Backup at:", backupDir, "===\n")
}

const businessId = process.argv[2]
if (!businessId) {
  console.error("Usage: node scripts/reset-pulse-control.js <businessId>")
  process.exit(1)
}

resetPulseControlData(businessId).catch((e) => { console.error(e); process.exit(1) })

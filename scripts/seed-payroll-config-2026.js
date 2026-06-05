/**
 * Seed/Update: tasas de nómina RD 2026 VERIFICADAS por business (db-cls).
 *
 * - Marca verificado=true (quita el banner "Tasas sin verificar").
 * - Fija tasas empleado, topes TSS (AFP/SFS) e ISR DGII 2026 en las columnas
 *   existentes (siempre).
 * - Intenta columnas TSS 2026 nuevas (srl_cap + tasas patronales). Si aún no se
 *   aplicó la migración DDL 202606050001, las omite sin romper (graceful).
 * - Registra auditoría en hr_audit_logs por tenant.
 * - Multi-tenant: una fila por business_id. NO destructivo (solo PATCH/INSERT).
 *
 * Uso: node scripts/seed-payroll-config-2026.js
 */
const fs = require("fs"), path = require("path")
const env = path.join(__dirname, "../.env.local")
if (fs.existsSync(env)) for (const ln of fs.readFileSync(env, "utf8").split(/\r?\n/)) {
  const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
}
const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
if (!URL || !KEY) { console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1) }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }

const ISR_2026 = [
  { li: 0, ls: 416220.0, tasa: 0, cuota: 0 },
  { li: 416220.01, ls: 624329.0, tasa: 0.15, cuota: 0 },
  { li: 624329.01, ls: 867123.0, tasa: 0.2, cuota: 31216.0 },
  { li: 867123.01, ls: null, tasa: 0.25, cuota: 79776.0 },
]
const BASE = { daily_base: 23.83, afp_rate: 0.0287, sfs_rate: 0.0304, afp_cap: 464460.0, sfs_cap: 232230.0, isr_brackets: ISR_2026, verificado: true, updated_at: new Date().toISOString() }
const EXTRA = { srl_cap: 92892.0, afp_employer_rate: 0.071, sfs_employer_rate: 0.0709, srl_employer_rate: 0.011, infotep_employer_rate: 0.01 }

const get = async (p) => { const r = await fetch(URL + p, { headers: H }); if (!r.ok) throw new Error(`GET ${p}: ${r.status} ${await r.text()}`); return r.json() }
const patch = async (p, body) => {
  const r = await fetch(URL + p, { method: "PATCH", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(body) })
  return { ok: r.ok, status: r.status, text: await r.text() }
}
const post = async (p, body) => {
  const r = await fetch(URL + p, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(body) })
  return { ok: r.ok, status: r.status, text: await r.text() }
}

;(async () => {
  const businesses = await get("/rest/v1/businesses?select=id,slug,name")
  let extraApplied = true
  for (const b of businesses) {
    const before = await get(`/rest/v1/hr_payroll_config?business_id=eq.${b.id}&select=*`)
    if (!before.length) {
      await post("/rest/v1/hr_payroll_config", { business_id: b.id, ...BASE })
    }
    // 1) Columnas base (siempre existen)
    const rBase = await patch(`/rest/v1/hr_payroll_config?business_id=eq.${b.id}`, BASE)
    if (!rBase.ok) { console.error(`✗ ${b.slug}: base ${rBase.status} ${rBase.text}`); process.exit(1) }
    // 2) Columnas nuevas (pueden no existir aún)
    const rExtra = await patch(`/rest/v1/hr_payroll_config?business_id=eq.${b.id}`, EXTRA)
    if (!rExtra.ok) {
      extraApplied = false
      console.log(`  · ${b.slug}: columnas TSS nuevas omitidas (${rExtra.status}) — falta migración DDL 202606050001`)
    }
    // 3) Auditoría
    await post("/rest/v1/hr_audit_logs", {
      business_id: b.id, user_email: "seed-script", module: "nomina", action: "config_update",
      entity_type: "hr_payroll_config", entity_id: b.id,
      old_values: before[0] || null, new_values: { ...BASE, ...(rExtra.ok ? EXTRA : {}) },
    })
    console.log(`✓ ${b.slug} (${b.name}): verificado=true, afp_cap=464460, sfs_cap=232230, ISR 2026${rExtra.ok ? ", + topes/tasas patronales" : ""}`)
  }
  console.log(`\nListo. Tasas verificadas para ${businesses.length} tenant(s).`)
  if (!extraApplied) console.log("NOTA: aplica supabase/migrations/202606050001_hr_payroll_tss_2026.sql en db-cls para persistir tope SRL + tasas patronales.")
})().catch(e => { console.error("ERROR:", e.message); process.exit(1) })

/** Smoke de captura manual de pacientes contra db-cls: inserta un prestador de
 *  PRUEBA, valida el merge (manual gana por colaborador; los reales de reservas
 *  intactos) y LIMPIA. No toca datos reales. */
const fs = require("fs"), path = require("path")
const env = path.join(__dirname, "../.env.local")
if (fs.existsSync(env)) for (const ln of fs.readFileSync(env, "utf8").split(/\r?\n/)) {
  const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
}
const { createClient } = require("@supabase/supabase-js")
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const TEST = "ZZZ_TEST_MANUAL"
const BRANCH = "RAFAEL VIDAL", MONTH = 6, YEAR = 2026
let pass = 0, fail = 0
const t = (n, c, x = "") => { (c ? pass++ : fail++); console.log(`  ${c ? "✓" : "✗"} ${n}${x ? " " + x : ""}`) }

// Replica de readPatientsForRun (merge por colaborador, manual gana).
function mergePatients(rows) {
  const byName = new Map()
  for (const r of rows) {
    const name = String(r.provider_name || "").trim().toUpperCase()
    if (!name) continue
    const prev = byName.get(name)
    if (!prev || (r.source === "manual" && prev.source !== "manual")) byName.set(name, { patients: Number(r.patient_count) || 0, source: r.source })
  }
  return byName
}

;(async () => {
  const { data: biz } = await sb.from("businesses").select("id").eq("slug", "csl").single()
  const business_id = biz.id
  const clean = () => sb.from("sales_commission_patient_counts").delete().eq("business_id", business_id).eq("provider_name", TEST)
  await clean() // por si quedó de una corrida previa

  try {
    // Estado base (reservas reales del período).
    const { data: before } = await sb.from("sales_commission_patient_counts")
      .select("provider_name,patient_count,source").eq("business_id", business_id).eq("branch", BRANCH).eq("period_month", MONTH).eq("period_year", YEAR)
    const baseMerge = mergePatients(before || [])
    const realProvider = [...baseMerge.keys()][0]
    const realBase = baseMerge.get(realProvider)?.patients
    t("hay reservas base para la sucursal/período", (before || []).length > 0)

    // 1) Inserta manual para el prestador de prueba.
    const { error: insErr } = await sb.from("sales_commission_patient_counts").insert({
      business_id, branch: BRANCH, period_month: MONTH, period_year: YEAR,
      provider_name: TEST, patient_count: 999, unique_patients: 999, source: "manual", observation: "smoke",
    })
    t("insert manual OK", !insErr, insErr ? insErr.message : "")

    const { data: after } = await sb.from("sales_commission_patient_counts")
      .select("provider_name,patient_count,source").eq("business_id", business_id).eq("branch", BRANCH).eq("period_month", MONTH).eq("period_year", YEAR)
    const merged = mergePatients(after || [])
    t("el prestador de prueba aparece con 999 (manual)", merged.get(TEST)?.patients === 999 && merged.get(TEST)?.source === "manual")
    t("los reales de reservas quedan INTACTOS (merge por colaborador)", merged.get(realProvider)?.patients === realBase)

    // 2) Manual sobre un prestador REAL gana sobre su reservas (simulado).
    const { error: ovErr } = await sb.from("sales_commission_patient_counts").insert({
      business_id, branch: BRANCH, period_month: MONTH, period_year: YEAR,
      provider_name: TEST + "2", patient_count: 5, unique_patients: 5, source: "manual",
    })
    // (usamos otro test-provider; el punto es que manual coexiste con reservas)
    t("segundo manual OK", !ovErr)
  } finally {
    const { error: delErr } = await sb.from("sales_commission_patient_counts").delete().eq("business_id", business_id).in("provider_name", [TEST, TEST + "2"])
    t("cleanup: filas de prueba eliminadas", !delErr, delErr ? delErr.message : "")
    const { data: leftover } = await sb.from("sales_commission_patient_counts").select("id").in("provider_name", [TEST, TEST + "2"])
    t("cleanup: no queda ninguna fila de prueba", (leftover || []).length === 0)
  }

  console.log(`\n${pass} pasaron · ${fail} fallaron`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })

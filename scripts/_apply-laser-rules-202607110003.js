/** Aplica 202607110003 (reglas de reparto láser) a db-cls. Idempotente, aditivo. */
const fs = require("fs"), path = require("path")
const env = path.join(__dirname, "../.env.local")
if (fs.existsSync(env)) for (const ln of fs.readFileSync(env, "utf8").split(/\r?\n/)) {
  const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
}
const { createClient } = require("@supabase/supabase-js")
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const NEW = [
  { name: "Reparto láser: % por cantidad de personas", rule_type: "laser_weight_personas", percentage: 0.5, fixed_amount: null },
  { name: "Reparto láser: % por pacientes atendidos", rule_type: "laser_weight_pacientes", percentage: 0.5, fixed_amount: null },
  { name: "Láser: empleado con 0 pacientes recibe parte fija", rule_type: "laser_zero_patients_fixed", percentage: null, fixed_amount: 1 },
  { name: "Láser: descontar tarjeta antes de la escala", rule_type: "laser_card_discount_before_scale", percentage: null, fixed_amount: 1 },
]

;(async () => {
  const { data: rules, error } = await sb.from("sales_commission_rules").select("business_id,rule_type")
  if (error) { console.log("error leyendo reglas:", error.message); process.exit(1) }
  const businesses = [...new Set((rules || []).map((r) => r.business_id))]
  console.log("negocios con reglas:", businesses.length)
  let inserted = 0
  for (const business_id of businesses) {
    const have = new Set((rules || []).filter((r) => r.business_id === business_id).map((r) => r.rule_type))
    const toInsert = NEW.filter((n) => !have.has(n.rule_type)).map((n) => ({
      business_id, name: n.name, rule_type: n.rule_type, percentage: n.percentage, fixed_amount: n.fixed_amount,
      priority: 100, active: true, effective_from: "2000-01-01", created_by: "seed",
    }))
    if (toInsert.length) {
      const { error: insErr } = await sb.from("sales_commission_rules").insert(toInsert)
      if (insErr) { console.log(`  ${business_id}: error insert:`, insErr.message); process.exit(1) }
      inserted += toInsert.length
      console.log(`  ${business_id}: +${toInsert.length} reglas`)
    } else {
      console.log(`  ${business_id}: ya tenía las 4`)
    }
  }
  console.log(`\nTotal insertadas: ${inserted}`)
  // Verificación
  const { data: check } = await sb.from("sales_commission_rules")
    .select("rule_type,percentage,fixed_amount").in("rule_type", NEW.map((n) => n.rule_type))
  console.log("reglas láser de reparto ahora:", (check || []).length)
})()

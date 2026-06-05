/**
 * Verifica el CHECK form_type de csl_public_form_links.
 * Intenta crear (service_role) un link form_type='solicitud_empleo' y reporta:
 *  - si falla con el check constraint  → el fix SQL aún NO se aplicó
 *  - si inserta OK                      → fix aplicado; borra la fila de prueba
 * Read-mostly: si inserta, hace rollback borrando por token_hash de prueba.
 */
const fs = require("fs"), path = require("path")
const envText = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
const env = {}
for (const line of envText.split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const { createClient } = require("@supabase/supabase-js")
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

;(async () => {
  const tokenHash = "verify_test_" + Date.now()
  const row = {
    business_id: "66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6", // CSL
    token_hash: tokenHash,
    form_type: "solicitud_empleo",
    expira_en: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
  }
  const { data, error } = await sb.from("csl_public_form_links").insert(row).select("id").single()
  if (error) {
    const isConstraint = /form_type_check/.test(error.message)
    console.log(isConstraint
      ? "❌ FALLA (constraint vigente): " + error.message + "\n→ El fix SQL todavía NO se aplicó."
      : "⚠️ Otro error: " + error.message)
    process.exit(0)
  }
  console.log("✅ OK: se creó link solicitud_empleo (id=" + data.id + "). El fix está aplicado.")
  await sb.from("csl_public_form_links").delete().eq("token_hash", tokenHash)
  console.log("🧹 Fila de prueba borrada.")
})()

/**
 * Regresión e2e: los handlers de Contratos/Documentos RR.HH. deben operar
 * sobre el business ACTIVO de la UI, no el del perfil del usuario.
 * (Antes usaban csl_user_profiles.business_id → superadmin viendo Depicenter
 * leía/escribía CSL.)
 *
 * Superadmin de CSL con activeBusinessId=DEPICENTER: guarda un contrato →
 * debe caer bajo DEPICENTER, verse con Depicenter activo y NO verse con CSL.
 * Limpia todo al final.
 *
 * Uso: node scripts/_test-hr-contracts-scoping.js [baseUrl]  (default http://localhost:3971)
 */
const fs = require("fs"), path = require("path")
const env = path.join(__dirname, "../.env.local")
if (fs.existsSync(env)) for (const ln of fs.readFileSync(env, "utf8").split(/\r?\n/)) {
  const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
}
const URL_ = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()
const SRK = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
const ANON = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim()
const BASE = process.argv[2] || "http://localhost:3971"
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", Prefer: "return=representation" }
const CSL = "66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6"
const DEPI = "03b96698-c5df-4b4b-84df-1160a7ad56b9"

const rest = async (method, p, body) => {
  const r = await fetch(URL_ + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  const txt = await r.text()
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${txt}`)
  return txt ? JSON.parse(txt) : null
}
const api = async (token, params) => {
  const r = await fetch(`${BASE}/api/csl`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(params) })
  return r.json()
}
let pass = 0, fail = 0
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log(`  PASS  ${name}`) } else { fail++; console.log(`  FAIL  ${name} ${extra}`) } }

;(async () => {
  const ts = Date.now()
  const email = `test.hrscope.${ts}@cibao.local`
  const password = `Th!${ts}Zc3`
  let userId = null, contractId = null
  const EMP = `TEST-HR-SCOPE-${ts}`
  try {
    const u = await rest("POST", "/auth/v1/admin/users", { email, password, email_confirm: true })
    userId = u.id
    await rest("POST", `/rest/v1/csl_user_profiles?on_conflict=user_id`, {
      user_id: userId, nombre: "TEST HR SCOPE", username: email, is_admin: false, is_superadmin: true,
      activo: true, business_id: CSL, menus: [], permissions: [],
    }).catch(async (e) => { if (!/duplicate|409/.test(String(e))) throw e })
    const tk = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }).then(r => r.json())
    if (!tk.access_token) throw new Error("Login falló: " + JSON.stringify(tk))
    const token = tk.access_token

    // Superadmin (perfil CSL) con DEPICENTER activo guarda un contrato
    const save = await api(token, {
      action: "saveHrContract", activeBusinessId: DEPI,
      data: JSON.stringify({ employee_id: EMP, contract_type: "indefinido", start_date: "2099-01-01", status: "borrador" }),
    })
    contractId = save?.record?.id
    check("guardar con Depicenter activo: ok", save?.ok === true && Boolean(contractId), JSON.stringify(save))
    check("el contrato cayó bajo DEPICENTER (no CSL)", save?.record?.business_id === DEPI, `business_id=${save?.record?.business_id}`)

    const listDepi = await api(token, { action: "getHrContracts", activeBusinessId: DEPI })
    check("con Depicenter activo: el contrato se ve", (listDepi?.records || []).some(r => r.id === contractId))
    const listCsl = await api(token, { action: "getHrContracts", activeBusinessId: CSL })
    check("con CSL activo: el contrato NO se ve", !(listCsl?.records || []).some(r => r.id === contractId))

    // Borrar con el tenant correcto activo
    const del = await api(token, { action: "deleteHrContract", id: contractId, activeBusinessId: DEPI })
    check("borrar con Depicenter activo: ok", del?.ok === true, JSON.stringify(del))
    const left = await rest("GET", `/rest/v1/hr_contracts?id=eq.${contractId}&select=id`)
    check("el contrato quedó borrado", (left || []).length === 0)
    contractId = null

    console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`)
    process.exitCode = fail ? 1 : 0
  } finally {
    if (contractId) await rest("DELETE", `/rest/v1/hr_contracts?id=eq.${contractId}`).catch(() => {})
    await rest("DELETE", `/rest/v1/hr_contracts?employee_id=eq.${EMP}`).catch(() => {})
    if (userId) {
      await rest("DELETE", `/rest/v1/csl_user_profiles?user_id=eq.${userId}`).catch(() => {})
      await rest("DELETE", `/auth/v1/admin/users/${userId}`).catch(() => {})
    }
    console.log("Limpieza de datos de prueba completada.")
  }
})().catch(e => { console.error("ERROR:", e.message); process.exit(1) })

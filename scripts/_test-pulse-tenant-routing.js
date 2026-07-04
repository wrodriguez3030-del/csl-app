/**
 * Prueba e2e del ruteo por sucursal de los imports de pulsos (v0.11.0/v0.14.0)
 * contra server local + db-cls:
 *
 *   1. SUPERADMIN con CSL activo guarda lectura/sesión de sucursal Depicenter
 *      → la fila cae bajo el business_id de DEPICENTER (ruteo automático).
 *   2. Usuario NORMAL de CSL intenta lo mismo → error claro, no escribe nada.
 *   3. saveOperatorShots de usuario normal con fila Depicenter → skipped.
 *
 * Usa usuarios desechables y limpia todos los datos sintéticos al final.
 * Uso: node scripts/_test-pulse-tenant-routing.js [baseUrl]  (default http://localhost:3971)
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
const WEEK = { start: "2099-01-04", end: "2099-01-09" } // semana futura: no choca con datos reales

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
const mkUser = async (email, password, profile) => {
  const u = await rest("POST", "/auth/v1/admin/users", { email, password, email_confirm: true })
  await rest("POST", `/rest/v1/csl_user_profiles?on_conflict=user_id`, { user_id: u.id, username: email, activo: true, menus: [], permissions: [], ...profile })
    .catch(async (e) => { if (!/duplicate|409/.test(String(e))) throw e; await rest("PATCH", `/rest/v1/csl_user_profiles?user_id=eq.${u.id}`, profile) })
  const tk = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }).then(r => r.json())
  if (!tk.access_token) throw new Error(`Login ${email} falló: ${JSON.stringify(tk)}`)
  return { id: u.id, token: tk.access_token }
}
let pass = 0, fail = 0
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log(`  PASS  ${name}`) } else { fail++; console.log(`  FAIL  ${name} ${extra}`) } }

;(async () => {
  const ts = Date.now()
  const users = []
  try {
    const sa = await mkUser(`test.routing.sa.${ts}@cibao.local`, `Tr!${ts}Xa1`, { nombre: "TEST ROUTING SA", is_admin: false, is_superadmin: true, business_id: CSL })
    users.push(sa.id)
    const nu = await mkUser(`test.routing.nu.${ts}@cibao.local`, `Tr!${ts}Xb2`, { nombre: "TEST ROUTING NORMAL", is_admin: false, is_superadmin: false, business_id: CSL })
    users.push(nu.id)

    // 1) Superadmin con CSL ACTIVO guarda lectura de Depicenter → va a DEPI
    const r1 = await api(sa.token, {
      action: "savePulseReading", activeBusinessId: CSL,
      data: JSON.stringify({ equipo_id: "TEST-RT-1", sucursal: "Depicenter", period_start: WEEK.start, period_end: WEEK.end, lectura_inicial: 100, lectura_final: 200, source_type: "excel_equipos" }),
    })
    check("superadmin CSL-activo: lectura Depicenter guardada", r1?.ok === true, JSON.stringify(r1))
    const [row1] = await rest("GET", `/rest/v1/csl_pulse_readings?equipo_id=eq.TEST-RT-1&period_start=eq.${WEEK.start}&select=business_id,sucursal`)
    check("ruteo: la lectura cayó bajo business_id de DEPICENTER", row1?.business_id === DEPI, JSON.stringify(row1))

    // 2) Usuario normal CSL intenta lectura de Depicenter → error, nada escrito
    const r2 = await api(nu.token, {
      action: "savePulseReading",
      data: JSON.stringify({ equipo_id: "TEST-RT-2", sucursal: "Depicenter", period_start: WEEK.start, period_end: WEEK.end, lectura_inicial: 1, lectura_final: 2 }),
    })
    check("usuario normal: lectura cross-tenant rechazada con error claro", r2?.ok !== true && /otro negocio/i.test(String(r2?.error)), JSON.stringify(r2))
    const rows2 = await rest("GET", `/rest/v1/csl_pulse_readings?equipo_id=eq.TEST-RT-2&select=id`)
    check("usuario normal: no se escribió ninguna fila", (rows2 || []).length === 0)

    // 3) saveSesion normal user cross-tenant → error
    const r3 = await api(nu.token, {
      action: "saveSesion",
      data: JSON.stringify({ SesionID: `ses_test_rt_${ts}`, Fecha: WEEK.start, Sucursal: "Depicenter", OperadoraID: "TESTOP", Cliente: "TEST", DisparosReportados: 10 }),
    })
    check("usuario normal: sesión cross-tenant rechazada", r3?.ok !== true && /otro negocio/i.test(String(r3?.error)), JSON.stringify(r3))

    // 4) saveSesion superadmin CSL-activo con sucursal Depicenter → cae en DEPI
    const r4 = await api(sa.token, {
      action: "saveSesion", activeBusinessId: CSL,
      data: JSON.stringify({ SesionID: `ses_test_rt_sa_${ts}`, Fecha: WEEK.start, Sucursal: "Depicenter", OperadoraID: "TESTOP", Cliente: "TEST", DisparosReportados: 10 }),
    })
    check("superadmin: sesión Depicenter guardada", r4?.ok === true, JSON.stringify(r4))
    const [row4] = await rest("GET", `/rest/v1/csl_sesiones_cliente?sesion_id=eq.ses_test_rt_sa_${ts}&select=business_id`)
    check("ruteo: la sesión cayó bajo DEPICENTER", row4?.business_id === DEPI, JSON.stringify(row4))

    // 5) saveOperatorShots usuario normal con fila Depicenter → skipped=1
    const r5 = await api(nu.token, {
      action: "saveOperatorShots",
      data: JSON.stringify({ rows: [{ period_start: WEEK.start, period_end: WEEK.end, sucursal_normalizada: "DEPICENTER", operadora_normalizada: "TESTOP", sesiones: 1, disparos: 10 }] }),
    })
    check("usuario normal: shot cross-tenant omitido (skipped=1)", r5?.ok === true && r5?.skipped === 1 && (r5?.upserted || 0) === 0, JSON.stringify(r5))

    console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`)
    process.exitCode = fail ? 1 : 0
  } finally {
    await rest("DELETE", `/rest/v1/csl_pulse_readings?equipo_id=like.TEST-RT-*`).catch(() => {})
    await rest("DELETE", `/rest/v1/csl_sesiones_cliente?sesion_id=like.ses_test_rt_*`).catch(() => {})
    await rest("DELETE", `/rest/v1/csl_operator_shots?operadora_normalizada=eq.TESTOP`).catch(() => {})
    for (const id of users) {
      await rest("DELETE", `/rest/v1/csl_user_profiles?user_id=eq.${id}`).catch(() => {})
      await rest("DELETE", `/auth/v1/admin/users/${id}`).catch(() => {})
    }
    console.log("Limpieza de datos de prueba completada.")
  }
})().catch(e => { console.error("ERROR:", e.message); process.exit(1) })

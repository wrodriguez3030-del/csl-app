/**
 * Prueba end-to-end del permiso granular material_requisitions.delete
 * (migración 202607020001) contra el server local + Supabase self-hosted.
 *
 * Crea un usuario de PRUEBA desechable (no toca a Carlos ni a nadie real),
 * le da el permiso, y verifica por el API real (/api/csl):
 *   1. Con permiso: elimina (soft delete) una requisición APROBADA que no creó.
 *   2. deleted_at/deleted_by/deleted_reason quedan bien (deleted_by = user real).
 *   3. Sin permiso: el mismo delete da "No tienes permiso".
 *   4. Cross-tenant: no puede eliminar una requisición de Depicenter.
 * Limpia todo al final (requisiciones sintéticas + usuario de prueba).
 *
 * Uso: node scripts/_test-reqmat-delete-perm.js [baseUrl]  (default http://localhost:3971)
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
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" }
const CSL = "66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6"
const DEPI = "03b96698-c5df-4b4b-84df-1160a7ad56b9"
const OTHER_UUID = "00000000-0000-4000-8000-00000000dead" // "creador" ajeno

const rest = async (method, p, body) => {
  const r = await fetch(URL_ + p, { method, headers: { ...H, Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined })
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
  const email = `test.delperm.${Date.now()}@cibao.local`
  const password = `Tp!${Math.random().toString(36).slice(2, 12)}A9`
  let userId = null
  const reqIds = []
  try {
    // 1) Usuario de prueba
    const u = await rest("POST", "/auth/v1/admin/users", { email, password, email_confirm: true })
    userId = u.id
    console.log("Usuario de prueba:", email, userId)

    // 2) Perfil: usuario NORMAL de CSL con el permiso granular
    await rest("POST", `/rest/v1/csl_user_profiles?on_conflict=user_id`, {
      user_id: userId, nombre: "TEST DELETE PERM", username: email, is_admin: false,
      is_superadmin: false, activo: true, business_id: CSL,
      menus: ["req-mat-aprobaciones"], permissions: ["material_requisitions.delete"],
    }).catch(async (e) => {
      // trigger pudo haber creado la fila → PATCH
      if (!/duplicate|409/.test(String(e))) throw e
      await rest("PATCH", `/rest/v1/csl_user_profiles?user_id=eq.${userId}`, {
        nombre: "TEST DELETE PERM", is_admin: false, is_superadmin: false, activo: true,
        business_id: CSL, menus: ["req-mat-aprobaciones"], permissions: ["material_requisitions.delete"],
      })
    })

    // 3) Login → access token
    const tk = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }).then(r => r.json())
    if (!tk.access_token) throw new Error("Login de prueba falló: " + JSON.stringify(tk))
    const token = tk.access_token

    // 4) Requisición APROBADA creada por OTRO usuario (el creador no podría
    //    eliminarla; solo admin o el permiso granular pueden)
    const [rq1] = await rest("POST", "/rest/v1/material_requisitions", {
      business_id: CSL, branch: "VILLA OLGA", status: "aprobada", requested_by: OTHER_UUID,
      requested_at: new Date().toISOString(), notes: "TEST permiso delete (borrar)",
    })
    reqIds.push(rq1.id)
    const del1 = await api(token, { action: "deleteRequisition", id: rq1.id, reason: "prueba permiso granular" })
    check("con permiso: elimina requisición aprobada ajena", del1?.ok === true, JSON.stringify(del1))

    const [after1] = await rest("GET", `/rest/v1/material_requisitions?id=eq.${rq1.id}&select=deleted_at,deleted_by,deleted_reason,updated_at`)
    check("soft delete: deleted_at seteado", Boolean(after1?.deleted_at))
    check("soft delete: deleted_by = usuario real", after1?.deleted_by === userId, `esperado ${userId}, got ${after1?.deleted_by}`)
    check("soft delete: deleted_reason guardado", after1?.deleted_reason === "prueba permiso granular")

    // 5) SIN permiso → mismo caso debe fallar
    await rest("PATCH", `/rest/v1/csl_user_profiles?user_id=eq.${userId}`, { permissions: [] })
    const [rq2] = await rest("POST", "/rest/v1/material_requisitions", {
      business_id: CSL, branch: "VILLA OLGA", status: "aprobada", requested_by: OTHER_UUID,
      requested_at: new Date().toISOString(), notes: "TEST sin permiso (borrar)",
    })
    reqIds.push(rq2.id)
    const del2 = await api(token, { action: "deleteRequisition", id: rq2.id, reason: "no debería" })
    check("sin permiso: usuario normal NO elimina", del2?.ok !== true && /permiso/i.test(String(del2?.error)), JSON.stringify(del2))

    // 6) Cross-tenant: requisición de DEPICENTER, usuario de CSL con permiso
    await rest("PATCH", `/rest/v1/csl_user_profiles?user_id=eq.${userId}`, { permissions: ["material_requisitions.delete"] })
    const [rq3] = await rest("POST", "/rest/v1/material_requisitions", {
      business_id: DEPI, branch: "DEPICENTER", status: "aprobada", requested_by: OTHER_UUID,
      requested_at: new Date().toISOString(), notes: "TEST cross-tenant (borrar)",
    })
    reqIds.push(rq3.id)
    const del3 = await api(token, { action: "deleteRequisition", id: rq3.id, reason: "no debería" })
    check("cross-tenant: NO elimina requisición de Depicenter", del3?.ok !== true, JSON.stringify(del3))
    const [after3] = await rest("GET", `/rest/v1/material_requisitions?id=eq.${rq3.id}&select=deleted_at`)
    check("cross-tenant: la fila de Depicenter quedó intacta", after3?.deleted_at == null)

    console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`)
    process.exitCode = fail ? 1 : 0
  } finally {
    // Limpieza: filas sintéticas + usuario de prueba
    for (const id of reqIds) await rest("DELETE", `/rest/v1/material_requisitions?id=eq.${id}`).catch(() => {})
    if (userId) {
      await rest("DELETE", `/rest/v1/csl_user_profiles?user_id=eq.${userId}`).catch(() => {})
      await rest("DELETE", `/auth/v1/admin/users/${userId}`).catch(() => {})
    }
    console.log("Limpieza de datos de prueba completada.")
  }
})().catch(e => { console.error("ERROR:", e.message); process.exit(1) })

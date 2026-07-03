/**
 * Prueba end-to-end del FLUJO COMPLETO de Requisición de Materiales contra el
 * server local + Supabase self-hosted (db-cls):
 *
 *   crear (encargada) → aprobar / rechazar ítems → comprar → recibir →
 *   consolidado → dashboard
 *
 * Usa un usuario ADMIN desechable de CSL (no toca usuarios reales) y limpia
 * todos los datos sintéticos al final. El export Excel/PDF es client-side
 * (lib/materials-export.ts) y se alimenta del mismo consolidado validado aquí.
 *
 * Uso: node scripts/_test-reqmat-full-flow.js [baseUrl]  (default http://localhost:3971)
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
  const email = `test.flow.${Date.now()}@cibao.local`
  const password = `Tf!${Math.random().toString(36).slice(2, 12)}B7`
  let userId = null, reqId = null
  try {
    // 1) Admin desechable de CSL
    const u = await rest("POST", "/auth/v1/admin/users", { email, password, email_confirm: true })
    userId = u.id
    await rest("POST", `/rest/v1/csl_user_profiles?on_conflict=user_id`, {
      user_id: userId, nombre: "TEST FLOW ADMIN", username: email, is_admin: true,
      is_superadmin: false, activo: true, business_id: CSL, menus: [], permissions: [],
    }).catch(async (e) => {
      if (!/duplicate|409/.test(String(e))) throw e
      await rest("PATCH", `/rest/v1/csl_user_profiles?user_id=eq.${userId}`, {
        nombre: "TEST FLOW ADMIN", is_admin: true, is_superadmin: false, activo: true, business_id: CSL,
      })
    })
    const tk = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }).then(r => r.json())
    if (!tk.access_token) throw new Error("Login falló: " + JSON.stringify(tk))
    const token = tk.access_token
    console.log("Usuario de prueba (admin CSL):", email)

    // 2) Crear requisición con 2 materiales
    const save = await api(token, {
      action: "saveRequisition", branch: "VILLA OLGA", notes: "TEST FLOW (borrar)",
      items: JSON.stringify([
        { materialName: "TEST MATERIAL UNO", supplierGroup: "BRAVO", requestedQty: 5, unit: "unidad" },
        { materialName: "TEST MATERIAL DOS", supplierGroup: "PRICES MART", requestedQty: 3, unit: "caja" },
      ]),
    })
    reqId = save?.record?.id
    check("crear: requisición enviada con 2 ítems", save?.ok === true && Boolean(reqId) && save?.record?.itemsCount === 2, JSON.stringify(save))

    // 3) Aparece en la lista
    const list = await api(token, { action: "getMyRequisitions", status: "todas" })
    check("lista: la requisición aparece en Aprobaciones", list?.ok === true && (list.records || []).some(r => r.id === reqId))

    const det = await api(token, { action: "getRequisition", id: reqId })
    const items = det?.record?.items || []
    check("detalle: trae los 2 ítems", items.length === 2, JSON.stringify(det))
    const [it1, it2] = items

    // 4) Aprobar ítem 1 (con ajuste de cantidad) y rechazar ítem 2
    const ap = await api(token, { action: "approveMaterialItem", id: it1.id, approvedQty: "4", approvalNote: "ajuste prueba" })
    check("aprobar: ítem 1 aprobado con cantidad ajustada", ap?.ok === true, JSON.stringify(ap))
    const rj = await api(token, { action: "rejectMaterialItem", id: it2.id, reason: "prueba rechazo" })
    check("rechazar: ítem 2 rechazado con motivo", rj?.ok === true, JSON.stringify(rj))

    // 5) Comprar ítem 1
    const pu = await api(token, { action: "purchaseMaterialItem", id: it1.id, purchasedQty: "4", purchasedCost: "150.50", purchasedSupplier: "BRAVO" })
    check("comprar: ítem 1 comprado con costo y suplidor", pu?.ok === true, JSON.stringify(pu))

    // 6) Recibir ítem 1 completo
    const re = await api(token, { action: "receiveMaterialItem", id: it1.id, receivedQty: "4" })
    check("recibir: ítem 1 recibido completo", re?.ok === true, JSON.stringify(re))

    const det2 = await api(token, { action: "getRequisition", id: reqId })
    const st = Object.fromEntries((det2?.record?.items || []).map(i => [i.materialName, i.status]))
    check("estados finales: uno recibido, otro rechazado",
      st["TEST MATERIAL UNO"] === "recibida_completa" && st["TEST MATERIAL DOS"] === "rechazada", JSON.stringify(st))
    check("cabecera refleja el proceso", ["recibida_completa", "recibida_parcial", "comprada", "aprobada"].includes(det2?.record?.status), `status=${det2?.record?.status}`)

    // 7) Consolidado de compras incluye la línea
    const cons = await api(token, { action: "getMaterialConsolidado", status: "todas" })
    const found = (cons?.records || []).some(r => String(r.materialName || "").includes("TEST MATERIAL UNO"))
    check("consolidado: incluye el material de prueba", cons?.ok === true && found)

    // 8) Dashboard responde con KPIs
    const dash = await api(token, { action: "getMaterialDashboard" })
    check("dashboard: responde ok", dash?.ok === true, JSON.stringify(dash).slice(0, 200))

    console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`)
    process.exitCode = fail ? 1 : 0
  } finally {
    if (reqId) {
      await rest("DELETE", `/rest/v1/material_requisition_audit_logs?requisition_id=eq.${reqId}`).catch(() => {})
      await rest("DELETE", `/rest/v1/material_requisition_items?requisition_id=eq.${reqId}`).catch(() => {})
      await rest("DELETE", `/rest/v1/material_requisitions?id=eq.${reqId}`).catch(() => {})
    }
    if (userId) {
      await rest("DELETE", `/rest/v1/csl_user_profiles?user_id=eq.${userId}`).catch(() => {})
      await rest("DELETE", `/auth/v1/admin/users/${userId}`).catch(() => {})
    }
    console.log("Limpieza de datos de prueba completada.")
  }
})().catch(e => { console.error("ERROR:", e.message); process.exit(1) })

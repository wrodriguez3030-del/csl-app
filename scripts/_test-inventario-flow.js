/**
 * TEST e2e — Inventario de materiales por sucursal (flujo completo).
 *
 * Crea un usuario throwaway NO-admin (tenant CSL, menú req-mat-inventario),
 * inicia sesión y ejercita: reutilización del catálogo, borrador + reanudar,
 * finalizar (inmutable), histórico, detalle, inmutabilidad, permisos de
 * corrección (solo admin) y aislamiento por tenant. Limpia todo al final.
 *
 * Requiere el dev server corriendo. Uso:
 *   API_BASE=http://localhost:3099 node scripts/_test-inventario-flow.js
 * Solo Supabase local (db-cls). NO toca datos existentes.
 */
const fs = require("fs")
for (const ln of fs.readFileSync(require("path").join(__dirname, "../.env.local"), "utf8").split(/\r?\n/)) {
  const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
}
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const API_BASE = process.env.API_BASE || "http://localhost:3099"
const CSL = "66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6"

if (/supabase\.co/.test(SB)) { console.error("✗ ABORT: Supabase Cloud, no self-hosted"); process.exit(1) }

const svc = { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json" }
const stamp = String(process.hrtime.bigint()).slice(-8)
const email = `test.inv.${stamp}@diag.local`
const password = `Diag!${stamp}xZ`
const invDate = "2020-01-0" + ((Number(stamp) % 9) + 1) // fecha histórica improbable de chocar
let userId = null, invId = null, pass = true
const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) pass = false }

async function jf(url, opts) {
  const r = await fetch(url, opts)
  const t = await r.text()
  let b = null; try { b = t ? JSON.parse(t) : null } catch { b = t }
  return { status: r.status, ok: r.ok, body: b }
}
const api = (token, body) => jf(`${API_BASE}/api/csl`, {
  method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body),
})

;(async () => {
  console.log("API_BASE:", API_BASE, "| Supabase:", new URL(SB).host, "| fecha:", invDate)
  let token
  try {
    userId = (await jf(`${SB}/auth/v1/admin/users`, { method: "POST", headers: svc, body: JSON.stringify({ email, password, email_confirm: true }) })).body.id
    ok(!!userId, "usuario throwaway NO-admin creado")
    await jf(`${SB}/rest/v1/csl_user_profiles`, {
      method: "POST", headers: svc,
      body: JSON.stringify({ user_id: userId, nombre: "ENC INV __TEST__", username: email, is_admin: false, is_superadmin: false, activo: true, business_id: CSL, menus: ["req-mat-inventario", "req-mat-inventario-historico"] }),
    })
    token = (await jf(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).body.access_token
    ok(!!token, "login NO-admin OK")

    // 1) Reutiliza el catálogo maestro existente (NO duplica)
    const cat = await api(token, { action: "getMaterialCatalog", activeBusinessId: CSL })
    const materials = (cat.body?.records) || []
    ok(cat.body?.ok && materials.length >= 10, `catálogo maestro reutilizado (${materials.length} materiales) — sin catálogo nuevo`)
    const pick = materials.slice(0, 3)

    // 2) Guardar BORRADOR con cantidades
    const items1 = pick.map((m, i) => ({ materialId: m.id, materialName: m.name, supplierGroup: m.supplierGroup, unit: m.unit, quantity: i + 1.5, observation: "conteo " + i }))
    const d1 = await api(token, { action: "saveInventory", branch: "Los Jardines", inventoryDate: invDate, status: "borrador", userName: "ENC INV __TEST__", items: JSON.stringify(items1) })
    invId = d1.body?.record?.id
    ok(d1.body?.ok && !!invId, "borrador guardado (con id)")

    // 3) Reanudar el borrador (salir y volver conserva cantidades)
    const draft = await api(token, { action: "getInventoryDraft", branch: "Los Jardines", inventoryDate: invDate })
    const dItems = draft.body?.record?.items || []
    ok(draft.body?.record?.id === invId && dItems.length === 3, "reanudar borrador conserva las 3 cantidades")
    ok(dItems.some((it) => Number(it.quantity) === 1.5), "acepta decimales (1.5 persistido)")

    // 4) Actualizar el mismo borrador (no duplica por doble guardado)
    const d2 = await api(token, { action: "saveInventory", id: invId, branch: "Los Jardines", inventoryDate: invDate, status: "borrador", userName: "ENC INV __TEST__", items: JSON.stringify(items1) })
    ok(d2.body?.ok && d2.body?.record?.id === invId, "re-guardar borrador reutiliza el mismo id (sin duplicar)")

    // 5) FINALIZAR (histórico inmutable)
    const fin = await api(token, { action: "saveInventory", id: invId, branch: "Los Jardines", inventoryDate: invDate, status: "finalizado", userName: "ENC INV __TEST__", items: JSON.stringify(items1) })
    ok(fin.body?.ok && fin.body?.record?.status === "finalizado", "inventario finalizado")

    // 6) Inmutabilidad: editar un finalizado por saveInventory falla
    const edit = await api(token, { action: "saveInventory", id: invId, branch: "Los Jardines", inventoryDate: invDate, status: "borrador", userName: "x", items: JSON.stringify(items1) })
    ok(edit.body?.ok === false && /finalizado/i.test(String(edit.body?.error || "")), "finalizado es inmutable (edición rechazada)")

    // 7) Histórico: aparece con conteo + creado por (snapshot de nombre)
    const hist = await api(token, { action: "getInventories", status: "todos", activeBusinessId: CSL })
    const mine = (hist.body?.records || []).find((r) => r.id === invId)
    ok(!!mine, "aparece en el histórico")
    ok(mine?.itemsCount === 3, "histórico muestra 3 materiales")
    ok(mine?.createdByName === "ENC INV __TEST__", "muestra 'Creado por' (snapshot de nombre)")
    ok(mine?.finalizedByName === "ENC INV __TEST__", "muestra 'Finalizado por'")
    ok(String(mine?.branch || "").toUpperCase() === "LOS JARDINES", `sucursal correcta (${mine?.branch})`)

    // 8) Detalle
    const det = await api(token, { action: "getInventory", id: invId })
    ok(det.body?.ok && (det.body?.record?.items || []).length === 3, "detalle con 3 ítems")

    // 9) Permiso: un NO-admin NO puede corregir un finalizado
    const anItem = det.body?.record?.items?.[0]
    const corr = await api(token, { action: "correctInventoryItem", itemId: anItem?.id, quantity: 99, reason: "test" })
    ok(corr.body?.ok === false && /admin/i.test(String(corr.body?.error || "")), "corrección de finalizado rechazada a NO-admin (RBAC)")

    // 10) Permiso: el creador NO-admin no puede eliminar un finalizado
    const del = await api(token, { action: "deleteInventory", id: invId, reason: "x" })
    ok(del.body?.ok === false && /permiso/i.test(String(del.body?.error || "")), "eliminar finalizado rechazado al creador NO-admin")

    // 11) Aislamiento: business_id = CSL en DB
    const chk = await jf(`${SB}/rest/v1/material_inventories?id=eq.${invId}&select=business_id,branch,status`, { headers: svc })
    ok(Array.isArray(chk.body) && chk.body[0]?.business_id === CSL, "business_id = CSL en DB (sin cruce Depicenter)")

    // 12) No se duplicó el catálogo maestro
    const catCount = await jf(`${SB}/rest/v1/material_catalog?business_id=eq.${CSL}&select=id`, { headers: svc })
    ok(Array.isArray(catCount.body) && catCount.body.length === materials.length, `catálogo maestro intacto (${catCount.body.length}) — NO se duplicó`)
  } catch (e) {
    ok(false, "excepción: " + e.message)
  } finally {
    // limpieza (borra solo lo creado por este test; ítems caen por ON DELETE CASCADE)
    if (invId) {
      await jf(`${SB}/rest/v1/material_inventory_audit_logs?inventory_id=eq.${invId}`, { method: "DELETE", headers: svc })
      await jf(`${SB}/rest/v1/material_inventories?id=eq.${invId}`, { method: "DELETE", headers: svc })
    }
    if (userId) {
      await jf(`${SB}/rest/v1/csl_user_profiles?user_id=eq.${userId}`, { method: "DELETE", headers: svc })
      await jf(`${SB}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: svc })
    }
    console.log(pass ? "\n✅ TEST PASA" : "\n❌ TEST FALLA")
    process.exit(pass ? 0 : 1)
  }
})()

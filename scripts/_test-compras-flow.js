/**
 * TEST e2e — Módulo COMPRAS (flujo completo, 20 pasos de la especificación).
 *
 * Crea 2 usuarios throwaway NO-admin (tenant CSL): U1 con permisos compras.*
 * (flujo positivo) y U2 sin permisos (chequeo RBAC negativo). Ejercita facturas,
 * pagos, gastos, gastos menores, recurrentes, integración con requisición,
 * no-inventario, soft delete, filtros y aislamiento por tenant. Limpia todo.
 *
 * Requiere el dev server corriendo. Uso:
 *   API_BASE=http://localhost:3099 node scripts/_test-compras-flow.js
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
const ALL_PERMS = ["compras.ver", "compras.crear", "compras.editar", "compras.pagar", "compras.aprobar", "compras.anular", "compras.eliminar", "compras.exportar"]

if (/supabase\.co/.test(SB)) { console.error("✗ ABORT: Supabase Cloud"); process.exit(1) }
const svc = { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json" }
const stamp = String(process.hrtime.bigint()).slice(-8)
let pass = true
const created = { users: [], invoices: [], expenses: [], petties: [], recurrings: [], reqs: [] }
const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) pass = false }

async function jf(url, opts) {
  const r = await fetch(url, opts); const t = await r.text()
  let b = null; try { b = t ? JSON.parse(t) : null } catch { b = t }
  return { status: r.status, ok: r.ok, body: b }
}
const api = (token, body) => jf(`${API_BASE}/api/csl`, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body) })

async function mkUser(name, perms) {
  const email = `test.compras.${name}.${stamp}@diag.local`, password = `Diag!${stamp}xZ`
  const uid = (await jf(`${SB}/auth/v1/admin/users`, { method: "POST", headers: svc, body: JSON.stringify({ email, password, email_confirm: true }) })).body.id
  created.users.push(uid)
  await jf(`${SB}/rest/v1/csl_user_profiles`, { method: "POST", headers: svc, body: JSON.stringify({ user_id: uid, nombre: `${name.toUpperCase()} __TEST__`, username: email, is_admin: false, is_superadmin: false, activo: true, business_id: CSL, menus: ["compras-facturas", "compras-pagos", "compras-gastos-menores", "compras-recurrentes", "compras-dashboard"], permissions: perms }) })
  const token = (await jf(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).body.access_token
  return { uid, token }
}

;(async () => {
  console.log("API_BASE:", API_BASE, "| Supabase:", new URL(SB).host)
  try {
    const u1 = await mkUser("full", ALL_PERMS)
    const u2 = await mkUser("readonly", ["compras.ver"])
    ok(!!u1.token && !!u2.token, "2 usuarios NO-admin creados (U1 con permisos, U2 solo ver)")

    // baseline inventario (para verificar que factura NO lo aumenta)
    const invBaseline = (await jf(`${SB}/rest/v1/material_inventories?business_id=eq.${CSL}&select=id`, { headers: svc })).body.length

    // 1) Crear factura con detalle
    const inv = await api(u1.token, {
      action: "savePurchaseInvoice", branch: "Los Jardines", supplier: "BRAVO", supplierRnc: "101010101",
      invoiceNumber: "F-" + stamp, ncf: "B0100000001", condition: "credito", status: "pendiente",
      invoiceDate: "2026-07-08", dueDate: "2026-07-20", userName: "FULL __TEST__",
      items: JSON.stringify([{ description: "CLORO", quantity: 10, unit: "galón", unitCost: 100, itbis: 180 }, { description: "ACE", quantity: 5, unit: "unidad", unitCost: 50, itbis: 45 }]),
    })
    const invId = inv.body?.record?.id
    created.invoices.push(invId)
    ok(inv.body?.ok && !!invId, "1. Factura creada con detalle")
    const total = inv.body?.record?.total
    ok(Math.abs(total - (10 * 100 + 5 * 50 + 180 + 45)) < 0.01, `total correcto (${total} = subtotal+itbis)`)
    ok(Math.abs(inv.body?.record?.balance - total) < 0.01, "balance inicial = total (sin pagos)")

    // 15) La factura NO aumentó inventario
    const invAfter = (await jf(`${SB}/rest/v1/material_inventories?business_id=eq.${CSL}&select=id`, { headers: svc })).body.length
    ok(invAfter === invBaseline, "15. Crear factura NO aumenta inventario")

    // 2) Pago parcial
    const p1 = await api(u1.token, { action: "registerInvoicePayment", invoiceId: invId, amount: 500, method: "efectivo", paymentDate: "2026-07-09", userName: "FULL __TEST__" })
    ok(p1.body?.ok && p1.body?.record?.status === "parcial", "2. Pago parcial → estado 'parcial'")
    // 3) Balance correcto
    ok(Math.abs(p1.body?.record?.balance - (total - 500)) < 0.01, `3. Balance correcto tras pago parcial (${p1.body?.record?.balance})`)
    // 4) Completar pago
    const p2 = await api(u1.token, { action: "registerInvoicePayment", invoiceId: invId, amount: total - 500, method: "transferencia", userName: "FULL __TEST__" })
    ok(p2.body?.ok && p2.body?.record?.status === "pagada" && Math.abs(p2.body?.record?.balance) < 0.01, "4. Pago completado → estado 'pagada', balance 0")

    // 5) Crear gasto (operativo)
    const exp = await api(u1.token, { action: "saveExpense", branch: "Los Jardines", kind: "gasto_operativo", category: "Electricidad", payee: "EDESUR", concept: "Factura luz", amount: 3500, expenseDate: "2026-07-08", userName: "FULL __TEST__" })
    created.expenses.push(exp.body?.record?.id)
    ok(exp.body?.ok && exp.body?.record?.amount === 3500, "5. Gasto operativo creado")

    // 6) Crear gasto menor
    const petty = await api(u1.token, { action: "savePettyExpense", branch: "Los Jardines", responsible: "FULL __TEST__", category: "Otros", concept: "Café oficina", amount: 250, expenseDate: "2026-07-08", userName: "FULL __TEST__" })
    const pettyId = petty.body?.record?.id
    created.petties.push(pettyId)
    ok(petty.body?.ok && petty.body?.record?.status === "pendiente", "6. Gasto menor creado (pendiente)")
    // 7) Aprobar + pagar
    const pa = await api(u1.token, { action: "setPettyStatus", id: pettyId, status: "aprobado", userName: "FULL __TEST__" })
    const pp = await api(u1.token, { action: "setPettyStatus", id: pettyId, status: "pagado", userName: "FULL __TEST__" })
    ok(pa.body?.ok && pp.body?.ok, "7. Gasto menor aprobado y pagado")

    // 8) Crear pago recurrente mensual
    const rec = await api(u1.token, { action: "saveRecurringPayment", name: "Internet " + stamp, payee: "CLARO", category: "Internet", frequency: "mensual", amount: 2500, nextDate: "2026-07-15", userName: "FULL __TEST__" })
    const recId = rec.body?.record?.id
    created.recurrings.push(recId)
    ok(rec.body?.ok && !!recId, "8. Pago recurrente creado")
    // 9-10) Registrar pago → próxima fecha avanza 1 mes
    const rp = await api(u1.token, { action: "registerRecurringPayment", id: recId, amount: 2500, method: "transferencia", userName: "FULL __TEST__" })
    ok(rp.body?.ok, "9. Pago recurrente registrado")
    ok(rp.body?.record?.nextDate === "2026-08-15", `10. Próxima fecha automática (${rp.body?.record?.nextDate} = +1 mes)`)

    // 11) Filtros por mes/sucursal
    const filt = await api(u1.token, { action: "getPurchaseInvoices", month: "2026-07", branch: "Los Jardines" })
    ok(filt.body?.ok && (filt.body?.records || []).some((r) => r.id === invId), "11. Filtro por mes+sucursal devuelve la factura")
    const filtOther = await api(u1.token, { action: "getPurchaseInvoices", month: "2020-01" })
    ok(filtOther.body?.ok && !(filtOther.body?.records || []).some((r) => r.id === invId), "11b. Filtro por otro mes NO la devuelve")

    // 14) Integración: crear requisición aprobada + factura desde consolidado
    const reqIns = await jf(`${SB}/rest/v1/material_requisitions`, { method: "POST", headers: { ...svc, Prefer: "return=representation" }, body: JSON.stringify({ business_id: CSL, branch: "LOS JARDINES", status: "aprobada", requested_by: u1.uid, requested_at: "2026-07-08T00:00:00Z" }) })
    const reqId = reqIns.body?.[0]?.id
    created.reqs.push(reqId)
    await jf(`${SB}/rest/v1/material_requisition_items`, { method: "POST", headers: svc, body: JSON.stringify({ business_id: CSL, requisition_id: reqId, material_name_snapshot: "CLORO", supplier_group_snapshot: "BRAVO", requested_qty: 10, approved_qty: 10, purchased_cost: 95, status: "aprobada", unit: "galón" }) })
    const fromReq = await api(u1.token, { action: "createInvoiceFromConsolidado", requisitionId: reqId, supplier: "BRAVO", userName: "FULL __TEST__" })
    const fromReqId = fromReq.body?.record?.id
    created.invoices.push(fromReqId)
    ok(fromReq.body?.ok && !!fromReqId, "14. Factura creada desde requisición (consolidado)")
    ok(fromReq.body?.record?.requisitionId === reqId, "14b. Factura mantiene referencia a la requisición")

    // 16) Soft delete (borrador)
    const draft = await api(u1.token, { action: "savePurchaseInvoice", branch: "Los Jardines", supplier: "BRAVO", status: "borrador", invoiceDate: "2026-07-08", userName: "FULL __TEST__", items: "[]" })
    const draftId = draft.body?.record?.id
    created.invoices.push(draftId)
    const del = await api(u1.token, { action: "deletePurchaseInvoice", id: draftId, reason: "test" })
    const listAfterDel = await api(u1.token, { action: "getPurchaseInvoices", month: "2026-07" })
    ok(del.body?.ok && !(listAfterDel.body?.records || []).some((r) => r.id === draftId), "16. Soft delete: borrador fuera de la lista activa")
    const dbDeleted = (await jf(`${SB}/rest/v1/purchase_invoices?id=eq.${draftId}&select=deleted_at`, { headers: svc })).body?.[0]
    ok(dbDeleted && dbDeleted.deleted_at, "16b. Soft delete: fila conservada con deleted_at (no borrado físico)")

    // 17) Permisos: U2 (solo ver) NO puede crear
    const denied = await api(u2.token, { action: "savePurchaseInvoice", branch: "Los Jardines", supplier: "X", status: "pendiente", items: "[]" })
    ok(denied.body?.ok === false && /permiso/i.test(String(denied.body?.error || "")), "17. RBAC: usuario sin compras.crear es rechazado (backend)")
    const canView = await api(u2.token, { action: "getPurchaseInvoices", month: "2026-07" })
    ok(canView.body?.ok, "17b. RBAC: usuario con compras.ver SÍ puede listar")

    // 18) business_id = CSL (aislamiento)
    const chk = (await jf(`${SB}/rest/v1/purchase_invoices?id=eq.${invId}&select=business_id,branch`, { headers: svc })).body?.[0]
    ok(chk?.business_id === CSL, "18. business_id = CSL (sin cruce Depicenter)")

    // Dashboard
    const dash = await api(u1.token, { action: "getPurchaseDashboard", month: "2026-07" })
    ok(dash.body?.ok && dash.body?.kpis, `Dashboard KPIs OK (compras mes=${dash.body?.kpis?.totalComprasMes}, pagado=${dash.body?.kpis?.totalPagadoMes})`)

    console.log("\n12-13. PDF/Excel: generación client-side (no testeable en Node) — cubierto en navegador.")
    console.log("19-20. Supabase local db-cls, NO Cloud: confirmado por la URL del host.")
  } catch (e) {
    ok(false, "excepción: " + e.message)
  } finally {
    // limpieza
    for (const id of created.invoices.filter(Boolean)) { await jf(`${SB}/rest/v1/purchase_payments?invoice_id=eq.${id}`, { method: "DELETE", headers: svc }); await jf(`${SB}/rest/v1/purchase_invoices?id=eq.${id}`, { method: "DELETE", headers: svc }) }
    for (const id of created.expenses.filter(Boolean)) await jf(`${SB}/rest/v1/expenses?id=eq.${id}`, { method: "DELETE", headers: svc })
    for (const id of created.petties.filter(Boolean)) await jf(`${SB}/rest/v1/petty_expenses?id=eq.${id}`, { method: "DELETE", headers: svc })
    for (const id of created.recurrings.filter(Boolean)) { await jf(`${SB}/rest/v1/recurring_payment_history?recurring_id=eq.${id}`, { method: "DELETE", headers: svc }); await jf(`${SB}/rest/v1/recurring_payments?id=eq.${id}`, { method: "DELETE", headers: svc }) }
    for (const id of created.reqs.filter(Boolean)) { await jf(`${SB}/rest/v1/material_requisition_items?requisition_id=eq.${id}`, { method: "DELETE", headers: svc }); await jf(`${SB}/rest/v1/material_requisitions?id=eq.${id}`, { method: "DELETE", headers: svc }) }
    await jf(`${SB}/rest/v1/purchase_audit_logs?business_id=eq.${CSL}&entity=in.(invoice,payment,expense,petty,recurring,recurring_payment)&user_id=in.(${created.users.filter(Boolean).join(",")})`, { method: "DELETE", headers: svc }).catch(() => {})
    for (const uid of created.users.filter(Boolean)) { await jf(`${SB}/rest/v1/csl_user_profiles?user_id=eq.${uid}`, { method: "DELETE", headers: svc }); await jf(`${SB}/auth/v1/admin/users/${uid}`, { method: "DELETE", headers: svc }) }
    console.log(pass ? "\n✅ TEST PASA" : "\n❌ TEST FALLA")
    process.exit(pass ? 0 : 1)
  }
})()

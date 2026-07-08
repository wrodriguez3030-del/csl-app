/**
 * Módulo COMPRAS — lógica de servidor (facturas de proveedores, pagos/gastos,
 * gastos menores, pagos recurrentes) + dashboard.
 *
 * Multi-tenant: toda lectura/escritura se scopea por business_id del
 * BusinessContext (service_role bypassa RLS; el aislamiento real lo dan estos
 * filtros + scopeByBranch por sucursal). RBAC granular con permisos compras.*
 * (admin/superadmin bypassa). Reutiliza proveedores (texto) y materiales
 * (material_catalog) — NO crea catálogos nuevos. Soft delete en todo.
 *
 * Contable (anti-doble-conteo): el balance de una factura sale SOLO de
 * purchase_payments. Los "pago de factura" del módulo Pagos/gastos se registran
 * como purchase_payments (no como expenses). expenses = gastos generales.
 * Una factura NUNCA aumenta inventario (eso es la recepción de la requisición).
 *
 * Server-only. NUNCA importar desde código cliente.
 */
import { getSupabaseAdmin } from "./supabase"
import {
  getBusinessContext, getBranchScope, scopeByBranch, requirePermission, hasPermission,
} from "./business-context"
import { normalizeSucursal, sucursalAllowedForTenant, sucursalesForTenant } from "@/lib/normalize-pulse"
import { textValue, numberValue, dateValue } from "./csl-helpers"
import type { ActionParams, ActionUser, Row } from "./csl-types"

// ── Tenant / permisos ────────────────────────────────────────────────────────
function bizId(): string | null {
  return getBusinessContext()?.businessId ?? null
}
function scoped(): boolean {
  const ctx = getBusinessContext()
  return Boolean(ctx && !ctx.bypassTenantFilter)
}
function requireBizId(): string {
  const id = bizId()
  if (!id) throw new Error("Selecciona un negocio activo para esta operación")
  return id
}
function isManager(): boolean {
  const ctx = getBusinessContext()
  return Boolean(ctx?.isAdmin || ctx?.isSuperadmin)
}
function userName(params: ActionParams): string | null {
  return textValue(params, "userName") || null
}

/** Valida la sucursal contra tenant + scope del usuario. Vacío permitido. */
function branchInScope(raw: string): string {
  const ctx = getBusinessContext()
  const slug = ctx?.businessSlug || "csl"
  const branch = normalizeSucursal(raw)
  if (!branch) return ""
  if (!sucursalAllowedForTenant(branch, slug)) throw new Error("Sucursal no pertenece a este negocio")
  const scope = getBranchScope()
  if (!scope.all && scope.branches.length && !scope.branches.includes(branch)) {
    throw new Error("No tienes permiso para operar esa sucursal")
  }
  return branch
}

// ── Auditoría (best-effort) ─────────────────────────────────────────────────
async function logAudit(
  user: ActionUser, entity: string, entityId: string | null, action: string,
  oldValues: unknown, newValues: unknown, reason?: string | null,
): Promise<void> {
  const business_id = bizId()
  if (!business_id) return
  try {
    await getSupabaseAdmin().from("purchase_audit_logs").insert({
      business_id, entity, entity_id: entityId, action,
      old_values: oldValues ?? null, new_values: newValues ?? null,
      reason: reason ?? null, user_id: user.id || null,
    })
  } catch { /* nunca rompe la operación principal */ }
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

// ── Mapeos DB → cliente ──────────────────────────────────────────────────────
function mapInvoice(r: Row) {
  return {
    id: r.id, branch: r.branch, invoiceNumber: r.invoice_number, ncf: r.ncf,
    supplier: r.supplier, supplierRnc: r.supplier_rnc,
    invoiceDate: r.invoice_date, dueDate: r.due_date,
    purchaseType: r.purchase_type, paymentMethod: r.payment_method, condition: r.condition,
    subtotal: Number(r.subtotal) || 0, discount: Number(r.discount) || 0,
    itbis: Number(r.itbis) || 0, total: Number(r.total) || 0,
    paidAmount: Number(r.paid_amount) || 0, balance: Number(r.balance) || 0,
    status: r.status, notes: r.notes, attachmentPath: r.attachment_path,
    requisitionId: r.requisition_id, createdByName: r.created_by_name ?? null,
    createdAt: r.created_at, deletedAt: r.deleted_at ?? null,
  }
}
function mapInvItem(r: Row) {
  return {
    id: r.id, invoiceId: r.invoice_id, materialId: r.material_id,
    materialName: r.material_name_snapshot, description: r.description,
    quantity: Number(r.quantity) || 0, unit: r.unit,
    unitCost: Number(r.unit_cost) || 0, itbis: Number(r.itbis) || 0, total: Number(r.total) || 0,
  }
}
function mapPayment(r: Row) {
  return {
    id: r.id, invoiceId: r.invoice_id, paymentDate: r.payment_date,
    amount: Number(r.amount) || 0, method: r.method, account: r.account,
    reference: r.reference, attachmentPath: r.attachment_path, notes: r.notes,
    createdByName: r.created_by_name ?? null, createdAt: r.created_at, deletedAt: r.deleted_at ?? null,
  }
}
function mapExpense(r: Row) {
  return {
    id: r.id, branch: r.branch, expenseDate: r.expense_date, kind: r.kind,
    category: r.category, payee: r.payee, concept: r.concept, method: r.method,
    account: r.account, amount: Number(r.amount) || 0, reference: r.reference,
    invoiceId: r.invoice_id, attachmentPath: r.attachment_path, notes: r.notes,
    status: r.status, createdByName: r.created_by_name ?? null, createdAt: r.created_at,
    deletedAt: r.deleted_at ?? null,
  }
}
function mapPetty(r: Row) {
  return {
    id: r.id, branch: r.branch, expenseDate: r.expense_date, responsible: r.responsible,
    category: r.category, concept: r.concept, amount: Number(r.amount) || 0,
    method: r.method, receiptNumber: r.receipt_number, attachmentPath: r.attachment_path,
    notes: r.notes, status: r.status, approvedByName: r.approved_by_name ?? null,
    approvedAt: r.approved_at, rejectedAt: r.rejected_at, rejectReason: r.reject_reason,
    paidAt: r.paid_at, createdByName: r.created_by_name ?? null, createdAt: r.created_at,
    deletedAt: r.deleted_at ?? null,
  }
}
function mapRecurring(r: Row) {
  return {
    id: r.id, branch: r.branch, name: r.name, payee: r.payee, category: r.category,
    frequency: r.frequency, amount: Number(r.amount) || 0, nextDate: r.next_date,
    paymentDay: r.payment_day, method: r.method, active: r.active !== false,
    reminderDays: r.reminder_days == null ? null : Number(r.reminder_days), notes: r.notes,
    createdByName: r.created_by_name ?? null, createdAt: r.created_at, deletedAt: r.deleted_at ?? null,
  }
}

// ── Fecha: avance según frecuencia ──────────────────────────────────────────
function advanceDate(iso: string, frequency: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (isNaN(d.getTime())) return iso
  switch (frequency) {
    case "semanal": d.setUTCDate(d.getUTCDate() + 7); break
    case "quincenal": d.setUTCDate(d.getUTCDate() + 15); break
    case "mensual": d.setUTCMonth(d.getUTCMonth() + 1); break
    case "trimestral": d.setUTCMonth(d.getUTCMonth() + 3); break
    case "semestral": d.setUTCMonth(d.getUTCMonth() + 6); break
    case "anual": d.setUTCFullYear(d.getUTCFullYear() + 1); break
    default: d.setUTCMonth(d.getUTCMonth() + 1)
  }
  return d.toISOString().slice(0, 10)
}

// ── Filtro por mes / rango de fechas (reutilizable) ─────────────────────────
/** [inicio, fin] del mes YYYY-MM, o null si no es un mes válido. */
function monthRange(month: string): [string, string] | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null
  const start = `${month}-01`
  const d = new Date(`${start}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + 1)
  d.setUTCDate(0)
  return [start, d.toISOString().slice(0, 10)]
}
function applyDateFilter<Q extends { gte(c: string, v: string): Q; lte(c: string, v: string): Q }>(
  q: Q, params: ActionParams, col: string,
): Q {
  const mr = monthRange(textValue(params, "month"))
  if (mr) return q.gte(col, mr[0]).lte(col, mr[1])
  let out = q
  const desde = dateValue(params.desde)
  const hasta = dateValue(params.hasta)
  if (desde) out = out.gte(col, desde)
  if (hasta) out = out.lte(col, hasta)
  return out
}

// ════════════════════════════════════════════════════════════════════════════
// PROVEEDORES (reutilización — texto libre, sin tabla nueva)
// ════════════════════════════════════════════════════════════════════════════
export async function getPurchaseSuppliers() {
  requirePermission("compras.ver")
  const sb = getSupabaseAdmin()
  const biz = bizId()
  const scope = scoped()
  const set = new Set<string>()
  const add = (v: unknown) => { const s = String(v || "").trim().toUpperCase(); if (s) set.add(s) }
  // material_catalog.supplier_group
  let cq = sb.from("material_catalog").select("supplier_group")
  if (scope) cq = cq.eq("business_id", biz as string)
  const { data: cats } = await cq
  for (const r of (cats || []) as Row[]) add(r.supplier_group)
  // purchase_invoices.supplier (ya capturados)
  let iq = sb.from("purchase_invoices").select("supplier").is("deleted_at", null)
  if (scope) iq = iq.eq("business_id", biz as string)
  const { data: invs } = await iq
  for (const r of (invs || []) as Row[]) add(r.supplier)
  return { ok: true, records: Array.from(set).sort() }
}

// ════════════════════════════════════════════════════════════════════════════
// FACTURAS DE PROVEEDORES
// ════════════════════════════════════════════════════════════════════════════
async function fetchInvoice(sb: ReturnType<typeof getSupabaseAdmin>, id: string): Promise<Row> {
  let q = sb.from("purchase_invoices").select("*").eq("id", id)
  if (scoped()) q = q.eq("business_id", bizId() as string)
  const { data, error } = await q.maybeSingle()
  if (error) throw error
  if (!data) throw new Error("Factura no encontrada o de otro negocio")
  return data as Row
}

/** Recalcula paid_amount, balance y status de una factura a partir de sus pagos vivos. */
async function recomputeInvoice(sb: ReturnType<typeof getSupabaseAdmin>, invoiceId: string): Promise<Row> {
  const { data: inv } = await sb.from("purchase_invoices").select("*").eq("id", invoiceId).maybeSingle()
  if (!inv) throw new Error("Factura no encontrada")
  const row = inv as Row
  const { data: pays } = await sb.from("purchase_payments").select("amount").eq("invoice_id", invoiceId).is("deleted_at", null)
  const paid = round2((pays || []).reduce((s, p) => s + (Number((p as Row).amount) || 0), 0))
  const total = round2(Number(row.total) || 0)
  const balance = round2(total - paid)
  let status = String(row.status)
  if (status !== "borrador" && status !== "anulada") {
    if (paid <= 0) {
      const overdue = row.due_date && String(row.due_date) < new Date().toISOString().slice(0, 10)
      status = overdue ? "vencida" : "pendiente"
    } else if (balance > 0.009) {
      status = "parcial"
    } else {
      status = "pagada"
    }
  }
  await sb.from("purchase_invoices").update({ paid_amount: paid, balance, status, updated_at: new Date().toISOString() }).eq("id", invoiceId)
  return { ...row, paid_amount: paid, balance, status } as Row
}

type IncomingInvItem = {
  materialId?: string; materialName?: string; description?: string
  quantity?: number | string; unit?: string; unitCost?: number | string; itbis?: number | string
}

export async function savePurchaseInvoice(params: ActionParams, user: ActionUser) {
  const id = textValue(params, "id")
  requirePermission(id ? "compras.editar" : "compras.crear")
  const business_id = requireBizId()
  const branch = branchInScope(textValue(params, "branch"))
  const sb = getSupabaseAdmin()

  if (id) {
    const existing = await fetchInvoice(sb, id)
    if (existing.deleted_at) throw new Error("Factura eliminada")
    if (existing.status === "anulada") throw new Error("La factura está anulada y no se puede editar")
  }

  let items: IncomingInvItem[] = []
  try { items = JSON.parse(textValue(params, "items") || "[]") } catch { throw new Error("Detalle inválido") }
  const clean = items
    .filter((it) => it && (it.materialName || it.description))
    .map((it) => {
      const qty = round2(Number(it.quantity) || 0)
      const cost = round2(Number(it.unitCost) || 0)
      const itbis = round2(Number(it.itbis) || 0)
      return {
        material_id: it.materialId || null,
        material_name_snapshot: it.materialName ? String(it.materialName).toUpperCase() : null,
        description: it.description || null,
        quantity: qty, unit: it.unit || "unidad", unit_cost: cost, itbis,
        total: round2(qty * cost + itbis),
      }
    })

  // Totales: si el cliente manda subtotal/itbis/total, respetarlos; si no, derivar del detalle.
  const detSub = round2(clean.reduce((s, it) => s + it.quantity * it.unit_cost, 0))
  const detItbis = round2(clean.reduce((s, it) => s + it.itbis, 0))
  const subtotal = params.subtotal !== undefined ? round2(numberValue(params, "subtotal", 0)) : detSub
  const discount = round2(numberValue(params, "discount", 0))
  const itbis = params.itbis !== undefined ? round2(numberValue(params, "itbis", 0)) : detItbis
  const total = params.total !== undefined ? round2(numberValue(params, "total", 0)) : round2(subtotal - discount + itbis)

  const status = textValue(params, "status") || "pendiente"
  const now = new Date().toISOString()
  const row: Row = {
    business_id, branch,
    invoice_number: textValue(params, "invoiceNumber") || null,
    ncf: textValue(params, "ncf") || null,
    supplier: (textValue(params, "supplier") || "").toUpperCase() || null,
    supplier_rnc: textValue(params, "supplierRnc") || null,
    invoice_date: dateValue(params.invoiceDate),
    due_date: dateValue(params.dueDate),
    purchase_type: textValue(params, "purchaseType") || null,
    payment_method: textValue(params, "paymentMethod") || null,
    condition: textValue(params, "condition") === "credito" ? "credito" : "contado",
    subtotal, discount, itbis, total,
    status: ["borrador", "pendiente", "parcial", "pagada", "vencida", "anulada"].includes(status) ? status : "pendiente",
    notes: textValue(params, "notes") || null,
    attachment_path: textValue(params, "attachmentPath") || null,
    requisition_id: textValue(params, "requisitionId") || null,
    updated_by: user.id || null, updated_at: now,
  }
  if (id) row.id = id
  else { row.created_by = user.id || null; row.created_by_name = userName(params) }

  const { data: saved, error } = await sb.from("purchase_invoices").upsert(row, { onConflict: "id" }).select().single()
  if (error) throw error
  const invoiceId = (saved as Row).id as string

  // Reemplazar detalle
  await sb.from("purchase_invoice_items").delete().eq("invoice_id", invoiceId).eq("business_id", business_id)
  if (clean.length) {
    await sb.from("purchase_invoice_items").insert(clean.map((it) => ({ business_id, invoice_id: invoiceId, ...it })))
  }
  const fresh = await recomputeInvoice(sb, invoiceId)
  await logAudit(user, "invoice", invoiceId, id ? "invoice_updated" : "invoice_created", null, { total, items: clean.length })
  return { ok: true, record: { ...mapInvoice(fresh), itemsCount: clean.length } }
}

export async function getPurchaseInvoices(params: ActionParams) {
  requirePermission("compras.ver")
  const sb = getSupabaseAdmin()
  let q = sb.from("purchase_invoices").select("*").order("invoice_date", { ascending: false }).order("created_at", { ascending: false })
  if (scoped()) q = q.eq("business_id", bizId() as string)
  const onlyDeleted = textValue(params, "deleted") === "1" && isManager()
  q = onlyDeleted ? q.not("deleted_at", "is", null) : q.is("deleted_at", null)
  const status = textValue(params, "status")
  if (status && status !== "todos") q = q.eq("status", status)
  const branch = normalizeSucursal(textValue(params, "branch"))
  if (branch) q = q.eq("branch", branch)
  const supplier = textValue(params, "supplier")
  if (supplier && supplier !== "todos") q = q.ilike("supplier", supplier)
  q = applyDateFilter(q, params, "invoice_date")
  const { data, error } = await q
  if (error) throw error
  const invs = scopeByBranch((data || []) as Row[], (r) => r.branch)
  return { ok: true, records: invs.map((r) => mapInvoice(r)) }
}

export async function getPurchaseInvoice(params: ActionParams) {
  requirePermission("compras.ver")
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const sb = getSupabaseAdmin()
  const inv = await fetchInvoice(sb, id)
  const { data: items } = await sb.from("purchase_invoice_items").select("*").eq("invoice_id", id)
  const { data: pays } = await sb.from("purchase_payments").select("*").eq("invoice_id", id).is("deleted_at", null).order("payment_date", { ascending: false })
  return { ok: true, record: { ...mapInvoice(inv), items: (items || []).map(mapInvItem), payments: (pays || []).map(mapPayment) } }
}

export async function voidPurchaseInvoice(params: ActionParams, user: ActionUser) {
  requirePermission("compras.anular")
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const sb = getSupabaseAdmin()
  const inv = await fetchInvoice(sb, id)
  if (inv.deleted_at) throw new Error("Factura eliminada")
  await sb.from("purchase_invoices").update({ status: "anulada", updated_at: new Date().toISOString(), updated_by: user.id || null }).eq("id", id)
  await logAudit(user, "invoice", id, "invoice_voided", { status: inv.status }, { status: "anulada" }, textValue(params, "reason") || null)
  return { ok: true }
}

export async function deletePurchaseInvoice(params: ActionParams, user: ActionUser) {
  requirePermission("compras.eliminar")
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const sb = getSupabaseAdmin()
  const inv = await fetchInvoice(sb, id)
  if (inv.deleted_at) return { ok: true }
  const canDelete = isManager() || (inv.status === "borrador" && String(inv.created_by) === String(user.id))
  if (!canDelete) throw new Error("Solo se puede eliminar un borrador propio (o admin).")
  await sb.from("purchase_invoices").update({
    deleted_at: new Date().toISOString(), deleted_by: user.id || null,
    deleted_reason: textValue(params, "reason") || null, updated_at: new Date().toISOString(),
  }).eq("id", id)
  await logAudit(user, "invoice", id, "invoice_deleted", { status: inv.status }, null, textValue(params, "reason") || null)
  return { ok: true }
}

/** Registra un pago aplicado a una factura → recalcula balance/estado. */
export async function registerInvoicePayment(params: ActionParams, user: ActionUser) {
  requirePermission("compras.pagar")
  const invoiceId = textValue(params, "invoiceId")
  if (!invoiceId) throw new Error("Falta la factura")
  const amount = round2(numberValue(params, "amount", 0))
  if (amount <= 0) throw new Error("El monto del pago debe ser mayor que 0")
  const business_id = requireBizId()
  const sb = getSupabaseAdmin()
  const inv = await fetchInvoice(sb, invoiceId)
  if (inv.deleted_at || inv.status === "anulada") throw new Error("La factura no admite pagos")
  const now = new Date().toISOString()
  const { data: pay, error } = await sb.from("purchase_payments").insert({
    business_id, branch: inv.branch, invoice_id: invoiceId,
    expense_id: textValue(params, "expenseId") || null,
    payment_date: dateValue(params.paymentDate) || now.slice(0, 10),
    amount, method: textValue(params, "method") || null, account: textValue(params, "account") || null,
    reference: textValue(params, "reference") || null, attachment_path: textValue(params, "attachmentPath") || null,
    notes: textValue(params, "notes") || null, created_by: user.id || null, created_by_name: userName(params),
  }).select().single()
  if (error) throw error
  const fresh = await recomputeInvoice(sb, invoiceId)
  await logAudit(user, "payment", (pay as Row).id as string, "payment_registered", null, { invoiceId, amount })
  return { ok: true, record: mapInvoice(fresh) }
}

export async function getInvoicePayments(params: ActionParams) {
  requirePermission("compras.ver")
  const invoiceId = textValue(params, "invoiceId")
  if (!invoiceId) throw new Error("Falta la factura")
  const sb = getSupabaseAdmin()
  await fetchInvoice(sb, invoiceId)
  const { data } = await sb.from("purchase_payments").select("*").eq("invoice_id", invoiceId).is("deleted_at", null).order("payment_date", { ascending: false })
  return { ok: true, records: (data || []).map(mapPayment) }
}

export async function deleteInvoicePayment(params: ActionParams, user: ActionUser) {
  requirePermission("compras.anular")
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const sb = getSupabaseAdmin()
  let pq = sb.from("purchase_payments").select("*").eq("id", id)
  if (scoped()) pq = pq.eq("business_id", bizId() as string)
  const { data: pay } = await pq.maybeSingle()
  if (!pay) throw new Error("Pago no encontrado o de otro negocio")
  await sb.from("purchase_payments").update({ deleted_at: new Date().toISOString(), deleted_by: user.id || null, updated_at: new Date().toISOString() }).eq("id", id)
  const invId = (pay as Row).invoice_id as string
  if (invId) await recomputeInvoice(sb, invId)
  await logAudit(user, "payment", id, "payment_deleted", { amount: (pay as Row).amount }, null)
  return { ok: true }
}

/**
 * Integración: crea una factura BORRADOR a partir del consolidado de una
 * requisición (proveedor + materiales aprobados de una sucursal). Reutiliza
 * proveedor y materiales; guarda ref a la requisición. NO afecta inventario.
 */
export async function createInvoiceFromConsolidado(params: ActionParams, user: ActionUser) {
  requirePermission("compras.crear")
  const business_id = requireBizId()
  const requisitionId = textValue(params, "requisitionId")
  if (!requisitionId) throw new Error("Falta la requisición")
  const supplier = (textValue(params, "supplier") || "").toUpperCase()
  const sb = getSupabaseAdmin()
  // Cargar la requisición (scopeada) + sus ítems del proveedor pedido.
  let rq = sb.from("material_requisitions").select("*").eq("id", requisitionId)
  if (scoped()) rq = rq.eq("business_id", business_id)
  const { data: req } = await rq.maybeSingle()
  if (!req) throw new Error("Requisición no encontrada o de otro negocio")
  const branch = branchInScope(String((req as Row).branch || ""))
  let itq = sb.from("material_requisition_items").select("*").eq("requisition_id", requisitionId).neq("status", "rechazada")
  if (supplier) itq = itq.ilike("supplier_group_snapshot", supplier)
  const { data: reqItems } = await itq
  const items = (reqItems || []) as Row[]
  if (!items.length) throw new Error("No hay materiales aprobados para ese proveedor en la requisición")

  const now = new Date().toISOString()
  const { data: inv, error } = await sb.from("purchase_invoices").insert({
    business_id, branch, supplier: supplier || null, condition: "credito",
    invoice_date: now.slice(0, 10), status: "borrador",
    requisition_id: requisitionId, subtotal: 0, itbis: 0, discount: 0, total: 0,
    notes: `Generada desde requisición ${requisitionId.slice(0, 8)}`,
    created_by: user.id || null, created_by_name: userName(params), updated_at: now,
  }).select().single()
  if (error) throw error
  const invoiceId = (inv as Row).id as string
  const detail = items.map((it) => {
    const qty = round2(Number(it.approved_qty ?? it.requested_qty) || 0)
    const cost = round2(Number(it.purchased_cost) || 0)
    return {
      business_id, invoice_id: invoiceId, material_id: it.material_id,
      material_name_snapshot: it.material_name_snapshot, description: null,
      quantity: qty, unit: it.unit || "unidad", unit_cost: cost, itbis: 0, total: round2(qty * cost),
    }
  })
  await sb.from("purchase_invoice_items").insert(detail)
  const subtotal = round2(detail.reduce((s, it) => s + it.total, 0))
  await sb.from("purchase_invoices").update({ subtotal, total: subtotal, balance: subtotal }).eq("id", invoiceId)
  const fresh = await recomputeInvoice(sb, invoiceId)
  await logAudit(user, "invoice", invoiceId, "invoice_from_consolidado", null, { requisitionId, supplier, items: detail.length })
  return { ok: true, record: { ...mapInvoice(fresh), itemsCount: detail.length } }
}

// ════════════════════════════════════════════════════════════════════════════
// PAGOS / GASTOS GENERALES (no ligados a factura)
// ════════════════════════════════════════════════════════════════════════════
export async function saveExpense(params: ActionParams, user: ActionUser) {
  const id = textValue(params, "id")
  requirePermission(id ? "compras.editar" : "compras.crear")
  const business_id = requireBizId()
  const branch = branchInScope(textValue(params, "branch"))
  const kind = textValue(params, "kind") || "gasto_operativo"
  const amount = round2(numberValue(params, "amount", 0))
  const invoiceId = textValue(params, "invoiceId") || null

  // Pago de factura → va al ledger de pagos (anti-doble-conteo), NO crea expense.
  if (kind === "pago_factura" && invoiceId && !id) {
    return await registerInvoicePayment({
      ...params, invoiceId, amount: String(amount),
      paymentDate: params.expenseDate, method: params.method,
    } as ActionParams, user)
  }

  if (amount <= 0) throw new Error("El monto debe ser mayor que 0")
  const now = new Date().toISOString()
  const sb = getSupabaseAdmin()
  const row: Row = {
    business_id, branch, expense_date: dateValue(params.expenseDate) || now.slice(0, 10),
    kind: ["gasto_operativo", "servicio", "otro"].includes(kind) ? kind : "gasto_operativo",
    category: textValue(params, "category") || null, payee: textValue(params, "payee") || null,
    concept: textValue(params, "concept") || null, method: textValue(params, "method") || null,
    account: textValue(params, "account") || null, amount, reference: textValue(params, "reference") || null,
    invoice_id: invoiceId, attachment_path: textValue(params, "attachmentPath") || null,
    notes: textValue(params, "notes") || null, status: textValue(params, "status") || "registrado",
    updated_by: user.id || null, updated_at: now,
  }
  if (id) row.id = id
  else { row.created_by = user.id || null; row.created_by_name = userName(params) }
  const { data, error } = await sb.from("expenses").upsert(row, { onConflict: "id" }).select().single()
  if (error) throw error
  await logAudit(user, "expense", (data as Row).id as string, id ? "expense_updated" : "expense_created", null, { amount, kind })
  return { ok: true, record: mapExpense(data as Row) }
}

export async function getExpenses(params: ActionParams) {
  requirePermission("compras.ver")
  const sb = getSupabaseAdmin()
  let q = sb.from("expenses").select("*").order("expense_date", { ascending: false }).order("created_at", { ascending: false })
  if (scoped()) q = q.eq("business_id", bizId() as string)
  const onlyDeleted = textValue(params, "deleted") === "1" && isManager()
  q = onlyDeleted ? q.not("deleted_at", "is", null) : q.is("deleted_at", null)
  const kind = textValue(params, "kind"); if (kind && kind !== "todos") q = q.eq("kind", kind)
  const status = textValue(params, "status"); if (status && status !== "todos") q = q.eq("status", status)
  const branch = normalizeSucursal(textValue(params, "branch")); if (branch) q = q.eq("branch", branch)
  const category = textValue(params, "category"); if (category && category !== "todas") q = q.eq("category", category)
  q = applyDateFilter(q, params, "expense_date")
  const { data, error } = await q
  if (error) throw error
  const rows = scopeByBranch((data || []) as Row[], (r) => r.branch)
  return { ok: true, records: rows.map(mapExpense) }
}

export async function voidExpense(params: ActionParams, user: ActionUser) {
  requirePermission("compras.anular")
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const sb = getSupabaseAdmin()
  let q = sb.from("expenses").update({ status: "anulado", updated_at: new Date().toISOString() }).eq("id", id)
  if (scoped()) q = q.eq("business_id", bizId() as string)
  const { data, error } = await q.select()
  if (error) throw error
  if (!data?.length) throw new Error("Gasto no encontrado")
  await logAudit(user, "expense", id, "expense_voided", null, null)
  return { ok: true }
}

export async function deleteExpense(params: ActionParams, user: ActionUser) {
  requirePermission("compras.eliminar")
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const sb = getSupabaseAdmin()
  let q = sb.from("expenses").update({
    deleted_at: new Date().toISOString(), deleted_by: user.id || null,
    deleted_reason: textValue(params, "reason") || null, updated_at: new Date().toISOString(),
  }).eq("id", id).is("deleted_at", null)
  if (scoped()) q = q.eq("business_id", bizId() as string)
  const { data, error } = await q.select()
  if (error) throw error
  if (!data?.length) throw new Error("Gasto no encontrado o ya eliminado")
  await logAudit(user, "expense", id, "expense_deleted", null, null, textValue(params, "reason") || null)
  return { ok: true }
}

// ════════════════════════════════════════════════════════════════════════════
// GASTOS MENORES (caja chica)
// ════════════════════════════════════════════════════════════════════════════
async function fetchPetty(sb: ReturnType<typeof getSupabaseAdmin>, id: string): Promise<Row> {
  let q = sb.from("petty_expenses").select("*").eq("id", id)
  if (scoped()) q = q.eq("business_id", bizId() as string)
  const { data, error } = await q.maybeSingle()
  if (error) throw error
  if (!data) throw new Error("Gasto menor no encontrado o de otro negocio")
  return data as Row
}

export async function savePettyExpense(params: ActionParams, user: ActionUser) {
  const id = textValue(params, "id")
  requirePermission(id ? "compras.editar" : "compras.crear")
  const business_id = requireBizId()
  const branch = branchInScope(textValue(params, "branch"))
  const amount = round2(numberValue(params, "amount", 0))
  if (amount <= 0) throw new Error("El monto debe ser mayor que 0")
  const now = new Date().toISOString()
  const sb = getSupabaseAdmin()
  if (id) {
    const ex = await fetchPetty(sb, id)
    if (ex.deleted_at) throw new Error("Gasto eliminado")
  }
  const row: Row = {
    business_id, branch, expense_date: dateValue(params.expenseDate) || now.slice(0, 10),
    responsible: textValue(params, "responsible") || userName(params), category: textValue(params, "category") || null,
    concept: textValue(params, "concept") || null, amount, method: textValue(params, "method") || null,
    receipt_number: textValue(params, "receiptNumber") || null, attachment_path: textValue(params, "attachmentPath") || null,
    notes: textValue(params, "notes") || null, updated_by: user.id || null, updated_at: now,
  }
  if (id) row.id = id
  else { row.created_by = user.id || null; row.created_by_name = userName(params); row.status = "pendiente" }
  const { data, error } = await sb.from("petty_expenses").upsert(row, { onConflict: "id" }).select().single()
  if (error) throw error
  await logAudit(user, "petty", (data as Row).id as string, id ? "petty_updated" : "petty_created", null, { amount })
  return { ok: true, record: mapPetty(data as Row) }
}

export async function getPettyExpenses(params: ActionParams) {
  requirePermission("compras.ver")
  const sb = getSupabaseAdmin()
  let q = sb.from("petty_expenses").select("*").order("expense_date", { ascending: false }).order("created_at", { ascending: false })
  if (scoped()) q = q.eq("business_id", bizId() as string)
  const onlyDeleted = textValue(params, "deleted") === "1" && isManager()
  q = onlyDeleted ? q.not("deleted_at", "is", null) : q.is("deleted_at", null)
  const status = textValue(params, "status"); if (status && status !== "todos") q = q.eq("status", status)
  const branch = normalizeSucursal(textValue(params, "branch")); if (branch) q = q.eq("branch", branch)
  const category = textValue(params, "category"); if (category && category !== "todas") q = q.eq("category", category)
  const responsible = textValue(params, "responsible"); if (responsible && responsible !== "todos") q = q.eq("responsible", responsible)
  q = applyDateFilter(q, params, "expense_date")
  const { data, error } = await q
  if (error) throw error
  const rows = scopeByBranch((data || []) as Row[], (r) => r.branch)
  return { ok: true, records: rows.map(mapPetty) }
}

export async function setPettyStatus(params: ActionParams, user: ActionUser) {
  const id = textValue(params, "id")
  const status = textValue(params, "status")
  if (!id || !["aprobado", "rechazado", "pagado", "pendiente"].includes(status)) throw new Error("Estado inválido")
  requirePermission(status === "pagado" ? "compras.pagar" : "compras.aprobar")
  const sb = getSupabaseAdmin()
  const ex = await fetchPetty(sb, id)
  const now = new Date().toISOString()
  const fields: Row = { status, updated_at: now, updated_by: user.id || null }
  if (status === "aprobado") { fields.approved_by = user.id || null; fields.approved_by_name = userName(params); fields.approved_at = now }
  if (status === "rechazado") { fields.rejected_by = user.id || null; fields.rejected_at = now; fields.reject_reason = textValue(params, "reason") || null }
  if (status === "pagado") { fields.paid_by = user.id || null; fields.paid_at = now }
  await sb.from("petty_expenses").update(fields).eq("id", id)
  await logAudit(user, "petty", id, `petty_${status}`, { status: ex.status }, { status }, textValue(params, "reason") || null)
  return { ok: true }
}

export async function deletePettyExpense(params: ActionParams, user: ActionUser) {
  requirePermission("compras.eliminar")
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const sb = getSupabaseAdmin()
  const ex = await fetchPetty(sb, id)
  if (ex.deleted_at) return { ok: true }
  const canDelete = isManager() || (ex.status === "pendiente" && String(ex.created_by) === String(user.id))
  if (!canDelete) throw new Error("Solo se puede eliminar un gasto menor pendiente propio (o admin).")
  await sb.from("petty_expenses").update({
    deleted_at: new Date().toISOString(), deleted_by: user.id || null,
    deleted_reason: textValue(params, "reason") || null, updated_at: new Date().toISOString(),
  }).eq("id", id)
  await logAudit(user, "petty", id, "petty_deleted", { status: ex.status }, null)
  return { ok: true }
}

// ════════════════════════════════════════════════════════════════════════════
// PAGOS RECURRENTES
// ════════════════════════════════════════════════════════════════════════════
async function fetchRecurring(sb: ReturnType<typeof getSupabaseAdmin>, id: string): Promise<Row> {
  let q = sb.from("recurring_payments").select("*").eq("id", id)
  if (scoped()) q = q.eq("business_id", bizId() as string)
  const { data, error } = await q.maybeSingle()
  if (error) throw error
  if (!data) throw new Error("Pago recurrente no encontrado o de otro negocio")
  return data as Row
}

const FREQS = ["semanal", "quincenal", "mensual", "trimestral", "semestral", "anual"]

export async function saveRecurringPayment(params: ActionParams, user: ActionUser) {
  const id = textValue(params, "id")
  requirePermission(id ? "compras.editar" : "compras.crear")
  const business_id = requireBizId()
  const branch = branchInScope(textValue(params, "branch"))
  const name = textValue(params, "name").trim()
  if (!name) throw new Error("El nombre es obligatorio")
  const frequency = textValue(params, "frequency") || "mensual"
  const now = new Date().toISOString()
  const sb = getSupabaseAdmin()
  const row: Row = {
    business_id, branch, name, payee: textValue(params, "payee") || null,
    category: textValue(params, "category") || null,
    frequency: FREQS.includes(frequency) ? frequency : "mensual",
    amount: round2(numberValue(params, "amount", 0)),
    next_date: dateValue(params.nextDate),
    payment_day: params.paymentDay !== undefined && String(params.paymentDay).trim() !== "" ? Math.min(31, Math.max(1, numberValue(params, "paymentDay", 1))) : null,
    method: textValue(params, "method") || null,
    active: textValue(params, "active") === "false" ? false : true,
    reminder_days: params.reminderDays !== undefined ? numberValue(params, "reminderDays", 3) : 3,
    notes: textValue(params, "notes") || null, updated_by: user.id || null, updated_at: now,
  }
  if (id) row.id = id
  else { row.created_by = user.id || null; row.created_by_name = userName(params) }
  const { data, error } = await sb.from("recurring_payments").upsert(row, { onConflict: "id" }).select().single()
  if (error) throw error
  await logAudit(user, "recurring", (data as Row).id as string, id ? "recurring_updated" : "recurring_created", null, { name })
  return { ok: true, record: mapRecurring(data as Row) }
}

export async function getRecurringPayments(params: ActionParams) {
  requirePermission("compras.ver")
  const sb = getSupabaseAdmin()
  let q = sb.from("recurring_payments").select("*").order("next_date", { ascending: true })
  if (scoped()) q = q.eq("business_id", bizId() as string)
  q = q.is("deleted_at", null)
  const active = textValue(params, "active")
  if (active === "1") q = q.eq("active", true)
  else if (active === "0") q = q.eq("active", false)
  const branch = normalizeSucursal(textValue(params, "branch")); if (branch) q = q.eq("branch", branch)
  const { data, error } = await q
  if (error) throw error
  const rows = scopeByBranch((data || []) as Row[], (r) => r.branch)
  const today = new Date().toISOString().slice(0, 10)
  return {
    ok: true,
    records: rows.map((r) => {
      const m = mapRecurring(r)
      const overdue = Boolean(m.active && m.nextDate && String(m.nextDate) < today)
      return { ...m, overdue }
    }),
  }
}

export async function setRecurringActive(params: ActionParams, user: ActionUser) {
  requirePermission("compras.editar")
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const active = textValue(params, "active") !== "false"
  const sb = getSupabaseAdmin()
  await fetchRecurring(sb, id)
  await sb.from("recurring_payments").update({ active, updated_at: new Date().toISOString() }).eq("id", id)
  await logAudit(user, "recurring", id, active ? "recurring_reactivated" : "recurring_paused", null, { active })
  return { ok: true }
}

export async function deleteRecurringPayment(params: ActionParams, user: ActionUser) {
  requirePermission("compras.eliminar")
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const sb = getSupabaseAdmin()
  const rec = await fetchRecurring(sb, id)
  if (rec.deleted_at) return { ok: true }
  await sb.from("recurring_payments").update({
    deleted_at: new Date().toISOString(), deleted_by: user.id || null,
    deleted_reason: textValue(params, "reason") || null, updated_at: new Date().toISOString(),
  }).eq("id", id)
  await logAudit(user, "recurring", id, "recurring_deleted", null, null)
  return { ok: true }
}

/** Registra un pago del recurrente → historial + avanza next_date. */
export async function registerRecurringPayment(params: ActionParams, user: ActionUser) {
  requirePermission("compras.pagar")
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const business_id = requireBizId()
  const sb = getSupabaseAdmin()
  const rec = await fetchRecurring(sb, id)
  const paidDate = dateValue(params.paidDate) || new Date().toISOString().slice(0, 10)
  const amount = params.amount !== undefined ? round2(numberValue(params, "amount", 0)) : round2(Number(rec.amount) || 0)
  const period = String(rec.next_date || paidDate).slice(0, 7)
  // Anti-duplicado: no registrar dos veces el mismo período.
  const { data: dup } = await sb.from("recurring_payment_history").select("id").eq("recurring_id", id).eq("period_label", period).maybeSingle()
  if (dup) throw new Error(`Ya se registró el pago del período ${period}`)
  await sb.from("recurring_payment_history").insert({
    business_id, recurring_id: id, paid_date: paidDate, period_label: period, amount,
    method: textValue(params, "method") || rec.method || null, reference: textValue(params, "reference") || null,
    attachment_path: textValue(params, "attachmentPath") || null, notes: textValue(params, "notes") || null,
    created_by: user.id || null, created_by_name: userName(params),
  })
  const base = String(rec.next_date || paidDate).slice(0, 10)
  const nextDate = advanceDate(base, String(rec.frequency))
  await sb.from("recurring_payments").update({ next_date: nextDate, updated_at: new Date().toISOString() }).eq("id", id)
  await logAudit(user, "recurring_payment", id, "recurring_paid", { next_date: rec.next_date }, { next_date: nextDate, amount, period })
  return { ok: true, record: { ...mapRecurring({ ...rec, next_date: nextDate } as Row), nextDate } }
}

export async function getRecurringHistory(params: ActionParams) {
  requirePermission("compras.ver")
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const sb = getSupabaseAdmin()
  await fetchRecurring(sb, id)
  const { data } = await sb.from("recurring_payment_history").select("*").eq("recurring_id", id).order("paid_date", { ascending: false })
  return {
    ok: true,
    records: (data || []).map((r: Row) => ({
      id: r.id, paidDate: r.paid_date, periodLabel: r.period_label, amount: Number(r.amount) || 0,
      method: r.method, reference: r.reference, notes: r.notes, createdByName: r.created_by_name ?? null, createdAt: r.created_at,
    })),
  }
}

// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD DE COMPRAS
// ════════════════════════════════════════════════════════════════════════════
export async function getPurchaseDashboard(params: ActionParams) {
  requirePermission("compras.ver")
  const sb = getSupabaseAdmin()
  const biz = bizId(); const scope = scoped()
  const today = new Date().toISOString().slice(0, 10)
  const month = (textValue(params, "month") && /^\d{4}-\d{2}$/.test(textValue(params, "month"))) ? textValue(params, "month") : today.slice(0, 7)
  const mStart = `${month}-01`
  const md = new Date(`${mStart}T00:00:00Z`); md.setUTCMonth(md.getUTCMonth() + 1); md.setUTCDate(0)
  const mEnd = md.toISOString().slice(0, 10)
  const branch = normalizeSucursal(textValue(params, "branch"))

  // Facturas
  let invQ = sb.from("purchase_invoices").select("*").is("deleted_at", null).neq("status", "anulada")
  if (scope) invQ = invQ.eq("business_id", biz as string)
  if (branch) invQ = invQ.eq("branch", branch)
  const { data: invAll } = await invQ
  const invs = scopeByBranch((invAll || []) as Row[], (r) => r.branch)
  const invMonth = invs.filter((r) => String(r.invoice_date || "") >= mStart && String(r.invoice_date || "") <= mEnd)
  const totalComprasMes = round2(invMonth.reduce((s, r) => s + (Number(r.total) || 0), 0))
  const balancePendiente = round2(invs.reduce((s, r) => s + (Number(r.balance) || 0), 0))
  const facturasVencidas = invs.filter((r) => Number(r.balance) > 0.009 && String(r.due_date || "") && String(r.due_date) < today && r.status !== "pagada").length

  // Pagos del mes (ledger de facturas)
  let payQ = sb.from("purchase_payments").select("amount, payment_date, branch").is("deleted_at", null).gte("payment_date", mStart).lte("payment_date", mEnd)
  if (scope) payQ = payQ.eq("business_id", biz as string)
  if (branch) payQ = payQ.eq("branch", branch)
  const { data: pays } = await payQ
  const totalPagadoMes = round2(scopeByBranch((pays || []) as Row[], (r) => r.branch).reduce((s, r) => s + (Number(r.amount) || 0), 0))

  // Gastos generales del mes
  let expQ = sb.from("expenses").select("amount, expense_date, branch, status").is("deleted_at", null).neq("status", "anulado").gte("expense_date", mStart).lte("expense_date", mEnd)
  if (scope) expQ = expQ.eq("business_id", biz as string)
  if (branch) expQ = expQ.eq("branch", branch)
  const { data: exps } = await expQ
  const gastosGeneralesMes = round2(scopeByBranch((exps || []) as Row[], (r) => r.branch).reduce((s, r) => s + (Number(r.amount) || 0), 0))

  // Gastos menores del mes (aprobados/pagados)
  let pettyQ = sb.from("petty_expenses").select("amount, expense_date, branch, status").is("deleted_at", null).gte("expense_date", mStart).lte("expense_date", mEnd)
  if (scope) pettyQ = pettyQ.eq("business_id", biz as string)
  if (branch) pettyQ = pettyQ.eq("branch", branch)
  const { data: petties } = await pettyQ
  const pettyRows = scopeByBranch((petties || []) as Row[], (r) => r.branch)
  const gastosMenoresMes = round2(pettyRows.filter((r) => ["aprobado", "pagado"].includes(String(r.status))).reduce((s, r) => s + (Number(r.amount) || 0), 0))
  const pettyPendientes = pettyRows.filter((r) => r.status === "pendiente").length

  // Recurrentes próximos (7 días) + vencidos
  const in7 = new Date(`${today}T00:00:00Z`); in7.setUTCDate(in7.getUTCDate() + 7)
  const in7s = in7.toISOString().slice(0, 10)
  let recQ = sb.from("recurring_payments").select("*").is("deleted_at", null).eq("active", true)
  if (scope) recQ = recQ.eq("business_id", biz as string)
  if (branch) recQ = recQ.eq("branch", branch)
  const { data: recs } = await recQ
  const recRows = scopeByBranch((recs || []) as Row[], (r) => r.branch)
  const recurrentesProximos = recRows.filter((r) => String(r.next_date || "") && String(r.next_date) <= in7s).length
  const recurrentesVencidos = recRows.filter((r) => String(r.next_date || "") && String(r.next_date) < today).length

  return {
    ok: true,
    month,
    kpis: {
      totalComprasMes, totalPagadoMes, balancePendiente, facturasVencidas,
      gastosGeneralesMes, gastosMenoresMes, pettyPendientes,
      recurrentesProximos, recurrentesVencidos,
    },
  }
}

// ── Sucursales disponibles (reutiliza el allow-list del tenant) ─────────────
export function getPurchaseBranches() {
  const ctx = getBusinessContext()
  const slug = ctx?.businessSlug || "csl"
  const all = sucursalesForTenant(slug)
  const scope = getBranchScope()
  const branches = scope.all || !scope.branches.length ? all : all.filter((b) => scope.branches.includes(b))
  return { ok: true, records: branches }
}

// ── URL firmada del adjunto (bucket purchase-docs) ──────────────────────────
export async function getPurchaseAttachmentUrl(params: ActionParams) {
  requirePermission("compras.ver")
  const path = textValue(params, "path")
  if (!path) throw new Error("Falta el archivo")
  // El path empieza con el business_id → validación de tenant.
  if (scoped() && !path.startsWith(`${bizId()}/`)) throw new Error("Archivo de otro negocio")
  const sb = getSupabaseAdmin()
  const download = textValue(params, "download") === "true"
  const opts = download ? { download: path.split("/").pop() || "comprobante" } : undefined
  const { data, error } = await sb.storage.from("purchase-docs").createSignedUrl(path, 120, opts)
  if (error || !data?.signedUrl) throw new Error(`No se pudo generar el enlace: ${error?.message || "desconocido"}`)
  if (!hasPermission("compras.exportar") && download) { /* ver permitido; descargar no exige extra */ }
  return { ok: true, url: data.signedUrl }
}

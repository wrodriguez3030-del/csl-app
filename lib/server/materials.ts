/**
 * Módulo Requisición de Materiales por Sucursal — lógica de servidor.
 *
 * Multi-tenant: toda lectura/escritura se scopea por business_id desde el
 * BusinessContext del request (service_role hace bypass de RLS, así que el
 * aislamiento real lo dan estos filtros explícitos). La encargada de sucursal
 * queda limitada a su(s) sucursal(es) por branchScope; compras/admin ven todas.
 *
 * Server-only. NUNCA importar desde código cliente.
 */
import { getSupabaseAdmin } from "./supabase"
import { getBusinessContext, getBranchScope, scopeByBranch } from "./business-context"
import { normalizeSucursal, sucursalesForTenant, sucursalAllowedForTenant } from "@/lib/normalize-pulse"
import { textValue, numberValue, dateValue } from "./csl-helpers"
import type { ActionParams, ActionUser, Row } from "./csl-types"

// ── Tenant helpers ─────────────────────────────────────────────────────────
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

// ── Auditoría (best-effort) ─────────────────────────────────────────────────
async function logAudit(
  user: ActionUser,
  action: string,
  requisitionId: string | null,
  itemId: string | null,
  oldValues: unknown,
  newValues: unknown,
): Promise<void> {
  const business_id = bizId()
  if (!business_id) return
  try {
    await getSupabaseAdmin().from("material_requisition_audit_logs").insert({
      business_id,
      requisition_id: requisitionId,
      item_id: itemId,
      action,
      old_values: oldValues ?? null,
      new_values: newValues ?? null,
      user_id: user.id || null,
    })
  } catch {
    // nunca rompe la operación principal
  }
}

// ── Mapeos DB ↔ cliente ─────────────────────────────────────────────────────
function mapMaterial(r: Row) {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    supplierGroup: r.supplier_group,
    unit: r.unit,
    active: r.active,
  }
}
function mapItem(r: Row) {
  return {
    id: r.id,
    requisitionId: r.requisition_id,
    materialId: r.material_id,
    materialName: r.material_name_snapshot,
    supplierGroup: r.supplier_group_snapshot,
    requestedQty: r.requested_qty == null ? null : Number(r.requested_qty),
    approvedQty: r.approved_qty == null ? null : Number(r.approved_qty),
    purchasedQty: r.purchased_qty == null ? null : Number(r.purchased_qty),
    receivedQty: r.received_qty == null ? null : Number(r.received_qty),
    unit: r.unit,
    status: r.status,
    note: r.note,
    approvalNote: r.approval_note,
    receptionNote: r.reception_note,
    purchasedSupplier: r.purchased_supplier,
    purchasedCost: r.purchased_cost == null ? null : Number(r.purchased_cost),
  }
}
function mapReq(r: Row) {
  return {
    id: r.id,
    branch: r.branch,
    requestedBy: r.requested_by,
    requestedAt: r.requested_at,
    status: r.status,
    notes: r.notes,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    rejectedBy: r.rejected_by,
    rejectedAt: r.rejected_at,
    rejectionReason: r.rejection_reason,
    purchasedBy: r.purchased_by,
    purchasedAt: r.purchased_at,
    receivedBy: r.received_by,
    receivedAt: r.received_at,
    createdAt: r.created_at,
  }
}

// ── Catálogo ─────────────────────────────────────────────────────────────────
export async function getMaterialCatalog() {
  const sb = getSupabaseAdmin()
  let q = sb.from("material_catalog").select("*").order("supplier_group").order("name")
  if (scoped()) q = q.eq("business_id", bizId() as string)
  const { data, error } = await q
  if (error) throw error
  return { ok: true, records: (data || []).map(mapMaterial) }
}

export async function saveMaterial(params: ActionParams, user: ActionUser) {
  const business_id = requireBizId()
  const id = textValue(params, "id")
  const name = textValue(params, "name").trim().toUpperCase()
  if (!name) throw new Error("El nombre del material es obligatorio")
  const row: Row = {
    business_id,
    name,
    category: textValue(params, "category") || textValue(params, "supplierGroup") || null,
    supplier_group: textValue(params, "supplierGroup") || null,
    unit: textValue(params, "unit") || "unidad",
    active: params.active === undefined ? true : String(params.active) !== "false",
    updated_at: new Date().toISOString(),
  }
  if (id) row.id = id
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.from("material_catalog").upsert(row, { onConflict: "id" }).select().single()
  if (error) {
    if ((error as { code?: string }).code === "23505") throw new Error("Ya existe un material con ese nombre")
    throw error
  }
  await logAudit(user, id ? "material_updated" : "material_created", null, null, null, { name })
  return { ok: true, record: mapMaterial(data as Row) }
}

export async function setMaterialActive(params: ActionParams, user: ActionUser) {
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const active = String(params.active) !== "false"
  const sb = getSupabaseAdmin()
  let q = sb.from("material_catalog").update({ active, updated_at: new Date().toISOString() }).eq("id", id)
  if (scoped()) q = q.eq("business_id", bizId() as string)
  const { data, error } = await q.select()
  if (error) throw error
  if (!data || !data.length) throw new Error("Material no encontrado o de otro negocio")
  await logAudit(user, "material_active_changed", null, null, null, { id, active })
  return { ok: true }
}

// ── Sucursales disponibles para el usuario ──────────────────────────────────
export function getMaterialBranches() {
  const ctx = getBusinessContext()
  const slug = ctx?.businessSlug || "csl"
  const all = sucursalesForTenant(slug)
  const scope = getBranchScope()
  const branches = scope.all || !scope.branches.length ? all : all.filter((b) => scope.branches.includes(b))
  return { ok: true, records: branches, canPickAll: scope.all }
}

// ── Requisiciones (encargada) ───────────────────────────────────────────────
type IncomingItem = {
  materialId?: string
  materialName?: string
  supplierGroup?: string
  requestedQty?: number
  unit?: string
  note?: string
}

export async function saveRequisition(params: ActionParams, user: ActionUser) {
  const business_id = requireBizId()
  const ctx = getBusinessContext()
  const slug = ctx?.businessSlug || "csl"
  const branch = normalizeSucursal(textValue(params, "branch"))
  if (!branch) throw new Error("Selecciona una sucursal")
  if (!sucursalAllowedForTenant(branch, slug)) throw new Error("Sucursal no pertenece a este negocio")
  // Encargada restringida: la sucursal debe estar en su scope.
  const scope = getBranchScope()
  if (!scope.all && scope.branches.length && !scope.branches.includes(branch)) {
    throw new Error("No tienes permiso para crear requisiciones de esa sucursal")
  }

  let items: IncomingItem[] = []
  try {
    items = JSON.parse(textValue(params, "items") || "[]")
  } catch {
    throw new Error("Lista de materiales inválida")
  }
  // Solo materiales con cantidad real > 0 (acepta decimales). NO se fuerza
  // ningún valor por defecto: una cantidad vacía/0 descarta la línea.
  const clean = items
    .filter((it) => it && it.materialName && Number(it.requestedQty) > 0)
    .map((it) => ({
      materialId: it.materialId || null,
      materialName: String(it.materialName).toUpperCase(),
      supplierGroup: it.supplierGroup || null,
      requestedQty: Number(it.requestedQty),
      unit: it.unit || "unidad",
      note: it.note || null,
    }))

  const status = textValue(params, "status") === "borrador" ? "borrador" : "enviada"
  if (status === "enviada" && clean.length === 0) {
    throw new Error("Marca al menos un material con cantidad para enviar")
  }

  const sb = getSupabaseAdmin()
  const id = textValue(params, "id")
  const now = new Date().toISOString()
  const reqRow: Row = {
    business_id,
    branch,
    requested_by: user.id,
    status,
    notes: textValue(params, "notes") || null,
    requested_at: status === "enviada" ? now : null,
    updated_at: now,
  }
  if (id) reqRow.id = id

  const { data: savedReq, error: reqErr } = await sb
    .from("material_requisitions")
    .upsert(reqRow, { onConflict: "id" })
    .select()
    .single()
  if (reqErr) throw reqErr
  const requisitionId = (savedReq as Row).id as string

  // Reemplazar ítems (borrador editable): borrar e insertar.
  await sb.from("material_requisition_items").delete().eq("requisition_id", requisitionId).eq("business_id", business_id)
  if (clean.length) {
    const itemRows = clean.map((it) => ({
      business_id,
      requisition_id: requisitionId,
      material_id: it.materialId,
      material_name_snapshot: it.materialName,
      supplier_group_snapshot: it.supplierGroup,
      requested_qty: it.requestedQty,
      unit: it.unit,
      status: "enviada",
      note: it.note,
    }))
    const { error: itErr } = await sb.from("material_requisition_items").insert(itemRows)
    if (itErr) throw itErr
  }

  await logAudit(user, id ? "requisition_updated" : "requisition_created", requisitionId, null, null, {
    branch,
    status,
    items: clean.length,
  })
  return { ok: true, record: { ...mapReq(savedReq as Row), itemsCount: clean.length } }
}

export async function getMyRequisitions(params: ActionParams) {
  const sb = getSupabaseAdmin()
  let q = sb.from("material_requisitions").select("*").order("created_at", { ascending: false })
  if (scoped()) q = q.eq("business_id", bizId() as string)
  const status = textValue(params, "status")
  if (status && status !== "todas") q = q.eq("status", status)
  const { data, error } = await q
  if (error) throw error
  // Restringir por sucursal (encargada ve solo su sucursal; admin ve todas).
  const reqs = scopeByBranch((data || []) as Row[], (r) => r.branch)
  // Adjuntar resumen de ítems.
  const ids = reqs.map((r) => r.id as string)
  let itemsByReq: Record<string, Row[]> = {}
  if (ids.length) {
    const { data: items } = await sb.from("material_requisition_items").select("*").in("requisition_id", ids)
    itemsByReq = (items || []).reduce((acc: Record<string, Row[]>, it: Row) => {
      const k = it.requisition_id as string
      ;(acc[k] = acc[k] || []).push(it)
      return acc
    }, {})
  }
  const records = reqs.map((r) => {
    const its = itemsByReq[r.id as string] || []
    return {
      ...mapReq(r),
      itemsCount: its.length,
      totalQty: its.reduce((s, it) => s + (Number(it.requested_qty) || 0), 0),
    }
  })
  return { ok: true, records }
}

export async function getRequisition(params: ActionParams) {
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const sb = getSupabaseAdmin()
  let rq = sb.from("material_requisitions").select("*").eq("id", id)
  if (scoped()) rq = rq.eq("business_id", bizId() as string)
  const { data: req, error } = await rq.maybeSingle()
  if (error) throw error
  if (!req) return { ok: false, error: "Requisición no encontrada o de otro negocio" }
  const { data: items } = await sb
    .from("material_requisition_items")
    .select("*")
    .eq("requisition_id", id)
    .order("supplier_group_snapshot")
    .order("material_name_snapshot")
  return { ok: true, record: { ...mapReq(req as Row), items: (items || []).map(mapItem) } }
}

export async function submitRequisition(params: ActionParams, user: ActionUser) {
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const sb = getSupabaseAdmin()
  let q = sb
    .from("material_requisitions")
    .update({ status: "enviada", requested_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
  if (scoped()) q = q.eq("business_id", bizId() as string)
  const { data, error } = await q.select()
  if (error) throw error
  if (!data || !data.length) throw new Error("Requisición no encontrada o de otro negocio")
  await sb.from("material_requisition_items").update({ status: "enviada" }).eq("requisition_id", id).eq("status", "borrador")
  await logAudit(user, "requisition_submitted", id, null, null, null)
  return { ok: true }
}

// ── Consolidado (compras/admin) ─────────────────────────────────────────────
export async function getMaterialConsolidado(params: ActionParams) {
  const sb = getSupabaseAdmin()
  let rq = sb.from("material_requisitions").select("*")
  if (scoped()) rq = rq.eq("business_id", bizId() as string)
  const status = textValue(params, "status")
  if (status && status !== "todas") rq = rq.eq("status", status)
  const desde = dateValue(params.desde)
  const hasta = dateValue(params.hasta)
  if (desde) rq = rq.gte("requested_at", desde)
  if (hasta) rq = rq.lte("requested_at", `${hasta}T23:59:59`)
  const { data: reqsRaw, error } = await rq
  if (error) throw error
  let reqs = scopeByBranch((reqsRaw || []) as Row[], (r) => r.branch)
  const branchFilter = normalizeSucursal(textValue(params, "branch"))
  if (branchFilter) reqs = reqs.filter((r) => normalizeSucursal(r.branch) === branchFilter)
  const reqById = new Map(reqs.map((r) => [r.id as string, r]))
  const ids = reqs.map((r) => r.id as string)
  if (!ids.length) return { ok: true, records: [], branches: [] }

  const supplierFilter = textValue(params, "supplier")
  let iq = sb.from("material_requisition_items").select("*").in("requisition_id", ids)
  if (supplierFilter && supplierFilter !== "todos") iq = iq.eq("supplier_group_snapshot", supplierFilter)
  const { data: items } = await iq

  // Aplanar: cada ítem con su sucursal + estado de requisición, para que el
  // cliente pivote por (proveedor, material) × sucursal.
  const records = (items || []).map((it: Row) => {
    const req = reqById.get(it.requisition_id as string)
    return {
      ...mapItem(it),
      branch: normalizeSucursal(req?.branch),
      requisitionStatus: req?.status,
      requestedAt: req?.requested_at,
    }
  })
  const branches = Array.from(new Set(records.map((r) => r.branch).filter(Boolean))).sort()
  return { ok: true, records, branches }
}

// ── Aprobación / compra / recepción por ítem ────────────────────────────────
async function fetchItem(sb: ReturnType<typeof getSupabaseAdmin>, id: string): Promise<Row> {
  let q = sb.from("material_requisition_items").select("*").eq("id", id)
  if (scoped()) q = q.eq("business_id", bizId() as string)
  const { data, error } = await q.maybeSingle()
  if (error) throw error
  if (!data) throw new Error("Ítem no encontrado o de otro negocio")
  return data as Row
}

/** Recalcula el estado de la requisición a partir de los estados de sus ítems. */
async function syncRequisitionStatus(sb: ReturnType<typeof getSupabaseAdmin>, requisitionId: string) {
  const { data: items } = await sb.from("material_requisition_items").select("status").eq("requisition_id", requisitionId)
  const list = (items || []) as Row[]
  if (!list.length) return
  const active = list.filter((i) => i.status !== "rechazada")
  const allDone = (s: string) => active.length > 0 && active.every((i) => i.status === s)
  const any = (s: string) => active.some((i) => i.status === s)
  let status = "en_revision"
  if (active.length === 0) status = "rechazada"
  else if (allDone("recibida_completa")) status = "recibida_completa"
  else if (any("recibida_completa") || any("recibida_parcial")) status = "recibida_parcial"
  else if (allDone("comprada")) status = "comprada"
  else if (allDone("aprobada")) status = "aprobada"
  else if (any("aprobada") || any("rechazada")) status = "en_revision"
  await sb.from("material_requisitions").update({ status, updated_at: new Date().toISOString() }).eq("id", requisitionId)
}

export async function approveItem(params: ActionParams, user: ActionUser) {
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const sb = getSupabaseAdmin()
  const before = await fetchItem(sb, id)
  const approvedQty = Math.max(0, numberValue(params, "approvedQty", Number(before.requested_qty) || 0))
  const fields: Row = {
    approved_qty: approvedQty,
    approval_note: textValue(params, "approvalNote") || before.approval_note || null,
    status: "aprobada",
    updated_at: new Date().toISOString(),
  }
  await sb.from("material_requisition_items").update(fields).eq("id", id)
  const reqId = before.requisition_id as string
  await sb
    .from("material_requisitions")
    .update({ approved_by: user.id, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", reqId)
  await syncRequisitionStatus(sb, reqId)
  await logAudit(user, "item_approved", reqId, id, { approved_qty: before.approved_qty, status: before.status }, fields)
  return { ok: true }
}

export async function rejectItem(params: ActionParams, user: ActionUser) {
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const reason = textValue(params, "reason") || textValue(params, "approvalNote")
  if (!reason.trim()) throw new Error("Indica el motivo del rechazo")
  const sb = getSupabaseAdmin()
  const before = await fetchItem(sb, id)
  const fields: Row = { status: "rechazada", approved_qty: 0, approval_note: reason, updated_at: new Date().toISOString() }
  await sb.from("material_requisition_items").update(fields).eq("id", id)
  const reqId = before.requisition_id as string
  await syncRequisitionStatus(sb, reqId)
  await logAudit(user, "item_rejected", reqId, id, { status: before.status }, fields)
  return { ok: true }
}

export async function approveAllRequisition(params: ActionParams, user: ActionUser) {
  const reqId = textValue(params, "id")
  if (!reqId) throw new Error("Falta id")
  const sb = getSupabaseAdmin()
  let rq = sb.from("material_requisitions").select("id").eq("id", reqId)
  if (scoped()) rq = rq.eq("business_id", bizId() as string)
  const { data: req } = await rq.maybeSingle()
  if (!req) throw new Error("Requisición no encontrada o de otro negocio")
  const { data: items } = await sb
    .from("material_requisition_items")
    .select("*")
    .eq("requisition_id", reqId)
    .neq("status", "rechazada")
  for (const it of (items || []) as Row[]) {
    const approvedQty = it.approved_qty != null ? Number(it.approved_qty) : Number(it.requested_qty) || 0
    await sb
      .from("material_requisition_items")
      .update({ approved_qty: approvedQty, status: "aprobada", updated_at: new Date().toISOString() })
      .eq("id", it.id as string)
  }
  await sb
    .from("material_requisitions")
    .update({ status: "aprobada", approved_by: user.id, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", reqId)
  await logAudit(user, "requisition_approved_all", reqId, null, null, { items: (items || []).length })
  return { ok: true }
}

export async function purchaseItem(params: ActionParams, user: ActionUser) {
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const sb = getSupabaseAdmin()
  const before = await fetchItem(sb, id)
  const purchasedQty = Math.max(0, numberValue(params, "purchasedQty", Number(before.approved_qty) || Number(before.requested_qty) || 0))
  const costRaw = String(params.purchasedCost ?? "").trim()
  const fields: Row = {
    purchased_qty: purchasedQty,
    purchased_supplier: textValue(params, "purchasedSupplier") || before.purchased_supplier || null,
    purchased_cost: costRaw ? Number(costRaw.replace(/[^\d.-]/g, "")) || null : before.purchased_cost ?? null,
    status: "comprada",
    updated_at: new Date().toISOString(),
  }
  await sb.from("material_requisition_items").update(fields).eq("id", id)
  const reqId = before.requisition_id as string
  await sb
    .from("material_requisitions")
    .update({ purchased_by: user.id, purchased_at: dateValue(params.purchasedAt) || new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", reqId)
  await syncRequisitionStatus(sb, reqId)
  await logAudit(user, "item_purchased", reqId, id, { status: before.status }, fields)
  return { ok: true }
}

export async function receiveItem(params: ActionParams, user: ActionUser) {
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const sb = getSupabaseAdmin()
  const before = await fetchItem(sb, id)
  const receivedQty = Math.max(0, numberValue(params, "receivedQty", 0))
  const target = Number(before.approved_qty) || Number(before.purchased_qty) || Number(before.requested_qty) || 0
  const status = receivedQty <= 0 ? before.status : receivedQty < target ? "recibida_parcial" : "recibida_completa"
  const fields: Row = {
    received_qty: receivedQty,
    reception_note: textValue(params, "receptionNote") || before.reception_note || null,
    status,
    updated_at: new Date().toISOString(),
  }
  await sb.from("material_requisition_items").update(fields).eq("id", id)
  const reqId = before.requisition_id as string
  await sb
    .from("material_requisitions")
    .update({ received_by: user.id, received_at: dateValue(params.receivedAt) || new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", reqId)
  await syncRequisitionStatus(sb, reqId)
  await logAudit(user, "item_received", reqId, id, { status: before.status, received_qty: before.received_qty }, fields)
  return { ok: true }
}

// ── Dashboard ────────────────────────────────────────────────────────────────
export async function getMaterialDashboard(params: ActionParams) {
  const sb = getSupabaseAdmin()
  let rq = sb.from("material_requisitions").select("*")
  if (scoped()) rq = rq.eq("business_id", bizId() as string)
  const desde = dateValue(params.desde)
  const hasta = dateValue(params.hasta)
  if (desde) rq = rq.gte("requested_at", desde)
  if (hasta) rq = rq.lte("requested_at", `${hasta}T23:59:59`)
  const { data: reqsRaw } = await rq
  const reqs = scopeByBranch((reqsRaw || []) as Row[], (r) => r.branch)
  const ids = reqs.map((r) => r.id as string)
  let items: Row[] = []
  if (ids.length) {
    const { data } = await sb.from("material_requisition_items").select("*").in("requisition_id", ids)
    items = (data || []) as Row[]
  }
  const reqById = new Map(reqs.map((r) => [r.id as string, r]))

  const countByStatus = (s: string) => reqs.filter((r) => r.status === s).length
  const kpis = {
    totalRequisiciones: reqs.length,
    pendientesAprobacion: reqs.filter((r) => ["enviada", "en_revision"].includes(String(r.status))).length,
    aprobadas: countByStatus("aprobada"),
    compradas: countByStatus("comprada"),
    recibidasCompletas: countByStatus("recibida_completa"),
    recibidasParciales: countByStatus("recibida_parcial"),
    rechazadas: countByStatus("rechazada"),
    totalMateriales: items.reduce((s, it) => s + (Number(it.requested_qty) || 0), 0),
    totalComprado: items.reduce((s, it) => s + (Number(it.purchased_cost) || 0), 0),
  }

  // Solicitudes por sucursal
  const porSucursalMap: Record<string, number> = {}
  reqs.forEach((r) => {
    const b = normalizeSucursal(r.branch) || "—"
    porSucursalMap[b] = (porSucursalMap[b] || 0) + 1
  })
  const porSucursal = Object.entries(porSucursalMap).map(([name, value]) => ({ name, value }))

  // Materiales más solicitados (top 10 por cantidad)
  const matMap: Record<string, number> = {}
  items.forEach((it) => {
    const n = String(it.material_name_snapshot || "—")
    matMap[n] = (matMap[n] || 0) + (Number(it.requested_qty) || 0)
  })
  const materialesTop = Object.entries(matMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)

  // Gasto por proveedor
  const provMap: Record<string, number> = {}
  items.forEach((it) => {
    const p = String(it.supplier_group_snapshot || "—")
    provMap[p] = (provMap[p] || 0) + (Number(it.purchased_cost) || 0)
  })
  const gastoPorProveedor = Object.entries(provMap).map(([name, value]) => ({ name, value }))

  // Estado de requisiciones (para pie)
  const estadoMap: Record<string, number> = {}
  reqs.forEach((r) => {
    const s = String(r.status)
    estadoMap[s] = (estadoMap[s] || 0) + 1
  })
  const estados = Object.entries(estadoMap).map(([name, value]) => ({ name, value }))

  // Tendencia mensual (por mes de requested_at)
  const mesMap: Record<string, number> = {}
  reqs.forEach((r) => {
    const d = String(r.requested_at || r.created_at || "").slice(0, 7)
    if (d) mesMap[d] = (mesMap[d] || 0) + 1
  })
  const tendencia = Object.entries(mesMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const sucursalTop = porSucursal.slice().sort((a, b) => b.value - a.value)[0]?.name || "—"
  const materialTop = materialesTop[0]?.name || "—"
  const proveedorTop = gastoPorProveedor.slice().sort((a, b) => b.value - a.value)[0]?.name || "—"

  return {
    ok: true,
    kpis: { ...kpis, sucursalTop, materialTop, proveedorTop },
    charts: { porSucursal, materialesTop, gastoPorProveedor, estados, tendencia },
  }
}

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
/** True si el usuario del request es admin del negocio o superadmin. Solo
 *  ellos pueden cambiar estado libremente, ver eliminadas o eliminar
 *  requisiciones ya aprobadas/en proceso. */
function isManager(): boolean {
  const ctx = getBusinessContext()
  return Boolean(ctx?.isAdmin || ctx?.isSuperadmin)
}

/** Permiso granular para eliminar requisiciones sin ser admin/superadmin
 *  (csl_user_profiles.permissions, migración 202607020001). Espejo del check
 *  del frontend en req-mat-aprobaciones-page.tsx — el backend nunca confía
 *  solo en la UI. Sigue scopeado al business_id activo del usuario. */
const PERM_REQ_DELETE = "material_requisitions.delete"
function canDeleteRequisitions(): boolean {
  const ctx = getBusinessContext()
  return Boolean(ctx?.isAdmin || ctx?.isSuperadmin || ctx?.permissions?.includes(PERM_REQ_DELETE))
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
    deletedAt: r.deleted_at ?? null,
    deletedBy: r.deleted_by ?? null,
    deletedReason: r.deleted_reason ?? null,
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
  // Eliminación lógica: por defecto solo activas. La vista "Eliminadas" (deleted=1)
  // es exclusiva de admin/superadmin; un usuario normal nunca ve eliminadas.
  const onlyDeleted = textValue(params, "deleted") === "1" && isManager()
  q = onlyDeleted ? q.not("deleted_at", "is", null) : q.is("deleted_at", null)
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
    .is("deleted_at", null)
  if (scoped()) q = q.eq("business_id", bizId() as string)
  const { data, error } = await q.select()
  if (error) throw error
  if (!data || !data.length) throw new Error("Requisición no encontrada o de otro negocio")
  await sb.from("material_requisition_items").update({ status: "enviada" }).eq("requisition_id", id).eq("status", "borrador")
  await logAudit(user, "requisition_submitted", id, null, null, null)
  return { ok: true }
}

// ── Acciones a nivel de requisición (menú "Acciones") ───────────────────────

const ALLOWED_REQ_STATUS = new Set<string>([
  "borrador",
  "enviada",
  "en_revision",
  "aprobada",
  "rechazada",
  "comprada",
  "recibida_parcial",
  "recibida_completa",
  "devuelta",
])
// Estados en los que el CREADOR ya no puede eliminar por su cuenta (requiere
// admin/superadmin): la requisición ya entró en proceso de compra/recepción.
const LOCKED_FOR_CREATOR = new Set<string>([
  "aprobada",
  "comprada",
  "recibida_parcial",
  "recibida_completa",
])

/** Carga una requisición scopeada por business activo. */
async function fetchReq(sb: ReturnType<typeof getSupabaseAdmin>, id: string): Promise<Row> {
  let rq = sb.from("material_requisitions").select("*").eq("id", id)
  if (scoped()) rq = rq.eq("business_id", bizId() as string)
  const { data, error } = await rq.maybeSingle()
  if (error) throw error
  if (!data) throw new Error("Requisición no encontrada o de otro negocio")
  return data as Row
}

/**
 * Eliminación LÓGICA de una requisición (soft delete). Nunca borra físicamente:
 * marca deleted_at/by/reason para conservar historial y auditoría. La quita de
 * todas las listas y totales activos. Filtra SIEMPRE por id + business_id.
 *
 * Permisos: admin/superadmin pueden eliminar cualquier estado; el creador solo
 * si la requisición aún no entró en compra (no aprobada/comprada/recibida).
 */
export async function deleteRequisition(params: ActionParams, user: ActionUser) {
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const sb = getSupabaseAdmin()
  const req = await fetchReq(sb, id)
  if (req.deleted_at) return { ok: true } // idempotente: ya estaba eliminada

  // Puede eliminar: admin/superadmin, usuario con el permiso granular
  // material_requisitions.delete (p.ej. Carlos Arias, compras), o el creador
  // mientras la requisición no haya entrado en compra/recepción.
  const manager = canDeleteRequisitions()
  const isCreator = Boolean(req.requested_by && user.id && String(req.requested_by) === String(user.id))
  const canDelete = manager || (isCreator && !LOCKED_FOR_CREATOR.has(String(req.status)))
  if (!canDelete) throw new Error("No tienes permiso para eliminar esta requisición.")

  const fields: Row = {
    deleted_at: new Date().toISOString(),
    deleted_by: user.id || null,
    deleted_reason: textValue(params, "reason") || null,
    updated_at: new Date().toISOString(),
  }
  let uq = sb.from("material_requisitions").update(fields).eq("id", id).is("deleted_at", null)
  if (scoped()) uq = uq.eq("business_id", bizId() as string)
  const { data: upd, error } = await uq.select()
  if (error) throw error
  if (!upd || !upd.length) throw new Error("No se pudo eliminar (verifica el negocio activo)")
  await logAudit(user, "requisition_deleted", id, null, { status: req.status }, { reason: fields.deleted_reason })
  return { ok: true }
}

/** Restaura una requisición eliminada lógicamente. Solo admin/superadmin. */
export async function restoreRequisition(params: ActionParams, user: ActionUser) {
  if (!isManager()) throw new Error("Solo admin/superadmin puede restaurar requisiciones")
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const sb = getSupabaseAdmin()
  let uq = sb
    .from("material_requisitions")
    .update({ deleted_at: null, deleted_by: null, deleted_reason: null, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (scoped()) uq = uq.eq("business_id", bizId() as string)
  const { data: upd, error } = await uq.select()
  if (error) throw error
  if (!upd || !upd.length) throw new Error("Requisición no encontrada o de otro negocio")
  await logAudit(user, "requisition_restored", id, null, null, null)
  return { ok: true }
}

/** Rechaza la requisición completa con motivo (todos sus ítems → rechazada). */
export async function rejectRequisition(params: ActionParams, user: ActionUser) {
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const reason = textValue(params, "reason").trim()
  if (!reason) throw new Error("Indica el motivo del rechazo")
  const sb = getSupabaseAdmin()
  const req = await fetchReq(sb, id)
  if (req.deleted_at) throw new Error("Requisición no encontrada o de otro negocio")
  await sb
    .from("material_requisition_items")
    .update({ status: "rechazada", approval_note: reason, updated_at: new Date().toISOString() })
    .eq("requisition_id", id)
    .neq("status", "rechazada")
  let uq = sb
    .from("material_requisitions")
    .update({
      status: "rechazada",
      rejected_by: user.id || null,
      rejected_at: new Date().toISOString(),
      rejection_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
  if (scoped()) uq = uq.eq("business_id", bizId() as string)
  const { data: upd, error } = await uq.select()
  if (error) throw error
  if (!upd || !upd.length) throw new Error("No se pudo rechazar")
  await logAudit(user, "requisition_rejected", id, null, { status: req.status }, { reason })
  return { ok: true }
}

/** Devuelve la requisición para corrección (estado 'devuelta') con motivo. */
export async function returnRequisition(params: ActionParams, user: ActionUser) {
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const reason = textValue(params, "reason").trim()
  if (!reason) throw new Error("Indica el motivo de la devolución")
  const sb = getSupabaseAdmin()
  const req = await fetchReq(sb, id)
  if (req.deleted_at) throw new Error("Requisición no encontrada o de otro negocio")
  let uq = sb
    .from("material_requisitions")
    .update({ status: "devuelta", rejection_reason: reason, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (scoped()) uq = uq.eq("business_id", bizId() as string)
  const { data: upd, error } = await uq.select()
  if (error) throw error
  if (!upd || !upd.length) throw new Error("No se pudo devolver")
  await logAudit(user, "requisition_returned", id, null, { status: req.status }, { reason })
  return { ok: true }
}

/** Cambia el estado de la requisición a un valor permitido. Solo admin/superadmin. */
export async function setRequisitionStatus(params: ActionParams, user: ActionUser) {
  if (!isManager()) throw new Error("Solo admin/superadmin puede cambiar el estado")
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const status = textValue(params, "status")
  if (!ALLOWED_REQ_STATUS.has(status)) throw new Error("Estado inválido")
  const sb = getSupabaseAdmin()
  const req = await fetchReq(sb, id)
  if (req.deleted_at) throw new Error("Requisición no encontrada o de otro negocio")
  let uq = sb
    .from("material_requisitions")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (scoped()) uq = uq.eq("business_id", bizId() as string)
  const { data: upd, error } = await uq.select()
  if (error) throw error
  if (!upd || !upd.length) throw new Error("No se pudo cambiar el estado")
  await logAudit(user, "requisition_status_set", id, null, { status: req.status }, { status })
  return { ok: true }
}

// ── Consolidado (compras/admin) ─────────────────────────────────────────────
export async function getMaterialConsolidado(params: ActionParams) {
  const sb = getSupabaseAdmin()
  let rq = sb.from("material_requisitions").select("*").is("deleted_at", null)
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
  let rq = sb.from("material_requisitions").select("*").is("deleted_at", null)
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

// ════════════════════════════════════════════════════════════════════════════
// Inventario de Materiales por Sucursal (conteo físico histórico)
//
// Reutiliza el catálogo maestro (material_catalog) — NO crea catálogo nuevo. Es
// un conteo independiente: NO toca requisiciones, compras, aprobaciones ni el
// catálogo. Mismo aislamiento multi-tenant + por sucursal que las requisiciones.
// ════════════════════════════════════════════════════════════════════════════

/** Auditoría de inventarios (best-effort; nunca rompe la operación). */
async function logInvAudit(
  user: ActionUser,
  action: string,
  inventoryId: string | null,
  itemId: string | null,
  oldValues: unknown,
  newValues: unknown,
  reason?: string | null,
): Promise<void> {
  const business_id = bizId()
  if (!business_id) return
  try {
    await getSupabaseAdmin().from("material_inventory_audit_logs").insert({
      business_id,
      inventory_id: inventoryId,
      item_id: itemId,
      action,
      old_values: oldValues ?? null,
      new_values: newValues ?? null,
      reason: reason ?? null,
      user_id: user.id || null,
    })
  } catch {
    /* no rompe la operación principal */
  }
}

function mapInventory(r: Row) {
  return {
    id: r.id,
    branch: r.branch,
    inventoryDate: r.inventory_date,
    status: r.status,
    notes: r.notes,
    createdBy: r.created_by,
    createdByName: r.created_by_name ?? null,
    finalizedBy: r.finalized_by,
    finalizedByName: r.finalized_by_name ?? null,
    createdAt: r.created_at,
    finalizedAt: r.finalized_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
    deletedBy: r.deleted_by ?? null,
    deletedReason: r.deleted_reason ?? null,
  }
}

function mapInvItem(r: Row) {
  return {
    id: r.id,
    inventoryId: r.inventory_id,
    materialId: r.material_id,
    materialName: r.material_name_snapshot,
    supplierGroup: r.supplier_group_snapshot,
    quantity: r.quantity == null ? null : Number(r.quantity),
    unit: r.unit,
    observation: r.observation,
  }
}

type IncomingInvItem = {
  materialId?: string
  materialName?: string
  supplierGroup?: string
  unit?: string
  quantity?: number | string
  observation?: string
}

/** Carga un inventario scopeado por business activo. Lanza si no existe/otro negocio. */
async function fetchInv(sb: ReturnType<typeof getSupabaseAdmin>, id: string): Promise<Row> {
  let q = sb.from("material_inventories").select("*").eq("id", id)
  if (scoped()) q = q.eq("business_id", bizId() as string)
  const { data, error } = await q.maybeSingle()
  if (error) throw error
  if (!data) throw new Error("Inventario no encontrado o de otro negocio")
  return data as Row
}

/** Valida sucursal contra tenant + scope del usuario. Devuelve la sucursal normalizada. */
function requireBranchInScope(rawBranch: string): string {
  const ctx = getBusinessContext()
  const slug = ctx?.businessSlug || "csl"
  const branch = normalizeSucursal(rawBranch)
  if (!branch) throw new Error("Selecciona una sucursal")
  if (!sucursalAllowedForTenant(branch, slug)) throw new Error("Sucursal no pertenece a este negocio")
  const scope = getBranchScope()
  if (!scope.all && scope.branches.length && !scope.branches.includes(branch)) {
    throw new Error("No tienes permiso para inventariar esa sucursal")
  }
  return branch
}

/** Normaliza los ítems entrantes: conserva solo los que traen una cantidad
 *  numérica (incluye 0 = "contado, sin existencia"). Un material SIN entrada se
 *  omite → cuenta como "sin contar" en los KPIs. Acepta decimales. */
function cleanInvItems(raw: IncomingInvItem[]): Array<{
  materialId: string | null
  materialName: string
  supplierGroup: string | null
  quantity: number
  unit: string
  observation: string | null
}> {
  return raw
    .filter((it) => {
      if (!it || !it.materialName) return false
      const q = Number(it.quantity)
      return Number.isFinite(q) && q >= 0 && String(it.quantity).trim() !== ""
    })
    .map((it) => ({
      materialId: it.materialId || null,
      materialName: String(it.materialName).toUpperCase(),
      supplierGroup: it.supplierGroup || null,
      quantity: Number(it.quantity),
      unit: it.unit || "unidad",
      observation: it.observation ? String(it.observation) : null,
    }))
}

/**
 * Devuelve el BORRADOR vivo de una (sucursal, fecha) con sus ítems, para
 * reanudar el conteo (autoguardado / "salir y volver"). null si no hay borrador.
 */
export async function getInventoryDraft(params: ActionParams) {
  const branch = requireBranchInScope(textValue(params, "branch"))
  const inventoryDate = dateValue(params.inventoryDate)
  if (!inventoryDate) throw new Error("Selecciona la fecha del inventario")
  const business_id = requireBizId()
  const sb = getSupabaseAdmin()
  const { data: inv, error } = await sb
    .from("material_inventories")
    .select("*")
    .eq("business_id", business_id)
    .eq("branch", branch)
    .eq("inventory_date", inventoryDate)
    .eq("status", "borrador")
    .is("deleted_at", null)
    .maybeSingle()
  if (error) throw error
  if (!inv) return { ok: true, record: null }
  const { data: items } = await sb
    .from("material_inventory_items")
    .select("*")
    .eq("inventory_id", (inv as Row).id as string)
  return { ok: true, record: { ...mapInventory(inv as Row), items: (items || []).map(mapInvItem) } }
}

/**
 * Guarda un inventario (borrador o finalizado). Reemplaza los ítems.
 *  - Reanuda el borrador de (sucursal, fecha) si existe (no duplica).
 *  - Un inventario ya FINALIZADO es inmutable: no se puede editar por esta vía
 *    (usar correctInventoryItem o duplicateInventory).
 */
export async function saveInventory(params: ActionParams, user: ActionUser) {
  const business_id = requireBizId()
  const branch = requireBranchInScope(textValue(params, "branch"))
  const inventoryDate = dateValue(params.inventoryDate)
  if (!inventoryDate) throw new Error("Selecciona la fecha del inventario")
  const status = textValue(params, "status") === "finalizado" ? "finalizado" : "borrador"

  let items: IncomingInvItem[] = []
  try {
    items = JSON.parse(textValue(params, "items") || "[]")
  } catch {
    throw new Error("Lista de materiales inválida")
  }
  const clean = cleanInvItems(items)
  if (status === "finalizado" && clean.length === 0) {
    throw new Error("Registra al menos un material contado para finalizar")
  }

  const sb = getSupabaseAdmin()
  let id = textValue(params, "id")

  if (id) {
    const existing = await fetchInv(sb, id)
    if (existing.deleted_at) throw new Error("Inventario eliminado")
    if (existing.status === "finalizado") {
      throw new Error("Este inventario ya está finalizado y no se puede editar. Usa Corregir (admin) o Duplicar como nuevo conteo.")
    }
  } else {
    // Reanudar el borrador existente de (sucursal, fecha) → evita duplicados.
    const { data: draft } = await sb
      .from("material_inventories")
      .select("id")
      .eq("business_id", business_id)
      .eq("branch", branch)
      .eq("inventory_date", inventoryDate)
      .eq("status", "borrador")
      .is("deleted_at", null)
      .maybeSingle()
    if (draft) id = (draft as Row).id as string
  }

  const now = new Date().toISOString()
  const invRow: Row = {
    business_id,
    branch,
    inventory_date: inventoryDate,
    status,
    notes: textValue(params, "notes") || null,
    updated_at: now,
  }
  const userName = textValue(params, "userName") || null
  if (id) invRow.id = id
  else {
    invRow.created_by = user.id || null
    invRow.created_by_name = userName
  }
  if (status === "finalizado") {
    invRow.finalized_by = user.id || null
    invRow.finalized_by_name = userName
    invRow.finalized_at = now
  }

  let savedInv: Row
  try {
    const { data, error } = await sb.from("material_inventories").upsert(invRow, { onConflict: "id" }).select().single()
    if (error) throw error
    savedInv = data as Row
  } catch (e) {
    // Índice único parcial: ya hay un borrador para esa sucursal+fecha (doble clic/carrera).
    if ((e as { code?: string }).code === "23505") {
      throw new Error("Ya hay un inventario en borrador para esa sucursal y fecha. Recárgalo para continuar.")
    }
    throw e
  }
  const inventoryId = savedInv.id as string

  // Reemplazar ítems (borrador editable): borrar e insertar.
  await sb.from("material_inventory_items").delete().eq("inventory_id", inventoryId).eq("business_id", business_id)
  if (clean.length) {
    const itemRows = clean.map((it) => ({
      business_id,
      inventory_id: inventoryId,
      material_id: it.materialId,
      material_name_snapshot: it.materialName,
      supplier_group_snapshot: it.supplierGroup,
      quantity: it.quantity,
      unit: it.unit,
      observation: it.observation,
    }))
    const { error: itErr } = await sb.from("material_inventory_items").insert(itemRows)
    if (itErr) throw itErr
  }

  await logInvAudit(
    user,
    status === "finalizado" ? "inventory_finalized" : id ? "inventory_saved" : "inventory_created",
    inventoryId,
    null,
    null,
    { branch, status, items: clean.length },
  )
  return { ok: true, record: { ...mapInventory(savedInv), itemsCount: clean.length } }
}

/** Lista de inventarios (histórico) con resumen. Scopeado por tenant + sucursal. */
export async function getInventories(params: ActionParams) {
  const sb = getSupabaseAdmin()
  let q = sb.from("material_inventories").select("*").order("inventory_date", { ascending: false }).order("created_at", { ascending: false })
  if (scoped()) q = q.eq("business_id", bizId() as string)
  const onlyDeleted = textValue(params, "deleted") === "1" && isManager()
  q = onlyDeleted ? q.not("deleted_at", "is", null) : q.is("deleted_at", null)
  const status = textValue(params, "status")
  if (status && status !== "todos") q = q.eq("status", status)
  const branchFilter = normalizeSucursal(textValue(params, "branch"))
  if (branchFilter) q = q.eq("branch", branchFilter)
  const desde = dateValue(params.desde)
  const hasta = dateValue(params.hasta)
  if (desde) q = q.gte("inventory_date", desde)
  if (hasta) q = q.lte("inventory_date", hasta)
  const { data, error } = await q
  if (error) throw error
  const invs = scopeByBranch((data || []) as Row[], (r) => r.branch)
  const ids = invs.map((r) => r.id as string)
  let itemsByInv: Record<string, Row[]> = {}
  if (ids.length) {
    const { data: items } = await sb.from("material_inventory_items").select("inventory_id, quantity").in("inventory_id", ids)
    itemsByInv = (items || []).reduce((acc: Record<string, Row[]>, it: Row) => {
      const k = it.inventory_id as string
      ;(acc[k] = acc[k] || []).push(it)
      return acc
    }, {})
  }
  const records = invs.map((r) => {
    const its = itemsByInv[r.id as string] || []
    return {
      ...mapInventory(r),
      itemsCount: its.length,
      totalQty: its.reduce((s, it) => s + (Number(it.quantity) || 0), 0),
    }
  })
  return { ok: true, records }
}

/** Un inventario con todos sus ítems (detalle / PDF). */
export async function getInventory(params: ActionParams) {
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const sb = getSupabaseAdmin()
  const inv = await fetchInv(sb, id)
  const { data: items } = await sb
    .from("material_inventory_items")
    .select("*")
    .eq("inventory_id", id)
    .order("supplier_group_snapshot")
    .order("material_name_snapshot")
  return { ok: true, record: { ...mapInventory(inv), items: (items || []).map(mapInvItem) } }
}

/** Eliminación LÓGICA (soft delete). Solo borradores para el creador; los
 *  finalizados solo admin/superadmin (conserva el histórico). */
export async function deleteInventory(params: ActionParams, user: ActionUser) {
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const sb = getSupabaseAdmin()
  const inv = await fetchInv(sb, id)
  if (inv.deleted_at) return { ok: true } // idempotente
  const isCreator = Boolean(inv.created_by && user.id && String(inv.created_by) === String(user.id))
  const canDelete = isManager() || (isCreator && inv.status === "borrador")
  if (!canDelete) throw new Error("No tienes permiso para eliminar este inventario.")
  const fields: Row = {
    deleted_at: new Date().toISOString(),
    deleted_by: user.id || null,
    deleted_reason: textValue(params, "reason") || null,
    updated_at: new Date().toISOString(),
  }
  let uq = sb.from("material_inventories").update(fields).eq("id", id).is("deleted_at", null)
  if (scoped()) uq = uq.eq("business_id", bizId() as string)
  const { data: upd, error } = await uq.select()
  if (error) throw error
  if (!upd || !upd.length) throw new Error("No se pudo eliminar (verifica el negocio activo)")
  await logInvAudit(user, "inventory_deleted", id, null, { status: inv.status }, { reason: fields.deleted_reason })
  return { ok: true }
}

/** Restaura un inventario eliminado lógicamente. Solo admin/superadmin. */
export async function restoreInventory(params: ActionParams, user: ActionUser) {
  if (!isManager()) throw new Error("Solo admin/superadmin puede restaurar inventarios")
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const sb = getSupabaseAdmin()
  let uq = sb
    .from("material_inventories")
    .update({ deleted_at: null, deleted_by: null, deleted_reason: null, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (scoped()) uq = uq.eq("business_id", bizId() as string)
  const { data: upd, error } = await uq.select()
  if (error) throw error
  if (!upd || !upd.length) throw new Error("Inventario no encontrado o de otro negocio")
  await logInvAudit(user, "inventory_restored", id, null, null, null)
  return { ok: true }
}

/**
 * Duplica un inventario como NUEVO borrador (mismo/otra fecha), copiando sus
 * ítems y cantidades para reconteo. No modifica el original.
 */
export async function duplicateInventory(params: ActionParams, user: ActionUser) {
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const business_id = requireBizId()
  const sb = getSupabaseAdmin()
  const src = await fetchInv(sb, id)
  const branch = requireBranchInScope(String(src.branch))
  const inventoryDate = dateValue(params.inventoryDate) || new Date().toISOString().slice(0, 10)

  // No duplicar si ya hay un borrador para esa sucursal+fecha (evita choque con el índice único).
  const { data: draft } = await sb
    .from("material_inventories")
    .select("id")
    .eq("business_id", business_id)
    .eq("branch", branch)
    .eq("inventory_date", inventoryDate)
    .eq("status", "borrador")
    .is("deleted_at", null)
    .maybeSingle()
  if (draft) throw new Error("Ya existe un borrador para esa sucursal y fecha. Ábrelo para continuar el conteo.")

  const now = new Date().toISOString()
  const { data: newInv, error } = await sb
    .from("material_inventories")
    .insert({
      business_id,
      branch,
      inventory_date: inventoryDate,
      status: "borrador",
      notes: src.notes || null,
      created_by: user.id || null,
      created_by_name: textValue(params, "userName") || null,
      updated_at: now,
    })
    .select()
    .single()
  if (error) {
    if ((error as { code?: string }).code === "23505") throw new Error("Ya existe un borrador para esa sucursal y fecha.")
    throw error
  }
  const newId = (newInv as Row).id as string
  const { data: srcItems } = await sb.from("material_inventory_items").select("*").eq("inventory_id", id)
  if (srcItems && srcItems.length) {
    const rows = (srcItems as Row[]).map((it) => ({
      business_id,
      inventory_id: newId,
      material_id: it.material_id,
      material_name_snapshot: it.material_name_snapshot,
      supplier_group_snapshot: it.supplier_group_snapshot,
      quantity: it.quantity,
      unit: it.unit,
      observation: it.observation,
    }))
    await sb.from("material_inventory_items").insert(rows)
  }
  await logInvAudit(user, "inventory_duplicated", newId, null, { from: id }, { branch, inventoryDate })
  return { ok: true, record: mapInventory(newInv as Row) }
}

/**
 * Corrección de un ítem de un inventario FINALIZADO. Solo admin/superadmin.
 * Registra auditoría con valor anterior, valor nuevo, motivo y usuario.
 */
export async function correctInventoryItem(params: ActionParams, user: ActionUser) {
  if (!isManager()) throw new Error("Solo admin/superadmin puede corregir un inventario finalizado")
  const itemId = textValue(params, "itemId")
  if (!itemId) throw new Error("Falta itemId")
  const reason = textValue(params, "reason").trim()
  if (!reason) throw new Error("Indica el motivo de la corrección")
  const sb = getSupabaseAdmin()
  // Cargar el ítem scopeado por tenant.
  let iq = sb.from("material_inventory_items").select("*").eq("id", itemId)
  if (scoped()) iq = iq.eq("business_id", bizId() as string)
  const { data: item, error: iErr } = await iq.maybeSingle()
  if (iErr) throw iErr
  if (!item) throw new Error("Ítem no encontrado o de otro negocio")
  const it = item as Row
  const inv = await fetchInv(sb, String(it.inventory_id))
  if (inv.status !== "finalizado") throw new Error("La corrección con auditoría es solo para inventarios finalizados")

  const hasQty = String(params.quantity ?? "").trim() !== ""
  const newQty = hasQty ? Math.max(0, numberValue(params, "quantity", Number(it.quantity) || 0)) : Number(it.quantity) || 0
  const hasObs = params.observation !== undefined
  const newObs = hasObs ? (textValue(params, "observation") || null) : (it.observation ?? null)
  const oldValues = { quantity: Number(it.quantity), observation: it.observation ?? null }
  const newValues = { quantity: newQty, observation: newObs }

  await sb
    .from("material_inventory_items")
    .update({ quantity: newQty, observation: newObs, updated_at: new Date().toISOString() })
    .eq("id", itemId)
  await sb.from("material_inventories").update({ updated_at: new Date().toISOString() }).eq("id", it.inventory_id)
  await logInvAudit(user, "inventory_item_corrected", String(it.inventory_id), itemId, oldValues, newValues, reason)
  return { ok: true }
}

/** Historial de cambios (auditoría) de un inventario. */
export async function getInventoryAuditLogs(params: ActionParams) {
  const inventoryId = textValue(params, "id")
  if (!inventoryId) throw new Error("Falta id")
  const sb = getSupabaseAdmin()
  // Verifica pertenencia al tenant antes de exponer la auditoría.
  await fetchInv(sb, inventoryId)
  let q = sb
    .from("material_inventory_audit_logs")
    .select("*")
    .eq("inventory_id", inventoryId)
    .order("created_at", { ascending: false })
  if (scoped()) q = q.eq("business_id", bizId() as string)
  const { data, error } = await q
  if (error) throw error
  const records = (data || []).map((r: Row) => ({
    id: r.id,
    action: r.action,
    oldValues: r.old_values,
    newValues: r.new_values,
    reason: r.reason,
    userId: r.user_id,
    createdAt: r.created_at,
  }))
  return { ok: true, records }
}

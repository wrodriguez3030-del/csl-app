/**
 * Módulo COMISIÓN DE VENTAS — lógica de servidor (reglas, importaciones,
 * cálculos, dashboard). Multi-tenant: toda lectura/escritura se scopea por
 * business_id del BusinessContext (service_role bypassa RLS; el aislamiento real
 * lo dan estos filtros). RBAC con permisos `sales_commission.*` (admin/superadmin
 * bypassa). Auditoría en `sales_commission_audit_logs`.
 *
 * Server-only. NUNCA importar desde código cliente.
 */
import { getSupabaseAdmin } from "./supabase"
import { getBusinessContext, requirePermission } from "./business-context"
import { textValue, numberValue } from "./csl-helpers"
import type { ActionParams, ActionUser, Row } from "./csl-types"
import { defaultCommissionRules } from "@/lib/commission/rules"
import { parseDateISO } from "@/lib/commission/normalize"

// ── Tenant ───────────────────────────────────────────────────────────────────
function bizId(): string | null {
  return getBusinessContext()?.businessId ?? null
}
function requireBizId(): string {
  const id = bizId()
  if (!id) throw new Error("Selecciona un negocio activo para esta operación")
  return id
}

async function logAudit(
  user: ActionUser, entity: string, entityId: string | null, action: string,
  oldValues: unknown, newValues: unknown, reason?: string | null,
  period?: { month?: number; year?: number },
): Promise<void> {
  const business_id = bizId()
  if (!business_id) return
  try {
    await getSupabaseAdmin().from("sales_commission_audit_logs").insert({
      business_id, entity_type: entity, entity_id: entityId, action,
      old_values: oldValues ?? null, new_values: newValues ?? null,
      reason: reason ?? null, user_id: user.id || null,
      period_month: period?.month ?? null, period_year: period?.year ?? null,
    })
  } catch { /* nunca rompe la operación principal */ }
}

// ── Mapeos DB → cliente ──────────────────────────────────────────────────────
function mapRule(r: Row) {
  return {
    id: r.id, name: r.name, ruleType: r.rule_type, category: r.category ?? null,
    employeeId: r.employee_id ?? null, branch: r.branch ?? null,
    minAmount: r.min_amount == null ? null : Number(r.min_amount),
    maxAmount: r.max_amount == null ? null : Number(r.max_amount),
    percentage: r.percentage == null ? null : Number(r.percentage),
    fixedAmount: r.fixed_amount == null ? null : Number(r.fixed_amount),
    priority: Number(r.priority) || 0, active: r.active !== false,
    effectiveFrom: r.effective_from, effectiveTo: r.effective_to ?? null,
    createdBy: r.created_by ?? null, updatedBy: r.updated_by ?? null,
  }
}

function mapImport(r: Row) {
  return {
    id: r.id, periodMonth: Number(r.period_month) || 0, periodYear: Number(r.period_year) || 0,
    filename: r.filename, fileHash: r.file_hash, rowsCount: Number(r.rows_count) || 0,
    grossTotal: Number(r.gross_total) || 0, status: r.status,
    importedBy: r.imported_by ?? null, importedAt: r.imported_at ?? null,
    committedAt: r.committed_at ?? null, createdAt: r.created_at,
  }
}

function mapCalc(r: Row) {
  return {
    id: r.id, periodMonth: Number(r.period_month) || 0, periodYear: Number(r.period_year) || 0,
    employeeId: r.employee_id ?? null, provider: r.provider_name_snapshot, branch: r.branch,
    productsCount: Number(r.products_count) || 0, productIncentive: Number(r.product_incentive) || 0,
    serviceCommission: Number(r.service_commission) || 0, laserIncentive: Number(r.laser_incentive) || 0,
    fixedIncentive: Number(r.fixed_incentive) || 0, manualAdjustment: Number(r.manual_adjustment) || 0,
    bonusExtra: Number(r.bonus_extra) || 0, grossTotal: Number(r.gross_total) || 0,
    cleaningContribution: Number(r.cleaning_contribution) || 0, netTotal: Number(r.net_total) || 0,
    status: r.status, approvedAt: r.approved_at ?? null, paidAt: r.paid_at ?? null,
  }
}

// ── Reglas ───────────────────────────────────────────────────────────────────
/** Siembra las reglas por defecto si el negocio no tiene ninguna (idempotente). */
async function seedRulesIfEmpty(): Promise<void> {
  const business_id = requireBizId()
  const sb = getSupabaseAdmin()
  const { count } = await sb
    .from("sales_commission_rules")
    .select("id", { count: "exact", head: true })
    .eq("business_id", business_id)
  if ((count ?? 0) > 0) return
  const rows = defaultCommissionRules(business_id).map((r) => ({
    business_id, name: r.name, rule_type: r.ruleType, category: r.category,
    employee_id: r.employeeId, branch: r.branch, min_amount: r.minAmount,
    max_amount: r.maxAmount, percentage: r.percentage, fixed_amount: r.fixedAmount,
    priority: r.priority, active: r.active, effective_from: r.effectiveFrom,
    effective_to: r.effectiveTo, created_by: "seed",
  }))
  await sb.from("sales_commission_rules").insert(rows)
}

export async function getCommissionRules(_params: ActionParams) {
  const business_id = requireBizId()
  await seedRulesIfEmpty()
  const { data, error } = await getSupabaseAdmin()
    .from("sales_commission_rules")
    .select("*")
    .eq("business_id", business_id)
    .order("rule_type", { ascending: true })
    .order("priority", { ascending: true })
    .order("name", { ascending: true })
  if (error) throw new Error(error.message)
  return { ok: true, records: (data || []).map(mapRule) }
}

export async function saveCommissionRule(params: ActionParams, user: ActionUser) {
  requirePermission("sales_commission.rules.manage")
  const business_id = requireBizId()
  const sb = getSupabaseAdmin()
  const id = textValue(params, "id")
  const fields: Row = {
    name: textValue(params, "name") || "Regla",
    rule_type: textValue(params, "ruleType") || "category_commission",
    category: textValue(params, "category") || null,
    branch: textValue(params, "branch") || null,
    percentage: params.percentage == null || params.percentage === "" ? null : numberValue(params, "percentage"),
    fixed_amount: params.fixedAmount == null || params.fixedAmount === "" ? null : numberValue(params, "fixedAmount"),
    min_amount: params.minAmount == null || params.minAmount === "" ? null : numberValue(params, "minAmount"),
    max_amount: params.maxAmount == null || params.maxAmount === "" ? null : numberValue(params, "maxAmount"),
    priority: params.priority == null || params.priority === "" ? 100 : numberValue(params, "priority"),
    active: params.active === undefined ? true : Boolean(params.active) && params.active !== "false",
    effective_from: textValue(params, "effectiveFrom") || "2000-01-01",
    effective_to: textValue(params, "effectiveTo") || null,
    updated_by: user.email || user.id || null,
    updated_at: new Date().toISOString(),
  }
  if (id) {
    const { data: prev } = await sb.from("sales_commission_rules").select("*").eq("id", id).eq("business_id", business_id).maybeSingle()
    if (!prev) throw new Error("Regla no encontrada")
    const { data, error } = await sb.from("sales_commission_rules").update(fields).eq("id", id).eq("business_id", business_id).select("*").maybeSingle()
    if (error) throw new Error(error.message)
    await logAudit(user, "rule", String(id), "regla_modificada", prev, fields)
    return { ok: true, record: data ? mapRule(data) : null }
  }
  const { data, error } = await sb.from("sales_commission_rules").insert({ ...fields, business_id, created_by: user.email || user.id || null }).select("*").maybeSingle()
  if (error) throw new Error(error.message)
  await logAudit(user, "rule", data ? String(data.id) : null, "regla_creada", null, fields)
  return { ok: true, record: data ? mapRule(data) : null }
}

export async function setCommissionRuleActive(params: ActionParams, user: ActionUser) {
  requirePermission("sales_commission.rules.manage")
  const business_id = requireBizId()
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id de regla")
  const active = Boolean(params.active) && params.active !== "false"
  const { data, error } = await getSupabaseAdmin()
    .from("sales_commission_rules")
    .update({ active, updated_by: user.email || user.id || null, updated_at: new Date().toISOString() })
    .eq("id", id).eq("business_id", business_id).select("*").maybeSingle()
  if (error) throw new Error(error.message)
  await logAudit(user, "rule", String(id), active ? "regla_activada" : "regla_desactivada", null, { active })
  return { ok: true, record: data ? mapRule(data) : null }
}

// ── Importaciones / cálculos / dashboard (lectura) ──────────────────────────
export async function getCommissionImports(params: ActionParams) {
  const business_id = requireBizId()
  let q = getSupabaseAdmin().from("sales_commission_imports").select("*").eq("business_id", business_id)
  const year = numberValue(params, "year")
  const month = numberValue(params, "month")
  if (year) q = q.eq("period_year", year)
  if (month) q = q.eq("period_month", month)
  const { data, error } = await q.order("period_year", { ascending: false }).order("period_month", { ascending: false }).order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return { ok: true, records: (data || []).map(mapImport) }
}

export async function getCommissionCalculations(params: ActionParams) {
  const business_id = requireBizId()
  let q = getSupabaseAdmin().from("sales_commission_calculations").select("*").eq("business_id", business_id)
  const year = numberValue(params, "year")
  const month = numberValue(params, "month")
  if (year) q = q.eq("period_year", year)
  if (month) q = q.eq("period_month", month)
  const { data, error } = await q.order("net_total", { ascending: false })
  if (error) throw new Error(error.message)
  return { ok: true, records: (data || []).map(mapCalc) }
}

// ── Importación (dedup por archivo + fila, persistencia por lotes) ──────────
interface ImportSaleIn {
  date?: string; branch?: string; customer?: string; provider?: string; providerOriginal?: string
  itemType?: string; itemName?: string; category?: string; quantity?: number; amount?: number
  paymentMethod?: string; rowHash?: string; originalId?: string
}
interface ImportCalcIn {
  provider?: string; branch?: string; productUnits?: number; productIncentive?: number
  serviceCommissionTotal?: number; laserSales?: number; patients?: number
}
interface ImportPayload {
  import?: { periodMonth?: number; periodYear?: number; filename?: string; fileHash?: string; rowsCount?: number; grossTotal?: number }
  sales?: ImportSaleIn[]
  calculations?: ImportCalcIn[]
  ruleSnapshot?: unknown
}

async function findActiveImport(fileHash: string) {
  const business_id = requireBizId()
  if (!fileHash) return null
  const { data } = await getSupabaseAdmin()
    .from("sales_commission_imports").select("*")
    .eq("business_id", business_id).eq("file_hash", fileHash).neq("status", "anulado")
    .maybeSingle()
  return data ?? null
}

/** Preview de dedup: ¿ya existe una importación activa con este file_hash? */
export async function checkCommissionImport(params: ActionParams) {
  requireBizId()
  const dup = await findActiveImport(textValue(params, "fileHash") || "")
  return { ok: true, exists: Boolean(dup), existing: dup ? mapImport(dup) : null }
}

const chunk = <T>(arr: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

export async function commitCommissionImport(params: ActionParams, user: ActionUser) {
  requirePermission("sales_commission.import")
  const business_id = requireBizId()
  const sb = getSupabaseAdmin()
  let payload: ImportPayload
  try { payload = JSON.parse(textValue(params, "importJson") || "{}") } catch { throw new Error("Payload de importación inválido") }
  const imp = payload.import || {}
  const sales = payload.sales || []
  const calcs = payload.calculations || []
  const month = Number(imp.periodMonth) || 0
  const year = Number(imp.periodYear) || 0
  if (!month || !year) throw new Error("Selecciona mes y año del período")
  if (!imp.fileHash) throw new Error("Falta el hash del archivo")

  // Dedup a nivel de archivo.
  const dup = await findActiveImport(imp.fileHash)
  if (dup) return { ok: false, duplicate: true, existing: mapImport(dup) }

  // Crear la importación.
  const { data: impRow, error: impErr } = await sb.from("sales_commission_imports").insert({
    business_id, period_month: month, period_year: year, filename: imp.filename || null,
    file_hash: imp.fileHash, rows_count: Number(imp.rowsCount) || sales.length,
    gross_total: Number(imp.grossTotal) || 0, status: "calculado",
    imported_by: user.email || user.id || null, imported_at: new Date().toISOString(), committed_at: new Date().toISOString(),
  }).select("*").maybeSingle()
  if (impErr || !impRow) throw new Error(impErr?.message || "No se pudo crear la importación")
  const importId = String(impRow.id)

  // Dedup a nivel de fila: descartar row_hash ya existentes en el negocio.
  const hashes = sales.map((s) => s.rowHash).filter(Boolean) as string[]
  const seen = new Set<string>()
  for (const part of chunk(hashes, 300)) {
    const { data } = await sb.from("sales_commission_sales").select("row_hash").eq("business_id", business_id).in("row_hash", part)
    for (const r of data || []) seen.add(String((r as Row).row_hash))
  }
  const fresh = sales.filter((s) => !s.rowHash || !seen.has(s.rowHash))
  // sale_date llega del Excel como "30/06/2026 19:19" (DD/MM/YYYY) o ISO;
  // Postgres (DateStyle ISO,MDY) rechaza DD/MM → normalizar SIEMPRE a ISO.
  const salesRows = fresh.map((s, i) => ({
    business_id, import_id: importId, original_row_number: i + 1, original_transaction_id: s.originalId || null,
    sale_date: parseDateISO(s.date) || null, branch: s.branch || null, customer_name: s.customer || null,
    provider_original: s.providerOriginal || null, provider_normalized: s.provider || null,
    service_name: s.itemName || null, category: s.category || null,
    product_name: s.itemType === "Producto" ? s.itemName || null : null,
    quantity: Number(s.quantity) || 0, gross_amount: Number(s.amount) || 0, net_amount: Number(s.amount) || 0,
    payment_method: s.paymentMethod || null, row_hash: s.rowHash || null,
  }))
  // Si algo falla a mitad, compensar: quitar SOLO las ventas recién insertadas
  // de este import y anularlo, para que el file_hash no bloquee el reintento.
  const voidThisImport = async () => {
    try {
      await sb.from("sales_commission_sales").delete().eq("import_id", importId).eq("business_id", business_id)
      await sb.from("sales_commission_imports").update({ status: "anulado", updated_at: new Date().toISOString() }).eq("id", importId).eq("business_id", business_id)
    } catch { /* best-effort */ }
  }

  let inserted = 0
  for (const part of chunk(salesRows, 500)) {
    const { error } = await sb.from("sales_commission_sales").insert(part)
    if (error) { await voidThisImport(); throw new Error(`Error insertando ventas: ${error.message}`) }
    inserted += part.length
  }

  // Cálculos por empleado (bono/limpieza/ajuste se editan en Liquidación).
  const calcRows = calcs.map((c) => {
    const prod = Number(c.productIncentive) || 0
    const svc = Number(c.serviceCommissionTotal) || 0
    return {
      business_id, import_id: importId, period_month: month, period_year: year,
      provider_name_snapshot: c.provider || null, branch: c.branch || null,
      products_count: Number(c.productUnits) || 0, product_incentive: prod, service_commission: svc,
      laser_incentive: 0, fixed_incentive: 0, manual_adjustment: 0, bonus_extra: 0,
      gross_total: Math.round((prod + svc) * 100) / 100, cleaning_contribution: 0,
      net_total: Math.round((prod + svc) * 100) / 100, status: "calculado",
      rule_snapshot: payload.ruleSnapshot ?? null, calculated_by: user.email || user.id || null,
    }
  })
  if (calcRows.length) {
    const { error } = await sb.from("sales_commission_calculations").insert(calcRows)
    if (error) { await voidThisImport(); throw new Error(`Error insertando cálculos: ${error.message}`) }
  }

  await logAudit(user, "import", importId, "importacion_confirmada",
    null, { rows: inserted, duplicated: sales.length - fresh.length, employees: calcRows.length, fileHash: imp.fileHash },
    null, { month, year })

  return { ok: true, importId, salesInserted: inserted, salesDuplicated: sales.length - fresh.length, employees: calcRows.length }
}

// ── Liquidación: edición de montos + cambio de estado ───────────────────────
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

/** Edita bono/limpieza/ajuste/láser/fijo de un cálculo y recalcula bruto/neto. */
export async function updateCommissionCalculation(params: ActionParams, user: ActionUser) {
  const business_id = requireBizId()
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id del cálculo")
  const sb = getSupabaseAdmin()
  const { data: prev } = await sb.from("sales_commission_calculations").select("*").eq("id", id).eq("business_id", business_id).maybeSingle()
  if (!prev) throw new Error("Cálculo no encontrado")
  if (prev.status === "cerrado") throw new Error("Período cerrado: no se puede editar")

  const patch: Row = {}
  const setNum = (key: string, col: string, perm: string) => {
    if (params[key] !== undefined && params[key] !== "") { requirePermission(perm); patch[col] = numberValue(params, key) }
  }
  setNum("bonusExtra", "bonus_extra", "sales_commission.bonus.manage")
  setNum("cleaningContribution", "cleaning_contribution", "sales_commission.cleaning.manage")
  setNum("manualAdjustment", "manual_adjustment", "sales_commission.adjust")
  setNum("laserIncentive", "laser_incentive", "sales_commission.adjust")
  setNum("fixedIncentive", "fixed_incentive", "sales_commission.adjust")
  if (Object.keys(patch).length === 0) throw new Error("Nada que actualizar")

  const merged = { ...prev, ...patch } as Row
  const num = (k: string) => Number(merged[k]) || 0
  const gross = round2(num("product_incentive") + num("service_commission") + num("laser_incentive") + num("fixed_incentive") + num("manual_adjustment") + num("bonus_extra"))
  const net = round2(gross - num("cleaning_contribution"))
  patch.gross_total = gross
  patch.net_total = net
  patch.updated_at = new Date().toISOString()

  const { data, error } = await sb.from("sales_commission_calculations").update(patch).eq("id", id).eq("business_id", business_id).select("*").maybeSingle()
  if (error) throw new Error(error.message)
  await logAudit(user, "calculation", String(id), "ajuste_liquidacion", { bonus: prev.bonus_extra, cleaning: prev.cleaning_contribution, adj: prev.manual_adjustment }, patch, textValue(params, "reason") || null,
    { month: Number(prev.period_month) || undefined, year: Number(prev.period_year) || undefined })
  return { ok: true, record: data ? mapCalc(data) : null }
}

const STATUS_PERM: Record<string, string> = {
  en_revision: "sales_commission.review", calculado: "sales_commission.review",
  aprobado: "sales_commission.approve", pagado: "sales_commission.pay", cerrado: "sales_commission.close",
}

/** Cambia el estado de un cálculo (revisión/aprobado/pagado/cerrado). */
export async function setCommissionCalcStatus(params: ActionParams, user: ActionUser) {
  const business_id = requireBizId()
  const id = textValue(params, "id")
  const status = textValue(params, "status")
  if (!id || !status || !STATUS_PERM[status]) throw new Error("Estado inválido")
  requirePermission(STATUS_PERM[status])
  const sb = getSupabaseAdmin()
  const { data: prev } = await sb.from("sales_commission_calculations").select("*").eq("id", id).eq("business_id", business_id).maybeSingle()
  if (!prev) throw new Error("Cálculo no encontrado")
  if (prev.status === "cerrado" && status !== "cerrado") throw new Error("Período cerrado: no se puede cambiar")
  const now = new Date().toISOString()
  const patch: Row = { status, updated_at: now }
  if (status === "aprobado") { patch.approved_by = user.email || user.id || null; patch.approved_at = now }
  if (status === "pagado") { patch.paid_by = user.email || user.id || null; patch.paid_at = now }
  const { data, error } = await sb.from("sales_commission_calculations").update(patch).eq("id", id).eq("business_id", business_id).select("*").maybeSingle()
  if (error) throw new Error(error.message)
  await logAudit(user, "calculation", String(id), `estado_${status}`, { status: prev.status }, { status }, textValue(params, "reference") || null,
    { month: Number(prev.period_month) || undefined, year: Number(prev.period_year) || undefined })
  return { ok: true, record: data ? mapCalc(data) : null }
}

// ── Vistas agregadas desde las ventas persistidas ───────────────────────────
import { classifyProvider } from "@/lib/commission/classification"

/** Trae las ventas del negocio (opcionalmente filtradas por período vía sale_date). */
async function fetchSalesForPeriod(params: ActionParams) {
  const business_id = requireBizId()
  const month = numberValue(params, "month")
  const year = numberValue(params, "year")
  let q = getSupabaseAdmin().from("sales_commission_sales")
    .select("branch,category,gross_amount,payment_method,provider_normalized,provider_original,customer_name,quantity")
    .eq("business_id", business_id)
  if (month && year) {
    const from = `${year}-${String(month).padStart(2, "0")}-01`
    const to = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`
    q = q.gte("sale_date", from).lt("sale_date", to)
  }
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data || []) as Row[]
}

async function cardPercentage(): Promise<number> {
  const business_id = requireBizId()
  const { data } = await getSupabaseAdmin().from("sales_commission_rules")
    .select("percentage").eq("business_id", business_id).eq("rule_type", "card_percentage").eq("active", true)
    .order("effective_from", { ascending: false }).limit(1).maybeSingle()
  return data?.percentage != null ? Number(data.percentage) : 0.27
}

/** Ventas por sucursal: bruto, medios de pago, % tarjeta, categorías. */
export async function getCommissionByBranch(params: ActionParams) {
  const rows = await fetchSalesForPeriod(params)
  const cardPct = await cardPercentage()
  type B = { branch: string; gross: number; tarjeta: number; efectivo: number; transferencia: number; otros: number; producto: number; servicio: number; laser: number; count: number }
  const map = new Map<string, B>()
  for (const r of rows) {
    const branch = String(r.branch || "(sin sucursal)")
    let b = map.get(branch)
    if (!b) { b = { branch, gross: 0, tarjeta: 0, efectivo: 0, transferencia: 0, otros: 0, producto: 0, servicio: 0, laser: 0, count: 0 }; map.set(branch, b) }
    const amt = Number(r.gross_amount) || 0
    b.gross = round2(b.gross + amt); b.count++
    const pm = String(r.payment_method || "OTROS")
    if (pm === "TARJETA") b.tarjeta = round2(b.tarjeta + amt)
    else if (pm === "EFECTIVO") b.efectivo = round2(b.efectivo + amt)
    else if (pm === "TRANSFERENCIA") b.transferencia = round2(b.transferencia + amt)
    else b.otros = round2(b.otros + amt)
    const cat = String(r.category || "")
    if (cat === "PRODUCTO") b.producto = round2(b.producto + amt)
    else if (cat === "DEPILACION_LASER") b.laser = round2(b.laser + amt)
    else b.servicio = round2(b.servicio + amt)
  }
  const branches = [...map.values()].map((b) => ({ ...b, cardPct, cardResult: round2(b.tarjeta * cardPct) })).sort((a, b) => b.gross - a.gross)
  return { ok: true, cardPct, branches }
}

/** Clientes atendidos por prestador comisionable (clientes distintos + participación). */
export async function getCommissionPatients(params: ActionParams) {
  const rows = await fetchSalesForPeriod(params)
  const byProv = new Map<string, { provider: string; branch: string; patients: Set<string> }>()
  for (const r of rows) {
    const info = classifyProvider(r.provider_original)
    if (!info.commissionable) continue
    const prov = String(r.provider_normalized || info.name)
    let e = byProv.get(prov)
    if (!e) { e = { provider: prov, branch: String(r.branch || ""), patients: new Set() }; byProv.set(prov, e) }
    if (r.customer_name) e.patients.add(String(r.customer_name))
  }
  const list = [...byProv.values()].map((e) => ({ provider: e.provider, branch: e.branch, patients: e.patients.size }))
  const total = list.reduce((s, e) => s + e.patients, 0)
  const rowsOut = list.map((e) => ({ ...e, participation: total ? Math.round((e.patients / total) * 10000) / 100 : 0 }))
    .sort((a, b) => b.patients - a.patients)
  const sumPct = round2(rowsOut.reduce((s, r) => s + r.participation, 0))
  return { ok: true, total, roundingDiff: round2(sumPct - 100), rows: rowsOut }
}

/** Comisión láser: fondo por escala + reparto por participación de pacientes. */
export async function getCommissionLaser(params: ActionParams) {
  const business_id = requireBizId()
  const rows = await fetchSalesForPeriod(params)
  // Venta láser total y por sucursal.
  let laserTotal = 0
  const byBranch: Record<string, number> = {}
  for (const r of rows) if (String(r.category) === "DEPILACION_LASER") {
    const amt = Number(r.gross_amount) || 0
    laserTotal = round2(laserTotal + amt)
    const b = String(r.branch || "(sin sucursal)")
    byBranch[b] = round2((byBranch[b] || 0) + amt)
  }
  // Escala desde reglas.
  const { data: scaleRows } = await getSupabaseAdmin().from("sales_commission_rules")
    .select("min_amount,percentage").eq("business_id", business_id).eq("rule_type", "laser_scale").eq("active", true)
  const scale = (scaleRows || []).map((s) => ({ threshold: Number((s as Row).min_amount), percentage: Number((s as Row).percentage) }))
    .filter((s) => Number.isFinite(s.threshold)).sort((a, b) => a.threshold - b.threshold)
  const reached = scale.filter((t) => laserTotal >= t.threshold).sort((a, b) => b.threshold - a.threshold)[0] || null
  const tramoPct = reached?.percentage || 0
  const fund = round2(laserTotal * tramoPct)
  // Reparto por participación de pacientes.
  const pat = await getCommissionPatients(params)
  const distribution = pat.rows.map((p) => ({ provider: p.provider, patients: p.patients, participation: p.participation, amount: round2(fund * (p.participation / 100)) }))
  return { ok: true, laserTotal, byBranch, tramoPct, fund, threshold: reached?.threshold || 0, distribution, patientsTotal: pat.total }
}

export async function getCommissionDashboard(params: ActionParams) {
  const business_id = requireBizId()
  const [rulesRes, calcsRes, importsRes] = await Promise.all([
    getSupabaseAdmin().from("sales_commission_rules").select("id", { count: "exact", head: true }).eq("business_id", business_id).eq("active", true),
    getCommissionCalculations(params),
    getCommissionImports(params),
  ])
  const calcs = calcsRes.records
  const sum = (f: (c: (typeof calcs)[number]) => number) => calcs.reduce((s, c) => s + f(c), 0)
  const round2 = (n: number) => Math.round(n * 100) / 100
  return {
    ok: true,
    activeRules: rulesRes.count ?? 0,
    imports: importsRes.records.length,
    employees: calcs.length,
    kpis: {
      productIncentive: round2(sum((c) => c.productIncentive)),
      serviceCommission: round2(sum((c) => c.serviceCommission)),
      laserIncentive: round2(sum((c) => c.laserIncentive)),
      bonusExtra: round2(sum((c) => c.bonusExtra)),
      grossTotal: round2(sum((c) => c.grossTotal)),
      cleaningContribution: round2(sum((c) => c.cleaningContribution)),
      netTotal: round2(sum((c) => c.netTotal)),
    },
    calculations: calcs,
  }
}

/**
 * Módulo INCENTIVOS DE VENTAS — lógica de servidor (reglas, importaciones,
 * cálculos, dashboard). Multi-tenant: toda lectura/escritura se scopea por
 * business_id del BusinessContext (service_role bypassa RLS; el aislamiento real
 * lo dan estos filtros). RBAC con permisos `sales_commission.*` (admin/superadmin
 * bypassa). Auditoría en `sales_commission_audit_logs`.
 *
 * Server-only. NUNCA importar desde código cliente.
 */
import { getSupabaseAdmin } from "./supabase"
import { getBusinessContext, requirePermission, hasPermission } from "./business-context"
import { textValue, numberValue } from "./csl-helpers"
import type { ActionParams, ActionUser, Row } from "./csl-types"
import { defaultCommissionRules } from "@/lib/commission/rules"
import { parseDateISO, canonicalCollaborator, normalizeName } from "@/lib/commission/normalize"
import { exclusiveEnd, monthBounds, monthsCovered, todayInTz } from "@/lib/commission/period"
import { assignLaserToCalcs } from "@/lib/commission/laser-apply"
import { computeRun, netAmount, allocateInt, type RunResult, type RunRules, type RunSaleRow } from "@/lib/commission/run-engine"

/**
 * Filtro de período desde params: prioriza from/to (rango INCLUSIVO — el fin
 * se consulta con `< to + 1 día` para no perder el día 31); si no, mes/año.
 */
function periodFilter(params: ActionParams): { from: string; toEx: string; months: Set<string> } | null {
  const from = textValue(params, "from")
  const to = textValue(params, "to")
  if (from && to) return { from, toEx: exclusiveEnd(to), months: monthsCovered(from, to) }
  const month = numberValue(params, "month")
  const year = numberValue(params, "year")
  if (month && year) {
    const b = monthBounds(year, month)
    return { from: b.from, toEx: exclusiveEnd(b.to), months: monthsCovered(b.from, b.to) }
  }
  return null
}

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
    importType: r.import_type || "SALES",
    detectedPeriodStart: r.detected_period_start ?? null,
    detectedPeriodEnd: r.detected_period_end ?? null,
    rawSummary: r.raw_summary ?? null,
    importedBy: r.imported_by ?? null, importedAt: r.imported_at ?? null,
    committedAt: r.committed_at ?? null, createdAt: r.created_at,
  }
}

/** Permiso de importación: acepta el granular por tipo o el general. */
function requireImportPerm(kind: "sales" | "reservations") {
  if (hasPermission(`sales_commission.import.${kind}`)) return
  requirePermission("sales_commission.import")
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
  const importType = textValue(params, "importType")
  if (importType) q = q.eq("import_type", importType)
  const status = textValue(params, "status")
  if (status) q = q.eq("status", status)
  // Rango sobre la FECHA DE CARGA (imported_at/created_at), inclusivo.
  const p = periodFilter(params)
  if (p && textValue(params, "dateField") === "created") q = q.gte("created_at", p.from).lt("created_at", p.toEx)
  const { data, error } = await q.order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return { ok: true, records: (data || []).map(mapImport) }
}

export async function getCommissionCalculations(params: ActionParams) {
  const business_id = requireBizId()
  let q = getSupabaseAdmin().from("sales_commission_calculations").select("*").eq("business_id", business_id)
  const branch = textValue(params, "branch")
  if (branch) q = q.eq("branch", branch)
  const provider = textValue(params, "provider")
  if (provider) q = q.eq("provider_name_snapshot", provider)
  const status = textValue(params, "status")
  if (status) q = q.eq("status", status)
  const { data, error } = await q.order("net_total", { ascending: false })
  if (error) throw new Error(error.message)
  // Período: los cálculos viven por (period_year, period_month) — un rango
  // from/to se traduce a los meses cubiertos (filas por negocio son pocas).
  const p = periodFilter(params)
  const rows = (data || []).filter((r) => !p || p.months.has(`${Number((r as Row).period_year)}-${Number((r as Row).period_month)}`))
  return { ok: true, records: rows.map(mapCalc) }
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
  periodMonth?: number; periodYear?: number
}
interface ImportPayload {
  import?: {
    periodMonth?: number; periodYear?: number; filename?: string; fileHash?: string
    rowsCount?: number; grossTotal?: number
    detectedPeriodStart?: string; detectedPeriodEnd?: string
  }
  sales?: ImportSaleIn[]
  calculations?: ImportCalcIn[]
  ruleSnapshot?: unknown
  rawSummary?: unknown
}

async function findActiveImport(fileHash: string, importType = "SALES") {
  const business_id = requireBizId()
  if (!fileHash) return null
  const { data } = await getSupabaseAdmin()
    .from("sales_commission_imports").select("*")
    .eq("business_id", business_id).eq("file_hash", fileHash).eq("import_type", importType)
    .neq("status", "anulado")
    .maybeSingle()
  return data ?? null
}

/** Preview de dedup: ¿ya existe una importación activa con este file_hash+tipo? */
export async function checkCommissionImport(params: ActionParams) {
  requireBizId()
  const importType = (textValue(params, "importType") || "SALES").toUpperCase()
  const dup = await findActiveImport(textValue(params, "fileHash") || "", importType)
  return { ok: true, exists: Boolean(dup), existing: dup ? mapImport(dup) : null }
}

const chunk = <T>(arr: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

export async function commitCommissionImport(params: ActionParams, user: ActionUser) {
  requireImportPerm("sales")
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

  // Dedup a nivel de archivo (por tipo).
  const dup = await findActiveImport(imp.fileHash, "SALES")
  if (dup) {
    await logAudit(user, "import", String(dup.id), "duplicate_file_blocked", null, { fileHash: imp.fileHash, type: "SALES" })
    return { ok: false, duplicate: true, existing: mapImport(dup) }
  }

  // Crear la importación (períodos REALES detectados en el archivo).
  const { data: impRow, error: impErr } = await sb.from("sales_commission_imports").insert({
    business_id, period_month: month, period_year: year, filename: imp.filename || null,
    file_hash: imp.fileHash, rows_count: Number(imp.rowsCount) || sales.length,
    gross_total: Number(imp.grossTotal) || 0, status: "calculado",
    import_type: "SALES",
    detected_period_start: imp.detectedPeriodStart || null,
    detected_period_end: imp.detectedPeriodEnd || null,
    raw_summary: payload.rawSummary ?? null,
    imported_by: user.email || user.id || null, imported_at: new Date().toISOString(), committed_at: new Date().toISOString(),
  }).select("*").maybeSingle()
  if (impErr || !impRow) throw new Error(impErr?.message || "No se pudo crear la importación")
  const importId = String(impRow.id)
  await logAudit(user, "import", importId, "sales_import_started", null, { rows: sales.length, fileHash: imp.fileHash }, null, { month, year })

  // Dedup a nivel de fila: descartar row_hash ya existentes en el negocio.
  // Consultas en PARALELO (archivos de miles de filas → 300 hashes por query).
  const hashes = sales.map((s) => s.rowHash).filter(Boolean) as string[]
  const seen = new Set<string>()
  await Promise.all(chunk(hashes, 300).map(async (part) => {
    const { data } = await sb.from("sales_commission_sales").select("row_hash").eq("business_id", business_id).in("row_hash", part)
    for (const r of data || []) seen.add(String((r as Row).row_hash))
  }))
  // Defensa adicional: si el payload trae el MISMO row_hash dos veces (no
  // debería — el cliente desambigua ocurrencias — pero un archivo viejo o un
  // reintento concurrente podría), conservar solo la primera para que el
  // índice único jamás reviente el lote con "duplicate key".
  const seenInBatch = new Set<string>()
  const fresh = sales.filter((s) => {
    if (!s.rowHash) return true
    if (seen.has(s.rowHash) || seenInBatch.has(s.rowHash)) return false
    seenInBatch.add(s.rowHash)
    return true
  })
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

  // Insertar en lotes de 500 en PARALELO (independientes entre sí); si
  // cualquiera falla se compensa el import completo.
  let inserted = 0
  const results = await Promise.all(chunk(salesRows, 500).map(async (part) => {
    const { error } = await sb.from("sales_commission_sales").insert(part)
    return { error, count: part.length }
  }))
  const failed = results.find((r) => r.error)
  if (failed?.error) { await voidThisImport(); throw new Error(`Error insertando ventas: ${failed.error.message}`) }
  inserted = results.reduce((s, r) => s + r.count, 0)

  // Cálculos por empleado y POR PERÍODO (un archivo puede cubrir varios meses;
  // cada fila trae su propio periodMonth/periodYear — fallback al del import).
  const calcRows = calcs.map((c) => {
    const prod = Number(c.productIncentive) || 0
    const svc = Number(c.serviceCommissionTotal) || 0
    return {
      business_id, import_id: importId,
      period_month: Number(c.periodMonth) || month, period_year: Number(c.periodYear) || year,
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

  await logAudit(user, "import", importId, "sales_import_committed",
    null, { rows: inserted, duplicated: sales.length - fresh.length, employees: calcRows.length, fileHash: imp.fileHash },
    null, { month, year })

  return { ok: true, importId, salesInserted: inserted, salesDuplicated: sales.length - fresh.length, employees: calcRows.length }
}

// ── Importador de RESERVAS (chunked: start → append×N → finalize) ────────────
interface ReservationRowIn {
  appointmentDate?: string; appointmentTime?: string; createdAt?: string
  branchOriginal?: string; branch?: string; externalClientId?: string
  firstName?: string; lastName?: string; email?: string; phone?: string; document?: string
  serviceName?: string; listPrice?: number; realPrice?: number
  sessionNumber?: string; totalSessions?: string
  providerOriginal?: string; provider?: string; attendanceStatus?: string
  paymentStatus?: string; paymentDate?: string; externalPaymentId?: string
  source?: string; assignedTo?: string; billingType?: string; rowHash?: string
}

/** Paso 1: valida dedup de archivo y crea la importación en borrador. */
export async function startReservationsImport(params: ActionParams, user: ActionUser) {
  requireImportPerm("reservations")
  const business_id = requireBizId()
  const fileHash = textValue(params, "fileHash")
  if (!fileHash) throw new Error("Falta el hash del archivo")
  const dup = await findActiveImport(fileHash, "RESERVATIONS")
  if (dup) {
    await logAudit(user, "import", String(dup.id), "duplicate_file_blocked", null, { fileHash, type: "RESERVATIONS" })
    return { ok: false, duplicate: true, existing: mapImport(dup) }
  }
  const month = numberValue(params, "month") || 0
  const year = numberValue(params, "year") || 0
  const { data, error } = await getSupabaseAdmin().from("sales_commission_imports").insert({
    business_id, period_month: month || 1, period_year: year || new Date().getFullYear(),
    filename: textValue(params, "filename") || null, file_hash: fileHash,
    rows_count: numberValue(params, "rowsCount") || 0, gross_total: 0,
    status: "borrador", import_type: "RESERVATIONS",
    detected_period_start: textValue(params, "periodStart") || null,
    detected_period_end: textValue(params, "periodEnd") || null,
    raw_summary: (() => { try { return JSON.parse(textValue(params, "summaryJson") || "null") } catch { return null } })(),
    imported_by: user.email || user.id || null, imported_at: new Date().toISOString(),
  }).select("*").maybeSingle()
  if (error || !data) throw new Error(error?.message || "No se pudo iniciar la importación")
  await logAudit(user, "import", String(data.id), "reservations_import_started", null, { fileHash, rows: numberValue(params, "rowsCount") || 0 })
  return { ok: true, importId: String(data.id) }
}

/** Paso 2 (×N): inserta un lote de reservas con dedup por row_hash. */
export async function appendReservationsRows(params: ActionParams, user: ActionUser) {
  requireImportPerm("reservations")
  const business_id = requireBizId()
  const sb = getSupabaseAdmin()
  const importId = textValue(params, "importId")
  if (!importId) throw new Error("Falta importId")
  const { data: imp } = await sb.from("sales_commission_imports").select("id,status,import_type").eq("id", importId).eq("business_id", business_id).maybeSingle()
  if (!imp || imp.import_type !== "RESERVATIONS") throw new Error("Importación no encontrada")
  if (imp.status !== "borrador") throw new Error("La importación ya fue finalizada")

  let rows: ReservationRowIn[]
  try { rows = JSON.parse(textValue(params, "rowsJson") || "[]") } catch { throw new Error("Lote inválido") }
  if (!rows.length) return { ok: true, inserted: 0, duplicated: 0 }

  // Dedup vs DB en paralelo (300 hashes por query).
  const hashes = rows.map((r) => r.rowHash).filter(Boolean) as string[]
  const seen = new Set<string>()
  await Promise.all(chunk(hashes, 300).map(async (part) => {
    const { data } = await sb.from("sales_commission_reservations").select("row_hash").eq("business_id", business_id).in("row_hash", part)
    for (const r of data || []) seen.add(String((r as Row).row_hash))
  }))
  const seenInBatch = new Set<string>()
  const fresh = rows.filter((r) => {
    if (!r.rowHash) return true
    if (seen.has(r.rowHash) || seenInBatch.has(r.rowHash)) return false
    seenInBatch.add(r.rowHash)
    return true
  })
  const dbRows = fresh.map((r) => ({
    business_id, import_id: importId,
    appointment_date: r.appointmentDate || null, appointment_time: r.appointmentTime || null,
    reservation_created_at: r.createdAt || null,
    branch_original: r.branchOriginal || null, branch_normalized: r.branch || null,
    external_client_id: r.externalClientId || null,
    first_name: r.firstName || null, last_name: r.lastName || null,
    email: r.email || null, phone: r.phone || null, document: r.document || null,
    service_name: r.serviceName || null,
    list_price: Number(r.listPrice) || 0, real_price: Number(r.realPrice) || 0,
    session_number: r.sessionNumber || null, total_sessions: r.totalSessions || null,
    provider_original: r.providerOriginal || null, provider_normalized: r.provider || null,
    attendance_status: r.attendanceStatus || null,
    payment_status: r.paymentStatus || null, payment_date: r.paymentDate || null,
    external_payment_id: r.externalPaymentId || null,
    source: r.source || null, assigned_to: r.assignedTo || null, billing_type: r.billingType || null,
    row_hash: r.rowHash || null,
  }))
  let inserted = 0
  const results = await Promise.all(chunk(dbRows, 500).map(async (part) => {
    const { error } = await sb.from("sales_commission_reservations").insert(part)
    return { error, count: part.length }
  }))
  const failed = results.find((r) => r.error)
  if (failed?.error) throw new Error(`Error insertando reservas: ${failed.error.message}`)
  inserted = results.reduce((s, r) => s + r.count, 0)
  void user
  return { ok: true, inserted, duplicated: rows.length - fresh.length }
}

/** Paso 3: cierra la importación y alimenta patient_counts (atenciones + únicos). */
export async function finalizeReservationsImport(params: ActionParams, user: ActionUser) {
  requireImportPerm("reservations")
  const business_id = requireBizId()
  const sb = getSupabaseAdmin()
  const importId = textValue(params, "importId")
  if (!importId) throw new Error("Falta importId")
  const { data: imp } = await sb.from("sales_commission_imports").select("id,status,import_type").eq("id", importId).eq("business_id", business_id).maybeSingle()
  if (!imp || imp.import_type !== "RESERVATIONS") throw new Error("Importación no encontrada")

  interface CountIn { periodMonth: number; periodYear: number; provider: string; branch: string; attended: number; uniquePatients: number }
  let counts: CountIn[]
  try { counts = JSON.parse(textValue(params, "countsJson") || "[]") } catch { throw new Error("Resumen inválido") }

  // Totales y participación por mes; upsert manual (update-else-insert) para
  // no duplicar al reimportar reservas del mismo período.
  const byPeriod = new Map<string, CountIn[]>()
  for (const c of counts) {
    const k = `${c.periodYear}-${c.periodMonth}`
    byPeriod.set(k, [...(byPeriod.get(k) || []), c])
  }
  for (const [, list] of byPeriod) {
    const total = list.reduce((s, c) => s + (Number(c.attended) || 0), 0)
    const { data: existing } = await sb.from("sales_commission_patient_counts")
      .select("id,provider_name,branch")
      .eq("business_id", business_id).eq("source", "reservas")
      .eq("period_year", list[0].periodYear).eq("period_month", list[0].periodMonth)
    const existingMap = new Map((existing || []).map((e) => [`${(e as Row).provider_name}|${(e as Row).branch || ""}`, String((e as Row).id)]))
    await Promise.all(list.map(async (c) => {
      const attended = Number(c.attended) || 0
      const fields = {
        patient_count: attended, unique_patients: Number(c.uniquePatients) || 0,
        total_period_patients: total,
        participation_percentage: total ? Math.round((attended / total) * 10000) / 100 : 0,
        branch: c.branch || null, updated_at: new Date().toISOString(),
      }
      const key = `${c.provider}|${c.branch || ""}`
      const id = existingMap.get(key)
      if (id) await sb.from("sales_commission_patient_counts").update(fields).eq("id", id).eq("business_id", business_id)
      else await sb.from("sales_commission_patient_counts").insert({
        business_id, period_year: c.periodYear, period_month: c.periodMonth,
        provider_name: c.provider, source: "reservas", ...fields,
      })
    }))
  }

  const rowsInserted = numberValue(params, "rowsInserted") || 0
  await sb.from("sales_commission_imports").update({
    status: "importado", rows_count: rowsInserted || undefined,
    committed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", importId).eq("business_id", business_id)
  await logAudit(user, "import", importId, "reservations_import_committed", null, { rows: rowsInserted, providers: counts.length })
  return { ok: true }
}

/** Anulación LÓGICA de una importación (sin borrado físico). */
export async function voidCommissionImport(params: ActionParams, user: ActionUser) {
  requirePermission("sales_commission.import")
  const business_id = requireBizId()
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const sb = getSupabaseAdmin()
  const { data: prev } = await sb.from("sales_commission_imports").select("*").eq("id", id).eq("business_id", business_id).maybeSingle()
  if (!prev) throw new Error("Importación no encontrada")
  if (prev.status === "anulado") return { ok: true }
  const { error } = await sb.from("sales_commission_imports").update({ status: "anulado", updated_at: new Date().toISOString() }).eq("id", id).eq("business_id", business_id)
  if (error) throw new Error(error.message)
  await logAudit(user, "import", String(id), "import_voided", { status: prev.status }, { status: "anulado" }, textValue(params, "reason") || null)
  return { ok: true }
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
import { isExcludedProvider, isNonIncentiveItem } from "@/lib/commission/exclusions"
import { receptionSplitsForBranch, isReceptionSplitSale } from "@/lib/commission/reception-splits"

/** Trae las ventas del negocio filtradas en DB por período (sale_date, rango
 *  inclusivo), sucursal y prestador — los filtros se aplican en backend.
 *  PAGINADO: PostgREST puede capar filas por request y un mes supera las 5,000
 *  ventas → se lee en páginas hasta agotar (orden estable por id). */
async function fetchSalesForPeriod(params: ActionParams) {
  const business_id = requireBizId()
  const p = periodFilter(params)
  const branch = textValue(params, "branch")
  const provider = textValue(params, "provider")
  const PAGE = 1000
  const out: Row[] = []
  for (let offset = 0; ; offset += PAGE) {
    let q = getSupabaseAdmin().from("sales_commission_sales")
      .select("id,sale_date,service_name,branch,category,gross_amount,payment_method,provider_normalized,provider_original,customer_name,quantity,assigned_at,assigned_by")
      .eq("business_id", business_id)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (p) q = q.gte("sale_date", p.from).lt("sale_date", p.toEx)
    if (branch) q = q.eq("branch", branch)
    if (provider) q = q.eq("provider_normalized", provider)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    out.push(...((data || []) as Row[]))
    if (!data || data.length < PAGE) break
  }
  return out
}

/** Prestador EFECTIVO de una venta: la asignación manual (assigned_at) gana
 *  sobre la clasificación del prestador original del archivo. Fuente única —
 *  detalle, dashboard, pacientes y runs deben usar esto, no classifyProvider
 *  directo, para que las asignaciones manuales fluyan a todos los cálculos. */
function effectiveProvider(r: Row): { name: string; commissionable: boolean } {
  if (r.assigned_at && r.provider_normalized) {
    const name = String(r.provider_normalized)
    // Un prestador excluido nunca comisiona, ni siquiera si se le asignó manual.
    return { name, commissionable: !isExcludedProvider(name) }
  }
  const info = classifyProvider(r.provider_original ?? r.provider_normalized)
  const name = String(r.provider_normalized || info.name)
  return { name, commissionable: info.commissionable && !!info.name && !isExcludedProvider(name) }
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
  let rows = await fetchSalesForPeriod(params)
  const payment = textValue(params, "payment")
  if (payment) rows = rows.filter((r) => String(r.payment_method || "OTROS") === payment)
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

/** Detalle de la comisión de servicios por categoría (prestador × categoría):
 *  venta base atribuible × % vigente de la regla. Recalcula desde las ventas
 *  persistidas con la MISMA lógica del importador (classifyProvider sobre el
 *  prestador original, sólo categorías con % configurado; láser va por fondo). */
export async function getCommissionServiceDetail(params: ActionParams) {
  const [rows, rules] = await Promise.all([fetchSalesForPeriod(params), readRunRules()])
  const pctByCat = rules.categoryPct
  type D = { provider: string; branch: string; category: string; base: number; pct: number; amount: number }
  const map = new Map<string, D>()
  for (const r of rows) {
    const cat = String(r.category || "")
    const pct = pctByCat[cat]
    if (pct == null || cat === "DEPILACION_LASER" || cat === "PRODUCTO") continue
    if (isNonIncentiveItem(r.service_name)) continue // insumo sin incentivo
    const p = effectiveProvider(r)
    if (!p.commissionable || !p.name) continue
    const key = `${p.name}||${cat}`
    let d = map.get(key)
    if (!d) { d = { provider: p.name, branch: String(r.branch || "(sin sucursal)"), category: cat, base: 0, pct: Number(pct), amount: 0 }; map.set(key, d) }
    d.base = round2(d.base + (Number(r.gross_amount) || 0))
  }
  const detail = [...map.values()]
    .map((d) => ({ ...d, amount: round2(d.base * d.pct) }))
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.category.localeCompare(b.category))
  return {
    ok: true, rows: detail,
    totals: { base: round2(detail.reduce((s, d) => s + d.base, 0)), amount: round2(detail.reduce((s, d) => s + d.amount, 0)) },
  }
}

/** Ventas sin prestador asignable: SERVICIOS y PRODUCTOS (excluye
 *  DEPILACION_LASER — va por fondo). Son las filas donde el archivo no trae
 *  prestador comisionable (vacío, "Sin Información", recepción/POS) y nadie ha
 *  asignado uno manual. */
export async function getCommissionUnassignedServices(params: ActionParams) {
  const rows = await fetchSalesForPeriod(params)
  const out = rows
    .filter((r) => {
      if (String(r.category || "") === "DEPILACION_LASER") return false
      // Las ventas de PRODUCTO de cuentas de recepción designadas se reparten
      // automáticamente entre prestadoras: no son "sin prestador".
      if (String(r.category || "") === "PRODUCTO" && isReceptionSplitSale(r.branch, r.provider_original)) return false
      return !effectiveProvider(r).commissionable
    })
    .map((r) => ({
      id: String(r.id),
      date: r.sale_date ? String(r.sale_date).slice(0, 10) : "",
      branch: String(r.branch || "(sin sucursal)"),
      customer: String(r.customer_name || ""),
      service: String(r.service_name || ""),
      category: String(r.category || "OTROS"),
      quantity: Number(r.quantity) || 0,
      amount: Number(r.gross_amount) || 0,
      providerOriginal: String(r.provider_original || ""),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.branch.localeCompare(b.branch))
  return {
    ok: true, rows: out,
    totals: { count: out.length, amount: round2(out.reduce((s, r) => s + r.amount, 0)) },
  }
}

/** Reparto de PRODUCTO de cuentas de recepción designadas: por sucursal/cuenta,
 *  las unidades totales se reparten en partes iguales (entero, remanente a las
 *  primeras) entre las prestadoras designadas; cada una aplica SU tarifa de
 *  producto. Espeja lo que el motor ya aplica en la liquidación (transparencia). */
export async function getCommissionReceptionSplit(params: ActionParams) {
  const [rows, rules] = await Promise.all([fetchSalesForPeriod(params), readRunRules()])
  type Grp = { branch: string; account: string; recipients: string[]; units: number }
  const groups: Grp[] = []
  const seen = new Map<string, Grp>()
  for (const r of rows) {
    if (String(r.category || "") !== "PRODUCTO") continue
    if (isNonIncentiveItem(r.service_name)) continue
    const branch = String(r.branch || "")
    const splits = receptionSplitsForBranch(branch)
    if (!splits.length) continue
    const name = normalizeName(classifyProvider(r.provider_original ?? r.provider_normalized).name)
    const split = splits.find((s) => name === s.account)
    if (!split) continue
    const key = `${branch}||${split.account}`
    let g = seen.get(key)
    if (!g) { g = { branch, account: split.account, recipients: split.recipients, units: 0 }; seen.set(key, g); groups.push(g) }
    g.units += Number(r.quantity) || 0
  }
  const allRecips = [...new Set(groups.flatMap((g) => g.recipients.map((x) => canonicalCollaborator(x))))]
  const rates = await productRatesForProviders(allRecips, rules.productUnitAmount)
  const detail = groups.map((g) => {
    const recips = g.recipients.map((x) => canonicalCollaborator(x))
    const shares = allocateInt(g.units, recips.length)
    return {
      branch: g.branch, account: g.account, totalUnits: g.units,
      recipients: recips.map((name, i) => ({
        name, units: shares[i], rate: rates[name] ?? rules.productUnitAmount,
        incentive: round2(shares[i] * (rates[name] ?? rules.productUnitAmount)),
      })),
    }
  }).sort((a, b) => a.branch.localeCompare(b.branch) || a.account.localeCompare(b.account))
  const totalUnits = detail.reduce((s, d) => s + d.totalUnits, 0)
  const totalIncentive = round2(detail.reduce((s, d) => s + d.recipients.reduce((x, r) => x + r.incentive, 0), 0))
  return { ok: true, rows: detail, totals: { units: totalUnits, incentive: totalIncentive } }
}

/** Tarifa de incentivo por unidad de producto de cada prestador: la propia del
 *  roster (`product_unit_amount`) o la regla general. */
async function productRatesForProviders(providers: string[], generalRate: number): Promise<Record<string, number>> {
  const business_id = requireBizId()
  const rates: Record<string, number> = {}
  providers.forEach((p) => { rates[p] = generalRate })
  if (!providers.length) return rates
  const { data } = await getSupabaseAdmin().from("sales_commission_collaborators")
    .select("name,product_unit_amount").eq("business_id", business_id).is("deleted_at", null)
    .in("name", providers)
  for (const r of (data || []) as Row[]) {
    if (r.product_unit_amount != null) rates[String(r.name)] = Number(r.product_unit_amount)
  }
  return rates
}

/** Asigna MANUALMENTE un prestador a ventas sin prestador y recalcula su
 *  liquidación en el/los período(s) afectado(s): servicios suman venta × % de
 *  la categoría; productos suman unidades × tarifa (propia del roster o regla
 *  general). Crea la fila de liquidación si no existía. Auditado. */
export async function assignCommissionSaleProvider(params: ActionParams, user: ActionUser) {
  requirePermission("sales_commission.adjust")
  const business_id = requireBizId()
  const provider = canonicalCollaborator(textValue(params, "provider") || "")
  if (!provider) throw new Error("Falta el prestador a asignar")
  const ids = (Array.isArray(params.ids) ? params.ids : String(params.ids || "").split(",")).map((x) => String(x).trim()).filter(Boolean)
  if (!ids.length) throw new Error("Selecciona al menos una venta")
  const sb = getSupabaseAdmin()

  const { data: rowsRaw, error: selErr } = await sb.from("sales_commission_sales")
    .select("id,sale_date,service_name,branch,category,gross_amount,quantity,provider_original,assigned_at")
    .eq("business_id", business_id).in("id", ids)
  if (selErr) throw new Error(selErr.message)
  const rows = ((rowsRaw || []) as Row[]).filter((r) => !r.assigned_at &&
    String(r.category || "") !== "DEPILACION_LASER")
  if (!rows.length) throw new Error("Las ventas seleccionadas ya tienen prestador o no aplican")

  // Delta por período: servicios Σ round2(base × %) por categoría; productos
  // Σ unidades × tarifa del prestador. Los insumos sin incentivo (rasuradoras,
  // anestesia) y los prestadores excluidos NO generan delta: se asignan igual
  // pero no suman incentivo (misma regla que el motor de liquidación).
  const providerExcluded = isExcludedProvider(provider)
  const rules = await readRunRules()
  const rate = (await productRatesForProviders([provider], rules.productUnitAmount))[provider]
  const byPeriod = new Map<string, { month: number; year: number; branch: string; byCat: Record<string, number>; prodUnits: number }>()
  for (const r of rows) {
    if (providerExcluded || isNonIncentiveItem(r.service_name)) continue
    const d = String(r.sale_date || "").slice(0, 10)
    const year = Number(d.slice(0, 4)), month = Number(d.slice(5, 7))
    if (!year || !month) continue
    const key = `${year}-${month}`
    let p = byPeriod.get(key)
    if (!p) { p = { month, year, branch: String(r.branch || ""), byCat: {}, prodUnits: 0 }; byPeriod.set(key, p) }
    const cat = String(r.category || "")
    if (cat === "PRODUCTO") p.prodUnits += Number(r.quantity) || 0
    else p.byCat[cat] = round2((p.byCat[cat] || 0) + (Number(r.gross_amount) || 0))
  }

  // Planificar y VALIDAR (períodos cerrados) ANTES de escribir nada.
  const deltas: { month: number; year: number; delta: number }[] = []
  const plans: { p: { month: number; year: number; branch: string; prodUnits: number }; svcDelta: number; prodDelta: number; delta: number; calc: Row | undefined }[] = []
  for (const p of byPeriod.values()) {
    const svcDelta = round2(Object.entries(p.byCat).reduce((s, [cat, base]) => {
      const pct = rules.categoryPct[cat]
      return s + (pct != null ? round2(base * pct) : 0)
    }, 0))
    const prodDelta = round2(p.prodUnits * rate)
    const delta = round2(svcDelta + prodDelta)
    deltas.push({ month: p.month, year: p.year, delta })
    if (!delta && !p.prodUnits) continue
    const { data: calcRows } = await sb.from("sales_commission_calculations").select("*")
      .eq("business_id", business_id).eq("period_month", p.month).eq("period_year", p.year)
      .eq("provider_name_snapshot", provider).order("created_at", { ascending: false }).limit(1)
    const calc = (calcRows || [])[0] as Row | undefined
    if (calc && String(calc.status) === "cerrado") throw new Error(`Período ${p.month}/${p.year} cerrado: no se puede recalcular`)
    plans.push({ p, svcDelta, prodDelta, delta, calc })
  }

  const now = new Date().toISOString()
  const { error: upErr } = await sb.from("sales_commission_sales")
    .update({ provider_normalized: provider, assigned_at: now, assigned_by: user.email || user.id || null })
    .eq("business_id", business_id).in("id", rows.map((r) => String(r.id)))
  if (upErr) throw new Error(upErr.message)

  for (const { p, svcDelta, prodDelta, delta, calc } of plans) {
    if (calc) {
      const { error } = await sb.from("sales_commission_calculations")
        .update({
          products_count: round2((Number(calc.products_count) || 0) + p.prodUnits),
          product_incentive: round2((Number(calc.product_incentive) || 0) + prodDelta),
          service_commission: round2((Number(calc.service_commission) || 0) + svcDelta),
          gross_total: round2((Number(calc.gross_total) || 0) + delta),
          net_total: round2((Number(calc.net_total) || 0) + delta),
          updated_at: now,
        })
        .eq("id", calc.id).eq("business_id", business_id)
      if (error) throw new Error(error.message)
    } else {
      const { error } = await sb.from("sales_commission_calculations").insert({
        business_id, period_month: p.month, period_year: p.year,
        provider_name_snapshot: provider, branch: p.branch || null,
        products_count: p.prodUnits, product_incentive: prodDelta, service_commission: svcDelta,
        laser_incentive: 0, fixed_incentive: 0, manual_adjustment: 0, bonus_extra: 0,
        gross_total: delta, cleaning_contribution: 0, net_total: delta,
        status: "calculado", calculated_by: user.email || user.id || null,
      })
      if (error) throw new Error(error.message)
    }
  }

  const first = deltas[0]
  await logAudit(user, "sale", ids.join(","), "prestador_asignado",
    null, { provider, rows: rows.length, deltas }, textValue(params, "reason") || null,
    first ? { month: first.month, year: first.year } : undefined)
  return { ok: true, updated: rows.length, provider, deltas }
}

/** Servicios con prestador ASIGNADO manualmente (para revisar/deshacer). */
export async function getCommissionAssignedServices(params: ActionParams) {
  const rows = await fetchSalesForPeriod(params)
  const out = rows
    .filter((r) => r.assigned_at)
    .map((r) => ({
      id: String(r.id),
      date: r.sale_date ? String(r.sale_date).slice(0, 10) : "",
      branch: String(r.branch || "(sin sucursal)"),
      customer: String(r.customer_name || ""),
      service: String(r.service_name || ""),
      category: String(r.category || "OTROS"),
      quantity: Number(r.quantity) || 0,
      amount: Number(r.gross_amount) || 0,
      providerOriginal: String(r.provider_original || ""),
      provider: String(r.provider_normalized || ""),
      assignedBy: String(r.assigned_by || ""),
      assignedAt: String(r.assigned_at).slice(0, 10),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.branch.localeCompare(b.branch))
  return {
    ok: true, rows: out,
    totals: { count: out.length, amount: round2(out.reduce((s, r) => s + r.amount, 0)) },
  }
}

/** Deshace asignaciones manuales: resta el delta (servicios: venta × %;
 *  productos: unidades × tarifa) de la liquidación del prestador en el período
 *  y devuelve la venta a su clasificación original del archivo. Bloquea
 *  períodos cerrados. Auditado. */
export async function unassignCommissionSaleProvider(params: ActionParams, user: ActionUser) {
  requirePermission("sales_commission.adjust")
  const business_id = requireBizId()
  const ids = (Array.isArray(params.ids) ? params.ids : String(params.ids || "").split(",")).map((x) => String(x).trim()).filter(Boolean)
  if (!ids.length) throw new Error("Selecciona al menos una venta")
  const sb = getSupabaseAdmin()

  const { data: rowsRaw, error: selErr } = await sb.from("sales_commission_sales")
    .select("id,sale_date,service_name,branch,category,gross_amount,quantity,provider_original,provider_normalized,assigned_at")
    .eq("business_id", business_id).in("id", ids)
  if (selErr) throw new Error(selErr.message)
  const rows = ((rowsRaw || []) as Row[]).filter((r) => r.assigned_at)
  if (!rows.length) throw new Error("Las ventas seleccionadas no tienen asignación manual")

  // Reversa por prestador × período: mismo cálculo que la asignación. Los
  // insumos sin incentivo y los prestadores excluidos no habían sumado delta,
  // así que tampoco se revierten (simetría exacta con la asignación).
  const rules = await readRunRules()
  const groups = new Map<string, { provider: string; month: number; year: number; byCat: Record<string, number>; prodUnits: number }>()
  for (const r of rows) {
    const provider = String(r.provider_normalized || "")
    if (!provider || isExcludedProvider(provider) || isNonIncentiveItem(r.service_name)) continue
    const d = String(r.sale_date || "").slice(0, 10)
    const year = Number(d.slice(0, 4)), month = Number(d.slice(5, 7))
    if (!year || !month) continue
    const key = `${provider}||${year}-${month}`
    let g = groups.get(key)
    if (!g) { g = { provider, month, year, byCat: {}, prodUnits: 0 }; groups.set(key, g) }
    const cat = String(r.category || "")
    if (cat === "PRODUCTO") g.prodUnits += Number(r.quantity) || 0
    else g.byCat[cat] = round2((g.byCat[cat] || 0) + (Number(r.gross_amount) || 0))
  }
  const rates = await productRatesForProviders([...new Set([...groups.values()].map((g) => g.provider))], rules.productUnitAmount)
  const now = new Date().toISOString()

  // Planificar y VALIDAR (períodos cerrados) ANTES de escribir nada.
  const deltas: { provider: string; month: number; year: number; delta: number }[] = []
  const plans: { g: { provider: string; month: number; year: number; prodUnits: number }; svcDelta: number; prodDelta: number; delta: number; calc: Row }[] = []
  for (const g of groups.values()) {
    const svcDelta = round2(Object.entries(g.byCat).reduce((s, [cat, base]) => {
      const pct = rules.categoryPct[cat]
      return s + (pct != null ? round2(base * pct) : 0)
    }, 0))
    const prodDelta = round2(g.prodUnits * (rates[g.provider] ?? rules.productUnitAmount))
    const delta = round2(svcDelta + prodDelta)
    deltas.push({ provider: g.provider, month: g.month, year: g.year, delta })
    if (!delta && !g.prodUnits) continue
    const { data: calcRows } = await sb.from("sales_commission_calculations").select("*")
      .eq("business_id", business_id).eq("period_month", g.month).eq("period_year", g.year)
      .eq("provider_name_snapshot", g.provider).order("created_at", { ascending: false }).limit(1)
    const calc = (calcRows || [])[0] as Row | undefined
    if (!calc) continue // sin fila de liquidación no hay nada que revertir
    if (String(calc.status) === "cerrado") throw new Error(`Período ${g.month}/${g.year} cerrado: no se puede revertir`)
    plans.push({ g, svcDelta, prodDelta, delta, calc })
  }

  // Devolver cada venta a la clasificación del archivo fuente.
  await Promise.all(rows.map(async (r) => {
    const original = classifyProvider(r.provider_original)
    const { error } = await sb.from("sales_commission_sales")
      .update({ provider_normalized: original.name || null, assigned_at: null, assigned_by: null })
      .eq("id", r.id).eq("business_id", business_id)
    if (error) throw new Error(error.message)
  }))

  for (const { g, svcDelta, prodDelta, delta, calc } of plans) {
    const { error } = await sb.from("sales_commission_calculations")
      .update({
        products_count: round2((Number(calc.products_count) || 0) - g.prodUnits),
        product_incentive: round2((Number(calc.product_incentive) || 0) - prodDelta),
        service_commission: round2((Number(calc.service_commission) || 0) - svcDelta),
        gross_total: round2((Number(calc.gross_total) || 0) - delta),
        net_total: round2((Number(calc.net_total) || 0) - delta),
        updated_at: now,
      })
      .eq("id", calc.id).eq("business_id", business_id)
    if (error) throw new Error(error.message)
  }

  const first = deltas[0]
  await logAudit(user, "sale", ids.join(","), "prestador_desasignado",
    null, { rows: rows.length, deltas }, textValue(params, "reason") || null,
    first ? { month: first.month, year: first.year } : undefined)
  return { ok: true, updated: rows.length, deltas }
}

/** REASIGNA ventas ya asignadas a otro prestador en una sola operación:
 *  primero deshace (resta el delta al prestador equivocado) y luego asigna al
 *  correcto (le suma su delta, con SU tarifa de producto). Ambos pasos quedan
 *  auditados (prestador_desasignado + prestador_asignado). */
export async function reassignCommissionSaleProvider(params: ActionParams, user: ActionUser) {
  const removed = await unassignCommissionSaleProvider(params, user)
  const added = await assignCommissionSaleProvider(params, user)
  return { ok: true, updated: added.updated, provider: added.provider, removed: removed.deltas, added: added.deltas }
}

/** Clientes atendidos por prestador. Fuente preferida: RESERVAS (atenciones
 *  ASISTE persistidas en patient_counts al importar); fallback: derivado de
 *  ventas (clientes distintos) si el período no tiene reservas cargadas. */
export async function getCommissionPatients(params: ActionParams) {
  const business_id = requireBizId()
  let pcQ = getSupabaseAdmin().from("sales_commission_patient_counts")
    .select("provider_name,branch,patient_count,unique_patients,period_month,period_year")
    .eq("business_id", business_id).eq("source", "reservas")
  const branch = textValue(params, "branch")
  if (branch) pcQ = pcQ.eq("branch", branch)
  const providerF = textValue(params, "provider")
  if (providerF) pcQ = pcQ.eq("provider_name", providerF)
  const { data: pcAll } = await pcQ
  const p = periodFilter(params)
  const pcRows = (pcAll || []).filter((r) => !p || p.months.has(`${Number((r as Row).period_year)}-${Number((r as Row).period_month)}`))
  if (pcRows && pcRows.length) {
    // Agregar (si no hay filtro de período, suma todos los meses cargados).
    const agg = new Map<string, { provider: string; branch: string; patients: number; uniquePatients: number }>()
    for (const r of pcRows as Row[]) {
      const key = String(r.provider_name || "")
      let e = agg.get(key)
      if (!e) { e = { provider: key, branch: String(r.branch || ""), patients: 0, uniquePatients: 0 }; agg.set(key, e) }
      e.patients += Number(r.patient_count) || 0
      e.uniquePatients += Number(r.unique_patients) || 0
    }
    const list = [...agg.values()]
    const total = list.reduce((s, e) => s + e.patients, 0)
    const rowsOut = list.map((e) => ({ ...e, participation: total ? Math.round((e.patients / total) * 10000) / 100 : 0 }))
      .sort((a, b) => b.patients - a.patients)
    const sumPct = round2(rowsOut.reduce((s, r) => s + r.participation, 0))
    return { ok: true, total, roundingDiff: round2(sumPct - 100), rows: rowsOut, sourceUsed: "reservas" }
  }
  return getCommissionPatientsFromSales(params)
}

/** Fallback histórico: clientes distintos derivados de las ventas. */
async function getCommissionPatientsFromSales(params: ActionParams) {
  const rows = await fetchSalesForPeriod(params)
  const byProv = new Map<string, { provider: string; branch: string; patients: Set<string> }>()
  for (const r of rows) {
    const info = effectiveProvider(r)
    if (!info.commissionable) continue
    const prov = info.name
    let e = byProv.get(prov)
    if (!e) { e = { provider: prov, branch: String(r.branch || ""), patients: new Set() }; byProv.set(prov, e) }
    if (r.customer_name) e.patients.add(String(r.customer_name))
  }
  const list = [...byProv.values()].map((e) => ({ provider: e.provider, branch: e.branch, patients: e.patients.size }))
  const total = list.reduce((s, e) => s + e.patients, 0)
  const rowsOut = list.map((e) => ({ ...e, participation: total ? Math.round((e.patients / total) * 10000) / 100 : 0 }))
    .sort((a, b) => b.patients - a.patients)
  const sumPct = round2(rowsOut.reduce((s, r) => s + r.participation, 0))
  return { ok: true, total, roundingDiff: round2(sumPct - 100), rows: rowsOut, sourceUsed: "ventas" }
}

/** Comisión láser: fondo por escala + reparto por participación de pacientes. */
export async function getCommissionLaser(params: ActionParams) {
  const business_id = requireBizId()
  const rows = await fetchSalesForPeriod(params)
  // Venta láser BRUTA y BASE NETA por sucursal.
  // La liquidación real NETEA la TARJETA (bruta × (1 − cardPct)) ANTES de aplicar
  // la escala; efectivo/transferencia/otros entran completos. El tramo se calcula
  // sobre esta base neta, no sobre la venta bruta.
  const cardPct = await cardPercentage()
  let laserTotal = 0 // venta láser bruta (informativa)
  const grossByBranch: Record<string, number> = {}
  const netByBranch: Record<string, number> = {}
  for (const r of rows) if (String(r.category) === "DEPILACION_LASER") {
    const gross = Number(r.gross_amount) || 0
    const pm = String(r.payment_method || "OTROS")
    const net = pm === "TARJETA" ? round2(gross * (1 - cardPct)) : gross
    const b = String(r.branch || "(sin sucursal)")
    laserTotal = round2(laserTotal + gross)
    grossByBranch[b] = round2((grossByBranch[b] || 0) + gross)
    netByBranch[b] = round2((netByBranch[b] || 0) + net)
  }
  // Escala desde reglas.
  const { data: scaleRows } = await getSupabaseAdmin().from("sales_commission_rules")
    .select("min_amount,percentage").eq("business_id", business_id).eq("rule_type", "laser_scale").eq("active", true)
  const scale = (scaleRows || []).map((s) => ({ threshold: Number((s as Row).min_amount), percentage: Number((s as Row).percentage) }))
    .filter((s) => Number.isFinite(s.threshold)).sort((a, b) => a.threshold - b.threshold)
  // TRAMO POR SUCURSAL sobre la BASE NETA (tarjeta neteada antes de la escala):
  // cada sucursal cae en su propio tramo según SU base neta individual. El fondo
  // total = suma de los fondos por sucursal. El % y el incentivo varían mes a mes
  // según la venta de cada sucursal. Alinea el reporte con la liquidación real.
  const tramoFor = (amount: number) => scale.filter((t) => amount >= t.threshold).sort((a, b) => b.threshold - a.threshold)[0] || null
  const branchDetail = Object.keys(grossByBranch)
    .map((branch) => {
      const gross = grossByBranch[branch]
      const base = netByBranch[branch] || 0
      const t = tramoFor(base)
      const pct = t?.percentage || 0
      return { branch, gross, base, pct, threshold: t?.threshold || 0, fund: round2(base * pct) }
    })
    .sort((a, b) => a.branch.localeCompare(b.branch))
  const fund = round2(branchDetail.reduce((s, b) => s + b.fund, 0))
  // % efectivo global (solo informativo): fondo total / venta total.
  const tramoPct = laserTotal > 0 ? Math.round((fund / laserTotal) * 10000) / 10000 : 0
  // Reparto por participación de pacientes.
  const pat = await getCommissionPatients(params)
  const distribution = pat.rows.map((p) => ({ provider: p.provider, patients: p.patients, participation: p.participation, amount: round2(fund * (p.participation / 100)) }))
  return { ok: true, laserTotal, byBranch: branchDetail, cardPct, tramoPct, fund, threshold: 0, distribution, patientsTotal: pat.total }
}

/** Sucursales de Cibao para el cálculo láser POR SUCURSAL. */
const LASER_BRANCHES = ["RAFAEL VIDAL", "LOS JARDINES", "VILLA OLGA"]

/**
 * Reparto láser CORREGIDO de un mes: corre el motor POR SUCURSAL (tarjeta
 * neteada → escala → fondo → reparto personas/pacientes) y agrega el láser total
 * de cada prestador entre sucursales. Devuelve la distribución por prestador +
 * el fondo total y el detalle por sucursal.
 */
async function laserDistributionForMonth(month: number, year: number) {
  const perProvider = new Map<string, number>()
  let fundTotal = 0
  const byBranch: { branch: string; base: number; pct: number; fund: number }[] = []
  for (const branch of LASER_BRANCHES) {
    const r = await computeRunForPeriod(branch, month, year)
    fundTotal = round2(fundTotal + r.laser.fund)
    byBranch.push({ branch, base: r.laser.base, pct: r.laser.pct, fund: r.laser.fund })
    for (const it of r.items) {
      if (it.laserTotal > 0) perProvider.set(it.name, round2((perProvider.get(it.name) || 0) + it.laserTotal))
    }
  }
  const distribution = [...perProvider.entries()].map(([provider, amount]) => ({ provider, amount }))
  return { distribution, fund: fundTotal, byBranch }
}

/**
 * Aplica el fondo láser del período a la LIQUIDACIÓN de cada empleado:
 * escribe `laser_incentive` (reparto CORREGIDO por sucursal: tarjeta neteada →
 * escala → personas + pacientes) en los cálculos del mes y recalcula bruto/neto.
 * Se procesa MES POR MES (fondo y escala son mensuales). Idempotente: re-aplicar
 * sincroniza con el reparto vigente (incluye poner en 0 a quien salió del
 * reparto). Filas pagadas/cerradas no se tocan y se reportan.
 */
export async function applyCommissionLaser(params: ActionParams, user: ActionUser) {
  requirePermission("sales_commission.calculate")
  const business_id = requireBizId()
  const sb = getSupabaseAdmin()
  const p = periodFilter(params)
  if (!p) throw new Error("Selecciona un período (mes o rango) para aplicar el fondo láser")
  const months = [...p.months].map((k) => {
    const [year, month] = k.split("-").map(Number)
    return { year, month }
  }).sort((a, b) => a.year - b.year || a.month - b.month)

  const results = []
  for (const { year, month } of months) {
    const laser = await laserDistributionForMonth(month, year)
    const { data: calcRows, error } = await sb.from("sales_commission_calculations").select("*")
      .eq("business_id", business_id).eq("period_year", year).eq("period_month", month)
    if (error) throw new Error(error.message)
    const rows = (calcRows || []) as Row[]
    const plan = assignLaserToCalcs(
      laser.distribution.map((d) => ({ provider: d.provider, amount: d.amount })),
      rows.map((r) => ({
        id: String(r.id), provider: String(r.provider_name_snapshot || ""), branch: String(r.branch || ""),
        status: String(r.status || ""), laserIncentive: Number(r.laser_incentive) || 0, grossTotal: Number(r.gross_total) || 0,
      })),
    )
    const byId = new Map(rows.map((r) => [String(r.id), r]))
    const updates = await Promise.all(plan.assignments.map(async (a) => {
      const merged = { ...byId.get(a.id), laser_incentive: a.laserIncentive } as Row
      const num = (k: string) => Number(merged[k]) || 0
      const gross = round2(num("product_incentive") + num("service_commission") + num("laser_incentive") + num("fixed_incentive") + num("manual_adjustment") + num("bonus_extra"))
      const net = round2(gross - num("cleaning_contribution"))
      const { error: upErr } = await sb.from("sales_commission_calculations")
        .update({ laser_incentive: a.laserIncentive, gross_total: gross, net_total: net, updated_at: new Date().toISOString() })
        .eq("id", a.id).eq("business_id", business_id)
      return upErr
    }))
    const failed = updates.find(Boolean)
    if (failed) throw new Error(`Error aplicando láser ${month}/${year}: ${failed.message}`)
    await logAudit(user, "calculation", null, "laser_fund_aplicado", null, {
      fund: laser.fund, byBranch: laser.byBranch,
      updated: plan.assignments.length, appliedTotal: plan.appliedTotal,
      unmatched: plan.unmatched, locked: plan.locked,
    }, textValue(params, "reason") || null, { month, year })
    results.push({
      month, year, fund: laser.fund, byBranch: laser.byBranch,
      updated: plan.assignments.length, appliedTotal: plan.appliedTotal,
      unmatched: plan.unmatched, locked: plan.locked,
    })
  }
  return { ok: true, results, totalApplied: round2(results.reduce((s, r) => s + r.appliedTotal, 0)) }
}

// ── Dashboard ejecutivo ──────────────────────────────────────────────────────
const MONTHS_ES_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
const monthLabel = (y: number, m: number) => `${MONTHS_ES_SHORT[m - 1] || ""} ${y}`
/** Variación % con 1 decimal; null si no hay base de comparación. */
const pctChange = (cur: number, prev: number): number | null =>
  prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : null
const fmtRDS = (n: number) => "RD$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

interface MonthlyAgg { y: number; m: number; branch: string; payment: string; gross: number; n: number }

/** Agregación mensual de ventas (año, mes, sucursal, pago) vía la función SQL
 *  `sc_sales_monthly`; si no existe en la DB, cae a agregar las ventas crudas
 *  por páginas (lento pero correcto). */
async function fetchMonthlyAggregates(
  business_id: string, fromISO: string, toEx: string,
  branch: string | null, provider: string | null,
): Promise<MonthlyAgg[]> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.rpc("sc_sales_monthly", {
    p_business: business_id, p_from: fromISO, p_to_ex: toEx, p_branch: branch, p_provider: provider,
  })
  if (!error) {
    return ((data || []) as Row[]).map((r) => ({
      y: Number(r.y) || 0, m: Number(r.m) || 0, branch: String(r.branch || "(sin sucursal)"),
      payment: String(r.payment || "OTROS"), gross: Number(r.gross) || 0, n: Number(r.n) || 0,
    }))
  }
  const agg = new Map<string, MonthlyAgg>()
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    let q = sb.from("sales_commission_sales").select("sale_date,branch,payment_method,gross_amount")
      .eq("business_id", business_id).gte("sale_date", fromISO).lt("sale_date", toEx)
      .order("id", { ascending: true }).range(offset, offset + PAGE - 1)
    if (branch) q = q.eq("branch", branch)
    if (provider) q = q.eq("provider_normalized", provider)
    const { data: page, error: pErr } = await q
    if (pErr) throw new Error(pErr.message)
    for (const r of (page || []) as Row[]) {
      const d = String(r.sale_date || "")
      const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7))
      if (!y || !m) continue
      const b = String(r.branch || "(sin sucursal)"), pm = String(r.payment_method || "OTROS")
      const k = `${y}-${m}|${b}|${pm}`
      const e = agg.get(k) || { y, m, branch: b, payment: pm, gross: 0, n: 0 }
      e.gross = round2(e.gross + (Number(r.gross_amount) || 0)); e.n++
      agg.set(k, e)
    }
    if (!page || page.length < PAGE) break
  }
  return [...agg.values()]
}

/**
 * Dashboard EJECUTIVO de Incentivos de Ventas — una sola llamada con todo lo que
 * pinta la pantalla: KPIs del período con comparativas vs mes anterior, ventas
 * por sucursal, composición de incentivos, tendencia de 6 meses, top
 * prestadores, resumen de liquidación e insights. Las comparativas solo se
 * calculan cuando el período seleccionado es UN MES COMPLETO.
 */
export async function getCommissionExecutiveDashboard(params: ActionParams) {
  const business_id = requireBizId()
  const branchF = textValue(params, "branch") || null
  const providerF = textValue(params, "provider") || null
  const passThrough: ActionParams = {
    ...(branchF ? { branch: branchF } : {}), ...(providerF ? { provider: providerF } : {}),
  }

  // Mes ancla = el seleccionado (o el mes actual en la TZ del negocio).
  const today = todayInTz()
  const [ty, tm] = today.split("-").map(Number)
  const anchorYear = numberValue(params, "year") || ty
  const anchorMonth = numberValue(params, "month") || tm
  const anchorB = monthBounds(anchorYear, anchorMonth)
  const hasPeriod = Boolean(periodFilter(params))
  const isFullMonth = hasPeriod && textValue(params, "from") === anchorB.from && textValue(params, "to") === anchorB.to
  const prevYear = anchorMonth === 1 ? anchorYear - 1 : anchorYear
  const prevMonth = anchorMonth === 1 ? 12 : anchorMonth - 1

  // Tendencia: 6 meses hasta el ancla (incluye el mes anterior para comparar).
  const trendMonths: { year: number; month: number }[] = []
  {
    let y = anchorYear, m = anchorMonth
    for (let i = 0; i < 6; i++) { trendMonths.unshift({ year: y, month: m }); m--; if (m < 1) { m = 12; y-- } }
  }
  const trendFrom = monthBounds(trendMonths[0].year, trendMonths[0].month).from
  const trendToEx = exclusiveEnd(anchorB.to)

  const [rows, calcsRes, patientsRes, importsMonthRes, pendingRes, monthlyAgg, prevCalcsRes, prevPatientsRes] = await Promise.all([
    fetchSalesForPeriod(params),
    getCommissionCalculations(params),
    getCommissionPatients(params),
    getCommissionImports({ from: anchorB.from, to: anchorB.to, dateField: "created" }),
    getCommissionImports({ status: "borrador" }),
    fetchMonthlyAggregates(business_id, trendFrom, trendToEx, branchF, providerF),
    isFullMonth ? getCommissionCalculations({ month: prevMonth, year: prevYear, ...passThrough }) : Promise.resolve(null),
    isFullMonth ? getCommissionPatients({ month: prevMonth, year: prevYear, ...passThrough }) : Promise.resolve(null),
  ])

  // — Ventas del período (filas ya filtradas por período/sucursal/prestador).
  let salesTotal = 0, cardTotal = 0
  const byBranchMap = new Map<string, number>()
  const provSales = new Map<string, number>()
  for (const r of rows) {
    const amt = Number(r.gross_amount) || 0
    salesTotal = round2(salesTotal + amt)
    if (String(r.payment_method || "") === "TARJETA") cardTotal = round2(cardTotal + amt)
    const b = String(r.branch || "(sin sucursal)")
    byBranchMap.set(b, round2((byBranchMap.get(b) || 0) + amt))
    const info = effectiveProvider(r)
    if (info.commissionable) {
      provSales.set(info.name, round2((provSales.get(info.name) || 0) + amt))
    }
  }
  const salesCount = rows.length
  const ticketAvg = salesCount ? round2(salesTotal / salesCount) : 0
  const cardSharePct = salesTotal ? Math.round((cardTotal / salesTotal) * 1000) / 10 : 0

  // — Incentivos del período (cálculos vivos).
  const calcs = calcsRes.records
  const sumC = (f: (c: (typeof calcs)[number]) => number) => round2(calcs.reduce((s, c) => s + f(c), 0))
  const serviceCommission = sumC((c) => c.serviceCommission)
  const productIncentive = sumC((c) => c.productIncentive)
  const laserIncentive = sumC((c) => c.laserIncentive)
  const bonusExtra = sumC((c) => c.bonusExtra)
  const grossTotal = sumC((c) => c.grossTotal)
  const cleaning = sumC((c) => c.cleaningContribution)
  const netTotal = sumC((c) => c.netTotal)
  const productUnits = calcs.reduce((s, c) => s + c.productsCount, 0)
  // "Descuentos" en el resumen = ajustes manuales NEGATIVOS (ya dentro del
  // bruto) mostrados como línea propia: bruto_mostrado − descuentos − limpieza = neto.
  const discounts = round2(Math.abs(calcs.reduce((s, c) => s + Math.min(0, c.manualAdjustment), 0)))

  // — Tendencia + mes anterior desde la agregación mensual.
  const monthAgg = (y: number, m: number) => monthlyAgg.filter((r) => r.y === y && r.m === m)
  const trend = trendMonths.map(({ year, month }) => ({
    year, month, label: monthLabel(year, month),
    sales: round2(monthAgg(year, month).reduce((s, r) => s + r.gross, 0)),
  }))
  const prevAgg = monthAgg(prevYear, prevMonth)
  const prevSales = round2(prevAgg.reduce((s, r) => s + r.gross, 0))
  const prevCard = round2(prevAgg.filter((r) => r.payment === "TARJETA").reduce((s, r) => s + r.gross, 0))
  const prevCount = prevAgg.reduce((s, r) => s + r.n, 0)
  const prevTicket = prevCount ? round2(prevSales / prevCount) : 0
  const prevCardShare = prevSales ? Math.round((prevCard / prevSales) * 1000) / 10 : 0
  const prevByBranch = new Map<string, number>()
  for (const r of prevAgg) prevByBranch.set(r.branch, round2((prevByBranch.get(r.branch) || 0) + r.gross))

  const prevCalcs = prevCalcsRes?.records || []
  const sumP = (f: (c: (typeof prevCalcs)[number]) => number) => round2(prevCalcs.reduce((s, c) => s + f(c), 0))
  const deltas = isFullMonth ? {
    salesTotal: pctChange(salesTotal, prevSales),
    serviceCommission: pctChange(serviceCommission, sumP((c) => c.serviceCommission)),
    productIncentive: pctChange(productIncentive, sumP((c) => c.productIncentive)),
    laserIncentive: pctChange(laserIncentive, sumP((c) => c.laserIncentive)),
    bonusExtra: pctChange(bonusExtra, sumP((c) => c.bonusExtra)),
    netTotal: pctChange(netTotal, sumP((c) => c.netTotal)),
    patients: pctChange(patientsRes.total, prevPatientsRes?.total ?? 0),
    productUnits: pctChange(productUnits, prevCalcs.reduce((s, c) => s + c.productsCount, 0)),
    cardSharePp: prevSales ? Math.round((cardSharePct - prevCardShare) * 10) / 10 : null,
    ticketAvg: pctChange(ticketAvg, prevTicket),
  } : null

  // — Top prestadores: liquidación (neto) + ventas atribuibles.
  const provMap = new Map<string, { provider: string; sales: number; commission: number; incentives: number; net: number }>()
  for (const c of calcs) {
    const k = String(c.provider || "").trim().toUpperCase()
    if (!k) continue
    const e = provMap.get(k) || { provider: String(c.provider), sales: 0, commission: 0, incentives: 0, net: 0 }
    e.commission = round2(e.commission + c.serviceCommission)
    e.incentives = round2(e.incentives + c.productIncentive + c.laserIncentive + c.fixedIncentive + c.bonusExtra)
    e.net = round2(e.net + c.netTotal)
    provMap.set(k, e)
  }
  for (const [prov, amount] of provSales) {
    const k = prov.trim().toUpperCase()
    const e = provMap.get(k)
    if (e) e.sales = round2(e.sales + amount)
  }
  const topProviders = [...provMap.values()].sort((a, b) => b.net - a.net).slice(0, 5)

  const byBranch = [...byBranchMap.entries()].map(([branch, gross]) => ({ branch, gross }))
    .sort((a, b) => b.gross - a.gross).slice(0, 5)
  const composition = [
    { name: "Comisiones servicios", value: serviceCommission },
    { name: "Incentivos productos", value: productIncentive },
    { name: "Incentivo láser", value: laserIncentive },
    { name: "Bono extra", value: bonusExtra },
  ]

  // — Insights del período.
  const insights: { tone: "success" | "info" | "warning"; title: string; detail: string }[] = []
  const topComm = [...calcs].sort((a, b) => b.serviceCommission - a.serviceCommission)[0]
  if (topComm && topComm.serviceCommission > 0) {
    insights.push({ tone: "success", title: `${topComm.provider} lidera comisiones del período`, detail: `Con ${fmtRDS(topComm.serviceCommission)} en comisiones generadas.` })
  } else {
    insights.push({ tone: "info", title: "Sin comisiones calculadas en el período", detail: "Importa el archivo de ventas para generar los cálculos." })
  }
  let growth: { branch: string; g: number } | null = null
  if (isFullMonth) {
    for (const [b, cur] of byBranchMap) {
      const prev = prevByBranch.get(b) || 0
      if (prev > 0) {
        const g = Math.round(((cur - prev) / prev) * 1000) / 10
        if (!growth || g > growth.g) growth = { branch: b, g }
      }
    }
  }
  if (growth) {
    insights.push({ tone: "info", title: `${growth.branch} tuvo el mayor crecimiento`, detail: `Crecimiento del ${growth.g.toFixed(1)}% en ventas vs. mes anterior.` })
  } else if (byBranch[0]) {
    insights.push({ tone: "info", title: `${byBranch[0].branch} lidera las ventas del período`, detail: `Con ${fmtRDS(byBranch[0].gross)} en ventas.` })
  }
  const pending = pendingRes.records.length
  insights.push(pending > 0
    ? { tone: "warning", title: "Importación de reservas pendiente", detail: `Tienes ${pending} importación${pending === 1 ? "" : "es"} por confirmar.` }
    : { tone: "success", title: "Sin importaciones pendientes", detail: "Todas las importaciones están confirmadas." })

  const providerOptions = [...new Set([...calcs.map((c) => String(c.provider || "")), ...provSales.keys()])]
    .filter(Boolean).sort()

  // Etiqueta fiel al filtro: mes=0 con rango = "Todos los meses"; sin período = historial.
  const periodLabel = !hasPeriod ? "Todo el historial"
    : textValue(params, "month") === "0" ? `Todos los meses ${anchorYear}`
    : monthLabel(anchorYear, anchorMonth)
  return {
    ok: true,
    period: { month: anchorMonth, year: anchorYear, label: periodLabel, isFullMonth, hasPeriod },
    prevLabel: monthLabel(prevYear, prevMonth),
    kpis: {
      salesTotal, serviceCommission, productIncentive, laserIncentive, bonusExtra, netTotal,
      employees: calcs.length, importsMonth: importsMonthRes.records.length,
      patients: patientsRes.total, productUnits, cardSharePct, ticketAvg,
    },
    deltas, byBranch, composition, trend, topProviders,
    settlement: { gross: round2(grossTotal + discounts), cleaning, discounts, net: netTotal },
    insights, providers: providerOptions,
  }
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

// ════════════════════════════════════════════════════════════════════════════
// CÁLCULO MENSUAL DE INCENTIVOS (runs por sucursal)
// El motor puro vive en lib/commission/run-engine.ts (computeRun). Aquí solo se
// arma su entrada desde datos persistidos, se corre y se persiste el resultado
// como un run (borrador→finalizado→anulado) con detalle por colaborador.
// ════════════════════════════════════════════════════════════════════════════

/** Fila DB de colaborador → objeto para cliente y motor (RunCollaborator+extras). */
function mapCollaborator(r: Row) {
  return {
    id: String(r.id),
    name: String(r.name || ""),
    branch: String(r.branch || ""),
    services: Array.isArray(r.services) ? (r.services as string[]) : [],
    participationType: r.participation_type ? String(r.participation_type) : "mixto",
    linearParticipation: r.linear_participation !== false,
    patientParticipation: r.patient_participation !== false,
    fixedPercentage: r.fixed_percentage == null ? null : Number(r.fixed_percentage),
    active: r.active !== false,
    cleaningContribution: r.cleaning_contribution == null ? 400 : Number(r.cleaning_contribution),
    bonusExtra: Number(r.bonus_extra) || 0,
    evaluationPct: r.evaluation_pct == null ? 100 : Number(r.evaluation_pct),
    productUnitAmount: r.product_unit_amount == null ? null : Number(r.product_unit_amount),
    notes: r.notes == null ? null : String(r.notes),
  }
}

/** Roster de colaboradores vivos (soft delete excluido). */
async function readRoster(branch?: string, includeInactive = false) {
  const business_id = requireBizId()
  let q = getSupabaseAdmin().from("sales_commission_collaborators")
    .select("*").eq("business_id", business_id).is("deleted_at", null)
    .order("branch", { ascending: true }).order("name", { ascending: true })
  if (branch) q = q.eq("branch", branch)
  if (!includeInactive) q = q.eq("active", true)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data || []).map((r) => mapCollaborator(r as Row))
}

/** Configuración de reglas (RunRules) para el motor, desde las reglas activas. */
async function readRunRules(): Promise<RunRules> {
  const business_id = requireBizId()
  const { data, error } = await getSupabaseAdmin().from("sales_commission_rules")
    .select("rule_type,category,percentage,fixed_amount,min_amount,effective_from,active")
    .eq("business_id", business_id).eq("active", true)
  if (error) throw new Error(error.message)
  const rows = (data || []) as Row[]
  const latest = (type: string) => rows.filter((r) => r.rule_type === type)
    .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0]
  const card = latest("card_percentage")
  const prod = latest("product_unit_incentive")
  const categoryPct: Record<string, number> = {}
  for (const r of rows.filter((r) => r.rule_type === "category_commission")) {
    if (r.category != null && r.percentage != null) categoryPct[String(r.category)] = Number(r.percentage)
  }
  const laserScale = rows
    .filter((r) => r.rule_type === "laser_scale" && r.min_amount != null && r.percentage != null)
    .map((r) => ({ threshold: Number(r.min_amount), percentage: Number(r.percentage) }))
    .sort((a, b) => a.threshold - b.threshold)
  // Reparto láser: pesos configurables por personas/pacientes (suman 100%).
  // Fallback a la regla legacy `laser_split` (fracción por pacientes); si no, 50/50.
  const wPersonas = latest("laser_weight_personas")?.percentage
  const wPacientes = latest("laser_weight_pacientes")?.percentage
  let laserSplitPatientsFraction: number
  if (wPersonas != null || wPacientes != null) {
    const p = Number(wPersonas ?? 0), q = Number(wPacientes ?? 0)
    laserSplitPatientsFraction = p + q > 0 ? q / (p + q) : 0.5
  } else {
    const split = latest("laser_split")?.percentage
    laserSplitPatientsFraction = split != null ? Number(split) : 0.5
  }
  const zeroFlag = latest("laser_zero_patients_fixed")?.fixed_amount
  // Modo de reparto: default EQUITATIVO (cuadro oficial) salvo regla en 0.
  const modeFlag = latest("laser_split_mode")?.fixed_amount
  return {
    cardPct: card?.percentage != null ? Number(card.percentage) : 0.27,
    productUnitAmount: prod?.fixed_amount != null ? Number(prod.fixed_amount) : 100,
    categoryPct,
    laserScale,
    laserSplitPatientsFraction,
    zeroPatientsGetsFixed: zeroFlag == null ? true : Number(zeroFlag) !== 0,
    laserDistributionMode: (modeFlag == null || Number(modeFlag) !== 0 ? "equitativo" : "pesos") as "equitativo" | "pesos",
  }
}

/** Conteos de pacientes por colaborador para un run. Merge POR COLABORADOR: la
 *  captura MANUAL gana sobre reservas (los demás mantienen su valor de reservas). */
async function readPatientsForRun(branch: string, month: number, year: number) {
  const business_id = requireBizId()
  const { data } = await getSupabaseAdmin().from("sales_commission_patient_counts")
    .select("provider_name,patient_count,source")
    .eq("business_id", business_id).eq("branch", branch)
    .eq("period_month", month).eq("period_year", year)
  const rows = (data || []) as Row[]
  const byName = new Map<string, { patients: number; source: string }>()
  for (const r of rows) {
    const name = canonicalCollaborator(r.provider_name)
    if (!name) continue
    const prev = byName.get(name)
    if (!prev || (r.source === "manual" && prev.source !== "manual")) {
      byName.set(name, { patients: Number(r.patient_count) || 0, source: String(r.source || "reservas") })
    }
  }
  const patients = [...byName.entries()].map(([collaborator, v]) => ({ collaborator, patients: v.patients }))
  const anyManual = [...byName.values()].some((v) => v.source === "manual")
  const anyReservas = [...byName.values()].some((v) => v.source !== "manual")
  const source = anyManual ? (anyReservas ? "mixto" : "manual") : rows.length ? "reservas" : "ninguna"
  return { patients, source }
}

/** Ventas del período+sucursal mapeadas al shape del motor. */
async function readRunSales(branch: string, month: number, year: number): Promise<RunSaleRow[]> {
  const rows = await fetchSalesForPeriod({ month, year, branch })
  return rows.map((r) => ({
    branch: String(r.branch || ""),
    category: String(r.category || "OTROS"),
    payment: String(r.payment_method || "OTROS"),
    amount: Number(r.gross_amount) || 0,
    quantity: Number(r.quantity) || 0,
    // Asignación manual: el motor clasifica providerOriginal, así que para las
    // filas asignadas se le pasa el nombre asignado (limpio → comisionable).
    providerOriginal: r.assigned_at && r.provider_normalized ? String(r.provider_normalized) : r.provider_original == null ? null : String(r.provider_original),
    provider: r.provider_normalized == null ? null : String(r.provider_normalized),
    serviceName: r.service_name == null ? null : String(r.service_name),
  }))
}

/** Corre el motor para una sucursal/período a partir de los datos persistidos. */
async function computeRunForPeriod(branch: string, month: number, year: number): Promise<RunResult> {
  const [sales, collaborators, rules] = await Promise.all([
    readRunSales(branch, month, year),
    readRoster(branch, false),
    readRunRules(),
  ])
  const { patients, source } = await readPatientsForRun(branch, month, year)
  return computeRun({ branch, sales, collaborators, patients, patientsSource: source, rules,
    receptionSplits: receptionSplitsForBranch(branch) })
}

function mapRun(r: Row) {
  return {
    id: String(r.id), branch: String(r.branch || ""),
    periodMonth: Number(r.period_month) || 0, periodYear: Number(r.period_year) || 0,
    status: String(r.status || "borrador"), cardPct: Number(r.card_pct) || 0,
    totals: r.totals ?? null, alerts: Array.isArray(r.alerts) ? (r.alerts as string[]) : [],
    baseSummary: r.base_summary ?? null, notes: r.notes == null ? null : String(r.notes),
    finalizedAt: r.finalized_at ?? null, finalizedBy: r.finalized_by ?? null,
    voidedAt: r.voided_at ?? null, voidReason: r.void_reason ?? null,
    createdAt: r.created_at ?? null, updatedAt: r.updated_at ?? null,
  }
}

function mapRunItem(r: Row) {
  return {
    id: String(r.id), collaboratorId: r.collaborator_id ?? null,
    name: String(r.collaborator_name || ""), branch: String(r.branch || ""),
    serviceBreakdown: r.service_breakdown ?? {}, patients: Number(r.patients) || 0,
    patientsPct: Number(r.patients_pct) || 0, productUnits: Number(r.product_units) || 0,
    productIncentive: Number(r.product_incentive) || 0, serviceIncentive: Number(r.service_incentive) || 0,
    evaluationPct: Number(r.evaluation_pct) || 0, serviceIncentiveAdjusted: Number(r.service_incentive_adjusted) || 0,
    laserLinear: Number(r.laser_linear) || 0, laserPatients: Number(r.laser_patients) || 0,
    laserTotal: Number(r.laser_total) || 0, bonusExtra: Number(r.bonus_extra) || 0,
    cleaningContribution: Number(r.cleaning_contribution) || 0,
    grossTotal: Number(r.gross_total) || 0, netTotal: Number(r.net_total) || 0,
  }
}

/** Colaboradores (roster) por sucursal. */
export async function getCommissionCollaborators(params: ActionParams) {
  requireBizId()
  const branch = textValue(params, "branch")
  const includeInactive = params.includeInactive === true || textValue(params, "includeInactive") === "1"
  const records = await readRoster(branch || undefined, includeInactive)
  return { ok: true, records }
}

/** Previsualiza el cálculo mensual (corre el motor, NO persiste).
 *  Sin sucursal ("Todas") calcula LAS 3 y devuelve `multi.results`. */
export async function getCommissionRunPreview(params: ActionParams) {
  const business_id = requireBizId()
  const branch = textValue(params, "branch")
  const month = numberValue(params, "month")
  const year = numberValue(params, "year")
  if (!month || !year) throw new Error("Selecciona mes y año para el cálculo")
  const branches = branch ? [branch] : LASER_BRANCHES
  const out: { branch: string; result: RunResult; savedRun: ReturnType<typeof mapRun> | null }[] = []
  for (const b of branches) {
    const result = await computeRunForPeriod(b, month, year)
    const { data } = await getSupabaseAdmin().from("sales_commission_runs").select("*")
      .eq("business_id", business_id).eq("branch", b)
      .eq("period_month", month).eq("period_year", year).is("deleted_at", null)
      .order("created_at", { ascending: false })
    const saved = (data || []).find((r) => (r as Row).status !== "anulado") || null
    out.push({ branch: b, result, savedRun: saved ? mapRun(saved as Row) : null })
  }
  if (branch) return { ok: true, result: out[0].result, savedRun: out[0].savedRun, patientsSource: out[0].result.laser.patientsSource }
  return { ok: true, multi: true, month, year, results: out }
}

/** Guarda (o recalcula) el run como BORRADOR + detalle por colaborador. */
export async function saveCommissionRun(params: ActionParams, user: ActionUser) {
  requirePermission("sales_commission.calculate")
  const business_id = requireBizId()
  const branch = textValue(params, "branch")
  const month = numberValue(params, "month")
  const year = numberValue(params, "year")
  if (!branch || !month || !year) throw new Error("Selecciona sucursal, mes y año para el cálculo")
  const sb = getSupabaseAdmin()

  // Run vivo existente (no anulado) para el mismo período/sucursal.
  const { data: existingRows } = await sb.from("sales_commission_runs").select("*")
    .eq("business_id", business_id).eq("branch", branch)
    .eq("period_month", month).eq("period_year", year).is("deleted_at", null)
  const existing = (existingRows || []).find((r) => (r as Row).status !== "anulado") as Row | undefined
  if (existing && existing.status === "finalizado") {
    throw new Error("Ya existe un cálculo FINALIZADO para esta sucursal y período. Anúlalo antes de recalcular.")
  }

  const result = await computeRunForPeriod(branch, month, year)
  const rules = await readRunRules()
  const nowIso = new Date().toISOString()
  const runFields = {
    business_id, branch, period_month: month, period_year: year, status: "borrador",
    card_pct: result.cardPct,
    base_summary: { byCategory: result.baseByCategory, total: result.baseTotal, laser: result.laser },
    rules_snapshot: rules as unknown as Record<string, unknown>,
    totals: result.totals as unknown as Record<string, unknown>,
    alerts: result.alerts, notes: textValue(params, "notes") || null,
    updated_by: user.id || null, updated_at: nowIso,
  }

  let runId: string
  if (existing) {
    const { error } = await sb.from("sales_commission_runs").update(runFields).eq("id", existing.id as string)
    if (error) throw new Error(error.message)
    runId = String(existing.id)
    await sb.from("sales_commission_run_items").delete().eq("run_id", runId)
  } else {
    const { data, error } = await sb.from("sales_commission_runs")
      .insert({ ...runFields, created_by: user.id || null }).select("id").single()
    if (error) throw new Error(error.message)
    runId = String((data as Row).id)
  }

  const items = result.items.map((it) => ({
    run_id: runId, business_id, collaborator_id: it.collaboratorId,
    collaborator_name: it.name, branch,
    service_breakdown: it.serviceBreakdown as unknown as Record<string, unknown>,
    patients: it.patients, patients_pct: it.patientsPct,
    product_units: it.productUnits, product_incentive: it.productIncentive,
    service_incentive: it.serviceIncentive, evaluation_pct: it.evaluationPct,
    service_incentive_adjusted: it.serviceIncentiveAdjusted,
    laser_linear: it.laserLinear, laser_patients: it.laserPatients, laser_total: it.laserTotal,
    bonus_extra: it.bonusExtra, cleaning_contribution: it.cleaningContribution,
    gross_total: it.grossTotal, net_total: it.netTotal,
  }))
  if (items.length) {
    const { error } = await sb.from("sales_commission_run_items").insert(items)
    if (error) throw new Error(error.message)
  }

  await logAudit(user, "commission_run", runId, existing ? "recalculate" : "create",
    existing ? { status: existing.status } : null, { branch, month, year, netTotal: result.totals.netTotal },
    null, { month, year })
  return { ok: true, runId, result }
}

/** Lista de runs del período (todas las sucursales). */
export async function getCommissionRuns(params: ActionParams) {
  const business_id = requireBizId()
  let q = getSupabaseAdmin().from("sales_commission_runs").select("*")
    .eq("business_id", business_id).is("deleted_at", null)
    .order("period_year", { ascending: false }).order("period_month", { ascending: false })
    .order("branch", { ascending: true })
  const month = numberValue(params, "month")
  const year = numberValue(params, "year")
  if (month) q = q.eq("period_month", month)
  if (year) q = q.eq("period_year", year)
  const branch = textValue(params, "branch")
  if (branch) q = q.eq("branch", branch)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return { ok: true, records: (data || []).map((r) => mapRun(r as Row)) }
}

/** Detalle de un run (cabecera + ítems por colaborador). */
export async function getCommissionRun(params: ActionParams) {
  const business_id = requireBizId()
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta el id del cálculo")
  const { data: runRow, error } = await getSupabaseAdmin().from("sales_commission_runs")
    .select("*").eq("business_id", business_id).eq("id", id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!runRow) throw new Error("Cálculo no encontrado")
  const { data: itemRows } = await getSupabaseAdmin().from("sales_commission_run_items")
    .select("*").eq("run_id", id).order("net_total", { ascending: false })
  return { ok: true, run: mapRun(runRow as Row), items: (itemRows || []).map((r) => mapRunItem(r as Row)) }
}

/** Finaliza un run BORRADOR (queda inmutable hasta anular). */
export async function finalizeCommissionRun(params: ActionParams, user: ActionUser) {
  requirePermission("sales_commission.calculate")
  const business_id = requireBizId()
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta el id del cálculo")
  const { data: runRow } = await getSupabaseAdmin().from("sales_commission_runs")
    .select("id,status,branch,period_month,period_year").eq("business_id", business_id).eq("id", id).maybeSingle()
  if (!runRow) throw new Error("Cálculo no encontrado")
  if ((runRow as Row).status !== "borrador") throw new Error("Solo se puede finalizar un cálculo en borrador")
  const { error } = await getSupabaseAdmin().from("sales_commission_runs")
    .update({ status: "finalizado", finalized_by: user.id || null, finalized_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) throw new Error(error.message)
  await logAudit(user, "commission_run", id, "finalize", { status: "borrador" }, { status: "finalizado" }, null,
    { month: Number((runRow as Row).period_month), year: Number((runRow as Row).period_year) })
  return { ok: true }
}

/** Anula un run (libera el período para recalcular). Requiere motivo. */
export async function voidCommissionRun(params: ActionParams, user: ActionUser) {
  requirePermission("sales_commission.calculate")
  const business_id = requireBizId()
  const id = textValue(params, "id")
  const reason = textValue(params, "reason")
  if (!id) throw new Error("Falta el id del cálculo")
  if (!reason) throw new Error("Indica el motivo de la anulación")
  const { data: runRow } = await getSupabaseAdmin().from("sales_commission_runs")
    .select("id,status,period_month,period_year").eq("business_id", business_id).eq("id", id).maybeSingle()
  if (!runRow) throw new Error("Cálculo no encontrado")
  if ((runRow as Row).status === "anulado") throw new Error("El cálculo ya está anulado")
  const { error } = await getSupabaseAdmin().from("sales_commission_runs")
    .update({ status: "anulado", voided_by: user.id || null, voided_at: new Date().toISOString(), void_reason: reason, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) throw new Error(error.message)
  await logAudit(user, "commission_run", id, "void", { status: (runRow as Row).status }, { status: "anulado" }, reason,
    { month: Number((runRow as Row).period_month), year: Number((runRow as Row).period_year) })
  return { ok: true }
}

// ════════════════════════════════════════════════════════════════════════════
// PERSONAL QUE APLICA INCENTIVO LÁSER (roster CRUD) + DETALLE LÁSER POR SUCURSAL
// ════════════════════════════════════════════════════════════════════════════

const boolParam = (params: ActionParams, key: string, def: boolean): boolean => {
  const v = params[key]
  if (v === undefined || v === "") return def
  return v === true || v === "1" || v === "true"
}
const numParam = (params: ActionParams, key: string, def: number): number => {
  const v = params[key]
  if (v === undefined || v === "") return def
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

/** Alta/edición de un colaborador del roster (personal que aplica láser). */
export async function saveCommissionCollaborator(params: ActionParams, user: ActionUser) {
  requirePermission("sales_commission.rules.manage")
  const business_id = requireBizId()
  const id = textValue(params, "id")
  const name = canonicalCollaborator(textValue(params, "name"))
  const branch = textValue(params, "branch").trim()
  if (!name) throw new Error("El nombre del empleado es obligatorio")
  if (!branch) throw new Error("La sucursal es obligatoria")
  const appliesLaser = boolParam(params, "appliesLaser", true)
  const fields: Record<string, unknown> = {
    business_id, name, branch,
    services: appliesLaser ? ["DEPILACION_LASER"] : [],
    active: boolParam(params, "active", true),
    linear_participation: boolParam(params, "linearParticipation", true),
    patient_participation: boolParam(params, "patientParticipation", true),
    cleaning_contribution: numParam(params, "cleaningContribution", 400),
    bonus_extra: numParam(params, "bonusExtra", 0),
    evaluation_pct: numParam(params, "evaluationPct", 100),
    // Tarifa de producto propia (RD$/u); vacío = usa la regla general (RD$100).
    product_unit_amount: textValue(params, "productUnitAmount") === "" ? null : numParam(params, "productUnitAmount", 100),
    start_date: textValue(params, "startDate") || null,
    end_date: textValue(params, "endDate") || null,
    notes: textValue(params, "notes") || null,
    updated_by: user.id || null, updated_at: new Date().toISOString(),
  }
  const sb = getSupabaseAdmin()
  let cid = id
  if (id) {
    const { error } = await sb.from("sales_commission_collaborators").update(fields).eq("id", id).eq("business_id", business_id)
    if (error) throw new Error(error.message)
  } else {
    // Reactivar/actualizar si ya existe uno VIVO con ese nombre+sucursal (evita choque con el único parcial).
    const { data: existing } = await sb.from("sales_commission_collaborators").select("id")
      .eq("business_id", business_id).eq("branch", branch).eq("name", name).is("deleted_at", null).maybeSingle()
    if (existing) {
      const { error } = await sb.from("sales_commission_collaborators").update(fields).eq("id", (existing as Row).id as string)
      if (error) throw new Error(error.message)
      cid = String((existing as Row).id)
    } else {
      const { data, error } = await sb.from("sales_commission_collaborators")
        .insert({ ...fields, created_by: user.id || null }).select("id").single()
      if (error) throw new Error(error.message)
      cid = String((data as Row).id)
    }
  }
  await logAudit(user, "commission_collaborator", cid || null, id ? "update" : "create", null,
    { name, branch, active: fields.active, appliesLaser }, null)
  return { ok: true, id: cid }
}

/** Activa/desactiva un colaborador (participa o no en el reparto del mes). */
export async function setCommissionCollaboratorActive(params: ActionParams, user: ActionUser) {
  requirePermission("sales_commission.rules.manage")
  const business_id = requireBizId()
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta el id del colaborador")
  const active = boolParam(params, "active", true)
  const { error } = await getSupabaseAdmin().from("sales_commission_collaborators")
    .update({ active, updated_by: user.id || null, updated_at: new Date().toISOString() })
    .eq("id", id).eq("business_id", business_id)
  if (error) throw new Error(error.message)
  await logAudit(user, "commission_collaborator", id, active ? "activate" : "deactivate", null, { active }, null)
  return { ok: true }
}

/** Baja (soft delete) de un colaborador. NO borra la fila: marca deleted_at. */
export async function deleteCommissionCollaborator(params: ActionParams, user: ActionUser) {
  requirePermission("sales_commission.rules.manage")
  const business_id = requireBizId()
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta el id del colaborador")
  const { error } = await getSupabaseAdmin().from("sales_commission_collaborators")
    .update({ deleted_at: new Date().toISOString(), deleted_by: user.id || null, active: false })
    .eq("id", id).eq("business_id", business_id)
  if (error) throw new Error(error.message)
  await logAudit(user, "commission_collaborator", id, "delete", null, null, textValue(params, "reason") || null)
  return { ok: true }
}

/**
 * DETALLE del incentivo láser POR SUCURSAL para un mes: resumen (venta bruta,
 * venta tarjeta, % tarjeta, descuento, base neta, tramo, %, fondo, personas,
 * pacientes, distribuido, cuadre) + personal elegible con su reparto. Reusa el
 * motor `computeRun` (una corrida por sucursal). Incluye validaciones/alertas.
 */
export async function getCommissionLaserDetail(params: ActionParams) {
  requireBizId()
  const month = numberValue(params, "month")
  const year = numberValue(params, "year")
  if (!month || !year) throw new Error("Selecciona mes y año para el cálculo láser")
  const branchFilter = textValue(params, "branch")
  const branches = branchFilter ? [branchFilter] : LASER_BRANCHES
  const rules = await readRunRules()
  // Validaciones globales (spec §11).
  const globalAlerts: string[] = []
  if (!rules.laserScale.length) globalAlerts.push("No hay escala láser configurada en Reglas: el fondo será 0.")
  if (rules.cardPct == null) globalAlerts.push("No hay % de tarjeta configurado.")

  const out = []
  for (const branch of branches) {
    const r = await computeRunForPeriod(branch, month, year)
    const roster = await readRoster(branch, false)
    const laserRoster = roster.filter((c) => c.services.includes("DEPILACION_LASER"))
    const itemByName = new Map(r.items.map((it) => [it.name, it]))
    const personnel = laserRoster.map((c) => {
      const it = itemByName.get(canonicalCollaborator(c.name))
      return {
        name: c.name, branch, applies: true,
        patients: it?.patients || 0, patientsPct: it?.patientsPct || 0,
        laserLinear: it?.laserLinear || 0, laserPatients: it?.laserPatients || 0, laserTotal: it?.laserTotal || 0,
      }
    })
    // Defensivo: alguien con láser asignado que no esté en el roster láser (no debería pasar).
    for (const it of r.items) {
      if (it.laserTotal > 0 && !laserRoster.some((c) => canonicalCollaborator(c.name) === it.name)) {
        personnel.push({ name: it.name, branch, applies: false, patients: it.patients, patientsPct: it.patientsPct, laserLinear: it.laserLinear, laserPatients: it.laserPatients, laserTotal: it.laserTotal })
      }
    }
    personnel.sort((a, b) => b.laserTotal - a.laserTotal)
    const laserBase = r.baseByCategory["DEPILACION_LASER"]
    const totalDistribuido = round2(personnel.reduce((s, p) => s + p.laserTotal, 0))
    out.push({
      branch,
      ventaLaserBruta: laserBase?.totalBruto || 0,
      ventaLaserTarjeta: laserBase?.tarjetaBruta || 0,
      cardPct: r.cardPct,
      descuentoTarjeta: laserBase?.tarjetaDescuento || 0,
      baseLaserNeta: r.laser.base,
      tramo: r.laser.threshold, pct: r.laser.pct,
      fondo: r.laser.fund, fondoPersonas: r.laser.fundLinear, fondoPacientes: r.laser.fundPatients,
      personasAplican: personnel.filter((p) => p.applies).length,
      totalPacientes: r.laser.patientsTotal, patientsSource: r.laser.patientsSource,
      totalDistribuido, cuadre: round2(r.laser.fund - totalDistribuido),
      eligibleCount: r.laser.eligibleCount, perCapita: r.laser.perCapita,
      personnel, alerts: r.alerts,
    })
  }
  return {
    ok: true, month, year,
    mode: rules.laserDistributionMode || "equitativo",
    weights: { personas: round2((1 - rules.laserSplitPatientsFraction) * 100), pacientes: round2(rules.laserSplitPatientsFraction * 100) },
    zeroPatientsGetsFixed: rules.zeroPatientsGetsFixed !== false,
    cardDiscountBeforeScale: true,
    globalAlerts, branches: out,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CAPTURA DE PACIENTES ATENDIDOS (manual, sobre-escribe reservas por colaborador)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Filas de captura/consulta de pacientes atendidos.
 *  - month>0 + sucursal: vista EDITABLE del mes (reservas base + manual que gana).
 *  - month>0 sin sucursal ("Todas"): mismo mes, las 3 sucursales (editable por fila).
 *  - month=0 ("Todos los meses"): SUMA ANUAL por colaborador+sucursal (efectivo
 *    por mes = manual si existe, si no reservas) — solo consulta.
 */
export async function getCommissionPatientCapture(params: ActionParams) {
  const business_id = requireBizId()
  const branch = textValue(params, "branch")
  const month = numberValue(params, "month")
  const year = numberValue(params, "year")
  if (!year) throw new Error("Selecciona un año")
  const sb = getSupabaseAdmin()
  let q = sb.from("sales_commission_patient_counts")
    .select("id,provider_name,branch,patient_count,source,service,observation,period_month")
    .eq("business_id", business_id).eq("period_year", year)
  if (month) q = q.eq("period_month", month)
  if (branch) q = q.eq("branch", branch)
  const { data: pcRows } = await q
  const roster = await readRoster(branch || undefined, false)

  type Cap = {
    provider: string; branch: string; inRoster: boolean
    reservas: number | null; manual: number | null; manualId: string | null
    service: string | null; observation: string | null; months: Set<number>
  }
  const map = new Map<string, Cap>()
  const ensure = (name: string, b: string): Cap => {
    const key = `${name}|${b}`
    let c = map.get(key)
    if (!c) { c = { provider: name, branch: b, inRoster: false, reservas: null, manual: null, manualId: null, service: null, observation: null, months: new Set() }; map.set(key, c) }
    return c
  }
  for (const c of roster) ensure(canonicalCollaborator(c.name), c.branch).inRoster = true

  if (month) {
    // ── Vista mensual (editable): manual sobre-escribe a reservas por colaborador.
    for (const r of (pcRows || []) as Row[]) {
      const name = canonicalCollaborator(r.provider_name)
      if (!name) continue
      const c = ensure(name, String(r.branch || branch))
      if (r.source === "manual") { c.manual = Number(r.patient_count) || 0; c.manualId = String(r.id); c.service = r.service == null ? null : String(r.service); c.observation = r.observation == null ? null : String(r.observation) }
      else c.reservas = Number(r.patient_count) || 0
    }
  } else {
    // ── Vista ANUAL (solo consulta): por colaborador+sucursal, el efectivo de
    // cada mes es manual (si existe) o reservas; se suman los 12 meses.
    const perMonth = new Map<string, { manual: number | null; reservas: number | null }>()
    for (const r of (pcRows || []) as Row[]) {
      const name = canonicalCollaborator(r.provider_name)
      if (!name) continue
      const k = `${name}|${String(r.branch || "")}|${Number(r.period_month) || 0}`
      const e = perMonth.get(k) || { manual: null, reservas: null }
      if (r.source === "manual") e.manual = Number(r.patient_count) || 0
      else e.reservas = Number(r.patient_count) || 0
      perMonth.set(k, e)
    }
    for (const [k, e] of perMonth) {
      const [name, b, mStr] = k.split("|")
      const c = ensure(name, b)
      const eff = e.manual != null ? e.manual : (e.reservas || 0)
      c.reservas = round2((c.reservas || 0) + (e.reservas || 0))
      c.manual = round2((c.manual == null ? 0 : c.manual) + eff) // manual acumula el EFECTIVO anual
      if (eff > 0) c.months.add(Number(mStr))
    }
  }

  const rows = [...map.values()].map((c) => {
    const effective = c.manual != null ? c.manual : (c.reservas || 0)
    const source = month
      ? (c.manual != null ? "manual" : (c.reservas != null ? "reservas" : "—"))
      : (c.months.size ? `${c.months.size} mes${c.months.size === 1 ? "" : "es"}` : "—")
    return { provider: c.provider, branch: c.branch, inRoster: c.inRoster, reservas: c.reservas, manual: month ? c.manual : null, manualId: c.manualId, service: c.service, observation: c.observation, effective, source }
  }).sort((a, b) => b.effective - a.effective || a.provider.localeCompare(b.provider))
  const total = rows.reduce((s, r) => s + r.effective, 0)
  return { ok: true, branch, month, year, total, editable: month > 0, rows }
}

/** Alta/edición de pacientes MANUAL de un colaborador (sobre-escribe reservas). */
export async function saveCommissionPatientCount(params: ActionParams, user: ActionUser) {
  requirePermission("sales_commission.calculate")
  const business_id = requireBizId()
  const branch = textValue(params, "branch")
  const month = numberValue(params, "month")
  const year = numberValue(params, "year")
  const provider = canonicalCollaborator(textValue(params, "provider"))
  const patients = Math.max(0, Math.round(numberValue(params, "patients", 0)))
  if (!branch || !month || !year || !provider) throw new Error("Faltan sucursal, mes, año o prestador")
  const sb = getSupabaseAdmin()
  const { data: existing } = await sb.from("sales_commission_patient_counts").select("id")
    .eq("business_id", business_id).eq("branch", branch).eq("period_month", month).eq("period_year", year)
    .eq("provider_name", provider).eq("source", "manual").maybeSingle()
  const fields = {
    business_id, branch, period_month: month, period_year: year, provider_name: provider,
    patient_count: patients, unique_patients: patients, source: "manual",
    service: textValue(params, "service") || null, observation: textValue(params, "observation") || null,
    updated_at: new Date().toISOString(),
  }
  if (existing) {
    const { error } = await sb.from("sales_commission_patient_counts").update(fields).eq("id", (existing as Row).id as string)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await sb.from("sales_commission_patient_counts").insert(fields)
    if (error) throw new Error(error.message)
  }
  await logAudit(user, "patient_count", null, existing ? "manual_update" : "manual_create", null,
    { branch, provider, patients }, null, { month, year })
  return { ok: true }
}

/** Elimina la captura MANUAL de un colaborador (revierte a reservas). */
export async function deleteCommissionPatientCount(params: ActionParams, user: ActionUser) {
  requirePermission("sales_commission.calculate")
  const business_id = requireBizId()
  const branch = textValue(params, "branch")
  const month = numberValue(params, "month")
  const year = numberValue(params, "year")
  const provider = canonicalCollaborator(textValue(params, "provider"))
  if (!branch || !month || !year || !provider) throw new Error("Faltan datos para revertir")
  const { error } = await getSupabaseAdmin().from("sales_commission_patient_counts")
    .delete().eq("business_id", business_id).eq("branch", branch).eq("period_month", month)
    .eq("period_year", year).eq("provider_name", provider).eq("source", "manual")
  if (error) throw new Error(error.message)
  await logAudit(user, "patient_count", null, "manual_revert", null, { branch, provider }, "revertir a reservas", { month, year })
  return { ok: true }
}

/**
 * Resumen ANUAL del incentivo láser ("Todos los meses"): base neta, tramo y
 * fondo por SUCURSAL × MES + totales del año. Rápido: UNA consulta paginada de
 * las ventas láser del año (tarjeta neteada por venta); sin detalle de personal
 * (para el reparto por persona se elige un mes específico).
 */
export async function getCommissionLaserAnnual(params: ActionParams) {
  const business_id = requireBizId()
  const year = numberValue(params, "year")
  if (!year) throw new Error("Selecciona un año")
  const rules = await readRunRules()
  const sb = getSupabaseAdmin()
  const PAGE = 1000
  const rows: Row[] = []
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from("sales_commission_sales")
      .select("branch,payment_method,gross_amount,sale_date")
      .eq("business_id", business_id).eq("category", "DEPILACION_LASER")
      .gte("sale_date", `${year}-01-01`).lt("sale_date", `${year + 1}-01-01`)
      .order("id", { ascending: true }).range(off, off + PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...((data || []) as Row[]))
    if (!data || data.length < PAGE) break
  }
  // Base neta por sucursal × mes (tarjeta neteada por venta, como el mensual).
  const base = new Map<string, number>()
  for (const r of rows) {
    const m = Number(String(r.sale_date || "").slice(5, 7))
    if (!m) continue
    const k = `${String(r.branch || "(sin sucursal)")}|${m}`
    base.set(k, round2((base.get(k) || 0) + netAmount(Number(r.gross_amount) || 0, String(r.payment_method || "OTROS"), rules.cardPct)))
  }
  const tramoOf = (v: number) => rules.laserScale.filter((t) => v >= t.threshold).sort((a, b) => b.threshold - a.threshold)[0] || null
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1
    const branches = LASER_BRANCHES.map((b) => {
      const v = base.get(`${b}|${m}`) || 0
      const t = tramoOf(v)
      return { branch: b, base: v, pct: t?.percentage || 0, threshold: t?.threshold || 0, fund: t ? round2(v * t.percentage) : 0 }
    })
    return { month: m, branches, fundTotal: round2(branches.reduce((s, x) => s + x.fund, 0)) }
  })
  const byBranch = LASER_BRANCHES.map((b) => ({
    branch: b,
    base: round2(months.reduce((s, mo) => s + (mo.branches.find((x) => x.branch === b)?.base || 0), 0)),
    fund: round2(months.reduce((s, mo) => s + (mo.branches.find((x) => x.branch === b)?.fund || 0), 0)),
  }))
  return {
    ok: true, year, cardPct: rules.cardPct, months,
    totals: { byBranch, fundYear: round2(byBranch.reduce((s, b) => s + b.fund, 0)) },
  }
}

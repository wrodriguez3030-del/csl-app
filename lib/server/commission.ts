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

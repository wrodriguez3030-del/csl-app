/**
 * BI FINANCIERO IA — Handlers del dispatcher /api/csl (lecturas + CRUD propio).
 *
 * Cubre lo PROPIO del módulo (settings, alertas, inversiones/ROI, proyecciones,
 * historial de la IA). Los datos financieros agregados vienen de
 * `getBiFinanceSummary` (fuente única). El asistente IA vive en su propia ruta
 * segura (app/api/bi-finance/assistant) por el timeout largo de OpenAI.
 *
 * Aislamiento por tenant: todo se filtra por el business_id del contexto.
 */
import { getSupabaseAdmin } from "@/lib/server/supabase"
import { getBusinessContext, requirePermission, hasPermission } from "@/lib/server/business-context"
import { textValue, numberValue, parsePayload } from "@/lib/server/csl-helpers"
import type { ActionParams, ActionUser } from "@/lib/server/csl-types"
import { getBiFinanceSummary } from "@/lib/server/bi-finance"
import {
  getKeyStatus, listModels, refreshModels, getPricing, savePricing, computeUsage, logBiAudit, RECOMMENDED,
} from "@/lib/server/bi-finance-secrets"

function bizId(): string {
  const id = getBusinessContext()?.businessId
  if (!id) throw new Error("Selecciona un negocio activo")
  return id
}
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

function periodOf(params: ActionParams): { month: number; year: number } {
  const now = new Date()
  return {
    month: numberValue(params, "month") || now.getUTCMonth() + 1,
    year: numberValue(params, "year") || now.getUTCFullYear(),
  }
}

// ── Dashboard / datos agregados ─────────────────────────────────────────────
export async function getBiFinanceData(params: ActionParams) {
  requirePermission("bi_finance.view")
  const { month, year } = periodOf(params)
  const from = textValue(params, "from") || undefined
  const to = textValue(params, "to") || undefined
  const branch = textValue(params, "branch") || null
  const summary = await getBiFinanceSummary({ from, to, month, year, branch })
  const business_id = bizId()
  const sb = getSupabaseAdmin()
  const { count: alertCount } = await sb.from("bi_finance_alerts")
    .select("id", { count: "exact", head: true }).eq("business_id", business_id).eq("status", "abierta")
  const { data: settingsRow } = await sb.from("bi_finance_settings").select("enabled").eq("business_id", business_id).maybeSingle()
  const keyStatus = await getKeyStatus(business_id)
  const aiConfigured = keyStatus.configured && (settingsRow?.enabled ?? true)
  // Último mes con ventas (para que el BI no abra en un mes vacío).
  let latestPeriod: { month: number; year: number } | null = null
  try {
    const { data: latest } = await sb.from("sales_commission_sales")
      .select("sale_date").eq("business_id", business_id).order("sale_date", { ascending: false }).limit(1).maybeSingle()
    if (latest?.sale_date) {
      const s = String(latest.sale_date).slice(0, 10)
      latestPeriod = { month: Number(s.slice(5, 7)), year: Number(s.slice(0, 4)) }
    }
  } catch { /* opcional */ }
  return { ok: true, summary, openAlerts: alertCount || 0, aiConfigured, latestPeriod }
}

// ── Configuración IA ────────────────────────────────────────────────────────
export async function getBiFinanceSettings() {
  requirePermission("bi_finance.view")
  const business_id = bizId()
  const { data } = await getSupabaseAdmin().from("bi_finance_settings").select("*").eq("business_id", business_id).maybeSingle()
  const envModel = (process.env.OPENAI_MODEL || "").trim() || null
  const extra = (data?.extra || {}) as Record<string, unknown>
  const base = data || { enabled: true, provider: "openai", model: null, temperature: 0.2, max_tokens: 1200, monthly_query_limit: 300, system_prompt: null }
  const keyStatus = await getKeyStatus(business_id)
  const effectiveModel = (data?.model || envModel || "gpt-4o")
  return {
    ok: true,
    settings: {
      ...base,
      allocate_overhead: extra.allocate_overhead !== false,
      // límites (pueden venir null)
      daily_query_limit: data?.daily_query_limit ?? null,
      monthly_input_token_limit: data?.monthly_input_token_limit ?? null,
      monthly_output_token_limit: data?.monthly_output_token_limit ?? null,
      monthly_total_token_limit: data?.monthly_total_token_limit ?? null,
      monthly_cost_limit: data?.monthly_cost_limit ?? null,
      cost_currency: data?.cost_currency ?? "USD",
      alert_threshold_70: data?.alert_threshold_70 ?? true,
      alert_threshold_90: data?.alert_threshold_90 ?? true,
      block_at_100: data?.block_at_100 ?? true,
    },
    keyStatus,
    canManageKey: hasPermission("bi_finance.ai_secrets.manage") || hasPermission("bi_finance.config"),
    canConfig: hasPermission("bi_finance.config"),
    env: { keyPresent: keyStatus.configured, envModel, effectiveModel },
    recommended: RECOMMENDED,
  }
}

export async function saveBiFinanceSettings(params: ActionParams, user: ActionUser) {
  requirePermission("bi_finance.config")
  const business_id = bizId()
  const p = parsePayload(params)
  const numOrNull = (v: unknown) => (v == null || v === "" ? null : Number(v))
  const record: Record<string, unknown> = {
    business_id,
    enabled: p.enabled != null ? Boolean(p.enabled) : true,
    provider: String(p.provider || "openai"),
    model: p.model ? String(p.model) : null,
    temperature: p.temperature != null ? Number(p.temperature) : 0.2,
    max_tokens: p.max_tokens != null ? Number(p.max_tokens) : 1200,
    system_prompt: p.system_prompt ? String(p.system_prompt) : null,
    monthly_query_limit: numOrNull(p.monthly_query_limit),
    daily_query_limit: numOrNull(p.daily_query_limit),
    monthly_input_token_limit: numOrNull(p.monthly_input_token_limit),
    monthly_output_token_limit: numOrNull(p.monthly_output_token_limit),
    monthly_total_token_limit: numOrNull(p.monthly_total_token_limit),
    monthly_cost_limit: numOrNull(p.monthly_cost_limit),
    cost_currency: String(p.cost_currency || "USD"),
    alert_threshold_70: p.alert_threshold_70 !== false,
    alert_threshold_90: p.alert_threshold_90 !== false,
    block_at_100: p.block_at_100 !== false,
    extra: { allocate_overhead: p.allocate_overhead !== false },
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  }
  const { error } = await getSupabaseAdmin().from("bi_finance_settings").upsert(record, { onConflict: "business_id" })
  if (error) throw new Error(error.message)
  await logBiAudit("ai_settings_changed", user.id, { model: record.model, enabled: record.enabled })
  return { ok: true }
}

// ── Modelos ──────────────────────────────────────────────────────────────────
export async function getBiFinanceModels() {
  requirePermission("bi_finance.view")
  const business_id = bizId()
  const { data } = await getSupabaseAdmin().from("bi_finance_settings").select("model").eq("business_id", business_id).maybeSingle()
  const effective = (data?.model || (process.env.OPENAI_MODEL || "").trim() || "gpt-4o")
  return { ok: true, ...(await listModels(business_id, effective)), effective }
}

export async function refreshBiFinanceModels(_params: ActionParams, user: ActionUser) {
  requirePermission("bi_finance.config")
  const business_id = bizId()
  return await refreshModels(business_id, user.id)
}

// ── Precios por modelo ───────────────────────────────────────────────────────
export async function getBiFinancePricing() {
  requirePermission("bi_finance.view")
  return { ok: true, rows: await getPricing(bizId()) }
}

export async function saveBiFinancePricing(params: ActionParams, user: ActionUser) {
  requirePermission("bi_finance.config")
  const p = parsePayload(params)
  return await savePricing(bizId(), p, user.id)
}

// ── Uso / límites ────────────────────────────────────────────────────────────
export async function getBiFinanceUsage() {
  requirePermission("bi_finance.view")
  const business_id = bizId()
  const { data } = await getSupabaseAdmin().from("bi_finance_settings").select("*").eq("business_id", business_id).maybeSingle()
  const usage = await computeUsage(business_id, (data || {}) as Record<string, unknown>)
  return { ok: true, usage }
}

// ── Historial de consultas a la IA ──────────────────────────────────────────
export async function getBiFinanceHistory(params: ActionParams) {
  requirePermission("bi_finance.view")
  const business_id = bizId()
  const limit = Math.min(numberValue(params, "limit") || 50, 200)
  const { data } = await getSupabaseAdmin().from("bi_finance_ai_queries")
    .select("id, created_at, user_email, scope, branch, period_month, period_year, question, answer, model, tokens_total, confidence, ok, error")
    .eq("business_id", business_id).order("created_at", { ascending: false }).limit(limit)
  return { ok: true, rows: data || [] }
}

// ── Alertas financieras ─────────────────────────────────────────────────────
export async function getBiFinanceAlerts(params: ActionParams) {
  requirePermission("bi_finance.view")
  const business_id = bizId()
  const status = textValue(params, "status")
  const month = numberValue(params, "month")
  const year = numberValue(params, "year")
  const severidad = textValue(params, "severidad")
  let q = getSupabaseAdmin().from("bi_finance_alerts").select("*").eq("business_id", business_id).order("created_at", { ascending: false }).limit(300)
  if (status) q = q.eq("status", status)
  if (severidad) q = q.eq("severidad", severidad)
  if (month && year) q = q.eq("period_month", month).eq("period_year", year)
  const { data } = await q
  const rows = data || []
  // Conteos globales (independientes del filtro) para las pestañas de estado.
  const { data: allForCounts } = await getSupabaseAdmin().from("bi_finance_alerts").select("status").eq("business_id", business_id)
  const counts = { total: (allForCounts || []).length, abierta: 0, revisada: 0, resuelta: 0, descartada: 0 } as Record<string, number>
  for (const a of allForCounts || []) counts[String((a as Record<string, unknown>).status)] = (counts[String((a as Record<string, unknown>).status)] || 0) + 1
  return { ok: true, rows, counts }
}

/** Recalcula alertas por reglas a partir del resumen real del período. Idempotente:
 *  reemplaza las alertas 'sistema' abiertas del mismo período. */
export async function generateBiFinanceAlerts(params: ActionParams, user: ActionUser) {
  requirePermission("bi_finance.alerts")
  const business_id = bizId()
  const { month, year } = periodOf(params)
  const summary = await getBiFinanceSummary({ month, year })
  const sb = getSupabaseAdmin()

  const alerts: Array<Record<string, unknown>> = []
  const push = (a: Partial<Record<string, unknown>>) => alerts.push({
    business_id, period_month: month, period_year: year, status: "abierta", source: "sistema", created_by: user.id, ...a,
  })

  // Margen neto consolidado bajo (<15%).
  if (summary.resumen.ingresos > 0 && summary.resumen.margenNeto < 15) {
    push({ tipo: "margen_bajo", severidad: summary.resumen.margenNeto < 0 ? "critica" : "alta",
      titulo: `Margen neto ${summary.resumen.margenNeto.toFixed(1)}% (bajo)`,
      detalle: `Ingresos RD$${summary.resumen.ingresos.toLocaleString()} vs gastos RD$${summary.resumen.gastos.toLocaleString()}.`,
      metric: "margen_neto", metric_value: summary.resumen.margenNeto, threshold: 15 })
  }
  // Sucursales en pérdida (crítica) o con margen bajo (<10%).
  for (const r of summary.rentabilidad) {
    if (r.branch === "(sin sucursal)" || r.ingresos <= 0) continue
    if (r.utilidadNeta < 0) {
      push({ tipo: "margen_bajo", severidad: "critica", branch: r.branch,
        titulo: `${r.branch} en pérdida`, detalle: `Utilidad RD$${r.utilidadNeta.toLocaleString()} (margen ${r.margenNeto.toFixed(1)}%).`,
        metric: "utilidad_neta", metric_value: r.utilidadNeta, threshold: 0 })
    } else if (r.margenNeto < 10) {
      push({ tipo: "margen_bajo", severidad: r.margenNeto < 5 ? "alta" : "media", branch: r.branch,
        titulo: `${r.branch} con margen bajo (${r.margenNeto.toFixed(1)}%)`,
        detalle: `Ingresos RD$${r.ingresos.toLocaleString()} · gastos RD$${r.gastos.toLocaleString()} · utilidad RD$${r.utilidadNeta.toLocaleString()}.`,
        metric: "margen_neto", metric_value: r.margenNeto, threshold: 10 })
    }
  }
  // Gasto elevado sobre ingresos (>85%).
  if (summary.resumen.ingresos > 0) {
    const ratio = round2((summary.resumen.gastos / summary.resumen.ingresos) * 100)
    if (ratio > 85) {
      push({ tipo: "gasto_alto", severidad: ratio > 100 ? "critica" : "alta",
        titulo: `Gastos = ${ratio.toFixed(1)}% de los ingresos`,
        detalle: `Gastos RD$${summary.resumen.gastos.toLocaleString()} sobre ingresos RD$${summary.resumen.ingresos.toLocaleString()}.`,
        metric: "gastos_totales", metric_value: summary.resumen.gastos, threshold: null })
    }
  }
  // Caída de ventas vs mes anterior (>15%).
  const delta = summary.resumen.ingresosDeltaPct
  if (typeof delta === "number" && delta < -15) {
    push({ tipo: "caida_ventas", severidad: delta < -30 ? "critica" : "alta",
      titulo: `Ventas ${delta.toFixed(1)}% vs mes anterior`,
      detalle: `Ingresos del período: RD$${summary.resumen.ingresos.toLocaleString()}.`,
      metric: "ingresos", metric_value: summary.resumen.ingresos, threshold: null })
  }

  // Reemplazar las de sistema abiertas del período.
  await sb.from("bi_finance_alerts").delete().eq("business_id", business_id).eq("source", "sistema")
    .eq("status", "abierta").eq("period_month", month).eq("period_year", year)
  if (alerts.length) {
    const { error } = await sb.from("bi_finance_alerts").insert(alerts)
    if (error) throw new Error(error.message)
  }
  return { ok: true, generated: alerts.length }
}

export async function updateBiFinanceAlert(params: ActionParams, user: ActionUser) {
  requirePermission("bi_finance.alerts")
  const business_id = bizId()
  const id = textValue(params, "id")
  const status = textValue(params, "status") || "revisada"
  if (!id) throw new Error("Falta el id de la alerta")
  const patch: Record<string, unknown> = { status }
  if (["resuelta", "descartada"].includes(status)) { patch.resolved_at = new Date().toISOString(); patch.resolved_by = user.id }
  const { error } = await getSupabaseAdmin().from("bi_finance_alerts").update(patch).eq("id", id).eq("business_id", business_id)
  if (error) throw new Error(error.message)
  return { ok: true }
}

// ── Inversiones y ROI ───────────────────────────────────────────────────────
export async function getBiFinanceInvestments() {
  requirePermission("bi_finance.view")
  const business_id = bizId()
  const { data } = await getSupabaseAdmin().from("bi_finance_investments").select("*")
    .eq("business_id", business_id).is("deleted_at", null).order("created_at", { ascending: false })
  return { ok: true, rows: data || [] }
}

function computeRoi(inversion: number, beneficio: number | null): number | null {
  if (!inversion || inversion <= 0 || beneficio == null) return null
  return round2(((beneficio - inversion) / inversion) * 100) / 100 // fracción
}

export async function saveBiFinanceInvestment(params: ActionParams, user: ActionUser) {
  requirePermission("bi_finance.investments")
  const business_id = bizId()
  const p = parsePayload(params)
  const id = p.id ? String(p.id) : null
  const inversion = Number(p.monto_inversion) || 0
  const benefEst = Number(p.beneficio_estimado) || 0
  const benefReal = p.beneficio_real != null && p.beneficio_real !== "" ? Number(p.beneficio_real) : null
  // Payback (meses) = inversión / beneficio mensual estimado (si aplica).
  const meses = Number(p.payback_meses)
  let payback: number | null = Number.isFinite(meses) && meses > 0 ? meses : null
  if (payback == null && benefEst > 0) {
    const inicio = String(p.fecha_inicio || ""), fin = String(p.fecha_fin || "")
    if (inicio && fin) {
      const d0 = new Date(inicio), d1 = new Date(fin)
      const monthsSpan = (d1.getUTCFullYear() - d0.getUTCFullYear()) * 12 + (d1.getUTCMonth() - d0.getUTCMonth()) + 1
      if (monthsSpan > 0) { const mensual = benefEst / monthsSpan; if (mensual > 0) payback = round2(inversion / mensual) }
    }
  }
  const record: Record<string, unknown> = {
    business_id,
    nombre: String(p.nombre || "").trim() || "Inversión",
    categoria: p.categoria ? String(p.categoria) : null,
    branch: p.branch ? String(p.branch) : null,
    monto_inversion: inversion,
    beneficio_estimado: benefEst,
    beneficio_real: benefReal,
    fecha_inicio: p.fecha_inicio ? String(p.fecha_inicio) : null,
    fecha_fin: p.fecha_fin ? String(p.fecha_fin) : null,
    estado: String(p.estado || "planificada"),
    roi_estimado: computeRoi(inversion, benefEst),
    roi_real: computeRoi(inversion, benefReal),
    payback_meses: payback,
    notas: p.notas ? String(p.notas) : null,
    updated_at: new Date().toISOString(),
  }
  const sb = getSupabaseAdmin()
  if (id) {
    const { error } = await sb.from("bi_finance_investments").update(record).eq("id", id).eq("business_id", business_id)
    if (error) throw new Error(error.message)
    return { ok: true, id }
  }
  record.created_by = user.id
  const { data, error } = await sb.from("bi_finance_investments").insert(record).select("id").single()
  if (error) throw new Error(error.message)
  return { ok: true, id: (data as Record<string, unknown>)?.id }
}

export async function deleteBiFinanceInvestment(params: ActionParams) {
  requirePermission("bi_finance.investments")
  const business_id = bizId()
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta el id")
  const { error } = await getSupabaseAdmin().from("bi_finance_investments")
    .update({ deleted_at: new Date().toISOString() }).eq("id", id).eq("business_id", business_id)
  if (error) throw new Error(error.message)
  return { ok: true }
}

// ── Proyecciones ────────────────────────────────────────────────────────────
/** Proyección a N meses por promedio móvil + tendencia lineal + escenarios,
 *  a partir de la serie real de 6 meses (ingresos/gastos/utilidad). */
export async function getBiFinanceForecast(params: ActionParams) {
  requirePermission("bi_finance.forecasts")
  const { month, year } = periodOf(params)
  const metric = (textValue(params, "metric") || "ingresos") as "ingresos" | "gastos" | "utilidad"
  const horizon = Math.min(numberValue(params, "horizon") || 3, 12)
  const summary = await getBiFinanceSummary({ month, year })
  const series = summary.trend.map((t) => ({ label: t.label, value: Number(t[metric]) || 0 }))
  const values = series.map((s) => s.value)

  // Promedio móvil (últimos 3).
  const last3 = values.slice(-3)
  const movil = last3.length ? round2(last3.reduce((a, b) => a + b, 0) / last3.length) : 0

  // Tendencia lineal (mínimos cuadrados) sobre los 6 puntos.
  const n = values.length
  let slope = 0, intercept = movil
  if (n >= 2) {
    const xs = values.map((_, i) => i)
    const mx = xs.reduce((a, b) => a + b, 0) / n
    const my = values.reduce((a, b) => a + b, 0) / n
    const num = xs.reduce((s, x, i) => s + (x - mx) * (values[i] - my), 0)
    const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0) || 1
    slope = num / den
    intercept = my - slope * mx
  }

  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
  const proj: Array<Record<string, number | string>> = []
  let py = year, pm = month
  for (let i = 1; i <= horizon; i++) {
    pm++; if (pm > 12) { pm = 1; py++ }
    const trend = round2(intercept + slope * (n - 1 + i))
    const base = round2((movil + trend) / 2)
    proj.push({
      label: `${MESES[pm - 1]} ${py}`,
      promedio_movil: movil,
      tendencia: Math.max(0, trend),
      base: Math.max(0, base),
      optimista: Math.max(0, round2(base * 1.1)),
      conservador: Math.max(0, round2(base * 0.9)),
    })
  }
  return { ok: true, metric, horizon, historico: series, proyeccion: proj, slope: round2(slope), promedioMovil: movil }
}

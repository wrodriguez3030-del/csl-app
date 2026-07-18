/**
 * BI FINANCIERO IA — Credenciales OpenAI, catálogo de modelos, precios y uso.
 * SOLO servidor. Nunca devuelve la API key en claro al cliente.
 */
import { getSupabaseAdmin } from "@/lib/server/supabase"
import { getBusinessContext } from "@/lib/server/business-context"
import { encryptSecret, decryptSecret, last4 } from "@/lib/server/bi-finance-crypto"

export const OPENAI_BASE = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "")

/** Lista fallback de modelos (spec §5B). No hardcodea un solo modelo. */
export const FALLBACK_MODELS: { id: string; display: string; reasoning?: boolean }[] = [
  { id: "gpt-5.2", display: "GPT-5.2 (máxima calidad)", reasoning: true },
  { id: "gpt-5.1", display: "GPT-5.1", reasoning: true },
  { id: "gpt-5", display: "GPT-5", reasoning: true },
  { id: "gpt-5-mini", display: "GPT-5 mini (balance)", reasoning: true },
  { id: "gpt-5-nano", display: "GPT-5 nano (bajo costo)", reasoning: true },
  { id: "gpt-4.1", display: "GPT-4.1" },
  { id: "gpt-4.1-mini", display: "GPT-4.1 mini" },
  { id: "gpt-4.1-nano", display: "GPT-4.1 nano" },
  { id: "gpt-4o", display: "GPT-4o (compatibilidad)" },
  { id: "gpt-4o-mini", display: "GPT-4o mini" },
]
export const LEGACY_MODELS = new Set(["gpt-3.5-turbo", "gpt-4-turbo", "gpt-4", "gpt-4-32k"])
export const RECOMMENDED = {
  calidad: "gpt-5.2",
  balance: "gpt-5-mini",
  bajo_costo: "gpt-5-nano",
  compatibilidad: "gpt-4o",
}

function bizId(): string {
  const id = getBusinessContext()?.businessId
  if (!id) throw new Error("Selecciona un negocio activo")
  return id
}

/** Registra un evento de auditoría del módulo (reutiliza la tabla de auditoría). */
export async function logBiAudit(action: string, userId: string | null, details?: Record<string, unknown>) {
  try {
    const business_id = getBusinessContext()?.businessId
    if (!business_id) return
    await getSupabaseAdmin().from("sales_commission_audit_logs").insert({
      business_id, entity_type: "bi_finance_ai", entity_id: null, action,
      new_values: details ?? null, user_id: userId || null,
    })
  } catch { /* la auditoría nunca rompe la operación */ }
}

// ── Credenciales ─────────────────────────────────────────────────────────────
export interface KeyStatus { configured: boolean; last4: string | null; source: "db" | "env" | null }

export async function getKeyStatus(business_id: string): Promise<KeyStatus> {
  const { data } = await getSupabaseAdmin().from("bi_finance_ai_secrets")
    .select("key_last4").eq("business_id", business_id).eq("active", true).order("configured_at", { ascending: false }).limit(1).maybeSingle()
  if (data) return { configured: true, last4: (data.key_last4 as string) || null, source: "db" }
  if ((process.env.OPENAI_API_KEY || "").trim()) return { configured: true, last4: last4(process.env.OPENAI_API_KEY as string), source: "env" }
  return { configured: false, last4: null, source: null }
}

/** Resuelve la API key efectiva: primero la del negocio (DB, descifrada), luego env. */
export async function resolveOpenAiKey(business_id: string): Promise<{ key: string; source: "db" | "env" } | null> {
  const { data } = await getSupabaseAdmin().from("bi_finance_ai_secrets")
    .select("encrypted_api_key").eq("business_id", business_id).eq("active", true).order("configured_at", { ascending: false }).limit(1).maybeSingle()
  if (data?.encrypted_api_key) {
    const key = decryptSecret(String(data.encrypted_api_key))
    if (key) return { key, source: "db" }
  }
  const env = (process.env.OPENAI_API_KEY || "").trim()
  if (env) return { key: env, source: "env" }
  return null
}

export async function saveOpenAiKey(key: string, userId: string): Promise<KeyStatus> {
  const business_id = bizId()
  const clean = String(key || "").trim()
  if (!clean || clean.length < 20 || !/^sk-/.test(clean)) throw new Error("La API key no parece válida (debe empezar con 'sk-').")
  const sb = getSupabaseAdmin()
  // Desactivar claves anteriores (rotación).
  await sb.from("bi_finance_ai_secrets").update({ active: false, rotated_at: new Date().toISOString() }).eq("business_id", business_id).eq("active", true)
  const { error } = await sb.from("bi_finance_ai_secrets").insert({
    business_id, provider: "openai", encrypted_api_key: encryptSecret(clean), key_last4: last4(clean),
    configured_by: userId, active: true,
  })
  if (error) throw new Error(error.message)
  await logBiAudit("api_key_configured", userId, { last4: last4(clean) })
  return { configured: true, last4: last4(clean), source: "db" }
}

export async function deleteOpenAiKey(userId: string): Promise<KeyStatus> {
  const business_id = bizId()
  await getSupabaseAdmin().from("bi_finance_ai_secrets").update({ active: false, rotated_at: new Date().toISOString() }).eq("business_id", business_id).eq("active", true)
  await logBiAudit("api_key_replaced", userId, {})
  return getKeyStatus(business_id)
}

// ── Modelos ──────────────────────────────────────────────────────────────────
export interface ModelItem { id: string; display: string; reasoning: boolean; legacy: boolean; source: "cache" | "fallback" }

function markModel(id: string, display?: string, reasoning?: boolean, source: "cache" | "fallback" = "fallback"): ModelItem {
  const legacy = LEGACY_MODELS.has(id)
  const reason = reasoning ?? /^(o1|o3|o4|gpt-5)/.test(id)
  return { id, display: display || id, reasoning: reason, legacy, source }
}

export async function listModels(business_id: string, effectiveModel: string) {
  const { data } = await getSupabaseAdmin().from("bi_finance_ai_models_cache")
    .select("model_id, display_name, supports_reasoning, last_seen_at, active")
    .eq("business_id", business_id).eq("active", true).order("model_id")
  const cache = (data || []) as Array<Record<string, unknown>>
  const map = new Map<string, ModelItem>()
  // Fallback siempre presente (spec §5B).
  for (const m of FALLBACK_MODELS) map.set(m.id, markModel(m.id, m.display, m.reasoning, "fallback"))
  // Cache (real de OpenAI) sobrescribe / agrega.
  let updatedAt: string | null = null
  for (const c of cache) {
    map.set(String(c.model_id), markModel(String(c.model_id), (c.display_name as string) || String(c.model_id), c.supports_reasoning as boolean | undefined, "cache"))
    const ls = c.last_seen_at ? String(c.last_seen_at) : null
    if (ls && (!updatedAt || ls > updatedAt)) updatedAt = ls
  }
  // Asegura que el modelo efectivo aparezca aunque no esté en las listas.
  if (effectiveModel && !map.has(effectiveModel)) map.set(effectiveModel, markModel(effectiveModel))
  const models = [...map.values()].sort((a, b) => Number(a.legacy) - Number(b.legacy) || a.id.localeCompare(b.id))
  return { models, updatedAt, recommended: RECOMMENDED }
}

/** Consulta GET /v1/models a OpenAI y cachea los modelos de chat. */
export async function refreshModels(business_id: string, userId: string) {
  const resolved = await resolveOpenAiKey(business_id)
  if (!resolved) return { ok: false, error: "no_api_key", reason: "Configura la API key antes de actualizar modelos." }
  const resp = await fetch(`${OPENAI_BASE}/models`, { headers: { Authorization: `Bearer ${resolved.key}` } })
  const jr = (await resp.json().catch(() => ({}))) as Record<string, unknown>
  if (!resp.ok) {
    const err = (jr.error as Record<string, unknown> | undefined)?.message || `HTTP ${resp.status}`
    return { ok: false, error: "openai_error", reason: String(err) }
  }
  const all = (jr.data as Array<Record<string, unknown>> | undefined) || []
  const EXCLUDE = /(embedding|whisper|tts|dall-e|dalle|moderation|audio|realtime|image|search|transcribe|davinci|babbage|omni-moderation)/i
  const chat = all.map((m) => String(m.id)).filter((id) => /^(gpt-|o1|o3|o4|chatgpt)/i.test(id) && !EXCLUDE.test(id))
  const sb = getSupabaseAdmin()
  const now = new Date().toISOString()
  let count = 0
  for (const id of chat) {
    const reasoning = /^(o1|o3|o4|gpt-5)/i.test(id)
    const { error } = await sb.from("bi_finance_ai_models_cache").upsert({
      business_id, model_id: id, provider: "openai", display_name: id, active: true,
      supports_responses: true, supports_reasoning: reasoning, last_seen_at: now, updated_at: now,
    }, { onConflict: "business_id,model_id" })
    if (!error) count++
  }
  await logBiAudit("models_refreshed", userId, { count })
  return { ok: true, count, updatedAt: now }
}

// ── Precios por modelo ───────────────────────────────────────────────────────
export async function getPricing(business_id: string) {
  const { data } = await getSupabaseAdmin().from("bi_finance_ai_model_pricing")
    .select("model_id, input_cost_per_1m_tokens, output_cost_per_1m_tokens, currency, active")
    .eq("business_id", business_id).order("model_id")
  return (data || []) as Array<Record<string, unknown>>
}

export async function savePricing(business_id: string, row: Record<string, unknown>, userId: string) {
  const model_id = String(row.model_id || "").trim()
  if (!model_id) throw new Error("Falta el modelo")
  const rec = {
    business_id, model_id,
    input_cost_per_1m_tokens: row.input_cost_per_1m_tokens != null && row.input_cost_per_1m_tokens !== "" ? Number(row.input_cost_per_1m_tokens) : null,
    output_cost_per_1m_tokens: row.output_cost_per_1m_tokens != null && row.output_cost_per_1m_tokens !== "" ? Number(row.output_cost_per_1m_tokens) : null,
    currency: String(row.currency || "USD"),
    active: row.active !== false,
    updated_at: new Date().toISOString(),
  }
  const { error } = await getSupabaseAdmin().from("bi_finance_ai_model_pricing").upsert(rec, { onConflict: "business_id,model_id" })
  if (error) throw new Error(error.message)
  await logBiAudit("pricing_updated", userId, { model_id })
  return { ok: true }
}

async function pricingFor(business_id: string, model: string): Promise<{ inp: number | null; out: number | null; currency: string }> {
  const { data } = await getSupabaseAdmin().from("bi_finance_ai_model_pricing")
    .select("input_cost_per_1m_tokens, output_cost_per_1m_tokens, currency").eq("business_id", business_id).eq("model_id", model).eq("active", true).maybeSingle()
  return {
    inp: data?.input_cost_per_1m_tokens != null ? Number(data.input_cost_per_1m_tokens) : null,
    out: data?.output_cost_per_1m_tokens != null ? Number(data.output_cost_per_1m_tokens) : null,
    currency: (data?.currency as string) || "USD",
  }
}

// ── Uso / límites ────────────────────────────────────────────────────────────
export interface UsageSummary {
  queriesMonth: number; queriesDay: number
  inputTokens: number; outputTokens: number; totalTokens: number
  cost: number; currency: string; hasCost: boolean
  topModel: string | null; lastAt: string | null
  limits: Record<string, number | null>
  pct: { queries: number | null; tokens: number | null; cost: number | null; max: number }
  status: "ok" | "warn70" | "warn90" | "blocked"
}

export async function computeUsage(business_id: string, settings: Record<string, unknown>): Promise<UsageSummary> {
  const sb = getSupabaseAdmin()
  const now = new Date()
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1
  const monthStart = `${y}-${String(m).padStart(2, "0")}-01T00:00:00Z`
  const dayStart = `${now.toISOString().slice(0, 10)}T00:00:00Z`
  const { data } = await sb.from("bi_finance_ai_usage_logs")
    .select("model, input_tokens, output_tokens, total_tokens, estimated_total_cost, currency, created_at")
    .eq("business_id", business_id).gte("created_at", monthStart)
  const rows = (data || []) as Array<Record<string, unknown>>
  let inputTokens = 0, outputTokens = 0, totalTokens = 0, cost = 0, queriesDay = 0
  const modelCount = new Map<string, number>()
  let hasCost = false, currency = String(settings.cost_currency || "USD"), lastAt: string | null = null
  for (const r of rows) {
    inputTokens += Number(r.input_tokens) || 0
    outputTokens += Number(r.output_tokens) || 0
    totalTokens += Number(r.total_tokens) || 0
    if (r.estimated_total_cost != null) { cost += Number(r.estimated_total_cost); hasCost = true; if (r.currency) currency = String(r.currency) }
    const mod = String(r.model || "?"); modelCount.set(mod, (modelCount.get(mod) || 0) + 1)
    const ca = String(r.created_at || ""); if (ca >= dayStart) queriesDay++
    if (!lastAt || ca > lastAt) lastAt = ca
  }
  const queriesMonth = rows.length
  const topModel = [...modelCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null

  const limits: Record<string, number | null> = {
    monthly_query_limit: settings.monthly_query_limit != null ? Number(settings.monthly_query_limit) : null,
    daily_query_limit: settings.daily_query_limit != null ? Number(settings.daily_query_limit) : null,
    monthly_input_token_limit: settings.monthly_input_token_limit != null ? Number(settings.monthly_input_token_limit) : null,
    monthly_output_token_limit: settings.monthly_output_token_limit != null ? Number(settings.monthly_output_token_limit) : null,
    monthly_total_token_limit: settings.monthly_total_token_limit != null ? Number(settings.monthly_total_token_limit) : null,
    monthly_cost_limit: settings.monthly_cost_limit != null ? Number(settings.monthly_cost_limit) : null,
  }
  const ratio = (used: number, lim: number | null) => (lim && lim > 0 ? Math.round((used / lim) * 1000) / 10 : null)
  const pctQueries = ratio(queriesMonth, limits.monthly_query_limit)
  const pctTokens = ratio(totalTokens, limits.monthly_total_token_limit)
  const pctCost = hasCost ? ratio(cost, limits.monthly_cost_limit) : null
  const pctInput = ratio(inputTokens, limits.monthly_input_token_limit)
  const pctOutput = ratio(outputTokens, limits.monthly_output_token_limit)
  const max = Math.max(0, ...[pctQueries, pctTokens, pctCost, pctInput, pctOutput].filter((x): x is number => x != null))
  const status: UsageSummary["status"] = max >= 100 ? "blocked" : max >= 90 ? "warn90" : max >= 70 ? "warn70" : "ok"

  return {
    queriesMonth, queriesDay, inputTokens, outputTokens, totalTokens, cost: Math.round(cost * 1e6) / 1e6, currency, hasCost,
    topModel, lastAt, limits, pct: { queries: pctQueries, tokens: pctTokens, cost: pctCost, max }, status,
  }
}

/** Verifica límites ANTES de llamar a OpenAI. Superadmin nunca se bloquea. */
export async function checkLimits(business_id: string, settings: Record<string, unknown>, isSuperadmin: boolean): Promise<{ blocked: boolean; reason?: string; usage: UsageSummary }> {
  const usage = await computeUsage(business_id, settings)
  if (isSuperadmin || settings.block_at_100 === false) return { blocked: false, usage }
  const L = usage.limits
  const over = (used: number, lim: number | null) => lim != null && lim > 0 && used >= lim
  if (over(usage.queriesMonth, L.monthly_query_limit)) return { blocked: true, reason: `Límite mensual de consultas alcanzado (${L.monthly_query_limit}).`, usage }
  if (over(usage.queriesDay, L.daily_query_limit)) return { blocked: true, reason: `Límite diario de consultas alcanzado (${L.daily_query_limit}).`, usage }
  if (over(usage.totalTokens, L.monthly_total_token_limit)) return { blocked: true, reason: `Límite mensual de tokens totales alcanzado.`, usage }
  if (over(usage.inputTokens, L.monthly_input_token_limit)) return { blocked: true, reason: `Límite mensual de tokens de entrada alcanzado.`, usage }
  if (over(usage.outputTokens, L.monthly_output_token_limit)) return { blocked: true, reason: `Límite mensual de tokens de salida alcanzado.`, usage }
  if (usage.hasCost && over(usage.cost, L.monthly_cost_limit)) return { blocked: true, reason: `Límite mensual de gasto alcanzado (${usage.currency} ${L.monthly_cost_limit}).`, usage }
  return { blocked: false, usage }
}

/** Registra el consumo real de una consulta (tokens + costo estimado si hay precio). */
export async function logUsage(business_id: string, userId: string, model: string, usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }, questionId: string | null) {
  const inp = Number(usage.prompt_tokens) || 0
  const out = Number(usage.completion_tokens) || 0
  const tot = Number(usage.total_tokens) || inp + out
  const price = await pricingFor(business_id, model)
  const costIn = price.inp != null ? (inp / 1e6) * price.inp : null
  const costOut = price.out != null ? (out / 1e6) * price.out : null
  const costTot = costIn != null || costOut != null ? Math.round(((costIn || 0) + (costOut || 0)) * 1e6) / 1e6 : null
  try {
    await getSupabaseAdmin().from("bi_finance_ai_usage_logs").insert({
      business_id, user_id: userId, model, endpoint: "assistant", question_id: questionId,
      input_tokens: inp, output_tokens: out, total_tokens: tot,
      estimated_input_cost: costIn, estimated_output_cost: costOut, estimated_total_cost: costTot,
      currency: price.currency,
    })
  } catch { /* nunca rompe la respuesta */ }
}

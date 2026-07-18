/**
 * BI FINANCIERO IA — Endpoint del asistente (OpenAI, backend-only).
 *
 * SEGURIDAD:
 *   - La API key JAMÁS sale del servidor. Se resuelve del negocio (DB cifrada)
 *     y, si no hay, de env OPENAI_API_KEY. Nunca se devuelve al cliente.
 *   - Valida sesión (Bearer), business_id (aislamiento por tenant) y el permiso
 *     `bi_finance.ai_chat`.
 *   - El modelo NUNCA recibe filas crudas ni PII: sólo el resumen AGREGADO real.
 *   - Cada consulta se persiste (bi_finance_ai_queries) + se registra el consumo
 *     real de tokens/costo (bi_finance_ai_usage_logs) + se audita.
 *
 * REGLAS DE NEGOCIO (inyectadas en el prompt del sistema):
 *   - Usar SOLO datos reales; nunca inventar cifras.
 *   - Si faltan datos: "No tengo datos suficientes para confirmar esto."
 *   - Cada recomendación termina en: "Recomendación sujeta a revisión administrativa."
 *   - La IA sólo RECOMIENDA; no ejecuta ni decide nada automáticamente.
 *
 * Disponibilidad (fuera de esto responde ok:false con motivo claro):
 *   - Sin API key (ni DB ni env)     → reason "no_api_key"
 *   - settings.enabled === false      → reason "ia_disabled_tenant"
 *   - Límite de uso/gasto alcanzado   → reason "limit_reached" (superadmin nunca se bloquea)
 */
import { NextResponse } from "next/server"
import { requireAuthenticatedUser, getSupabaseAdmin } from "@/lib/server/supabase"
import { loadBusinessContext } from "@/lib/server/csl-crud"
import {
  applyActiveBusiness, runWithBusinessContext, requirePermission, getBusinessContext,
} from "@/lib/server/business-context"
import { getBiFinanceSummary } from "@/lib/server/bi-finance"
import { resolveOpenAiKey, checkLimits, logUsage, logBiAudit, OPENAI_BASE } from "@/lib/server/bi-finance-secrets"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

const json = (data: unknown, status = 200) => NextResponse.json(data, { status })

/**
 * Llama a OpenAI Chat Completions adaptándose al modelo. Los modelos nuevos
 * (GPT-5.x, o-series) exigen `max_completion_tokens` en vez de `max_tokens`, y
 * algunos no aceptan `temperature`/`response_format` custom. Se hace una
 * suposición por prefijo y, si la API rechaza un parámetro, se reintenta una
 * vez quitando/renombrando el parámetro ofensivo (robusto a modelos futuros).
 */
async function openAiChat(apiKey: string, args: {
  model: string; messages: unknown[]; maxTokens: number; temperature?: number; jsonObject?: boolean
}): Promise<{ resp: Response; jr: Record<string, unknown> }> {
  const newStyle = /^(gpt-5|o1|o3|o4|gpt-4\.1)/i.test(args.model)
  const reasoning = /^(gpt-5|o1|o3|o4)/i.test(args.model)
  const noCustomTemp = /^(o1|o3|o4|gpt-5)/i.test(args.model)
  const body: Record<string, unknown> = { model: args.model, messages: args.messages }
  if (args.jsonObject) body.response_format = { type: "json_object" }
  // Los modelos de razonamiento gastan tokens en "pensar": si el límite es bajo,
  // la respuesta sale vacía. Dejamos un piso holgado (sin subir el de gpt-4o).
  const effMax = reasoning ? Math.max(args.maxTokens, args.jsonObject ? 4000 : 64) : args.maxTokens
  if (newStyle) body.max_completion_tokens = effMax
  else body.max_tokens = effMax
  if (args.temperature != null && !noCustomTemp) body.temperature = args.temperature

  const send = async () => {
    const resp = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    })
    const jr = (await resp.json().catch(() => ({}))) as Record<string, unknown>
    return { resp, jr }
  }
  let out = await send()
  if (!out.resp.ok) {
    const msg = String((out.jr.error as Record<string, unknown> | undefined)?.message || "")
    let changed = false
    if (/max_completion_tokens/i.test(msg) && "max_tokens" in body) {
      body.max_completion_tokens = body.max_tokens; delete body.max_tokens; changed = true
    }
    if (/temperature/i.test(msg) && /(unsupported|does not support|only the default|must be|not supported)/i.test(msg) && "temperature" in body) {
      delete body.temperature; changed = true
    }
    if (/response_format/i.test(msg) && "response_format" in body) { delete body.response_format; changed = true }
    if (changed) out = await send()
  }
  return out
}

interface AiAnswer {
  resumen_ejecutivo: string
  datos_utilizados: string[]
  hallazgos: string[]
  riesgos: string[]
  recomendaciones: string[]
  acciones: string[]
  nivel_confianza: "alto" | "medio" | "bajo"
  datos_faltantes: string[]
}

const DISCLAIMER = "Recomendación sujeta a revisión administrativa."

function systemPrompt(businessName: string, custom?: string | null): string {
  const base = [
    `Eres un analista financiero y de BI senior para ${businessName}, un centro de estética/spa láser en República Dominicana.`,
    "Tu rol es analizar ventas, gastos, rentabilidad por sucursal, productividad y eficiencia, y dar recomendaciones estratégicas accionables.",
    "",
    "REGLAS OBLIGATORIAS:",
    "1. Usa EXCLUSIVAMENTE los datos reales del contexto financiero proporcionado. NUNCA inventes cifras, tendencias ni comparaciones que no estén respaldadas por los datos.",
    "2. Si un dato no está disponible o es insuficiente para una conclusión, escribe textualmente: \"No tengo datos suficientes para confirmar esto.\"",
    "3. Cada recomendación DEBE terminar con la frase exacta: \"" + DISCLAIMER + "\"",
    "4. Solo RECOMIENDAS; no ejecutas ni decides nada de forma automática. El administrador toma las decisiones.",
    "5. Todas las cifras monetarias son pesos dominicanos (RD$). Sé concreto y cuantitativo, citando los números del contexto.",
    "6. Nunca menciones ni mezcles datos de otro negocio o tenant.",
    "",
    "Responde SIEMPRE en español y en formato JSON válido con exactamente estas claves:",
    "resumen_ejecutivo (string), datos_utilizados (string[]), hallazgos (string[]), riesgos (string[]), recomendaciones (string[]), acciones (string[]), nivel_confianza (\"alto\"|\"medio\"|\"bajo\"), datos_faltantes (string[]).",
  ].join("\n")
  return custom && custom.trim() ? `${base}\n\nINSTRUCCIONES ADICIONALES DEL NEGOCIO:\n${custom.trim()}` : base
}

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request)
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const activeBusinessId = typeof body.activeBusinessId === "string" ? body.activeBusinessId : undefined
    const ctx = applyActiveBusiness(await loadBusinessContext(user.id), activeBusinessId)
    if (!ctx) return json({ ok: false, error: "No se pudo cargar el contexto de negocio" }, 403)

    return await runWithBusinessContext(ctx, async () => {
      requirePermission("bi_finance.ai_chat")
      const bctx = getBusinessContext()!
      const business_id = bctx.businessId
      const sb = getSupabaseAdmin()

      const { data: settingsRow } = await sb.from("bi_finance_settings").select("*").eq("business_id", business_id).maybeSingle()
      const settings = (settingsRow || {}) as Record<string, unknown>

      // Resolver la API key (DB cifrada → env). Nunca se expone.
      const resolved = await resolveOpenAiKey(business_id)
      if (!resolved) return json({ ok: false, error: "no_api_key", reason: "No hay API key de OpenAI configurada. Configúrala en Configuración IA." }, 200)

      const apiKey = resolved.key
      const model = (String(settings.model || "").trim()) || (process.env.OPENAI_MODEL || "").trim() || "gpt-4o"
      const temperature = settings.temperature != null ? Number(settings.temperature) : 0.2
      const maxTokens = settings.max_tokens != null ? Number(settings.max_tokens) : 1200
      const mode = String(body.mode || "chat")

      // ── Probar conexión ────────────────────────────────────────────────
      if (mode === "test") {
        const t0 = Date.now()
        const { resp, jr } = await openAiChat(apiKey, { model, messages: [{ role: "user", content: "Responde solo: OK" }], maxTokens: 16 })
        await logBiAudit("openai_test_connection", user.id, { model, ok: resp.ok })
        if (!resp.ok) {
          const err = (jr.error as Record<string, unknown> | undefined)?.message || `HTTP ${resp.status}`
          return json({ ok: false, error: "openai_error", reason: String(err), model }, 200)
        }
        return json({ ok: true, model, latencyMs: Date.now() - t0, provider: "openai", keySource: resolved.source })
      }

      if (settingsRow && settings.enabled === false) return json({ ok: false, error: "ia_disabled_tenant", reason: "El asistente IA está desactivado para este negocio en Configuración IA." }, 200)

      const question = String(body.question || "").trim()
      if (!question) return json({ ok: false, error: "Escribe una pregunta para el asistente." }, 400)

      // ── Límites de uso / gasto ─────────────────────────────────────────
      const limitCheck = await checkLimits(business_id, settings, Boolean(bctx.isSuperadmin))
      if (limitCheck.blocked) {
        await logBiAudit("ai_request_blocked_limit", user.id, { reason: limitCheck.reason })
        return json({ ok: false, error: "limit_reached", reason: `${limitCheck.reason} Ajusta el límite en Configuración IA o espera el próximo período.`, usage: limitCheck.usage }, 200)
      }

      // ── Contexto financiero REAL (agregado, sin PII) ───────────────────
      const now = new Date()
      const pMonth = Number(body.month) || now.getUTCMonth() + 1
      const pYear = Number(body.year) || now.getUTCFullYear()
      const branch = typeof body.branch === "string" && body.branch ? body.branch : null
      const from = typeof body.from === "string" && body.from ? body.from : undefined
      const to = typeof body.to === "string" && body.to ? body.to : undefined
      const extra = (settings.extra || {}) as Record<string, unknown>
      const summary = await getBiFinanceSummary({ from, to, month: pMonth, year: pYear, branch, allocateOverhead: extra.allocate_overhead !== false })
      const scope = String(body.scope || "dashboard")

      const userContent = [
        `PREGUNTA DEL ADMINISTRADOR (pantalla: ${scope}): ${question}`,
        "",
        "CONTEXTO FINANCIERO REAL DEL PERÍODO (cifras en RD$, agregadas):",
        JSON.stringify(summary),
      ].join("\n")

      const t0 = Date.now()
      const { resp, jr } = await openAiChat(apiKey, {
        model, temperature, maxTokens, jsonObject: true,
        messages: [
          { role: "system", content: systemPrompt(summary.business.name, settings.system_prompt as string | undefined) },
          { role: "user", content: userContent },
        ],
      })
      if (!resp.ok) {
        const err = (jr.error as Record<string, unknown> | undefined)?.message || `HTTP ${resp.status}`
        void sb.from("bi_finance_ai_queries").insert({
          business_id, user_id: user.id, user_email: user.email, scope, branch,
          period_month: pMonth, period_year: pYear, question, model, provider: "openai", ok: false, error: String(err),
        })
        await logBiAudit("ai_request_error", user.id, { model, error: String(err) })
        return json({ ok: false, error: "openai_error", reason: String(err), model }, 200)
      }

      const usage = (jr.usage || {}) as Record<string, number>
      const raw = ((jr.choices as Array<Record<string, unknown>>)?.[0]?.message as Record<string, unknown>)?.content
      let answer: AiAnswer
      try {
        answer = JSON.parse(String(raw || "{}")) as AiAnswer
      } catch {
        answer = {
          resumen_ejecutivo: String(raw || "No se pudo interpretar la respuesta."),
          datos_utilizados: [], hallazgos: [], riesgos: [], recomendaciones: [], acciones: [],
          nivel_confianza: "bajo", datos_faltantes: ["Respuesta no estructurada del modelo."],
        }
      }
      answer.recomendaciones = (answer.recomendaciones || []).map((r) =>
        r.trim().endsWith(DISCLAIMER) ? r.trim() : `${r.trim()} ${DISCLAIMER}`)

      let queryId: string | null = null
      try {
        const { data: ins } = await sb.from("bi_finance_ai_queries").insert({
          business_id, user_id: user.id, user_email: user.email, scope, branch,
          period_month: pMonth, period_year: pYear, question, model, provider: "openai",
          answer, confidence: answer.nivel_confianza || null,
          tokens_prompt: usage.prompt_tokens || null, tokens_completion: usage.completion_tokens || null,
          tokens_total: usage.total_tokens || null, ok: true,
        }).select("id").single()
        queryId = (ins as Record<string, unknown> | null)?.id as string | null
      } catch { /* logging nunca rompe la respuesta */ }

      await logUsage(business_id, user.id, model, usage, queryId)
      await logBiAudit("ai_request_success", user.id, { model, tokens: usage.total_tokens || null })

      return json({
        ok: true, queryId, model, keySource: resolved.source, latencyMs: Date.now() - t0,
        tokens: usage.total_tokens || null, answer,
        period: summary.period, business: summary.business,
      })
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido"
    const status = msg === "Sesion invalida" || msg === "No autenticado" ? 401 : msg.startsWith("No tienes permiso") ? 403 : 500
    return json({ ok: false, error: msg }, status)
  }
}

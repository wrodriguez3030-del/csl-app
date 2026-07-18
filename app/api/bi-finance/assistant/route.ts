/**
 * BI FINANCIERO IA — Endpoint del asistente (OpenAI, backend-only).
 *
 * SEGURIDAD:
 *   - La API key JAMÁS sale del servidor (se lee de env OPENAI_API_KEY).
 *   - Valida sesión (Bearer), business_id (aislamiento por tenant) y el permiso
 *     `bi_finance.ai_chat`.
 *   - El modelo NUNCA recibe filas crudas ni PII: sólo el resumen AGREGADO real.
 *   - Toda consulta se persiste (bi_finance_ai_queries) y se audita.
 *
 * REGLAS DE NEGOCIO (inyectadas en el prompt del sistema):
 *   - Usar SOLO datos reales del contexto; nunca inventar cifras.
 *   - Si faltan datos: "No tengo datos suficientes para confirmar esto."
 *   - Cada recomendación termina en: "Recomendación sujeta a revisión administrativa."
 *   - La IA sólo RECOMIENDA; no ejecuta ni decide nada automáticamente.
 *
 * Gates de disponibilidad (fuera de estos, responde ok:false con motivo claro):
 *   - BI_FINANCE_AI_ENABLED !== "true"  → reason "ia_disabled"
 *   - OPENAI_API_KEY ausente            → reason "no_api_key"
 *   - settings.enabled === false        → reason "ia_disabled_tenant"
 */
import { NextResponse } from "next/server"
import { requireAuthenticatedUser, getSupabaseAdmin } from "@/lib/server/supabase"
import { loadBusinessContext } from "@/lib/server/csl-crud"
import {
  applyActiveBusiness, runWithBusinessContext, requirePermission, getBusinessContext,
} from "@/lib/server/business-context"
import { getBiFinanceSummary } from "@/lib/server/bi-finance"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

const json = (data: unknown, status = 200) => NextResponse.json(data, { status })
const OPENAI_URL = "https://api.openai.com/v1/chat/completions"

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
    const enabled = String(process.env.BI_FINANCE_AI_ENABLED || "").trim().toLowerCase() === "true"
    const apiKey = (process.env.OPENAI_API_KEY || "").trim()

    const user = await requireAuthenticatedUser(request)
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const activeBusinessId = typeof body.activeBusinessId === "string" ? body.activeBusinessId : undefined
    const ctx = applyActiveBusiness(await loadBusinessContext(user.id), activeBusinessId)
    if (!ctx) return json({ ok: false, error: "No se pudo cargar el contexto de negocio" }, 403)

    return await runWithBusinessContext(ctx, async () => {
      requirePermission("bi_finance.ai_chat")
      const business_id = getBusinessContext()!.businessId
      const sb = getSupabaseAdmin()

      // Configuración de la IA del tenant.
      const { data: settingsRow } = await sb.from("bi_finance_settings").select("*").eq("business_id", business_id).maybeSingle()
      const settings = (settingsRow || {}) as Record<string, unknown>

      const mode = String(body.mode || "chat")

      // ── Gates de disponibilidad ────────────────────────────────────────
      if (!apiKey) return json({ ok: false, error: "no_api_key", reason: "Falta configurar OPENAI_API_KEY en el servidor (Vercel)." }, 200)
      if (!enabled) return json({ ok: false, error: "ia_disabled", reason: "El asistente IA no está habilitado (define BI_FINANCE_AI_ENABLED=true)." }, 200)
      if (settingsRow && settings.enabled === false) return json({ ok: false, error: "ia_disabled_tenant", reason: "El asistente IA está desactivado para este negocio en Configuración IA." }, 200)

      const model = (String(settings.model || "").trim()) || (process.env.OPENAI_MODEL || "").trim() || "gpt-4o"
      const temperature = settings.temperature != null ? Number(settings.temperature) : 0.2
      const maxTokens = settings.max_tokens != null ? Number(settings.max_tokens) : 1200

      // ── Probar conexión ────────────────────────────────────────────────
      if (mode === "test") {
        const t0 = Date.now()
        const resp = await fetch(OPENAI_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, messages: [{ role: "user", content: "Responde solo: OK" }], max_tokens: 5 }),
        })
        const jr = (await resp.json().catch(() => ({}))) as Record<string, unknown>
        if (!resp.ok) {
          const err = (jr.error as Record<string, unknown> | undefined)?.message || `HTTP ${resp.status}`
          return json({ ok: false, error: "openai_error", reason: String(err), model }, 200)
        }
        return json({ ok: true, model, latencyMs: Date.now() - t0, provider: "openai" })
      }

      const question = String(body.question || "").trim()
      if (!question) return json({ ok: false, error: "Escribe una pregunta para el asistente." }, 400)

      // ── Límite mensual de consultas ────────────────────────────────────
      const now = new Date()
      const pMonth = Number(body.month) || now.getUTCMonth() + 1
      const pYear = Number(body.year) || now.getUTCFullYear()
      const limit = settings.monthly_query_limit != null ? Number(settings.monthly_query_limit) : 300
      if (limit > 0) {
        const { count } = await sb.from("bi_finance_ai_queries").select("id", { count: "exact", head: true })
          .eq("business_id", business_id).eq("period_year", pYear).eq("period_month", pMonth)
        if ((count || 0) >= limit) {
          return json({ ok: false, error: "limit_reached", reason: `Alcanzaste el límite de ${limit} consultas para el período. Ajústalo en Configuración IA.` }, 200)
        }
      }

      // ── Contexto financiero REAL (agregado, sin PII) ───────────────────
      const branch = typeof body.branch === "string" && body.branch ? body.branch : null
      const summary = await getBiFinanceSummary({ month: pMonth, year: pYear, branch })
      const scope = String(body.scope || "dashboard")

      const userContent = [
        `PREGUNTA DEL ADMINISTRADOR (pantalla: ${scope}): ${question}`,
        "",
        "CONTEXTO FINANCIERO REAL DEL PERÍODO (cifras en RD$, agregadas):",
        JSON.stringify(summary),
      ].join("\n")

      const t0 = Date.now()
      const resp = await fetch(OPENAI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          temperature,
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt(summary.business.name, settings.system_prompt as string | undefined) },
            { role: "user", content: userContent },
          ],
        }),
      })
      const jr = (await resp.json().catch(() => ({}))) as Record<string, unknown>
      if (!resp.ok) {
        const err = (jr.error as Record<string, unknown> | undefined)?.message || `HTTP ${resp.status}`
        // Persistir el intento fallido (sin romper).
        void sb.from("bi_finance_ai_queries").insert({
          business_id, user_id: user.id, user_email: user.email, scope, branch,
          period_month: pMonth, period_year: pYear, question, model, provider: "openai",
          ok: false, error: String(err),
        })
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
      // Garantía dura: cada recomendación lleva el descargo (regla 3).
      answer.recomendaciones = (answer.recomendaciones || []).map((r) =>
        r.trim().endsWith(DISCLAIMER) ? r.trim() : `${r.trim()} ${DISCLAIMER}`)

      const record = {
        business_id, user_id: user.id, user_email: user.email, scope, branch,
        period_month: pMonth, period_year: pYear, question, model, provider: "openai",
        answer, confidence: answer.nivel_confianza || null,
        tokens_prompt: usage.prompt_tokens || null, tokens_completion: usage.completion_tokens || null,
        tokens_total: usage.total_tokens || null, ok: true,
      }
      let queryId: string | null = null
      try {
        const { data: ins } = await sb.from("bi_finance_ai_queries").insert(record).select("id").single()
        queryId = (ins as Record<string, unknown> | null)?.id as string | null
      } catch { /* logging nunca rompe la respuesta */ }

      return json({
        ok: true, queryId, model, latencyMs: Date.now() - t0,
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

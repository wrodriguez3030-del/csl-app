/**
 * POST /api/integrations/agendapro/payments?token=...
 *
 * Webhook de PAGOS de AgendaPro (distinto del webhook de clientes en
 * ../webhook, que se mantiene intacto). Procesa el payload real de un pago:
 * bookings / mock_bookings / memberships / products / giftcards / receipts /
 * down_payments. Crea/actualiza cliente, registra la compra (sesiones
 * adquiridas = disponibles, NUNCA consume) y crea el consentimiento pendiente.
 *
 * Seguridad (§8):
 *   - `?token=` == AGENDAPRO_WEBHOOK_SECRET (comparación en tiempo constante).
 *   - HMAC-SHA256 opcional: si llega `x-agendapro-signature`, se valida contra
 *     el body con el mismo secreto.
 *   - Content-Type JSON, tamaño máximo, rate-limit básico por IP.
 *   - Idempotencia por payment.id en el orquestador.
 *
 * Respuestas (§19): 200 processed / 200 already_processed / 202 requires_mapping /
 *   400 invalid / 401 auth / 500 error interno. Nunca stack traces ni PII completa.
 */

import crypto from "node:crypto"
import { NextResponse } from "next/server"
import { getAgendaProConfig } from "@/lib/server/agendapro"
import { createSupabaseRepo, processAgendaProPayment } from "@/lib/server/agendapro-payments"

export const dynamic = "force-dynamic"
export const revalidate = 0

const MAX_BODY_BYTES = 512 * 1024 // 512 KB

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status })
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

// ── Rate limit best-effort en memoria (por IP). No sustituye a un WAF, pero
//    frena reenvíos abusivos dentro de la misma instancia. ──
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 120
const rateBuckets = new Map<string, { count: number; resetAt: number }>()
function rateLimited(ip: string): boolean {
  const now = Date.now()
  const b = rateBuckets.get(ip)
  if (!b || now > b.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return false
  }
  b.count += 1
  return b.count > RATE_MAX
}

export async function POST(request: Request) {
  const cfg = getAgendaProConfig()
  const enabled = (process.env.AGENDAPRO_WEBHOOK_ENABLED ?? "true").toLowerCase() !== "false"
  const logPayloads = (process.env.AGENDAPRO_LOG_PAYLOADS ?? "false").toLowerCase() === "true"

  if (!cfg.webhookSecret) {
    return json({ success: false, error: "Webhook AgendaPro no configurado (AGENDAPRO_WEBHOOK_SECRET faltante)." }, 503)
  }
  if (!enabled) {
    return json({ success: false, error: "Webhook de pagos deshabilitado (AGENDAPRO_WEBHOOK_ENABLED=false)." }, 503)
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  if (rateLimited(ip)) {
    return json({ success: false, error: "Demasiadas solicitudes." }, 429)
  }

  // Autenticación por token (constante) + HMAC opcional.
  const url = new URL(request.url)
  const token = url.searchParams.get("token") || ""
  if (!safeEqual(token, cfg.webhookSecret)) {
    return json({ success: false, error: "Token inválido" }, 401)
  }

  const contentType = request.headers.get("content-type") || ""
  if (contentType && !contentType.toLowerCase().includes("json")) {
    return json({ success: false, error: "Content-Type debe ser application/json" }, 415)
  }

  const raw = await request.text()
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return json({ success: false, error: "Payload demasiado grande" }, 413)
  }

  // HMAC opcional (si AgendaPro lo envía).
  const signature = request.headers.get("x-agendapro-signature")
  if (signature) {
    const expected = crypto.createHmac("sha256", cfg.webhookSecret).update(raw).digest("hex")
    const provided = signature.replace(/^sha256=/i, "").trim()
    if (!safeEqual(provided, expected)) {
      return json({ success: false, error: "Firma HMAC inválida" }, 401)
    }
  }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return json({ success: false, error: "Body inválido (JSON esperado)" }, 400)
  }

  const payloadHash = crypto.createHash("sha256").update(raw).digest("hex")

  try {
    const repo = createSupabaseRepo()
    const result = await processAgendaProPayment(payload, repo, { payloadHash, storePayload: logPayloads })
    return json(
      {
        success: result.status !== "invalid" && result.status !== "error",
        status: result.status,
        payment_id: result.paymentId,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.error && result.status === "invalid" ? { error: result.error } : {}),
      },
      result.httpStatus,
    )
  } catch (err) {
    // Nunca exponer stack trace ni datos personales.
    console.error("[agendapro/payments] error interno:", err instanceof Error ? err.message : err)
    return json({ success: false, status: "error", error: "Error interno procesando el pago." }, 500)
  }
}

/** GET = health-check sin secretos. */
export async function GET() {
  const cfg = getAgendaProConfig()
  const enabled = (process.env.AGENDAPRO_WEBHOOK_ENABLED ?? "true").toLowerCase() !== "false"
  return json({
    success: true,
    endpoint: "/api/integrations/agendapro/payments",
    enabled,
    webhookConfigured: Boolean(cfg.webhookSecret) && cfg.webhookSecret.length >= 16,
  })
}

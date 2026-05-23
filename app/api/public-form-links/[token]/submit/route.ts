/**
 * POST /api/public-form-links/[token]/submit — el cliente envía el form.
 *
 * Endpoint PÚBLICO (sin auth). El token valida la sesión efímera.
 *
 * Flujo atómico:
 *   1. Verificar token (solo lectura).
 *   2. Construir el row del form según link.form_type (reusa los mappers
 *      existentes: fichaDermoToDb / consentToDb).
 *   3. CLAIM atómico del token (UPDATE WHERE usado=false ...). Si retorna
 *      0 filas → 409 conflicto (race / expirado mientras enviaba).
 *   4. INSERT del row en la tabla correspondiente, con business_id del link.
 *   5. Si el INSERT falla post-claim: NO revertimos el claim (mejor que
 *      double-submit). Devolvemos 500 y el usuario tendrá que pedir link nuevo.
 *
 * Rate-limit por IP para frenar abuso si alguien descubre un patrón de tokens.
 */

import { NextResponse } from "next/server"
import { fichaDermoToDb } from "@/lib/dermo-server"
import { consentToDb } from "@/lib/server/csl-transforms"
import { getSupabaseAdmin } from "@/lib/server/supabase"
import { claimPublicFormLink, verifyPublicFormLink } from "@/lib/server/public-form-links"
import { clientIp, rateLimit } from "@/lib/rate-limit-server"

export const dynamic = "force-dynamic"
export const revalidate = 0

const POST_LIMIT = { max: 8, windowMs: 10 * 60 * 1000 } // 8 envíos / 10 min / IP

function json(data: Record<string, unknown>, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      ...extra,
    },
  })
}

type FormPayload = Record<string, unknown>

function deriveRecordId(formType: string, payload: FormPayload): string {
  if (formType === "ficha_dermatologica") {
    return String(payload.id || payload.ID || `dermo_${Date.now()}`)
  }
  const prefix = formType === "consentimiento_masajes" ? "CM" : "CTC"
  return String(payload.id || payload.ID || `${prefix}-${Date.now()}`)
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const ip = clientIp(request)
    const limit = rateLimit({ key: `public-form-link-submit:${ip}`, ...POST_LIMIT })
    if (!limit.ok) {
      return json(
        { ok: false, error: "Demasiados envíos desde tu conexión. Intenta de nuevo en unos minutos." },
        429,
        { "Retry-After": String(limit.retryAfterSeconds) },
      )
    }

    const { token } = await context.params
    const body = (await request.json().catch(() => ({}))) as FormPayload

    // 1) Verificar (solo lectura). Validamos antes de pegarle a la DB de form.
    const verified = await verifyPublicFormLink(String(token || ""))
    if (verified.status !== "valido" || !verified.formType || !verified.link) {
      return json({ ok: false, status: verified.status, error: `Link ${verified.status}` }, 410)
    }

    const formType = verified.formType
    const businessId = verified.link.business_id

    // 2) Construir row según tipo de formulario. Forzamos business_id desde
    // el link — NO confiamos en lo que mande el cliente.
    let recordId: string
    let row: Record<string, unknown>
    let targetTable: "csl_ficha_dermatologica" | "csl_consent_masajes" | "csl_consent_tatuajes_cejas"
    let onConflictKey: "ficha_id" | "consent_id"

    // Estado al venir desde link público = "Pendiente de revisión". La
    // especialista debe abrirlo en interno, completar los campos clínicos
    // (Evaluación, Observación cutánea, firma del especialista, etc.) y
    // cambiarlo a "Completada" / "Firmado" antes del PDF final.
    if (formType === "ficha_dermatologica") {
      recordId = deriveRecordId(formType, body)
      row = fichaDermoToDb({ ...body, id: recordId, estado: "Pendiente de revisión" }) as Record<string, unknown>
      row.business_id = businessId
      targetTable = "csl_ficha_dermatologica"
      onConflictKey = "ficha_id"
    } else if (formType === "consentimiento_masajes" || formType === "consentimiento_tatuajes_cejas") {
      recordId = deriveRecordId(formType, body)
      const kind = formType === "consentimiento_masajes" ? "masajes" : "tatuajes"
      row = consentToDb({ ...body, id: recordId, estado: "Pendiente de revisión" }, kind) as Record<string, unknown>
      row.business_id = businessId
      targetTable = formType === "consentimiento_masajes" ? "csl_consent_masajes" : "csl_consent_tatuajes_cejas"
      onConflictKey = "consent_id"
    } else {
      return json({ ok: false, error: "Tipo de formulario no soportado" }, 400)
    }

    // Validación mínima: firma del cliente (para todos los tipos).
    const hasFirmaCliente = formType === "ficha_dermatologica"
      ? Boolean(row.firma_digital || row.firma_cliente)
      : Boolean(row.firma_cliente)
    if (!hasFirmaCliente) {
      return json({ ok: false, error: "Falta la firma del cliente" }, 400)
    }

    // 3) CLAIM atómico — solo continuamos si reclamamos el token con éxito.
    const claimed = await claimPublicFormLink(String(token), recordId)
    if (!claimed) {
      // Race: alguien más usó el token entre verify y claim, o expiró.
      const recheck = await verifyPublicFormLink(String(token))
      return json({ ok: false, status: recheck.status, error: `Link ${recheck.status}` }, 409)
    }

    // 4) INSERT del form. Usamos upsert con onConflict para que sea idempotente
    // si por algún motivo el cliente reintenta (mismo recordId).
    const supabase = getSupabaseAdmin()
    const { error } = await supabase
      .from(targetTable)
      .upsert(row, { onConflict: onConflictKey })
    if (error) {
      return json(
        { ok: false, error: `Token consumido pero falló el guardado: ${error.message}` },
        500,
      )
    }

    return json({ ok: true, recordId, formType })
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : "Error desconocido" },
      500,
    )
  }
}

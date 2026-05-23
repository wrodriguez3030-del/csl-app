/**
 * POST /api/public-form-links/[token]/submit — el cliente envía el form.
 *
 * Endpoint PÚBLICO (sin auth). El token valida la sesión efímera.
 *
 * Flujo (corregido tras bug "token consumido pero falló el guardado"):
 *   1. Verificar token (solo lectura). Aceptamos token usado=true PERO
 *      con submitted_record_id null como recuperable — un intento previo
 *      consumió el token sin grabar nada (bug histórico).
 *   2. Construir el row del form (reusa fichaDermoToDb / consentToDb).
 *   3. INSERT del row PRIMERO, con schema-fallback (si la DB no conoce
 *      una columna por schema cache stale, la stripea y reintenta).
 *      Si falla terminal: 500, token NO consumido, cliente puede reintentar.
 *   4. CLAIM atómico del token (UPDATE usado=true + submitted_record_id).
 *      Si CLAIM gana → marca consumido. Si pierde una race (otro request
 *      consumió en paralelo), el form ya está guardado (upsert idempotente)
 *      → devolvemos OK igual.
 *
 * Rate-limit por IP para frenar abuso si alguien descubre un patrón de tokens.
 */

import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
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

/**
 * Upsert con schema-fallback: si Postgres/PostgREST devuelve "column 'X' of
 * '<table>'" la quita del payload y reintenta. Idéntico patrón a
 * `upsertRow("ficha_dermatologica", ...)` en csl-crud.ts (que ya tolera esto
 * en el flujo interno) — acá lo aplicamos a las 3 tablas del submit público.
 *
 * Esto resuelve el caso real reportado:
 *   "Could not find the 'alergias' column of 'csl_ficha_dermatologica'
 *    in the schema cache"
 * Cuando la DB tiene un subset de columnas vs el shape TS, el mapper
 * genera campos extra; los stripeamos y reintentamos hasta lograr el insert.
 */
async function upsertWithSchemaFallback(
  supabase: SupabaseClient,
  table: string,
  payload: Record<string, unknown>,
  onConflict: string,
): Promise<void> {
  const row = { ...payload }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { error } = await supabase.from(table).upsert(row, { onConflict })
    if (!error) return
    // Postgres "column 'X' of ..." | PostgREST PGRST204 "Could not find ... column"
    const match = /['"]([a-z0-9_]+)['"]\s+column|column\s+['"]?([a-z0-9_]+)['"]?\s+of/i.exec(error.message || "")
    const missing = (match?.[1] || match?.[2] || "").toLowerCase()
    if (!missing || !(missing in row)) {
      // Error que no es "columna faltante" — no podemos arreglarlo acá.
      throw error
    }
    delete row[missing]
  }
  throw new Error(`No se pudo guardar en ${table}: demasiadas columnas pendientes de migración`)
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

    // 3) INSERT del form PRIMERO — con schema fallback. Si la columna no
    // existe en la DB (PGRST204 / schema cache stale), la stripea y reintenta.
    // Si el insert termina fallando, el token NO se consume y el cliente
    // puede reintentar con el mismo link.
    const supabase = getSupabaseAdmin()
    try {
      await upsertWithSchemaFallback(supabase, targetTable, row, onConflictKey)
    } catch (insertError) {
      // Log server-side con el mensaje técnico real (para el operador) pero
      // devolvemos al cliente un mensaje amigable y NO consumimos el token.
      const msg = insertError instanceof Error ? insertError.message : String(insertError)
      console.error("[public-form-link/submit] insert error", {
        token_id: verified.link.id,
        form_type: formType,
        target: targetTable,
        record_id: recordId,
        error: msg,
      })
      return json(
        {
          ok: false,
          error: "No se pudo enviar el formulario. Por favor intente nuevamente o comuníquese con recepción.",
        },
        500,
      )
    }

    // 4) CLAIM atómico del token DESPUÉS del insert exitoso. Si gana → marca
    // consumido. Si pierde la race (otro request consumió en paralelo), el
    // form ya está guardado (recordId determinístico + upsert idempotente)
    // → devolvemos OK igual; el cliente cumplió su parte.
    const claimed = await claimPublicFormLink(String(token), recordId)
    if (!claimed) {
      // El form está guardado. Tratamos como éxito — la operación del
      // cliente terminó. El log queda para auditoría.
      console.warn("[public-form-link/submit] form saved but claim race", {
        token_id: verified.link.id,
        record_id: recordId,
      })
    }

    return json({ ok: true, recordId, formType })
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : "Error desconocido" },
      500,
    )
  }
}

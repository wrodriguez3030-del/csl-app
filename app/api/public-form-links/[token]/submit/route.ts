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

/**
 * Asegura un cliente_id válido en csl_cosmiatria_clientes (la PK real es
 * `cliente_id`, NO `id`).
 *
 * Estrategia para evitar el error
 *   "duplicate key value violates unique constraint
 *    csl_cosmiatria_clientes_documento_uidx":
 *
 *   1. Si el body trae clienteId/cliente_id (vinculado al generar el link)
 *      → buscar por cliente_id (PK). Si existe, usar.
 *   2. Si tiene documento_identidad → buscar por esa columna unique.
 *      Si existe, usar el cliente_id encontrado (no insertar nada nuevo).
 *   3. Si tiene teléfono → buscar por telefono.
 *   4. Si no se encontró nada → INSERT nuevo con cliente_id determinístico
 *      cli_doc_<digits> o cli_tel_<digits>. Si el INSERT falla por
 *      duplicate-key (race / unique violation), re-buscar por documento
 *      y devolver el cliente_id existente.
 *
 * Devuelve el cliente_id a usar en la ficha/consent, o "" si no había
 * data suficiente para vincular (no es error — la ficha guarda con
 * cliente_id vacío).
 */
async function ensureCliente(
  supabase: SupabaseClient,
  businessId: string,
  body: FormPayload,
): Promise<string> {
  const onlyDigits = (v: unknown) => String(v ?? "").replace(/\D/g, "")
  const nombre = String(body.nombre || body.Nombre || body.nombreCliente || "").trim()
  const documento = String(body.documento || body.Documento || body.cedula || body.Cedula || "").trim()
  const telefono = String(body.telefono || body.Telefono || "").trim()
  const docDigits = onlyDigits(documento)
  const telDigits = onlyDigits(telefono)
  const explicitClienteId = String(body.clienteId || body.cliente_id || body.ClienteID || "").trim()
  const correo = String(body.correo || body.email || body.Email || "").trim()
  const direccion = String(body.direccion || body.Direccion || "").trim()
  const sucursal = String(body.sucursal || body.Sucursal || "").trim()

  // NOTA: las búsquedas NO filtran por business_id. Razón:
  //   - El índice único csl_cosmiatria_clientes_documento_uidx es GLOBAL
  //     (un mismo documento_identidad solo puede existir UNA vez en toda
  //     la tabla, sin importar tenant).
  //   - Si filtráramos por business_id y el cliente histórico tiene
  //     business_id distinto (legacy null o tenant cruzado), no lo
  //     encontraríamos → intentaríamos INSERT → reventaría con el unique
  //     global que sí lo detecta.
  //   - Reusar el cliente_id existente es lo correcto: la ficha apunta a
  //     ese cliente. La ficha sí lleva el business_id del link, no se
  //     mezclan datos clínicos entre tenants.

  // 1) Si vino un clienteId explícito, ver si existe.
  if (explicitClienteId) {
    const { data } = await supabase
      .from("csl_cosmiatria_clientes")
      .select("cliente_id")
      .eq("cliente_id", explicitClienteId)
      .maybeSingle()
    if (data?.cliente_id) return String(data.cliente_id)
  }

  // 2) Buscar por documento_identidad — la columna con índice único.
  //    Comparamos tanto el documento como viene como solo-dígitos para
  //    tolerar diferencias de formato (con/sin guiones, espacios).
  if (documento || docDigits) {
    const orParts: string[] = []
    if (documento) orParts.push(`documento_identidad.eq.${documento}`)
    if (docDigits && docDigits !== documento) orParts.push(`documento_identidad.eq.${docDigits}`)
    const { data } = await supabase
      .from("csl_cosmiatria_clientes")
      .select("cliente_id, documento_identidad")
      .or(orParts.join(","))
      .limit(1)
      .maybeSingle()
    if (data?.cliente_id) return String(data.cliente_id)
  }

  // 3) Buscar por teléfono como último recurso de matching.
  if (telefono || telDigits) {
    const orParts: string[] = []
    if (telefono) orParts.push(`telefono.eq.${telefono}`)
    if (telDigits && telDigits !== telefono) orParts.push(`telefono.eq.${telDigits}`)
    const { data } = await supabase
      .from("csl_cosmiatria_clientes")
      .select("cliente_id")
      .or(orParts.join(","))
      .limit(1)
      .maybeSingle()
    if (data?.cliente_id) return String(data.cliente_id)
  }

  // 4) No existe → crear nuevo cliente con cliente_id determinístico.
  if (!docDigits && !telDigits && !nombre) {
    // Sin data suficiente para crear ni vincular — devolvemos vacío.
    return ""
  }
  const newClienteId = explicitClienteId
    || (docDigits ? `cli_doc_${docDigits}` : telDigits ? `cli_tel_${telDigits}` : `cli_${Date.now()}`)
  const partes = nombre.split(/\s+/).filter(Boolean)
  const nombreCorto = partes.length > 1 ? partes.slice(0, Math.ceil(partes.length / 2)).join(" ") : (partes[0] || nombre)
  const apellido = partes.length > 1 ? partes.slice(Math.ceil(partes.length / 2)).join(" ") : ""

  const insertRow: Record<string, unknown> = {
    cliente_id: newClienteId,
    business_id: businessId,
    numero_cliente: docDigits || telDigits || newClienteId,
    nombre: nombreCorto,
    apellido,
    documento_identidad: documento || null,
    telefono: telefono || null,
    email: correo || null,
    direccion: direccion || null,
    sucursal: sucursal || null,
    estado: "Activo",
    cliente_desde: new Date().toISOString().slice(0, 10),
    payload_json: {},
  }
  // Upsert con onConflict en cliente_id para que sea idempotente.
  const { error: insertErr } = await supabase
    .from("csl_cosmiatria_clientes")
    .upsert(insertRow, { onConflict: "cliente_id" })

  if (insertErr) {
    console.warn("[ensureCliente] insert/upsert failed, attempting recovery", {
      code: (insertErr as { code?: string }).code,
      message: insertErr.message,
      documento,
      docDigits,
      telefono,
    })
    // 23505 = unique_violation. El único índice unique conocido en esta
    // tabla es csl_cosmiatria_clientes_documento_uidx (sobre
    // documento_identidad, GLOBAL). Si chocó, el cliente con ese doc
    // existe — recuperamos su cliente_id por búsqueda global.
    // Probamos múltiples variantes de matching para tolerar formatos.
    const tryFindByDoc = async (value: string): Promise<string | null> => {
      try {
        const { data } = await supabase
          .from("csl_cosmiatria_clientes")
          .select("cliente_id")
          .eq("documento_identidad", value)
          .limit(1)
          .maybeSingle()
        return data?.cliente_id ? String(data.cliente_id) : null
      } catch { return null }
    }
    const tryFindByTel = async (value: string): Promise<string | null> => {
      try {
        const { data } = await supabase
          .from("csl_cosmiatria_clientes")
          .select("cliente_id")
          .eq("telefono", value)
          .limit(1)
          .maybeSingle()
        return data?.cliente_id ? String(data.cliente_id) : null
      } catch { return null }
    }

    // Probar TODAS las variantes posibles del documento: tal cual, sin
    // espacios, solo dígitos, con guiones canónicos.
    const docVariants = Array.from(new Set([
      documento,
      documento.replace(/\s+/g, ""),
      docDigits,
      docDigits ? `${docDigits.slice(0, 3)}-${docDigits.slice(3, 10)}-${docDigits.slice(10)}` : "",
    ].filter(Boolean)))
    for (const v of docVariants) {
      const found = await tryFindByDoc(v)
      if (found) return found
    }
    const telVariants = Array.from(new Set([telefono, telDigits].filter(Boolean)))
    for (const v of telVariants) {
      const found = await tryFindByTel(v)
      if (found) return found
    }
    // Último recurso: NO lanzamos — guardamos la ficha sin cliente_id
    // vinculado. Mejor que perder el envío del cliente. El operador
    // puede vincular el cliente manualmente después desde el sistema
    // interno. Logueamos para auditoría.
    console.error("[ensureCliente] could not recover cliente — saving ficha without cliente_id link", {
      documento, docDigits, telefono, businessId,
      insertErrorCode: (insertErr as { code?: string }).code,
      insertErrorMessage: insertErr.message,
    })
    return ""
  }
  return newClienteId
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

    // 2) Asegurar cliente_id válido en csl_cosmiatria_clientes ANTES de
    // armar el row del form. Esto previene:
    //   (a) "duplicate key on documento_identidad" — si ya existe un cliente
    //       con ese doc, reusamos su cliente_id (no insertamos uno nuevo).
    //   (b) Cliente_id huérfano en la ficha/consent que apunte a una fila
    //       inexistente — el helper crea el cliente si no existe.
    // Si falla, el token NO se consume (este try lanza al catch externo).
    const supabase = getSupabaseAdmin()
    let resolvedClienteId = ""
    try {
      resolvedClienteId = await ensureCliente(supabase, businessId, body)
    } catch (clienteErr) {
      console.error("[public-form-link/submit] cliente resolve error", {
        token_id: verified.link.id,
        form_type: formType,
        error: clienteErr instanceof Error ? clienteErr.message : String(clienteErr),
      })
      return json(
        {
          ok: false,
          error: "No se pudo enviar el formulario. Por favor intente nuevamente o comuníquese con recepción.",
        },
        500,
      )
    }

    // 3) Construir row del form, inyectando el cliente_id resuelto.
    // Forzamos business_id desde el link — NO confiamos en lo que mande
    // el cliente. Estado se fuerza a "Pendiente de revisión".
    let recordId: string
    let row: Record<string, unknown>
    let targetTable: "csl_ficha_dermatologica" | "csl_consent_masajes" | "csl_consent_tatuajes_cejas"
    let onConflictKey: "ficha_id" | "consent_id"

    const bodyConCliente = resolvedClienteId
      ? { ...body, clienteId: resolvedClienteId, cliente_id: resolvedClienteId }
      : body

    if (formType === "ficha_dermatologica") {
      recordId = deriveRecordId(formType, bodyConCliente)
      row = fichaDermoToDb({ ...bodyConCliente, id: recordId, estado: "Pendiente de revisión" }) as Record<string, unknown>
      row.business_id = businessId
      targetTable = "csl_ficha_dermatologica"
      onConflictKey = "ficha_id"
    } else if (formType === "consentimiento_masajes" || formType === "consentimiento_tatuajes_cejas") {
      recordId = deriveRecordId(formType, bodyConCliente)
      const kind = formType === "consentimiento_masajes" ? "masajes" : "tatuajes"
      row = consentToDb({ ...bodyConCliente, id: recordId, estado: "Pendiente de revisión" }, kind) as Record<string, unknown>
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

    // 4) INSERT del form — con schema fallback. Si la columna no
    // existe en la DB (PGRST204 / schema cache stale), la stripea y reintenta.
    // Si el insert termina fallando, el token NO se consume y el cliente
    // puede reintentar con el mismo link.
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

    // 5) CLAIM atómico del token DESPUÉS del insert exitoso. Si gana → marca
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

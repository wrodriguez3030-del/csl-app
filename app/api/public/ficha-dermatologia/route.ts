import { randomBytes } from "node:crypto"
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { fichaDermoToDb, sendFichaDermoEmail } from "@/lib/dermo-server"
import { clientIp, rateLimit, type RateLimitResult } from "@/lib/rate-limit-server"
import { REAL_BUSINESS_ID_BY_SLUG } from "@/lib/business"

// Este formulario público es de "Cibao Spa Laser" (CSL). Fijamos el tenant de
// forma explícita para no depender del default de columna y evitar que fichas
// anónimas queden mal etiquetadas entre negocios.
const CSL_BUSINESS_ID = REAL_BUSINESS_ID_BY_SLUG.csl

type Payload = Record<string, unknown>

// Rate-limit del POST público.  Margen amplio para uso real (recepción captura
// múltiples fichas en una mañana), pero corta el flooding obvio.
const POST_LIMIT = { max: 12, windowMs: 10 * 60 * 1000 } // 12 envíos / 10 min / IP

export const dynamic = "force-dynamic"
export const revalidate = 0

function json(data: Record<string, unknown>, status = 200, extraHeaders: Record<string, string> = {}) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      ...extraHeaders,
    },
  })
}

function rateLimitHeaders(result: RateLimitResult, max: number): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(max),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
    ...(result.retryAfterSeconds > 0 ? { "Retry-After": String(result.retryAfterSeconds) } : {}),
  }
}

function text(value: unknown) {
  return String(value ?? "").trim()
}

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "")
}

function splitName(value: unknown) {
  const parts = text(value).split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return { nombre: parts[0] || "", apellido: "" }
  return { nombre: parts.slice(0, Math.ceil(parts.length / 2)).join(" "), apellido: parts.slice(Math.ceil(parts.length / 2)).join(" ") }
}

function clienteFromFicha(row: Record<string, unknown>) {
  const payload = (row.payload_json && typeof row.payload_json === "object" ? row.payload_json : {}) as Record<string, unknown>
  const document = onlyDigits(row.documento || row.cedula || payload.documento || payload.cedula)
  const phone = onlyDigits(row.telefono || payload.telefono)
  const clienteId = text(payload.clienteId) || (document ? `cli_doc_${document}` : phone ? `cli_tel_${phone}` : `cli_${Date.now()}`)
  const name = splitName(row.nombre || payload.nombre)
  return {
    cliente_id: clienteId,
    numero_cliente: document || phone || clienteId,
    documento_identidad: text(row.documento || row.cedula || payload.documento || payload.cedula),
    email: text(row.email || payload.email),
    nombre: name.nombre,
    apellido: name.apellido,
    telefono: text(row.telefono || payload.telefono),
    telefono2: "",
    direccion: text(row.direccion || payload.direccion),
    localidad: "",
    ciudad: text(row.ciudad || payload.ciudad),
    region: "",
    fecha_nacimiento: text(row.fecha_nacimiento || payload.fechaNacimiento) || null,
    edad: Number(payload.edad || 0) || 0,
    genero: "",
    sucursal: text(row.sucursal || payload.sucursal),
    puede_agendar: true,
    cliente_desde: row.fecha || new Date().toISOString().slice(0, 10),
    estado: "Activo",
    notas: "",
    payload_json: { ...payload, ClienteID: clienteId, clienteId },
  }
}

function getSupabaseAdmin() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
  if (!url || !serviceKey) throw new Error("Faltan variables de Supabase en el servidor")
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function upsertFichaWithSchemaFallback(supabase: ReturnType<typeof getSupabaseAdmin>, row: Record<string, unknown>) {
  const payload = { ...row }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { error } = await supabase
      .from("csl_ficha_dermatologica")
      .upsert(payload, { onConflict: "ficha_id" })
    if (!error) return
    const missingColumn = /'([^']+)' column/.exec(error.message || "")?.[1]
    if (!missingColumn || !(missingColumn in payload)) throw error
    delete payload[missingColumn]
  }
  throw new Error("No se pudo guardar ficha: demasiadas columnas pendientes de migración")
}

export async function GET() {
  try {
    // SEGURIDAD: este endpoint es PÚBLICO (sin sesión). NUNCA debe devolver el
    // padrón de clientes — hacerlo era una fuga masiva de PII cross-tenant
    // (cédula/email/teléfono/dirección) explotable con un solo GET anónimo.
    // Un formulario público de captura no autocompleta clientes existentes.
    // Solo se expone la lista de operadoras (nombres) para poblar el selector.
    const supabase = getSupabaseAdmin()
    // El formulario público es de CSL: sin este filtro el GET anónimo
    // devolvía también los nombres de las operadoras de Depicenter.
    const { data, error } = await supabase
      .from("csl_operadoras")
      .select("nombre,sucursal,estado")
      .eq("business_id", CSL_BUSINESS_ID)
      .eq("estado", "Activa")
      .order("nombre", { ascending: true })
    if (error) throw error

    return json({
      ok: true,
      operadoras: (data || [])
        .map((row) => String(row.nombre || "").trim())
        .filter(Boolean),
      clientes: [],
    })
  } catch {
    // No se devuelve el detalle del error de BD a un cliente anónimo (evita
    // divulgación de esquema). El detalle queda en los logs del servidor.
    return json({ ok: false, error: "Error cargando datos" }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const ip = clientIp(request)
    const limit = rateLimit({ key: `public:ficha-dermatologia:${ip}`, ...POST_LIMIT })
    const limitHeaders = rateLimitHeaders(limit, POST_LIMIT.max)
    if (!limit.ok) {
      return json(
        { ok: false, error: "Demasiados envíos. Intenta de nuevo en unos minutos." },
        429,
        limitHeaders,
      )
    }

    const body = (await request.json().catch(() => ({}))) as Payload
    if (text(body.empresaOculta)) return json({ ok: true }, 200, limitHeaders)

    const row = fichaDermoToDb({ ...body, estado: "Completada" }) as Record<string, unknown>
    const payloadJson = (row.payload_json || {}) as Record<string, unknown>
    if (!row.sucursal || !row.nombre || !row.telefono || !row.motivo_consulta || !row.firma_digital || !payloadJson.declaracionAceptada) {
      return json(
        { ok: false, error: "Completa sucursal, nombre, teléfono, motivo de consulta, declaración y firma" },
        400,
        limitHeaders,
      )
    }

    const cliente = clienteFromFicha(row)
    row.cliente_id = cliente.cliente_id
    row.business_id = CSL_BUSINESS_ID

    // SEGURIDAD (03/09/2026): el `ficha_id` venía del cuerpo ANÓNIMO y el
    // guardado es un upsert contra la clave primaria. Cualquiera en internet
    // podía mandar el ficha_id de otra persona y reescribirle antecedentes,
    // alergias, medicación y firma — y de paso cambiarla de negocio. El id no
    // es secreto: se devuelve a quien envía y va en el nombre del PDF que sale
    // por correo. Aquí el id lo pone el servidor, siempre. Es la misma regla
    // que tres líneas más abajo ya protege el registro maestro del cliente.
    row.ficha_id = `dermo_${Date.now()}_${randomBytes(6).toString("hex")}`

    const supabase = getSupabaseAdmin()
    const { data: existingCliente, error: existingClienteError } = await supabase
      .from("csl_cosmiatria_clientes")
      .select("cliente_id,email")
      .eq("cliente_id", cliente.cliente_id)
      .maybeSingle()
    if (existingClienteError) throw existingClienteError

    // SEGURIDAD: un envío anónimo NUNCA sobrescribe el registro maestro de un
    // cliente ya existente (evita tampering de PII: email/teléfono/dirección/
    // nombre). Solo se crea el cliente cuando no existe; si ya existe, se deja
    // intacto y solo se adjunta la ficha nueva.
    if (!existingCliente) {
      const { error: clienteError } = await supabase
        .from("csl_cosmiatria_clientes")
        .insert({ ...cliente, business_id: CSL_BUSINESS_ID })
      // Carrera: si otro request lo creó primero (violación de unique) lo
      // tratamos como "ya existe" y continuamos con la ficha.
      if (clienteError && !/duplicate key|already exists|23505/i.test(clienteError.message || "")) {
        throw clienteError
      }
    }

    const existingEmail = existingCliente && typeof existingCliente.email === "string" ? existingCliente.email : ""
    row.email = text(row.email || existingEmail)
    row.payload_json = { ...((row.payload_json as unknown as Record<string, unknown>) || {}), email: row.email, Email: row.email }

    await upsertFichaWithSchemaFallback(supabase, row)

    const email = await sendFichaDermoEmail(row).catch((emailError: unknown) => ({
      sent: false,
      warning: emailError instanceof Error ? emailError.message : "No se pudo enviar el correo",
    }))
    return json({ ok: true, fichaId: row.ficha_id, email }, 200, limitHeaders)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    const missingTable = /csl_ficha_dermatologica|csl_cosmiatria_clientes|schema cache|PGRST205/i.test(message)
    // No divulgamos el detalle del error de BD a un cliente anónimo (evita
    // reconocimiento de esquema). Salvo el mensaje operativo de "tabla faltante".
    return json({
      ok: false,
      error: missingTable
        ? "Falta crear o refrescar las tablas de Cosmiatria en Supabase. Ejecuta supabase/csl_consentimientos.sql y vuelve a intentar."
        : "No se pudo guardar la ficha. Intenta nuevamente en unos minutos.",
    }, 500)
  }
}



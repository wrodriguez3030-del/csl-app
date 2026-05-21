import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { clientIp, rateLimit, type RateLimitResult } from "@/lib/rate-limit-server"

type SolicitudPayload = Record<string, unknown>

// Rate-limit del POST público.  Más estricto que ficha-dermatologia: una
// persona normalmente envía una solicitud, no una decena.
const POST_LIMIT = { max: 5, windowMs: 10 * 60 * 1000 } // 5 envíos / 10 min / IP

function json(data: Record<string, unknown>, status = 200, extraHeaders: Record<string, string> = {}) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
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

function getSupabaseAdmin() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()

  if (!url || !serviceKey) {
    throw new Error("Faltan variables de Supabase en el servidor")
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function text(value: unknown, fallback = "") {
  return String(value ?? fallback).trim()
}

function numberValue(value: unknown) {
  const parsed = Number(String(value ?? 0).replace(/[^\d.-]/g, ""))
  return Number.isFinite(parsed) ? parsed : 0
}

function dateValue(value: unknown) {
  const raw = text(value)
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

export async function GET() {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("csl_sucursales")
      .select("nombre")
      .eq("estado", "Activa")
      .order("nombre", { ascending: true })

    if (error) throw error
    const sucursales = (data || []).map((row) => text((row as { nombre?: unknown }).nombre)).filter(Boolean)
    return json({ ok: true, sucursales })
  } catch (error) {
    return json({ ok: false, sucursales: [], error: error instanceof Error ? error.message : "Error desconocido" }, 500)
  }
}

function solicitudToDb(payload: SolicitudPayload) {
  const id = text(payload.id) || `sol_${Date.now()}`
  const fechaIngresoLaboral = dateValue(payload.fechaIngresoLaboral ?? payload.FechaIngresoLaboral) || text(payload.fechaIngresoLaboral ?? payload.FechaIngresoLaboral)
  const direccion = [payload.calle, payload.numeroDir, payload.sector, payload.ciudad]
    .map((value) => text(value))
    .filter(Boolean)
    .join(", ")

  return {
    solicitud_id: id,
    fecha_solicitud: dateValue(payload.fecha) || new Date().toISOString().slice(0, 10),
    estado: "Pendiente",
    puesto_solicitado: text(payload.puestoSolicitado),
    nombre: text(payload.nombre),
    apellido: text(payload.apellido),
    cedula: text(payload.cedula),
    email: text(payload.email),
    telefono: text(payload.celular || payload.telefonoResidencia),
    fecha_nacimiento: dateValue(payload.fechaNacimiento),
    sexo: text(payload.sexo),
    nacionalidad: text(payload.nacionalidad, "Dominicana"),
    provincia: text(payload.provincia),
    ciudad: text(payload.ciudad),
    sector: text(payload.sector),
    direccion,
    experiencia: JSON.stringify(payload.experiencia || []),
    salario: numberValue(payload.pretensionesSalariales),
    nivel_educacion: text(payload.nivelEducacion),
    especialidad: text(payload.especialidad),
    documentos_adjuntos: stringArray(payload.documentosAdjuntos),
    firma_digital: text(payload.firma),
    observaciones: text(payload.observaciones),
    payload_json: { ...payload, id, fechaIngresoLaboral, estado: "Pendiente" },
  }
}

export async function POST(request: Request) {
  try {
    const ip = clientIp(request)
    const limit = rateLimit({ key: `public:solicitud-empleo:${ip}`, ...POST_LIMIT })
    const limitHeaders = rateLimitHeaders(limit, POST_LIMIT.max)
    if (!limit.ok) {
      return json(
        { ok: false, error: "Demasiados envíos. Intenta de nuevo en unos minutos." },
        429,
        limitHeaders,
      )
    }

    const body = (await request.json().catch(() => ({}))) as SolicitudPayload
    if (text(body.empresaOculta)) return json({ ok: true }, 200, limitHeaders)

    const row = solicitudToDb(body)
    if (!row.nombre || !row.apellido || !row.cedula || !row.puesto_solicitado || !row.telefono) {
      return json(
        { ok: false, error: "Completa nombre, apellido, cedula, telefono y puesto solicitado" },
        400,
        limitHeaders,
      )
    }

    const { error } = await getSupabaseAdmin()
      .from("csl_solicitudes_empleo")
      .upsert(row, { onConflict: "solicitud_id" })

    if (error) throw error
    return json({ ok: true, solicitudId: row.solicitud_id }, 200, limitHeaders)
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Error desconocido" }, 500)
  }
}

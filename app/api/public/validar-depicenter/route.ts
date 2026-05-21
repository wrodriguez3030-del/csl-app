/**
 * Endpoint público para validar un certificado Depicenter por código.
 *
 * - GET ?codigo=DEPI-GC-...  → { ok, found, certificado }
 * - Devuelve sólo los campos seguros (sin observaciones, sin datos
 *   sensibles): codigo, otorgadoA, cortesiaDe, validoPor, fecha,
 *   estado, fechaVencimiento.
 * - Si la tabla aún no existe (PGRST205) responde con { ok:false,
 *   tableMissing:true } para que la página pública pueda fallar de
 *   forma amigable sin error 500.
 * - Rate-limited (best-effort).
 */
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { clientIp, rateLimit } from "@/lib/rate-limit-server"

export const dynamic = "force-dynamic"
export const revalidate = 0

const GET_LIMIT = { max: 60, windowMs: 10 * 60 * 1000 }

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  })
}

export async function GET(request: Request) {
  const ip = clientIp(request)
  const rl = rateLimit({ key: `validar-depicenter:${ip}`, max: GET_LIMIT.max, windowMs: GET_LIMIT.windowMs })
  if (!rl.ok) {
    return json({ ok: false, error: "Demasiadas consultas. Intenta nuevamente en un momento." }, 429)
  }

  const url = new URL(request.url)
  const codigo = String(url.searchParams.get("codigo") || "").trim().toUpperCase()
  if (!codigo) return json({ ok: false, error: "Falta el código del certificado." }, 400)

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: "Configuración del servidor incompleta." }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const { data, error } = await supabase
    .from("csl_certificados_depicenter")
    .select("codigo, fecha, fecha_vencimiento, otorgado_a, cortesia_de, valido_por, estado, sucursal, emitido_en")
    .ilike("codigo", codigo)
    .maybeSingle()

  if (error) {
    // PGRST205 = tabla no encontrada en cache de Supabase
    if (String(error.code || "") === "PGRST205" || /schema cache|Could not find the table/i.test(error.message || "")) {
      return json({ ok: false, tableMissing: true, error: "La base de certificados aún no está habilitada." }, 503)
    }
    return json({ ok: false, error: "No se pudo consultar el certificado. Intenta nuevamente." }, 500)
  }

  if (!data) {
    return json({ ok: true, found: false })
  }

  return json({
    ok: true,
    found: true,
    certificado: {
      codigo: data.codigo,
      fecha: data.fecha,
      fechaVencimiento: data.fecha_vencimiento,
      otorgadoA: data.otorgado_a,
      cortesiaDe: data.cortesia_de,
      validoPor: data.valido_por,
      estado: data.estado,
      sucursal: data.sucursal,
      emitidoEn: data.emitido_en,
    },
  })
}

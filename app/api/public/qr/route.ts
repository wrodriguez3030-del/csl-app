/**
 * GET /api/public/qr?token=...
 *
 * Resuelve un token de QR de empleado (opaco, hasheado) para mostrarlo por link
 * compartible (WhatsApp). NO expone employee_id ni datos sensibles: solo nombre
 * y sucursal. Si el token fue regenerado o el QR está inactivo, devuelve ok:false.
 */
import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/server/supabase"
import { createHash } from "node:crypto"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const runtime = "nodejs"

const sha = (v: string) => createHash("sha256").update(v, "utf8").digest("hex")
const json = (d: Record<string, unknown>, status = 200) =>
  NextResponse.json(d, { status, headers: { "Cache-Control": "no-store" } })

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") || ""
  if (!token) return json({ ok: false, error: "Falta el token" }, 400)
  const sb = getSupabaseAdmin()
  const { data: qr, error } = await sb
    .from("hr_employee_qr_tokens")
    .select("employee_id, business_id, active")
    .eq("token_hash", sha(token))
    .maybeSingle()
  if (error || !qr || !qr.active) return json({ ok: false, error: "QR inválido o regenerado" })

  let nombre = "", sucursal = ""
  const { data: emp } = await sb.from("csl_empleados").select("nombre, apellido").eq("business_id", qr.business_id).eq("empleado_id", qr.employee_id).maybeSingle()
  const e = emp as { nombre?: string; apellido?: string } | null
  if (e) nombre = `${e.nombre ?? ""} ${e.apellido ?? ""}`.trim()
  if (!nombre) {
    const { data: sol } = await sb.from("csl_solicitudes_empleo").select("nombre, apellido, payload_json").eq("business_id", qr.business_id).eq("solicitud_id", qr.employee_id).maybeSingle()
    const s = sol as { nombre?: string; apellido?: string; payload_json?: Record<string, unknown> } | null
    if (s) { nombre = `${s.nombre ?? ""} ${s.apellido ?? ""}`.trim(); sucursal = String((s.payload_json || {}).sucursal || (s.payload_json || {}).Sucursal || "") }
  }
  return json({ ok: true, employee_nombre: nombre || "Empleado", sucursal })
}

/**
 * POST /api/public-form-links — crear un link único de un solo uso para
 * enviar un formulario público a un cliente por WhatsApp.
 *
 * Requiere autenticación. El business_id se toma del profile del usuario
 * (csl_user_profiles) — el cliente NO puede crear links para otro tenant.
 */

import { NextResponse } from "next/server"
import { requireAuthenticatedUser } from "@/lib/server/supabase"
import { loadBusinessContext } from "@/lib/server/csl-crud"
import {
  createPublicFormLink,
  isFormType,
  type FormType,
} from "@/lib/server/public-form-links"

export const dynamic = "force-dynamic"
export const revalidate = 0

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status })
}

function buildPublicUrl(request: Request, token: string): string {
  // Preferimos el host del request (funciona en preview/prod sin hardcode).
  // Si X-Forwarded-* viene, fetch ya lo respetó.
  const url = new URL(request.url)
  return `${url.origin}/formulario-publico/${token}`
}

function buildWhatsappUrl(publicUrl: string, ttlHours: number): string {
  const mensaje = [
    "Hola, por favor complete y firme su formulario en este enlace:",
    publicUrl,
    "",
    `Este enlace es válido por ${ttlHours} horas y solo puede usarse una vez.`,
  ].join("\n")
  // wa.me sin número permite al user elegir contacto desde WhatsApp.
  return `https://wa.me/?text=${encodeURIComponent(mensaje)}`
}

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request)
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const formType = body.formType
    if (!isFormType(formType)) {
      return json({ ok: false, error: "formType inválido" }, 400)
    }

    const ctx = await loadBusinessContext(user.id)
    if (!ctx) {
      return json({ ok: false, error: "No se pudo cargar el contexto de negocio" }, 403)
    }

    const ttlHours = 12
    const clienteNombre = typeof body.clienteNombre === "string" ? body.clienteNombre.trim() : ""
    const clienteTelefono = typeof body.clienteTelefono === "string" ? body.clienteTelefono.trim() : ""

    const { token, link } = await createPublicFormLink({
      businessId: ctx.businessId,
      formType: formType as FormType,
      createdBy: user.id,
      clienteNombre: clienteNombre || undefined,
      clienteTelefono: clienteTelefono || undefined,
      ttlHours,
    })

    const publicUrl = buildPublicUrl(request, token)
    const whatsappUrl = buildWhatsappUrl(publicUrl, ttlHours)

    return json({
      ok: true,
      url: publicUrl,
      whatsappUrl,
      expiraEn: link.expira_en,
      id: link.id,
      formType,
    })
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : "Error desconocido" },
      500,
    )
  }
}

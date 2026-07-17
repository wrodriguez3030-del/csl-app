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
import { applyActiveBusiness } from "@/lib/server/business-context"
import {
  createPublicFormLink,
  isFormType,
  type FormType,
  type PrefillPayload,
} from "@/lib/server/public-form-links"
import { getBusinessBranding } from "@/lib/business"

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

// Texto del consentimiento por tipo — espejo del title del page para que
// el mensaje WhatsApp y la vista previa hablen el mismo idioma.
const CONSENT_NAME_BY_TYPE: Record<FormType, string> = {
  ficha_dermatologica: "Consentimiento de Ficha Dermatológica",
  consentimiento_masajes: "Consentimiento de Masajes",
  consentimiento_peeling: "Consentimiento Informado para Peeling",
  consentimiento_tatuajes_cejas: "Consentimiento de Eliminación de Tatuajes y Cejas",
  consentimiento_depilacion_laser: "Consentimiento de Depilación Láser",
  solicitud_empleo: "Solicitud de empleo",
}

function buildWhatsappUrl(
  publicUrl: string,
  ttlHours: number,
  clienteNombre: string | undefined,
  formType: FormType | undefined,
  businessName: string,
): string {
  const firstName = clienteNombre ? clienteNombre.trim().split(/\s+/)[0].toUpperCase() : ""

  let mensaje: string
  if (formType === "solicitud_empleo") {
    // Para solicitud de empleo: mensaje sin nombre del cliente (candidato),
    // con la marca del tenant correcta y el link.
    const greeting = firstName ? `Hola ${firstName} 👋` : "Hola 👋"
    mensaje = [
      greeting,
      "",
      `Te compartimos el enlace para completar tu solicitud de empleo en ${businessName}:`,
      "",
      publicUrl,
      "",
      "Este enlace es de un solo uso y vence en 12 horas.",
      "",
      "Gracias.",
    ].join("\n")
  } else {
    const consentName = formType ? CONSENT_NAME_BY_TYPE[formType] : "formulario"
    const greeting = firstName ? `Hola ${firstName}, por favor` : "Hola, por favor"
    mensaje = [
      `${greeting} complete y firme su ${consentName} de ${businessName} en este enlace:`,
      publicUrl,
      "",
      `Este enlace es válido por ${ttlHours} horas y solo puede usarse una vez.`,
    ].join("\n")
  }
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

    const baseCtx = await loadBusinessContext(user.id)
    // Respeta el business activo que manda la UI: un superadmin genera el link
    // del tenant ACTIVO (no el de su propio perfil). Usuario normal: sin efecto.
    const activeBusinessId = typeof body.activeBusinessId === "string" ? body.activeBusinessId : undefined
    const ctx = applyActiveBusiness(baseCtx, activeBusinessId)
    if (!ctx) {
      return json({ ok: false, error: "No se pudo cargar el contexto de negocio" }, 403)
    }

    const ttlHours = 12
    const clienteNombre = typeof body.clienteNombre === "string" ? body.clienteNombre.trim() : ""
    const clienteTelefono = typeof body.clienteTelefono === "string" ? body.clienteTelefono.trim() : ""

    // Extraer prefill_payload del body: el frontend manda nombre/telefono/
    // documento/correo/direccion/sucursal/motivoConsulta/servicio según el
    // tipo de form. Acepta cualquier string key — el código del form público
    // ignora los que no aplican a su tipo.
    const prefillPayload: PrefillPayload | undefined =
      body.prefillPayload && typeof body.prefillPayload === "object"
        ? (body.prefillPayload as PrefillPayload)
        : undefined

    const { token, link } = await createPublicFormLink({
      businessId: ctx.businessId,
      formType: formType as FormType,
      createdBy: user.id,
      clienteNombre: clienteNombre || undefined,
      clienteTelefono: clienteTelefono || undefined,
      prefillPayload,
      ttlHours,
    })

    const publicUrl = buildPublicUrl(request, token)
    // El nombre del tenant sale de la marca canónica (tabla businesses vía slug),
    // no de un mapa hardcodeado — así queda dividido por tenant sin fallback a CSL.
    const businessName = getBusinessBranding(ctx.businessSlug).name
    const whatsappUrl = buildWhatsappUrl(
      publicUrl,
      ttlHours,
      clienteNombre || prefillPayload?.nombre,
      formType as FormType,
      businessName,
    )

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

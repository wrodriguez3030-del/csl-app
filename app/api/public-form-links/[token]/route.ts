/**
 * GET /api/public-form-links/[token] — verificar estado del link.
 *
 * Endpoint PÚBLICO (sin auth). El cliente lo abre desde WhatsApp y la
 * página /formulario-publico/[token] lo llama para saber si el link es
 * válido, usado, expirado, o inválido.
 *
 * NO devuelve datos sensibles del negocio — solo el form_type y un nombre
 * pre-cargado opcional (puesto al generar el link).
 */

import { NextResponse } from "next/server"
import { verifyPublicFormLink } from "@/lib/server/public-form-links"
import { getSupabaseAdmin } from "@/lib/server/supabase"

export const dynamic = "force-dynamic"
export const revalidate = 0

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
    },
  })
}

/** Resuelve business_id → slug. Default "csl" si no se puede determinar. */
async function lookupBusinessSlug(businessId: string | null | undefined): Promise<string> {
  if (!businessId) return "csl"
  try {
    const { data } = await getSupabaseAdmin()
      .from("businesses").select("slug").eq("id", businessId).maybeSingle()
    return (data as { slug?: string } | null)?.slug || "csl"
  } catch {
    return "csl"
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await context.params
    const result = await verifyPublicFormLink(String(token || ""))
    // Incluimos el slug del business para que el frontend muestre marca
    // correcta (Cibao vs Depicenter vs futuro tenant). NO devolvemos el
    // business_id raw porque el slug es lo único que el cliente necesita.
    const businessSlug = await lookupBusinessSlug(result.link?.business_id)
    return json({
      ok: true,
      status: result.status,
      formType: result.formType ?? null,
      clienteNombre: result.clienteNombre ?? null,
      clienteTelefono: result.clienteTelefono ?? null,
      prefillPayload: result.prefillPayload ?? null,
      expiraEn: result.expiraEn ?? null,
      businessSlug,
    })
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : "Error" },
      500,
    )
  }
}

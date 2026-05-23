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

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await context.params
    const result = await verifyPublicFormLink(String(token || ""))
    return json({
      ok: true,
      status: result.status,
      formType: result.formType ?? null,
      clienteNombre: result.clienteNombre ?? null,
      clienteTelefono: result.clienteTelefono ?? null,
      prefillPayload: result.prefillPayload ?? null,
      expiraEn: result.expiraEn ?? null,
    })
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : "Error" },
      500,
    )
  }
}

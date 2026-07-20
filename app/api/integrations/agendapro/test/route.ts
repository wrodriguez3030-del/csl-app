/**
 * POST /api/integrations/agendapro/test
 *
 * Prueba las credenciales de AgendaPro del NEGOCIO ACTIVO sin importar datos.
 * No expone credenciales. Interpreta la respuesta de AgendaPro:
 *   - 2xx                → conexión validada
 *   - 401/403            → credenciales inválidas
 *   - 400/422            → credenciales OK pero el listado requiere búsqueda
 */

import { NextResponse } from "next/server"
import { requireAuthenticatedUser } from "@/lib/server/supabase"
import { resolveEffectiveBusinessContext } from "@/lib/server/integration-auth"
import { resolveAgendaProConfigForBusiness } from "@/lib/server/agendapro-credentials"
import { testAgendaProConnection, validateAgendaProConfig } from "@/lib/server/agendapro"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const runtime = "nodejs"

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request) {
  let user
  try {
    user = await requireAuthenticatedUser(request)
  } catch {
    return json({ ok: false, error: "No autenticado" }, 401)
  }

  let body: { activeBusinessId?: string } = {}
  try {
    const raw = await request.text()
    body = raw ? JSON.parse(raw) : {}
  } catch {
    body = {}
  }

  const ctx = await resolveEffectiveBusinessContext(user.id, body.activeBusinessId)
  if (!ctx) return json({ ok: false, error: "Contexto de negocio no encontrado." }, 403)

  const cfg = await resolveAgendaProConfigForBusiness(ctx.businessId, ctx.businessSlug)
  const cfgError = validateAgendaProConfig(cfg)
  if (cfgError) {
    return json({
      ok: false,
      error: cfg.source === "none" ? "AgendaPro no está configurado para este negocio." : cfgError,
    }, 400)
  }

  const result = await testAgendaProConnection(cfg)
  if (result.ok) {
    return json({ ok: true, message: "Conexión con AgendaPro validada." })
  }
  if (result.status === 401 || result.status === 403) {
    return json({ ok: false, error: "Credenciales inválidas: AgendaPro rechazó el usuario/clave." }, 200)
  }
  if (result.status === 400 || result.status === 422) {
    return json({ ok: true, message: "Conexión validada (el listado de AgendaPro requiere búsqueda)." })
  }
  return json({ ok: false, error: result.error || `AgendaPro respondió ${result.status}.` }, 200)
}

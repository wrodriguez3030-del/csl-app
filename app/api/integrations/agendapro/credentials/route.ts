/**
 * POST /api/integrations/agendapro/credentials
 *
 * Guarda (cifradas) las credenciales de la API Pública de AgendaPro del NEGOCIO
 * ACTIVO. Solo admin/superadmin o quien tenga `integrations.agendapro.configure`.
 * Nunca devuelve la clave: responde con el estado enmascarado (****1234).
 */

import { NextResponse } from "next/server"
import { requireAuthenticatedUser } from "@/lib/server/supabase"
import { resolveEffectiveBusinessContext } from "@/lib/server/integration-auth"
import { saveAgendaProCredentials, getAgendaProCredentialStatus } from "@/lib/server/agendapro-credentials"

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

  let body: { activeBusinessId?: string; api_user?: string; api_key?: string; base_url?: string; clients_path?: string } = {}
  try {
    const raw = await request.text()
    body = raw ? JSON.parse(raw) : {}
  } catch {
    body = {}
  }

  const ctx = await resolveEffectiveBusinessContext(user.id, body.activeBusinessId)
  if (!ctx) return json({ ok: false, error: "Contexto de negocio no encontrado." }, 403)

  const allowed = ctx.isAdmin || ctx.isSuperadmin || (ctx.permissions || []).includes("integrations.agendapro.configure")
  if (!allowed) return json({ ok: false, error: "No tienes permiso para configurar AgendaPro." }, 403)

  try {
    await saveAgendaProCredentials({
      businessId: ctx.businessId,
      apiUser: body.api_user || "",
      apiKey: body.api_key || "",
      baseUrl: body.base_url ?? null,
      clientsPath: body.clients_path ?? null,
      userId: user.id,
    })
    const status = await getAgendaProCredentialStatus(ctx.businessId, ctx.businessSlug)
    return json({ ok: true, message: "Credenciales de AgendaPro guardadas.", status })
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Error al guardar credenciales." }, 400)
  }
}

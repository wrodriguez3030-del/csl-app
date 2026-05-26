/**
 * GET /api/integrations/agendapro/health
 *
 * Diagnóstico admin-only. NO devuelve credenciales — solo flags y meta.
 */

import { NextResponse } from "next/server"
import { requireAuthenticatedUser } from "@/lib/server/supabase"
import { getProfile } from "@/lib/server/csl-crud"
import { getAgendaProConfig, safeConfigSummary, validateAgendaProConfig } from "@/lib/server/agendapro"

export const dynamic = "force-dynamic"
export const revalidate = 0

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  let user
  try {
    user = await requireAuthenticatedUser(request)
  } catch {
    return json({ ok: false, error: "No autenticado" }, 401)
  }
  const profile = await getProfile(user.id)
  if (!profile?.is_admin && !profile?.is_superadmin) {
    return json({ ok: false, error: "Solo admin o superadmin." }, 403)
  }
  const cfg = getAgendaProConfig()
  const configError = validateAgendaProConfig(cfg)
  return json({
    ok: true,
    ready: configError === null,
    pending: configError,
    config: safeConfigSummary(cfg),
    perPage: Number(process.env.AGENDAPRO_API_PER_PAGE || 100),
  })
}

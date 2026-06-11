/**
 * POST /api/integrations/mantenimiento/import-lecturas
 *
 * BLOQUEADO POR POLÍTICA (estricto total — "bloquea todo lo que alimente
 * automático"): este endpoint alimentaba mantenimiento de forma automática
 * desde el Excel "Dashboard Mantenimiento" (antes actualizaba csl_equipos y
 * registraba historial en csl_equipo_snapshots / csl_equipo_fallas).
 *
 * Los datos de mantenimiento SOLO se modifican manualmente por un técnico/admin
 * autorizado dentro del módulo. Por eso este endpoint ya NO escribe nada:
 * registra el intento como `auto_change_blocked` y responde con el mensaje
 * estándar. La carga manual de equipos se hace desde el módulo Equipos.
 */

import { NextResponse } from "next/server"
import { requireAuthenticatedUser } from "@/lib/server/supabase"
import { loadBusinessContext } from "@/lib/server/csl-crud"
import { runWithBusinessContext } from "@/lib/server/business-context"
import { recordMaintenanceAudit, MAINTENANCE_REJECTION_MESSAGE } from "@/lib/server/maintenance-guard"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const maxDuration = 60
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

  const ctx = await loadBusinessContext(user.id)
  if (!ctx) return json({ ok: false, error: "Contexto de negocio no encontrado." }, 403)

  // Capturar nombre de archivo solo para enriquecer la auditoría (best-effort).
  let archivoNombre: string | null = null
  try {
    const body = await request.json()
    archivoNombre = typeof body?.archivoNombre === "string" ? body.archivoNombre : null
  } catch { /* body vacío o no-JSON */ }

  return runWithBusinessContext(ctx, async () => {
    await recordMaintenanceAudit({
      entity: "equipos",
      table: "csl_equipo_snapshots",
      op: "upsert",
      changeSource: "auto_change_blocked",
      userId: user.id,
      userEmail: user.email,
      details: { endpoint: "import-lecturas", archivoNombre },
    })
    return json(
      { ok: false, blocked: true, policy: "maintenance_manual_only", error: MAINTENANCE_REJECTION_MESSAGE },
      403,
    )
  })
}

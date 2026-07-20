/**
 * Resolución del NEGOCIO ACTIVO para endpoints de integración standalone
 * (fuera del dispatcher /api/csl). Sin esto, un superadmin con Depicenter
 * seleccionado en el switcher terminaría sincronizando hacia SU propio negocio
 * (CSL) — mezclando tenants.
 *
 * Regla: contexto base del perfil + `applyActiveBusiness(activeBusinessId)`.
 *  - Usuario normal: se ignora activeBusinessId (queda en su propio negocio).
 *  - Superadmin: se scopea al negocio activo válido que manda la UI.
 */

import { loadBusinessContext } from "@/lib/server/csl-crud"
import { applyActiveBusiness } from "@/lib/server/business-context"
import type { BusinessContext } from "@/lib/server/csl-types"

/** Lee `activeBusinessId` de un request (query en GET, body JSON en POST). */
export async function readActiveBusinessId(request: Request): Promise<string | null> {
  if (request.method === "GET") {
    return new URL(request.url).searchParams.get("activeBusinessId")
  }
  try {
    const raw = await request.clone().text()
    if (!raw) return null
    const body = JSON.parse(raw) as { activeBusinessId?: string }
    return body.activeBusinessId ? String(body.activeBusinessId) : null
  } catch {
    return null
  }
}

/** Contexto de negocio EFECTIVO (perfil + negocio activo del switcher). */
export async function resolveEffectiveBusinessContext(
  userId: string,
  activeBusinessId: string | null | undefined,
): Promise<BusinessContext | null> {
  const base = await loadBusinessContext(userId)
  return applyActiveBusiness(base, activeBusinessId)
}

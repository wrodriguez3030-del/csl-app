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

/**
 * Lee `activeBusinessId` de un request: primero de la query, luego del cuerpo JSON.
 *
 * La query se mira SIEMPRE, no solo en GET, porque las subidas de archivos van en
 * `multipart/form-data` y ahí no hay cuerpo JSON que parsear. Sin esto, las tres
 * rutas de subida ignoraban el negocio del selector y guardaban el archivo con el
 * business_id del perfil del superadministrador: en Compras el adjunto quedaba
 * además inaccesible, porque la descarga valida que la ruta empiece por el negocio.
 */
export async function readActiveBusinessId(request: Request): Promise<string | null> {
  const enLaUrl = new URL(request.url).searchParams.get("activeBusinessId")
  if (enLaUrl) return enLaUrl
  if (request.method === "GET") return null
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

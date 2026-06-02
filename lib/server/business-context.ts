/**
 * Request-scoped BusinessContext via AsyncLocalStorage.
 *
 * Patrón:
 *   1. /api/csl/_handlers.ts envuelve cada request en `runWithBusinessContext(ctx, async () => ...)`
 *   2. Los CRUD ops (csl-crud.ts) leen el contexto via `getBusinessContext()` y aplican
 *      `business_id = ctx.businessId` automáticamente.
 *   3. Si el handler corre sin contexto (debería ser imposible en /api/csl normal),
 *      `requireBusinessContext()` lanza un error claro para detectar regresiones.
 *
 * Por qué AsyncLocalStorage en vez de pasar ctx como argumento a cada función:
 *   - El backend tiene ~30 case handlers en _handlers.ts y cada uno llama múltiples
 *     CRUD ops. Pasarlo explícito a cada uno requiere modificar todas las firmas.
 *   - Con AsyncLocalStorage se inyecta en un solo punto (top de handleAction) y se
 *     respeta automáticamente en toda la cadena async. Imposible olvidarse en un handler.
 *   - Cero impacto perf — AsyncLocalStorage es nativo Node y O(1).
 *
 * Server-only. NUNCA importar desde código cliente.
 */

import { AsyncLocalStorage } from "node:async_hooks"
import type { BusinessContext } from "./csl-types"

const storage = new AsyncLocalStorage<BusinessContext | null>()

/**
 * Ejecuta `fn` con el BusinessContext disponible en `getBusinessContext()`
 * desde cualquier punto dentro de la cadena de promises. Cuando `fn` termina,
 * el contexto se desmonta automáticamente.
 */
export function runWithBusinessContext<T>(
  ctx: BusinessContext | null,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(ctx, fn)
}

/**
 * Devuelve el BusinessContext del request actual, o `null` si no hay scope.
 * Los CRUD ops usan esto para decidir si aplican filtro `business_id`.
 *
 * Devolver `null` cuando no hay contexto permite que módulos de helper que
 * corren fuera de un request (tests, scripts, migraciones) sigan funcionando
 * sin tenant filter.
 */
export function getBusinessContext(): BusinessContext | null {
  return storage.getStore() ?? null
}

/**
 * Variante estricta: lanza si no hay contexto. Útil para CRUD ops donde
 * faltar contexto es definitivamente un bug (un handler que se saltó el
 * runWithBusinessContext del dispatcher).
 */
export function requireBusinessContext(): BusinessContext {
  const ctx = getBusinessContext()
  if (!ctx) {
    throw new Error(
      "BusinessContext not set in current async scope. The request handler must wrap its work in runWithBusinessContext().",
    )
  }
  return ctx
}

/**
 * UUIDs reales de los businesses en producción (Supabase pfqnyzbtwhfkemkixril).
 * Espejo del mapa cliente en `components/superadmin-business-filter.tsx`.
 * Sirve para validar el `activeBusinessId` que manda la UI antes de scopear.
 */
const KNOWN_BUSINESS_IDS = new Set<string>([
  "66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6", // csl
  "03b96698-c5df-4b4b-84df-1160a7ad56b9", // depicenter
])

/**
 * Aplica el "business activo" que la UI envía en cada request.
 *
 * Regla de aislamiento end-to-end:
 *  - Usuario normal: se ignora `activeBusinessId`; sigue scopeado a su propio
 *    business por `bypassTenantFilter=false` (no puede saltar de tenant).
 *  - Superadmin con `activeBusinessId` válido: se SCOPEA a ese business
 *    (bypassTenantFilter=false) — deja de ver datos de otros tenants.
 *  - Superadmin SIN activeBusinessId (modo "Todos" explícito): mantiene
 *    `bypassTenantFilter=true` y ve todos los tenants.
 *
 * Nunca eleva privilegios: un no-superadmin jamás puede activar el bypass ni
 * cambiar su businessId.
 */
export function applyActiveBusiness(
  base: BusinessContext | null,
  activeBusinessId: string | null | undefined,
): BusinessContext | null {
  if (!base) return base
  if (!base.isSuperadmin) return base
  const id = (activeBusinessId ?? "").trim()
  if (!id || !KNOWN_BUSINESS_IDS.has(id)) return base // "Todos" o id inválido → sin scope
  return { ...base, businessId: id, bypassTenantFilter: false }
}

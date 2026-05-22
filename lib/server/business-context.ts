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

/**
 * Guardia del módulo MANTENIMIENTO.
 *
 * Regla de negocio (decisión del dueño, alcance "estricto total"):
 *   Las tablas de mantenimiento SOLO aceptan cambios manuales hechos por un
 *   técnico o admin autorizado DENTRO del módulo de Mantenimiento. Ningún
 *   proceso automático —seed, sync API, import de Excel, PulseControl,
 *   AgendaPro, recálculos, scripts de normalización/reparación, cambios de
 *   tenant/sucursal, carga de maestros— puede crear, editar, reemplazar o
 *   borrar estas filas.
 *
 * Cómo se aplica:
 *   1. El dispatcher (_handlers.ts) marca CADA acción manual de mantenimiento
 *      con `runWithMaintenanceWriteScope({ source: manual_tecnico|manual_admin })`.
 *   2. Los CRUD ops (csl-crud.ts) llaman `assertMaintenanceWriteAllowed(table)`
 *      antes de escribir. Si la tabla es protegida y NO hay un scope manual
 *      aprobado en el contexto async, la escritura se BLOQUEA y se audita como
 *      `auto_change_blocked`.
 *
 * Server-only. NUNCA importar desde código cliente.
 */

import { AsyncLocalStorage } from "node:async_hooks"
import { getSupabaseAdmin } from "./supabase"
import { getBusinessContext } from "./business-context"

export type MaintenanceChangeSource = "manual_tecnico" | "manual_admin"

export interface MaintenanceWriteScope {
  source: MaintenanceChangeSource
  userId: string
  userEmail?: string
}

/**
 * Tablas de mantenimiento protegidas. Toda escritura a estas tablas exige un
 * scope manual aprobado en el contexto async — incluyendo el historial
 * (snapshots/fallas): "bloquea todo lo que alimente automático".
 *
 * NOTA: `csl_sucursales` NO se incluye (no es un menú de Mantenimiento y lo
 * usan otros módulos).
 */
export const PROTECTED_MAINTENANCE_TABLES = new Set<string>([
  "csl_equipos",
  "csl_reportes",
  "csl_piezas",
  "csl_tecnicos",
  "csl_inventario",
  "csl_piezas_poliza_lista",
  // Historial de equipos: append-only, pero alimentado solo por procesos
  // automáticos (import del Dashboard). Bloqueado por política.
  "csl_equipo_snapshots",
  "csl_equipo_fallas",
])

const APPROVED_SOURCES = new Set<MaintenanceChangeSource>([
  "manual_tecnico",
  "manual_admin",
])

export const MAINTENANCE_REJECTION_MESSAGE =
  "Los datos de mantenimiento solo pueden ser modificados manualmente por un técnico autorizado."

export function isProtectedMaintenanceTable(table: string): boolean {
  return PROTECTED_MAINTENANCE_TABLES.has(table)
}

const storage = new AsyncLocalStorage<MaintenanceWriteScope | null>()

/**
 * Ejecuta `fn` declarando que el request actual es un cambio MANUAL de
 * mantenimiento autorizado. Solo lo usa _handlers.ts para las acciones
 * manuales del módulo (saveEquipo, saveReporte, deletePieza, etc.).
 */
export function runWithMaintenanceWriteScope<T>(
  scope: MaintenanceWriteScope,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(scope, fn)
}

export function getMaintenanceWriteScope(): MaintenanceWriteScope | null {
  return storage.getStore() ?? null
}

interface AuditEntry {
  entity?: string
  table: string
  recordKey?: string | null
  op: "upsert" | "update" | "delete"
  changeSource: string
  userId?: string | null
  userEmail?: string | null
  details?: Record<string, unknown>
}

/**
 * Inserta una fila en csl_maintenance_audit. Best-effort: si la tabla aún no
 * existe (migración 202606110001 pendiente) u ocurre cualquier error, NO
 * interrumpe la operación principal — solo deja un warning en logs.
 */
export async function recordMaintenanceAudit(entry: AuditEntry): Promise<void> {
  try {
    const ctx = getBusinessContext()
    await getSupabaseAdmin()
      .from("csl_maintenance_audit")
      .insert({
        business_id: ctx?.businessId ?? null,
        entity: entry.entity ?? null,
        table_name: entry.table,
        record_key: entry.recordKey ?? null,
        op: entry.op,
        change_source: entry.changeSource,
        user_id: entry.userId ?? null,
        user_email: entry.userEmail ?? null,
        details: entry.details ?? null,
      })
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    if (code !== "42P01") {
      console.warn("csl_maintenance_audit insert falló:", (error as Error)?.message)
    }
  }
}

/**
 * Verifica si está permitido escribir en `table`. Si la tabla es protegida y
 * NO hay un scope manual aprobado en el contexto async, registra el intento
 * como `auto_change_blocked` y LANZA con el mensaje estándar.
 *
 * Devuelve el scope manual aprobado (para que el CRUD estampe change_source /
 * updated_by) o `null` si la tabla no es protegida.
 */
export async function assertMaintenanceWriteAllowed(
  table: string,
  op: "upsert" | "update" | "delete",
  opts?: { entity?: string; recordKey?: string | null },
): Promise<MaintenanceWriteScope | null> {
  if (!isProtectedMaintenanceTable(table)) return null

  const scope = getMaintenanceWriteScope()
  if (scope && APPROVED_SOURCES.has(scope.source)) {
    return scope
  }

  // Intento automático (o sin scope manual) → bloquear + auditar.
  await recordMaintenanceAudit({
    entity: opts?.entity,
    table,
    recordKey: opts?.recordKey ?? null,
    op,
    changeSource: "auto_change_blocked",
    details: { reason: scope ? `source no aprobado: ${scope.source}` : "sin scope manual de mantenimiento" },
  })
  throw new Error(MAINTENANCE_REJECTION_MESSAGE)
}

/**
 * Ayudantes de CONTEXTO compartidos por los módulos de handlers.
 *
 * Vivían dentro de `_handlers.ts`, que creció hasta 5.805 líneas y 361 `case`
 * —contra la regla del proyecto de 800 máximo— y donde vivieron todos los
 * fallos que destapó la auditoría del 03/09/2026. Sacarlos aquí es lo que
 * permite mover un módulo entero a su propio archivo sin duplicar nada.
 *
 * Solo contexto y tenant: nada de lógica de negocio.
 */
import { getBusinessContext, hasPermission } from "@/lib/server/business-context"
import { modoEstricto } from "@/lib/server/permission-gate"
import { businessIdForSlug } from "@/lib/business"
import { tenantSlugForSucursal } from "@/lib/normalize-pulse"

/** La tabla no existe todavía (migración pendiente). */
export function isMissingTable(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "42P01"
}

/** business_id efectivo (respeta el business activo del superadministrador). */
export function effectiveBusinessId(): string | null {
  return getBusinessContext()?.businessId ?? null
}

/** ¿Se debe filtrar por business_id? (false solo para superadmin en modo «Todos»). */
export function shouldScopeTenant(): boolean {
  const ctx = getBusinessContext()
  return Boolean(ctx && !ctx.bypassTenantFilter)
}

/**
 * Para los RECORTES por permiso dentro de una acción pública.
 *
 * Respeta el interruptor igual que la puerta: en modo sombra el sistema
 * comprueba pero NO cambia nada, y un recorte que se aplicara igual rompería en
 * silencio y sin dejar rastro en `csl_permission_denials` — justo lo que el modo
 * sombra existe para evitar. Pasó: seis cuentas se quedaron sin sucursales al
 * emitir un certificado de regalo y no hubo ni un registro.
 */
export function puedeVer(perm: string): boolean {
  return !modoEstricto() || hasPermission(perm)
}

/**
 * business_id CORRECTO para una fila de pulsos según SU sucursal, no según el
 * business activo de la UI. El Excel semanal trae sucursales de CSL y
 * DEPICENTER mezcladas; estampar todas con el business activo era la causa de
 * la contaminación cross-tenant recurrente.
 *
 *  - sucursal del tenant activo o de tenant desconocido → business activo.
 *  - sucursal de OTRO tenant conocido:
 *      · superadmin → business_id del tenant dueño (ruteo automático).
 *      · usuario normal → null (fila rechazada; no puede escribir cross-tenant).
 */
export function businessIdForRowSucursal(sucursal: unknown): string | null {
  const ctx = getBusinessContext()
  const activeBiz = ctx?.businessId ?? null
  const ownerSlug = tenantSlugForSucursal(sucursal)
  if (!ownerSlug) return activeBiz
  const ownerBiz = businessIdForSlug(ownerSlug)
  if (!ownerBiz || ownerBiz === activeBiz) return activeBiz
  return ctx?.isSuperadmin ? ownerBiz : null
}

/** Admin del negocio o superadmin — quien ve y restaura la papelera. */
export function isMaintenanceAdmin(): boolean {
  const ctx = getBusinessContext()
  return Boolean(ctx?.isAdmin || ctx?.isSuperadmin)
}

export const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100

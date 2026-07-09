/**
 * Catálogo central de permisos granulares (csl_user_profiles.permissions text[]).
 * Sin dependencias de runtime — importable por cliente y servidor, igual que
 * `lib/menus.ts`. Los permisos son ORTOGONALES a los menús: los menús deciden
 * VISIBILIDAD; los permisos gatean ACCIONES dentro de una pantalla visible.
 *
 * Convención de check (frontend y backend): admin/superadmin BYPASSA todo
 * permiso. Ver `hasPermission`/`requirePermission` en server y `canPerm` en UI.
 */
export interface PermissionOption {
  id: string
  label: string
  section: string
}

export const PERMISSION_OPTIONS: PermissionOption[] = [
  // Compras y gastos
  { id: "compras.ver", label: "Ver compras y gastos", section: "Compras" },
  { id: "compras.crear", label: "Crear facturas/gastos", section: "Compras" },
  { id: "compras.editar", label: "Editar compras/gastos", section: "Compras" },
  { id: "compras.pagar", label: "Registrar pagos", section: "Compras" },
  { id: "compras.aprobar", label: "Aprobar gastos menores", section: "Compras" },
  { id: "compras.anular", label: "Anular facturas/pagos", section: "Compras" },
  { id: "compras.eliminar", label: "Eliminar (borrador, soft delete)", section: "Compras" },
  { id: "compras.exportar", label: "Exportar PDF/Excel", section: "Compras" },
  // Requisición de materiales (ya existía suelto — lo formalizamos en el catálogo)
  { id: "material_requisitions.delete", label: "Eliminar requisiciones", section: "Requisición de materiales" },
  // Inventario de materiales (histórico): ver detalle y exportar
  { id: "materials.inventory.view", label: "Ver detalle de inventarios", section: "Requisición de materiales" },
  { id: "materials.inventory.print", label: "Imprimir inventarios", section: "Requisición de materiales" },
  { id: "materials.inventory.export_excel", label: "Exportar inventarios a Excel", section: "Requisición de materiales" },
  { id: "materials.inventory.export_pdf", label: "Generar PDF de inventarios", section: "Requisición de materiales" },
]

export const ALL_PERMISSION_IDS: string[] = PERMISSION_OPTIONS.map((p) => p.id)
export const PERMISSION_ID_SET: ReadonlySet<string> = new Set(ALL_PERMISSION_IDS)

/** Filtra una lista arbitraria a solo permisos válidos del catálogo. */
export function normalizePermissions(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  for (const p of input) {
    if (typeof p === "string" && PERMISSION_ID_SET.has(p)) seen.add(p)
  }
  return Array.from(seen)
}

/**
 * Check de permiso para UI. `user` es el SystemUser de useSessionUser().
 * Admin/superadmin bypassa. Espejo de `hasPermission` del servidor.
 */
export function canPerm(
  user: { isAdmin?: boolean; isSuperadmin?: boolean; permissions?: string[] } | null | undefined,
  perm: string,
): boolean {
  if (!user) return false
  return Boolean(user.isAdmin || user.isSuperadmin || user.permissions?.includes(perm))
}

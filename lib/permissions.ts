/**
 * Punto de entrada del catálogo de permisos. La implementación vive en
 * `lib/permissions/` — este archivo se mantiene para no romper los imports
 * `@/lib/permissions` que ya existen por toda la app.
 *
 * Sin dependencias de runtime: importable por cliente y servidor.
 */
export type { PermissionOption } from "./permissions/catalog"
export {
  PERMISSION_OPTIONS,
  CAJA_FUERTE,
  ALL_PERMISSION_IDS,
  PERMISSION_ID_SET,
  esCajaFuerte,
  normalizePermissions,
  canPerm,
} from "./permissions/catalog"

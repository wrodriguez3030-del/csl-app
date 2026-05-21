/**
 * Tipos compartidos por los módulos server-only del endpoint /api/csl.
 *
 * Mantener estos tipos en un único módulo evita ciclos de import entre
 * `csl-helpers`, `csl-crud`, `csl-transforms`, etc.
 */

/** Parámetros que entran al dispatcher: vienen del body JSON o de la query. */
export type ActionParams = Record<string, string | number | boolean | null | undefined>

/** Fila genérica de Supabase / payload JSON deserializado. */
export type Row = Record<string, unknown>

/** Identidad mínima del usuario autenticado disponible en cada handler. */
export interface ActionUser {
  id: string
  email?: string
}

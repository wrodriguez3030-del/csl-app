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

/**
 * Contexto multi-tenant para inyectar en las queries CRUD.
 *
 * Cuando se construya en _handlers.ts a partir del JWT, los CRUD helpers
 * pueden filtrar/inyectar `business_id` automáticamente. Hoy es OPCIONAL —
 * los CRUD aceptan undefined y se comportan como antes (cero filtro,
 * Service Role devuelve todas las rows). Esto permite hacer rollout por
 * fases sin romper nada.
 *
 * Una vez que las migraciones SQL (202605220*) corran y el endpoint
 * /api/csl/_handlers.ts cargue el profile con business_id, este contexto
 * se pasará en cada llamada y los filtros se activan.
 */
export interface BusinessContext {
  /** UUID del negocio del usuario (csl_user_profiles.business_id). */
  businessId: string
  /** Slug del negocio: "csl" | "depicenter". Útil para logs/branding. */
  businessSlug: string
  /** Si true, el filtro por business_id se omite (acceso cross-tenant). */
  isSuperadmin: boolean
}

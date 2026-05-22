/**
 * Configuración de los negocios (tenants) del sistema CSL.
 *
 * El catálogo dinámico de negocios vive en la tabla Supabase `businesses`
 * (ver supabase/migrations/202605220001_businesses_table.sql). Pero el
 * frontend necesita conocer slug/nombre/logo/color sin esperar a la
 * migración — para que el sistema siga renderizando "Cibao Spa Laser"
 * antes de que el backend devuelva el business del usuario.
 *
 * Esta tabla local actúa como:
 *  - **Fallback** cuando el usuario aún no tiene business_id en el profile
 *    (todavía no migrado en prod, sesión recién iniciada, etc).
 *  - **Branding mapper** que traduce un slug en un Business hidratado
 *    listo para usar en Sidebar/Header.
 *  - **Defensa en profundidad** si por alguna razón el server devuelve
 *    un slug desconocido — caemos a CSL en vez de romper render.
 *
 * Cuando las migraciones SQL se apliquen y los profiles tengan business_id,
 * el backend devolverá el business hidratado y este fallback solo se usará
 * en el primer render (antes de que la sesión esté lista).
 */

import type { Business, BusinessSlug } from "./types"

/** Slug del negocio por defecto. Define qué branding ve un usuario sin business asignado. */
export const DEFAULT_BUSINESS_SLUG: BusinessSlug = "csl"

/**
 * Negocios soportados. Las claves coinciden con `businesses.slug` en DB.
 * Los `id` aquí son sentinelas — el `id` real es uuid generado por Supabase
 * tras correr la migración 001. Frontend nunca compara por id, solo por slug.
 */
export const BUSINESS_FALLBACK: Record<BusinessSlug, Business> = {
  csl: {
    id: "fallback-csl",
    slug: "csl",
    name: "Cibao Spa Laser",
    displayName: "Cibao Spa Laser · CSL",
    logoUrl: "/cibao-spa-laser-logo.jpeg",
    primaryColor: "#14B7B0",
    active: true,
  },
  depicenter: {
    id: "fallback-depicenter",
    slug: "depicenter",
    name: "Depicenter Skin Laser",
    displayName: "Depicenter Skin Laser",
    logoUrl: "/brands/depicenter-logo.jpg",
    primaryColor: "#FF6B9D",
    active: true,
  },
}

/**
 * Devuelve el Business hidratado a partir de un slug (string). Si el slug
 * no es válido, devuelve el negocio por defecto (CSL). Nunca tira.
 */
export function getBusinessBySlug(slug: BusinessSlug | string | null | undefined): Business {
  if (slug && typeof slug === "string" && (slug === "csl" || slug === "depicenter")) {
    return BUSINESS_FALLBACK[slug as BusinessSlug]
  }
  return BUSINESS_FALLBACK[DEFAULT_BUSINESS_SLUG]
}

/**
 * Resuelve el branding visual a usar en sidebar/header.
 *
 * Estrategia:
 *  1. Si recibimos un Business hidratado válido, lo usamos tal cual.
 *  2. Si recibimos null/undefined (sesión sin profile cargada todavía,
 *     o usuario sin business_id porque las migraciones no corrieron),
 *     devolvemos el fallback CSL — comportamiento idéntico al pre-multi-tenant.
 */
export function resolveBusinessBranding(business: Business | null | undefined): Business {
  if (business && business.slug) {
    return business
  }
  return BUSINESS_FALLBACK[DEFAULT_BUSINESS_SLUG]
}

/**
 * Lista de slugs válidos. Útil para validar inputs (selector de tenant
 * para superadmin, por ejemplo).
 */
export const SUPPORTED_BUSINESS_SLUGS: BusinessSlug[] = ["csl", "depicenter"]

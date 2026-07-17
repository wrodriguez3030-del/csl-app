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
    shortName: "CSL",
    displayName: "Cibao Spa Laser · CSL",
    logoUrl: "/cibao-spa-laser-logo.jpeg",
    primaryColor: "#14B7B0",
    active: true,
  },
  depicenter: {
    id: "fallback-depicenter",
    slug: "depicenter",
    name: "Depicenter Skin Laser",
    shortName: "Depicenter",
    displayName: "Depicenter Skin Laser",
    logoUrl: "/brands/depicenter-logo.jpg",
    // Turquesa identidad del logo. Misma familia que CSL pero levemente
    // más profundo para diferenciarlos sutilmente. Ajustable en DB.
    primaryColor: "#1FB5AE",
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

/**
 * UUIDs REALES de los businesses en producción (Supabase pfqnyzbtwhfkemkixril).
 *
 * Ojo: los `id` de `BUSINESS_FALLBACK` son sentinelas ("fallback-csl") — NO se
 * usan para comparar contra la DB. Estos sí son los uuid reales y se envían al
 * backend en `activeBusinessId` para el aislamiento end-to-end del superadmin.
 * El backend valida contra el mismo set (lib/server/business-context.ts).
 */
export const REAL_BUSINESS_ID_BY_SLUG: Record<BusinessSlug, string> = {
  csl: "66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6",
  depicenter: "03b96698-c5df-4b4b-84df-1160a7ad56b9",
}

/** uuid real del business para un slug, o null si el slug no es válido. */
export function businessIdForSlug(slug: string | null | undefined): string | null {
  if (slug === "csl" || slug === "depicenter") return REAL_BUSINESS_ID_BY_SLUG[slug]
  return null
}

/**
 * Orden preferido de sucursales por tenant para los filtros y menús del módulo
 * de comisión (MAYÚSCULAS, formato canónico). Cada tenant define el suyo aquí;
 * las sucursales no listadas quedan después, en orden alfabético. Así no se
 * ordena alfabéticamente por defecto (que ponía "Los Jardines" antes que
 * "Rafael Vidal") y cada tenant es independiente.
 */
export const COMMISSION_BRANCH_ORDER: Record<string, string[]> = {
  csl: ["RAFAEL VIDAL", "LOS JARDINES", "VILLA OLGA"],
}

/** Ordena una lista de sucursales según el orden preferido del tenant. */
export function orderCommissionBranches(slug: string | null | undefined, branches: string[]): string[] {
  const pref = COMMISSION_BRANCH_ORDER[String(slug || "")] || []
  const idx = (b: string) => {
    const i = pref.indexOf(b)
    return i === -1 ? pref.length : i
  }
  return [...branches].sort((a, b) => idx(a) - idx(b) || a.localeCompare(b))
}

/**
 * Branding normalizado para exportaciones (PDF, Excel, encabezados, footers).
 *
 * REGLA: ninguna exportación debe hardcodear "Cibao Spa Láser" / "CSL".
 * Toda exportación reutilizada por varios tenants debe tomar su branding
 * desde aquí, en función del business activo.
 */
export interface BusinessBranding {
  slug: BusinessSlug
  /** Nombre visible completo, con acentuación correcta para mostrar. */
  name: string
  /** Nombre corto / sigla (para logos compactos). */
  shortName: string
  /** Subtítulo del sistema. */
  subtitle: string
  /** Ruta del logo (relativa a /public; el consumidor la absolutiza si imprime). */
  logoUrl: string
  /** Color primario del tenant. */
  primaryColor: string
  /** Texto de footer en reportes. */
  footerText: string
  /** Correo de contacto del tenant (protección de datos, pie de consentimientos). */
  contactEmail: string
}

/**
 * Textos de marca que NO viven en el catálogo `Business` (nombre acentuado
 * para display, subtítulo y footer). El logo/color/shortName vienen del
 * catálogo `BUSINESS_FALLBACK` para no duplicar.
 */
const BRANDING_TEXT: Record<BusinessSlug, { displayName: string; subtitle: string; footerText: string; contactEmail: string }> = {
  csl: {
    displayName: "Cibao Spa Láser",
    subtitle: "Sistema Integral CSL",
    footerText: "Cibao Spa Láser",
    contactEmail: "cibaospalaser@gmail.com",
  },
  depicenter: {
    displayName: "Depicenter Skin Laser",
    subtitle: "Sistema Integral Depicenter",
    footerText: "Depicenter Skin Laser",
    contactEmail: "depicenterskinlaser@gmail.com",
  },
}

/**
 * Resuelve el branding de exportación a partir de un slug (o un Business).
 * Nunca tira: ante slug desconocido cae al branding por defecto (CSL).
 *
 * Uso típico desde un componente cliente:
 *   const b = useCurrentBusiness()
 *   const branding = getBusinessBranding(b.slug)
 */
export function getBusinessBranding(
  slugOrBusiness: BusinessSlug | string | Business | null | undefined,
): BusinessBranding {
  const slug =
    slugOrBusiness && typeof slugOrBusiness === "object"
      ? slugOrBusiness.slug
      : slugOrBusiness
  const base = getBusinessBySlug(slug)
  const text = BRANDING_TEXT[base.slug] ?? BRANDING_TEXT[DEFAULT_BUSINESS_SLUG]
  return {
    slug: base.slug,
    name: text.displayName,
    shortName: base.shortName,
    subtitle: text.subtitle,
    logoUrl: base.logoUrl,
    primaryColor: base.primaryColor,
    footerText: text.footerText,
    contactEmail: text.contactEmail,
  }
}

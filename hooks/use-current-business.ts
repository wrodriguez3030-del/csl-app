"use client"

import { useMemo } from "react"
import { useSessionUser } from "@/hooks/use-session-user"
import { resolveBusinessBranding, getBusinessBySlug } from "@/lib/business"
import { useAppStore } from "@/lib/store"
import type { Business } from "@/lib/types"

/**
 * Hook que devuelve el Business del usuario actual.
 *
 * Cadena de resolución:
 *   1. Si el SystemUser ya tiene `businessSlug` (post-migración + login flow
 *      actualizado), construimos el Business desde el catálogo local.
 *   2. Si SystemUser existe pero NO tiene businessSlug (estado actual pre-migración),
 *      caemos a CSL. Esto preserva el branding actual del sistema en producción.
 *   3. Si no hay sesión todavía (estado de carga), también caemos a CSL.
 *
 * Nunca devuelve null/undefined — siempre un Business válido. Esto simplifica
 * el render en Sidebar/Header (no hay que manejar estados loading).
 */
export function useCurrentBusiness(): Business {
  const user = useSessionUser()
  const activeBusinessSlug = useAppStore((s) => s.activeBusinessSlug)

  return useMemo(() => {
    // Superadmin: el branding/datos siguen el business ACTIVO elegido en el
    // switcher. Si está en "Todos" (null) cae a su propio business para el
    // branding del header. Un usuario normal siempre ve su propio business.
    if (user?.isSuperadmin && (activeBusinessSlug === "csl" || activeBusinessSlug === "depicenter")) {
      return getBusinessBySlug(activeBusinessSlug)
    }
    if (user?.businessSlug) {
      return getBusinessBySlug(user.businessSlug)
    }
    return resolveBusinessBranding(null)
  }, [user?.businessSlug, user?.isSuperadmin, activeBusinessSlug])
}

"use client"

import { useMemo } from "react"
import { useAppStore } from "@/lib/store"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { orderCommissionBranches } from "@/lib/business"

/**
 * Sucursales del TENANT activo, en el formato canónico del módulo de comisión
 * (MAYÚSCULAS, igual que roster/ventas/runs — el catálogo `db.sucursales` viene
 * en Title Case, p.ej. "Rafael Vidal" → "RAFAEL VIDAL"). Cada tenant es
 * independiente: la lista sale de su propio catálogo, nunca de una constante
 * hardcodeada. Excluye las sucursales inactivas y respeta el ORDEN preferido del
 * tenant (`COMMISSION_BRANCH_ORDER`), no alfabético. El servidor usa el
 * equivalente `readTenantBranches()`.
 */
export function useCommissionBranches(): string[] {
  const sucursales = useAppStore((s) => s.db.sucursales)
  const slug = useCurrentBusiness()?.slug
  return useMemo(() => {
    const names = (sucursales || [])
      .filter((s) => s?.Estado !== "Inactiva")
      .map((s) => String(s?.Nombre || "").trim().toUpperCase())
      .filter(Boolean)
    return orderCommissionBranches(slug, [...new Set(names)])
  }, [sucursales, slug])
}

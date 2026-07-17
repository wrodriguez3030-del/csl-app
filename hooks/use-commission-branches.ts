"use client"

import { useMemo } from "react"
import { useAppStore } from "@/lib/store"

/**
 * Sucursales del TENANT activo, en el formato canónico del módulo de comisión
 * (MAYÚSCULAS, igual que roster/ventas/runs — el catálogo `db.sucursales` viene
 * en Title Case, p.ej. "Rafael Vidal" → "RAFAEL VIDAL"). Cada tenant es
 * independiente: la lista sale de su propio catálogo, nunca de una constante
 * hardcodeada (antes se fijaban las 3 de CSL en todo el módulo). Excluye las
 * sucursales inactivas. El servidor usa el equivalente `readTenantBranches()`.
 */
export function useCommissionBranches(): string[] {
  const sucursales = useAppStore((s) => s.db.sucursales)
  return useMemo(() => {
    const names = (sucursales || [])
      .filter((s) => s?.Estado !== "Inactiva")
      .map((s) => String(s?.Nombre || "").trim().toUpperCase())
      .filter(Boolean)
    return [...new Set(names)].sort()
  }, [sucursales])
}

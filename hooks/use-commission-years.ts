"use client"

import { useEffect, useState } from "react"
import { useAppStore, apiCallCached, normalizeApiUrl } from "@/lib/store"
import { useCurrentBusiness } from "@/hooks/use-current-business"

/**
 * Años que ofrece el filtro de Incentivos de Ventas: los que REALMENTE tienen
 * ventas importadas en el tenant activo, del más nuevo al más viejo.
 *
 * Antes la lista era `[hoy+1, hoy, hoy−1, hoy−2]`, así que el historial de
 * 2020–2023 quedaba importado pero imposible de elegir. Se pide una sola vez
 * (lectura cacheada 30 s y particionada por negocio) porque la barra de filtros
 * es compartida por las 7 pantallas del módulo.
 */
export function useCommissionYears(): number[] {
  const apiUrl = useAppStore((s) => s.apiUrl)
  const slug = useCurrentBusiness()?.slug
  const [years, setYears] = useState<number[]>([])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await apiCallCached(normalizeApiUrl(apiUrl), { action: "getCommissionYears" })
        const list = Array.isArray(res?.years) ? (res.years as unknown[]).map(Number).filter(Number.isInteger) : []
        if (alive && list.length) setYears(list)
      } catch {
        // Si la consulta falla, el selector se queda con el respaldo de abajo.
      }
    })()
    return () => { alive = false }
  }, [apiUrl, slug])

  const now = new Date().getFullYear()
  return years.length ? years : [now, now - 1, now - 2]
}

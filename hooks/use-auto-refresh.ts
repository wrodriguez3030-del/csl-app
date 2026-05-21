"use client"

import { useEffect, useRef } from "react"

/**
 * Auto-refresh para módulos listables.
 *
 * Comportamiento:
 *   - Llama a `refresh` al montar.
 *   - Vuelve a llamar cada `intervalMs` (default 60_000).
 *   - Llama también al volver al tab (`visibilitychange` y `focus`).
 *   - Salta la llamada si:
 *       · ya hay una en vuelo (lock interno)
 *       · `skipWhen()` devuelve `true` (p.ej. formulario abierto)
 *       · el documento está oculto (`document.hidden`)
 *
 * `refresh` puede ser sync o async; los errores son responsabilidad del
 * caller (este hook sólo orquesta el cuándo, no el cómo).
 */
export function useAutoRefresh(
  refresh: () => Promise<void> | void,
  options: { intervalMs?: number; skipWhen?: () => boolean; enabled?: boolean } = {},
) {
  const { intervalMs = 60_000, skipWhen, enabled = true } = options

  // Refs para no recrear el efecto en cada render
  const refreshRef = useRef(refresh)
  const skipRef = useRef(skipWhen)
  const inflightRef = useRef(false)

  useEffect(() => {
    refreshRef.current = refresh
    skipRef.current = skipWhen
  }, [refresh, skipWhen])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const fire = async () => {
      if (cancelled || inflightRef.current) return
      if (typeof document !== "undefined" && document.hidden) return
      if (skipRef.current && skipRef.current()) return
      inflightRef.current = true
      try {
        await refreshRef.current()
      } catch {
        // El caller decide cómo manejar errores. No queremos romper la cadencia.
      } finally {
        inflightRef.current = false
      }
    }

    // Disparo inicial
    void fire()

    // Periódico
    const interval = window.setInterval(() => {
      void fire()
    }, intervalMs)

    // Visibilidad / foco
    const onVisible = () => {
      if (typeof document !== "undefined" && document.hidden) return
      void fire()
    }
    const onFocus = () => {
      void fire()
    }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", onFocus)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", onFocus)
    }
  }, [intervalMs, enabled])
}

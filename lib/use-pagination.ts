"use client"

import { useEffect, useMemo, useState } from "react"

/**
 * Paginación en cliente reutilizable. Recibe el arreglo ya filtrado/ordenado y
 * devuelve la ventana de la página actual + metadatos para el pie de tabla.
 *
 * `resetKey` debe cambiar cuando cambian filtros/búsqueda/orden para volver a la
 * página 1 (p. ej. `resetKey: query + sucursal`). El índice de página se acota
 * automáticamente si el total se reduce.
 */
export function usePagination<T>(
  items: T[],
  opts?: { initialPageSize?: number; resetKey?: unknown },
): {
  page: number
  setPage: (p: number) => void
  pageSize: number
  setPageSize: (n: number) => void
  totalPages: number
  total: number
  from: number
  to: number
  pageItems: T[]
} {
  const [page, setPageRaw] = useState(1)
  const [pageSize, setPageSize] = useState(opts?.initialPageSize ?? 25)
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return items.slice(start, start + pageSize)
  }, [items, safePage, pageSize])

  // Volver a la página 1 cuando cambia el filtro/orden o el tamaño de página.
  useEffect(() => { setPageRaw(1) }, [opts?.resetKey, pageSize])

  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1
  const to = Math.min(safePage * pageSize, total)
  const setPage = (p: number) => setPageRaw(Math.min(Math.max(1, p), totalPages))

  return { page: safePage, setPage, pageSize, setPageSize, totalPages, total, from, to, pageItems }
}

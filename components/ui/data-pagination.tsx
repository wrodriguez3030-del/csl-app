"use client"

import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react"

interface DataPaginationProps {
  page: number
  totalPages: number
  total: number
  from: number
  to: number
  pageSize: number
  onPage: (p: number) => void
  onPageSize: (n: number) => void
  pageSizeOptions?: number[]
  /** Etiqueta del tipo de registro, p. ej. "lecturas", "ponches". */
  label?: string
  className?: string
}

/**
 * Pie de paginación reutilizable: "Mostrando X–Y de Z" + selector de tamaño +
 * controles ‹ « » ›. No renderiza nada cuando hay 0 registros.
 */
export function DataPagination({
  page, totalPages, total, from, to, pageSize,
  onPage, onPageSize, pageSizeOptions = [25, 50, 100, 200], label = "registros", className,
}: DataPaginationProps) {
  if (total === 0) return null
  return (
    <div className={`flex flex-col gap-2 border-t px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between ${className ?? ""}`}>
      <div className="text-xs text-muted-foreground">
        Mostrando <b>{from}</b>–<b>{to}</b> de <b>{total}</b> {label}
      </div>
      <div className="flex items-center gap-1.5">
        <select
          className="h-8 rounded-md border bg-background px-2 text-xs"
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          aria-label="Registros por página"
        >
          {pageSizeOptions.map((n) => <option key={n} value={n}>{n} / pág.</option>)}
        </select>
        <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => onPage(1)} disabled={page <= 1} title="Primera"><ChevronsLeft className="h-4 w-4" /></Button>
        <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => onPage(page - 1)} disabled={page <= 1} title="Anterior"><ChevronLeft className="h-4 w-4" /></Button>
        <span className="whitespace-nowrap px-1 text-xs">Pág. <b>{page}</b>/<b>{totalPages}</b></span>
        <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => onPage(page + 1)} disabled={page >= totalPages} title="Siguiente"><ChevronRight className="h-4 w-4" /></Button>
        <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => onPage(totalPages)} disabled={page >= totalPages} title="Última"><ChevronsRight className="h-4 w-4" /></Button>
      </div>
    </div>
  )
}

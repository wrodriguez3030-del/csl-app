import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * Badge discreto para mostrar el número secuencial visual de una fila.
 *
 * - No es un ID real del sistema; sólo refleja la posición visible
 *   actualmente (después de filtros, búsqueda y ordenamiento).
 * - Usado en todas las tablas de listado del sistema CSL.
 */
export function SeqBadge({ n, className }: { n: number; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "min-w-[28px] justify-center px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-muted-foreground/90",
        className,
      )}
    >
      {n}
    </Badge>
  )
}

/**
 * Encabezado "#" para la primera columna de las tablas con secuencial.
 * Se usa como contenido dentro de un <TableHead> o <th>.
 */
export const SEQ_HEADER_CLASS = "w-12 text-center text-[10px] font-black uppercase tracking-widest text-muted-foreground"

"use client"

/**
 * Ordenamiento reutilizable para tablas: asc → desc → default (3 clicks).
 * Ordena por tipo real (número, fecha, estado lógico, texto). Úsalo con
 * accessors por columna para no duplicar lógica.
 */
import * as React from "react"
import { useState } from "react"
import { ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react"

export type SortDir = "asc" | "desc"
export interface SortState { key: string | null; dir: SortDir }

export function useTableSort(defaultKey: string | null = null, defaultDir: SortDir = "asc") {
  const [sort, setSort] = useState<SortState>({ key: defaultKey, dir: defaultDir })
  const toggle = (key: string) => setSort((s) => {
    if (s.key !== key) return { key, dir: "asc" }
    if (s.dir === "asc") return { key, dir: "desc" }
    return { key: defaultKey, dir: defaultDir } // 3er click → vuelve al orden por defecto
  })
  return { sort, toggle, setSort }
}

function cmp(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a).localeCompare(String(b), "es", { numeric: true, sensitivity: "base" })
}

/** Ordena una copia de `rows` según el estado y los accessors por columna. */
export function sortRows<T>(rows: T[], sort: SortState, accessors: Record<string, (r: T) => unknown>): T[] {
  if (!sort.key) return rows
  const acc = accessors[sort.key]
  if (!acc) return rows
  const out = [...rows].sort((a, b) => cmp(acc(a), acc(b)))
  return sort.dir === "desc" ? out.reverse() : out
}

/** Orden lógico de estados (para ordenar por la columna Estado). */
const ESTADO_ORDER: Record<string, number> = {
  incompleto: 0,
  "pendiente de calcular": 1, pendiente: 1,
  borrador: 2,
  calculado: 3, solicitada: 3, solicitado: 3,
  "en revisión": 4, "en revision": 4, en_revision: 4, entrevista: 4,
  aprobada: 5, aprobado: 5, activo: 5,
  pagada: 6, pagado: 6,
  anulada: 7, anulado: 7, inactivo: 7, archivado: 7,
}
export const estadoRank = (s: unknown) => ESTADO_ORDER[String(s ?? "").toLowerCase().trim()] ?? 50

/** Etiqueta de encabezado con indicador asc/desc. Colócala dentro de <TableHead>/<th> con onClick={() => toggle(key)}. */
export function SortLabel({ label, sortKey, sort, className }: { label: string; sortKey: string; sort: SortState; className?: string }) {
  const active = sort.key === sortKey
  return (
    <span className={"inline-flex items-center gap-1 cursor-pointer select-none hover:text-foreground " + (className || "")}>
      {label}
      {active ? (sort.dir === "asc" ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />) : <ChevronsUpDown className="h-3 w-3 opacity-30" />}
    </span>
  )
}

"use client"

/**
 * Banner + filtro de business para usuarios superadmin.
 *
 * Cuando un user con is_superadmin = true entra a una página, el backend
 * NO le aplica filtro tenant (ve TODOS los rows). Esto es útil para
 * administración pero confuso porque ve datos mezclados de CSL y
 * Depicenter sin aviso.
 *
 * Este componente:
 *   - Solo se renderiza si el user es superadmin (devuelve null si no)
 *   - Muestra un banner ámbar visible aclarando el modo
 *   - Provee un Select para filtrar client-side: Todos / CSL / Depicenter
 *
 * La página dueña mantiene el state del filtro y aplica `.filter()` a
 * sus datos antes de renderizar.
 *
 * Usado por Equipos, Solicitudes de empleo. Reutilizable en cualquier
 * página que liste rows con business_id.
 */

import { ShieldAlert } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useSessionUser } from "@/hooks/use-session-user"

export type BusinessFilterValue = "all" | "csl" | "depicenter"

const BUSINESS_ID_BY_SLUG: Record<"csl" | "depicenter", string> = {
  csl:        "66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6",
  depicenter: "03b96698-c5df-4b4b-84df-1160a7ad56b9",
}

/** Convierte el filtro de UI a UUID de business_id. "all" devuelve null
 *  para indicar "no filtrar". */
export function filterValueToBusinessId(v: BusinessFilterValue): string | null {
  if (v === "all") return null
  return BUSINESS_ID_BY_SLUG[v]
}

/** Hook para saber si el user actual es superadmin. */
export function useIsSuperadmin(): boolean {
  const user = useSessionUser()
  return Boolean(user?.isSuperadmin)
}

export function SuperadminBusinessFilter({
  value,
  onChange,
  className = "",
}: {
  value: BusinessFilterValue
  onChange: (v: BusinessFilterValue) => void
  className?: string
}) {
  const isSuperadmin = useIsSuperadmin()
  if (!isSuperadmin) return null
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 ${className}`}>
      <ShieldAlert className="h-4 w-4 shrink-0 text-amber-700" />
      <div className="text-xs font-semibold text-amber-900">
        Modo Superadmin · ves datos de todos los negocios
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-amber-900">Ver como:</span>
        <Select value={value} onValueChange={(v) => onChange(v as BusinessFilterValue)}>
          <SelectTrigger className="h-8 w-52 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los negocios</SelectItem>
            <SelectItem value="csl">Cibao Spa Laser</SelectItem>
            <SelectItem value="depicenter">Depicenter Skin Láser</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

"use client"

/**
 * Selector reutilizable de EMPLEADOS REALES para todos los módulos de RR.HH.
 *
 * Sustituye los inputs de texto libre de "ID Empleado". Carga empleados desde
 * la acción `getEmpleados` (tabla csl_empleados, alimentada por solicitudes de
 * empleo APROBADAS; nunca pendientes ni candidatos). El filtrado multi-tenant
 * es automático: `apiCall` inyecta `activeBusinessId`, así que cada negocio ve
 * solo SUS empleados (superadmin respeta el business activo).
 *
 * Al seleccionar, devuelve el empleado completo (empleado_id, nombre, cédula,
 * puesto, sucursal, sueldo) para autollenar el formulario. Incluye botón
 * "Agregar empleado" (navega al módulo Empleados) y estado vacío explícito.
 */

import { useEffect, useMemo, useState } from "react"
import { apiCall, normalizeApiUrl, useAppStore } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Check, ChevronsUpDown, UserPlus, RotateCw, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

export interface EmployeeOption {
  empleado_id: string
  nombre: string
  cedula: string
  puesto: string
  sucursal: string
  sueldo: number
}

const str = (v: unknown) => (v == null ? "" : String(v))

function toOption(r: Record<string, unknown>): EmployeeOption {
  const nombre = `${str(r.Nombre ?? r.nombre)} ${str(r.Apellido ?? r.apellido)}`.replace(/\s+/g, " ").trim()
  const id = str(r.SolicitudID ?? r.empleado_id ?? r.EmpleadoID ?? r.id)
  return {
    empleado_id: id,
    nombre: nombre || id,
    cedula: str(r.Cedula ?? r.cedula),
    puesto: str(r.PuestoSolicitado ?? r.Puesto ?? r.puesto),
    sucursal: str(r.Sucursal ?? r.sucursal),
    sueldo: Number(r.Salario ?? r.salario ?? r.sueldo_mensual ?? 0) || 0,
  }
}

interface Props {
  value?: string
  onSelect: (emp: EmployeeOption | null) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function EmployeeSelect({ value, onSelect, placeholder = "Seleccionar empleado…", className, disabled }: Props) {
  const apiUrl = useAppStore(s => s.apiUrl)
  const activeBusinessSlug = useAppStore(s => s.activeBusinessSlug)
  const setActiveTab = useAppStore(s => s.setActiveTab)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [emps, setEmps] = useState<EmployeeOption[]>([])

  const load = async () => {
    setLoading(true)
    try {
      const res = await apiCall(normalizeApiUrl(apiUrl), { action: "getEmpleados" }) as { ok?: boolean; records?: Record<string, unknown>[] }
      const seen = new Set<string>()
      const list = (res?.records ?? []).map(toOption).filter(e => e.empleado_id && !seen.has(e.empleado_id) && seen.add(e.empleado_id))
      list.sort((a, b) => a.nombre.localeCompare(b.nombre))
      setEmps(list)
    } catch {
      setEmps([])
    } finally { setLoading(false) }
  }
  // Recarga al montar y al cambiar de tenant (evita mezclar empleados entre negocios).
  useEffect(() => { load() }, [activeBusinessSlug]) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = useMemo(() => emps.find(e => e.empleado_id === value) || null, [emps, value])
  const label = selected
    ? `${selected.nombre}${selected.cedula ? ` · ${selected.cedula}` : ""}`
    : (value ? value : placeholder)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} disabled={disabled}
          className={cn("w-full justify-between font-normal", !selected && !value && "text-muted-foreground", className)}>
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar por nombre, cédula, puesto…" />
          <CommandList>
            {loading ? (
              <div className="py-6 text-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Cargando empleados…</div>
            ) : emps.length === 0 ? (
              <div className="py-4 px-3 text-center text-sm text-muted-foreground">
                No hay empleados registrados para este negocio. Agrega un empleado o sincroniza solicitudes aprobadas.
              </div>
            ) : (
              <>
                <CommandEmpty>Sin coincidencias.</CommandEmpty>
                <CommandGroup heading="Empleados">
                  {emps.map(e => (
                    <CommandItem
                      key={e.empleado_id}
                      value={`${e.nombre} ${e.cedula} ${e.puesto} ${e.sucursal} ${e.empleado_id}`}
                      onSelect={() => { onSelect(e); setOpen(false) }}
                    >
                      <Check className={cn("mr-2 h-4 w-4 shrink-0", value === e.empleado_id ? "opacity-100" : "opacity-0")} />
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium truncate">{e.nombre}</span>
                        <span className="text-xs text-muted-foreground truncate">{[e.cedula, e.puesto, e.sucursal].filter(Boolean).join(" · ") || "—"}</span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
          {/* Acciones fijas (fuera del filtro de búsqueda) */}
          <div className="flex items-center justify-between border-t p-1.5">
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setOpen(false); setActiveTab("rrhh-empleados") }}>
              <UserPlus className="w-3.5 h-3.5 mr-1" />Agregar empleado
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Recargar" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

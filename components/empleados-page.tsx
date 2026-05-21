"use client"

import { useEffect, useMemo, useState } from "react"
import { BadgeCheck, Briefcase, CreditCard, Mail, MapPin, Phone, Search, Users } from "lucide-react"
import { useAppStore, apiJsonp, normalizeApiUrl } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { RecordActions } from "@/components/record-actions"

interface EmpleadoRecord {
  id: string
  fecha: string
  estado: string
  puestoSolicitado: string
  nombre: string
  apellido: string
  cedula: string
  celular: string
  email: string
  ciudad: string
  sector: string
  fechaNacimiento: string
  nacionalidad: string
  observaciones: string
}
type EmpleadoSortKey = "fecha" | "nombre" | "puestoSolicitado" | "cedula" | "ciudad"

function normalizeEmpleado(raw: Record<string, unknown>): EmpleadoRecord {
  return {
    id: String(raw.SolicitudID ?? raw.id ?? ""),
    fecha: String(raw.FechaSolicitud ?? raw.fecha ?? ""),
    estado: String(raw.Estado ?? raw.estado ?? ""),
    puestoSolicitado: String(raw.PuestoSolicitado ?? raw.puestoSolicitado ?? ""),
    nombre: String(raw.Nombre ?? raw.nombre ?? ""),
    apellido: String(raw.Apellido ?? raw.apellido ?? ""),
    cedula: String(raw.Cedula ?? raw.cedula ?? ""),
    celular: String(raw.Telefono ?? raw.celular ?? ""),
    email: String(raw.Email ?? raw.email ?? ""),
    ciudad: String(raw.Ciudad ?? raw.ciudad ?? ""),
    sector: String(raw.Sector ?? raw.sector ?? ""),
    fechaNacimiento: String(raw.FechaNacimiento ?? raw.fechaNacimiento ?? ""),
    nacionalidad: String(raw.Nacionalidad ?? raw.nacionalidad ?? ""),
    observaciones: String(raw.Observaciones ?? raw.observaciones ?? ""),
  }
}

export function EmpleadosPage() {
  const { apiUrl, showToast, setIsLoading, setLoadingMessage } = useAppStore()
  const [empleados, setEmpleados] = useState<EmpleadoRecord[]>([])
  const [search, setSearch] = useState("")
  const [sortKey, setSortKey] = useState<EmpleadoSortKey>("nombre")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  const loadEmpleados = async () => {
    const normalized = normalizeApiUrl(apiUrl)
    if (!normalized) {
      setEmpleados([])
      return
    }

    try {
      setIsLoading(true)
      setLoadingMessage("Cargando empleados...")
      const result = await apiJsonp(normalized, { action: "getEmpleados" })
      const records = Array.isArray((result as { records?: unknown[] }).records)
        ? ((result as { records?: Record<string, unknown>[] }).records || [])
        : []
      setEmpleados(records.map((r) => normalizeEmpleado(r)))
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Error cargando empleados", "error")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadEmpleados()
  }, [apiUrl])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return empleados
      .filter((e) =>
        !search.trim() ||
        [e.nombre, e.apellido, e.cedula, e.puestoSolicitado, e.email, e.celular, e.ciudad, e.sector]
          .join(" ")
          .toLowerCase()
          .includes(q)
      )
      .sort((a, b) => {
        const valueA = sortKey === "nombre" ? `${a.nombre} ${a.apellido}` : a[sortKey]
        const valueB = sortKey === "nombre" ? `${b.nombre} ${b.apellido}` : b[sortKey]
        return String(valueA || "").localeCompare(String(valueB || ""), "es", { numeric: true }) * (sortDir === "asc" ? 1 : -1)
      })
  }, [empleados, search, sortKey, sortDir])

  function handleSort(key: EmpleadoSortKey) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc")
    else {
      setSortKey(key)
      setSortDir(key === "fecha" ? "desc" : "asc")
    }
  }

  function sortText(key: EmpleadoSortKey, label: string) {
    return `${label}${sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : " ⇅"}`
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Empleados activos desde solicitudes</p>
            <p className="mt-2 text-3xl font-bold">{filtered.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Fuente</p>
            <p className="mt-2 text-lg font-semibold">Solicitudes aprobadas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Sincronización</p>
            <p className="mt-2 text-lg font-semibold">Supabase</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Empleados</CardTitle>
              <p className="text-sm text-muted-foreground">Lee solicitudes con estado Aprobado desde Supabase.</p>
            </div>
            <button onClick={() => void loadEmpleados()} className="rounded-lg border px-3 py-2 text-sm">Actualizar</button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Buscar por nombre, cédula, puesto o contacto..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => handleSort("nombre")} className="rounded-lg border px-3 py-2 text-xs">{sortText("nombre", "Nombre")}</button>
              <button onClick={() => handleSort("fecha")} className="rounded-lg border px-3 py-2 text-xs">{sortText("fecha", "Fecha")}</button>
              <button onClick={() => handleSort("puestoSolicitado")} className="rounded-lg border px-3 py-2 text-xs">{sortText("puestoSolicitado", "Puesto")}</button>
              <button onClick={() => handleSort("ciudad")} className="rounded-lg border px-3 py-2 text-xs">{sortText("ciudad", "Ciudad")}</button>
            </div>
          </div>

          <div className="grid gap-4">
            {filtered.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                No hay empleados todavía. Cambia una solicitud a estado <b>Aprobado</b>.
              </div>
            ) : (
              filtered.map((empleado) => (
                <Card key={empleado.id} className="border-border/70">
                  <CardContent className="pt-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4 text-primary" />
                            <h3 className="text-lg font-semibold">{empleado.nombre} {empleado.apellido}</h3>
                          </div>
                          <Badge className="gap-1 bg-green-600 text-white hover:bg-green-600">
                            <BadgeCheck className="h-3.5 w-3.5" />
                            Aprobado
                          </Badge>
                        </div>

                        <div className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2 xl:grid-cols-4">
                          <div className="flex items-center gap-2"><Briefcase className="h-4 w-4" /><span>{empleado.puestoSolicitado || "Sin puesto"}</span></div>
                          <div className="flex items-center gap-2"><CreditCard className="h-4 w-4" /><span>{empleado.cedula || "Sin cédula"}</span></div>
                          <div className="flex items-center gap-2"><Phone className="h-4 w-4" /><span>{empleado.celular || "Sin teléfono"}</span></div>
                          <div className="flex items-center gap-2"><Mail className="h-4 w-4" /><span>{empleado.email || "Sin correo"}</span></div>
                          <div className="flex items-center gap-2 md:col-span-2 xl:col-span-2"><MapPin className="h-4 w-4" /><span>{[empleado.sector, empleado.ciudad].filter(Boolean).join(", ") || "Sin ubicación"}</span></div>
                        </div>
                      </div>

                      <div className="text-sm text-muted-foreground lg:text-right">
                        <div><b>Fecha solicitud:</b> {empleado.fecha || "—"}</div>
                        <div><b>Nacionalidad:</b> {empleado.nacionalidad || "—"}</div>
                        <div><b>Nacimiento:</b> {empleado.fechaNacimiento || "—"}</div>
                      </div>
                    </div>

                    {empleado.observaciones ? (
                      <div className="mt-4 rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
                        <b>Observaciones:</b> {empleado.observaciones}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default EmpleadosPage

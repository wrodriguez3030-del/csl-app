"use client"

import { useEffect, useMemo, useState } from "react"
import { BadgeCheck, Briefcase, CreditCard, Mail, MapPin, Phone, Search, Users, QrCode } from "lucide-react"
import { useAppStore, apiJsonp, apiCall, normalizeApiUrl } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import QRCode from "qrcode"
import { EmployeeScheduleDialog } from "@/components/hr/employee-schedule-dialog"
import { Clock } from "lucide-react"
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
  const [qrEmp, setQrEmp] = useState<EmpleadoRecord | null>(null)
  const [qrUrl, setQrUrl] = useState("")
  const [qrToken, setQrToken] = useState("")
  const [qrBusy, setQrBusy] = useState(false)
  const [schedEmp, setSchedEmp] = useState<EmpleadoRecord | null>(null)

  const qrLink = (token: string) => `${typeof window !== "undefined" ? window.location.origin : ""}/qr/${encodeURIComponent(token)}`
  const shareWhatsapp = () => {
    if (!qrToken || !qrEmp) return
    const nombre = `${qrEmp.nombre} ${qrEmp.apellido}`.trim()
    const msg = `Hola ${nombre} 👋\n\nEste es tu QR personal para el ponche de asistencia.\n\nDebes presentarlo en el kiosco autorizado de tu sucursal para registrar entrada y salida.\n\nImportante:\nEste QR solo funciona dentro de la geocerca de la sucursal y desde un dispositivo autorizado.\n\n${qrLink(qrToken)}`
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank")
  }
  const copyLink = async () => {
    if (!qrToken) return
    try { await navigator.clipboard.writeText(qrLink(qrToken)); showToast("Link del QR copiado", "success") }
    catch { showToast(qrLink(qrToken), "info") }
  }

  const openQr = async (emp: EmpleadoRecord, regenerate = false) => {
    setQrEmp(emp); setQrBusy(true); if (!regenerate) setQrUrl("")
    try {
      const params: Record<string, string> = { action: "getHrEmployeeQr", employee_id: emp.id }
      if (regenerate) params.regenerate = "true"
      const res = await apiCall(normalizeApiUrl(apiUrl), params) as { ok?: boolean; token?: string | null; tableMissing?: boolean; error?: string }
      if (res?.tableMissing) { showToast("Falta aplicar la migración del ponche QR en db-cls", "error"); return }
      if (!res?.ok || !res.token) { showToast(res?.error || "No se pudo generar el QR", "error"); return }
      setQrToken(res.token)
      setQrUrl(await QRCode.toDataURL(res.token, { width: 320, margin: 1 }))
      if (regenerate) showToast("QR regenerado. El anterior quedó inválido.", "success")
    } catch (e) { showToast(e instanceof Error ? e.message : "Error generando QR", "error") } finally { setQrBusy(false) }
  }
  const downloadQr = () => {
    if (!qrUrl || !qrEmp) return
    const a = document.createElement("a"); a.href = qrUrl
    a.download = `QR_${qrEmp.nombre}_${qrEmp.apellido}.png`.replace(/\s+/g, "_")
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

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

  const [syncing, setSyncing] = useState(false)
  const syncAprobadas = async () => {
    const normalized = normalizeApiUrl(apiUrl)
    if (!normalized) return
    setSyncing(true)
    try {
      const res = await apiJsonp(normalized, { action: "syncApprovedEmpleados" }) as
        { ok?: boolean; aprobadas?: number; creados?: number; actualizados?: number; omitidos?: number; errores?: number; error?: string }
      if (!res?.ok) { showToast(res?.error || "No se pudo sincronizar", "error"); return }
      showToast(`Sincronizado: ${res.creados ?? 0} creados, ${res.actualizados ?? 0} actualizados, ${res.omitidos ?? 0} omitidos${res.errores ? `, ${res.errores} con error` : ""} (de ${res.aprobadas ?? 0} aprobadas)`, (res.errores ?? 0) > 0 ? "error" : "success")
      await loadEmpleados()
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Error al sincronizar", "error")
    } finally {
      setSyncing(false)
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
            <div className="flex gap-2">
              <button onClick={() => void syncAprobadas()} disabled={syncing} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">{syncing ? "Sincronizando…" : "Sincronizar aprobadas"}</button>
              <button onClick={() => void loadEmpleados()} className="rounded-lg border px-3 py-2 text-sm">Actualizar</button>
            </div>
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
                        <div className="mt-3 flex gap-2 lg:justify-end">
                          <button onClick={() => setSchedEmp(empleado)} className="rounded-lg border px-3 py-1.5 text-xs flex items-center gap-1 hover:bg-muted/50"><Clock className="h-3.5 w-3.5" />Horario</button>
                          <button onClick={() => void openQr(empleado)} className="rounded-lg border px-3 py-1.5 text-xs flex items-center gap-1 hover:bg-muted/50"><QrCode className="h-3.5 w-3.5" />Ver QR</button>
                        </div>
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

      <Dialog open={!!qrEmp} onOpenChange={(o) => { if (!o) { setQrEmp(null); setQrUrl(""); setQrToken("") } }}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>QR · {qrEmp?.nombre} {qrEmp?.apellido}</DialogTitle></DialogHeader>
          <div className="flex flex-col items-center gap-3 py-2">
            {qrBusy && !qrUrl ? (
              <div className="py-12 text-sm text-muted-foreground">Generando QR…</div>
            ) : qrUrl ? (
              <img src={qrUrl} alt="QR del empleado" className="w-56 h-56" />
            ) : (
              <div className="py-12 text-sm text-muted-foreground">Sin QR</div>
            )}
            <p className="text-[11px] text-muted-foreground text-center">El empleado presenta este QR en el kiosco de ponche. Solo funciona dentro de la sucursal (geocerca) y en un dispositivo autorizado.</p>
            <div className="grid grid-cols-2 gap-2 w-full">
              <button onClick={downloadQr} disabled={!qrUrl} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">Descargar</button>
              <button onClick={shareWhatsapp} disabled={!qrToken} className="rounded-lg bg-[#25D366] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">WhatsApp</button>
              <button onClick={copyLink} disabled={!qrToken} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">Copiar link</button>
              <button onClick={() => qrEmp && void openQr(qrEmp, true)} disabled={qrBusy} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">Regenerar</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {schedEmp && (
        <EmployeeScheduleDialog
          employeeId={schedEmp.id}
          employeeName={`${schedEmp.nombre} ${schedEmp.apellido}`.trim()}
          sucursal={(schedEmp as unknown as { sucursal?: string }).sucursal}
          onClose={() => setSchedEmp(null)}
        />
      )}
    </div>
  )
}

export default EmpleadosPage

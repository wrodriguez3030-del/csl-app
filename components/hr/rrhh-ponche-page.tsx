"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { apiCall, normalizeApiUrl, useAppStore } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EmployeeSelect } from "@/components/hr/employee-select"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Fingerprint, Plus, Trash2, Save, X, Loader2, Monitor, ArrowLeft, AlertCircle, MapPin, Smartphone, ScanLine, FileSpreadsheet, CheckCircle2, XCircle, LocateFixed, Power } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { exportHrReportExcel } from "@/lib/hr-report-excel"

interface HrPunch {
  id: string; employee_id: string; employee_nombre?: string | null; type: string; punched_at: string
  sucursal: string | null; source: string; is_correction: boolean; correction_reason: string | null
  latitude?: number | null; longitude?: number | null; distance_meters?: number | null
  device_id?: string | null; status?: string; rejection_reason?: string | null
}
interface Device { id: string; sucursal: string | null; device_name: string; active: boolean; last_seen_at: string | null; device_info: string | null }
interface Geofence { id: string; sucursal: string; latitude: number; longitude: number; radius_meters: number; active: boolean }
interface Emp { id: string; nombre: string; cedula: string; sucursal: string }

const TYPES = ["entrada", "salida", "inicio_descanso", "fin_descanso"]
const TYPE_LABEL: Record<string, string> = {
  entrada: "Entrada", salida: "Salida", inicio_descanso: "Inicio descanso", fin_descanso: "Fin descanso",
  almuerzo_inicio: "Inicio descanso", almuerzo_fin: "Fin descanso", salida_autorizada: "Salida autorizada",
}
const TYPE_CLASS: Record<string, string> = {
  entrada: "bg-emerald-100 text-emerald-700 border-emerald-200",
  salida: "bg-blue-100 text-blue-700 border-blue-200",
  inicio_descanso: "bg-amber-100 text-amber-700 border-amber-200",
  fin_descanso: "bg-amber-100 text-amber-700 border-amber-200",
}
const DEVICE_TOKEN_KEY = "csl_punch_device_token"
const pick = (...v: unknown[]) => { for (const x of v) { const s = x == null ? "" : String(x).trim(); if (s) return s } return "" }
const fmtDateTime = (iso: string) => iso ? new Date(iso).toLocaleString("es-DO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"
const isToday = (iso: string) => { if (!iso) return false; const d = new Date(iso), n = new Date(); return d.toDateString() === n.toDateString() }
function toEmp(r: Record<string, unknown>): Emp {
  return {
    id: pick(r.SolicitudID, r.empleado_id, r.EmpleadoID, r.id),
    nombre: `${pick(r.Nombre, r.nombre)} ${pick(r.Apellido, r.apellido)}`.replace(/\s+/g, " ").trim() || pick(r.SolicitudID, r.empleado_id),
    cedula: pick(r.Cedula, r.cedula), sucursal: pick(r.Sucursal, r.sucursal),
  }
}

export function RrhhPonchePage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const [view, setView] = useState<"admin" | "kiosk">("admin")
  const call = (params: Record<string, string | number | boolean>) => apiCall(normalizeApiUrl(apiUrl), params)

  // ── Datos admin ──────────────────────────────────────────────────────────
  const [punches, setPunches] = useState<HrPunch[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [geofences, setGeofences] = useState<Geofence[]>([])
  const [empMap, setEmpMap] = useState<Record<string, Emp>>({})
  const [tableMissing, setTableMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [correction, setCorrection] = useState<Partial<HrPunch> | null>(null)
  const [geoEdit, setGeoEdit] = useState<Partial<Geofence> | null>(null)
  const [authDev, setAuthDev] = useState<{ device_name: string; sucursal: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const reload = async () => {
    setLoading(true)
    try {
      const [p, d, g, e] = await Promise.all([
        call({ action: "getHrPunches" }) as Promise<{ ok?: boolean; records?: HrPunch[]; tableMissing?: boolean }>,
        call({ action: "getHrPunchDevices" }) as Promise<{ ok?: boolean; records?: Device[]; tableMissing?: boolean }>,
        call({ action: "getHrBranchGeofences" }) as Promise<{ ok?: boolean; records?: Geofence[] }>,
        call({ action: "getEmpleados" }) as Promise<{ ok?: boolean; records?: Record<string, unknown>[] }>,
      ])
      setTableMissing(Boolean(p?.tableMissing || d?.tableMissing))
      setPunches(p?.records ?? []); setDevices(d?.records ?? []); setGeofences(g?.records ?? [])
      const map: Record<string, Emp> = {}
      for (const r of (e?.records ?? [])) { const em = toEmp(r); if (em.id) map[em.id] = em }
      setEmpMap(map)
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setLoading(false) }
  }
  useEffect(() => { if (view === "admin") reload() }, [view]) // eslint-disable-line react-hooks/exhaustive-deps

  const sucursales = useMemo(() => Array.from(new Set([...geofences.map(g => g.sucursal), ...Object.values(empMap).map(e => e.sucursal)].filter(Boolean))).sort(), [geofences, empMap])
  const deviceName = (id?: string | null) => id ? (devices.find(d => d.id === id)?.device_name || "Dispositivo") : "—"
  const filtered = useMemo(() => {
    if (!search) return punches
    const q = search.toLowerCase()
    return punches.filter(p => `${p.employee_id} ${empMap[p.employee_id]?.nombre || ""} ${p.sucursal || ""}`.toLowerCase().includes(q))
  }, [punches, search, empMap])

  const cards = useMemo(() => {
    const today = punches.filter(p => isToday(p.punched_at))
    return {
      hoy: today.length,
      entradas: today.filter(p => p.type === "entrada" && p.status !== "rejected").length,
      salidas: today.filter(p => p.type === "salida" && p.status !== "rejected").length,
      rechazados: today.filter(p => p.status === "rejected").length,
      devices: devices.filter(d => d.active).length,
    }
  }, [punches, devices])

  // ── Acciones admin ─────────────────────────────────────────────────────
  const saveCorrection = async () => {
    if (!correction?.employee_id?.trim() || !correction.type) { showToast("Empleado y tipo obligatorios", "error"); return }
    if (!correction.correction_reason?.trim()) { showToast("El motivo de la corrección es obligatorio", "error"); return }
    setSaving(true)
    try {
      const payload: Record<string, string | boolean> = {
        employee_id: correction.employee_id.trim(), type: correction.type, is_correction: true,
        correction_reason: correction.correction_reason.trim(), source: "manual", status: "approved",
      }
      if (correction.punched_at) payload.punched_at = new Date(correction.punched_at).toISOString()
      if (correction.sucursal) payload.sucursal = correction.sucursal
      const res = await call({ action: "saveHrPunch", data: JSON.stringify(payload) }) as { ok?: boolean; error?: string }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo guardar"}`, "error"); return }
      showToast("Marca registrada", "success"); setCorrection(null); reload()
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setSaving(false) }
  }
  const saveGeofence = async () => {
    if (!geoEdit?.sucursal) { showToast("Sucursal obligatoria", "error"); return }
    setSaving(true)
    try {
      const res = await call({ action: "saveHrBranchGeofence", data: JSON.stringify({ sucursal: geoEdit.sucursal, latitude: geoEdit.latitude || 0, longitude: geoEdit.longitude || 0, radius_meters: geoEdit.radius_meters || 80, active: geoEdit.active !== false }) }) as { ok?: boolean; error?: string; tableMissing?: boolean }
      if (res?.tableMissing) { showToast("Falta aplicar la migración del ponche QR en db-cls", "error"); return }
      if (!res?.ok) { showToast(`Error: ${res?.error}`, "error"); return }
      showToast("Geocerca guardada", "success"); setGeoEdit(null); reload()
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setSaving(false) }
  }
  const useMyLocation = () => {
    if (!navigator.geolocation) { showToast("Geolocalización no disponible", "error"); return }
    navigator.geolocation.getCurrentPosition(
      pos => setGeoEdit(prev => prev ? { ...prev, latitude: Math.round(pos.coords.latitude * 1e7) / 1e7, longitude: Math.round(pos.coords.longitude * 1e7) / 1e7 } : prev),
      () => showToast("No se pudo obtener la ubicación", "error"), { enableHighAccuracy: true, timeout: 10000 })
  }
  const authorizeDevice = async () => {
    if (!authDev) return
    setSaving(true)
    try {
      const res = await call({ action: "authorizeHrPunchDevice", data: JSON.stringify({ device_name: authDev.device_name || "Kiosco de ponche", sucursal: authDev.sucursal || "", device_info: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : "" }) }) as { ok?: boolean; device_token?: string; error?: string; tableMissing?: boolean }
      if (res?.tableMissing) { showToast("Falta aplicar la migración del ponche QR en db-cls", "error"); return }
      if (!res?.ok || !res.device_token) { showToast(`Error: ${res?.error || "no se pudo autorizar"}`, "error"); return }
      localStorage.setItem(DEVICE_TOKEN_KEY, res.device_token)
      showToast("Dispositivo autorizado en este navegador", "success"); setAuthDev(null); reload()
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setSaving(false) }
  }
  const toggleDevice = async (d: Device) => {
    setBusyId(d.id)
    try { await call({ action: "setHrPunchDeviceActive", id: d.id, active: !d.active }); reload() }
    catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setBusyId(null) }
  }

  const exportExcel = () => {
    const headers = ["No.", "Empleado", "Cédula", "Sucursal", "Fecha", "Hora", "Tipo", "Dispositivo", "Latitud", "Longitud", "Distancia (m)", "Estado", "Motivo rechazo"]
    const rows = filtered.map((p, i) => {
      const e = empMap[p.employee_id]; const d = new Date(p.punched_at)
      return [
        i + 1, p.employee_nombre || e?.nombre || p.employee_id, pick(e?.cedula), p.sucursal || "",
        p.punched_at ? d.toLocaleDateString("es-DO") : "", p.punched_at ? d.toLocaleTimeString("es-DO") : "",
        TYPE_LABEL[p.type] || p.type, deviceName(p.device_id),
        p.latitude ?? "", p.longitude ?? "", p.distance_meters ?? "",
        p.status === "rejected" ? "Rechazado" : "Aprobado", p.rejection_reason || "",
      ]
    })
    exportHrReportExcel(business, { title: "Reporte de Ponches (Reloj checador)", headers, rows, filtros: search ? `Búsqueda: ${search}` : "", filename: `Ponches_${new Date().toISOString().slice(0, 10)}.xls` })
    showToast(`Excel generado (${rows.length} fila(s))`, "success")
  }

  if (view === "kiosk") return <KioskView onExit={() => setView("admin")} apiUrl={apiUrl} />

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Fingerprint className="h-6 w-6" /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">RR.HH. · Asistencia · {business.shortName}</p>
            <h2 className="mt-0.5 text-xl font-black tracking-tight">Ponche / Reloj checador (QR + geocerca)</h2>
            <p className="mt-1 text-sm text-muted-foreground">El empleado marca con su QR desde un dispositivo autorizado y dentro del radio de la sucursal.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button onClick={() => setView("kiosk")}><Monitor className="w-4 h-4 mr-1" />Abrir kiosco</Button>
          <Button variant="outline" onClick={() => setAuthDev({ device_name: "Kiosco de ponche", sucursal: sucursales[0] || "" })}><Smartphone className="w-4 h-4 mr-1" />Autorizar dispositivo</Button>
          <Button variant="outline" onClick={() => setGeoEdit({ sucursal: sucursales[0] || "", latitude: 0, longitude: 0, radius_meters: 80, active: true })}><MapPin className="w-4 h-4 mr-1" />Configurar geocerca</Button>
          <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 mr-1" />Exportar Excel</Button>
        </div>
      </div>

      {tableMissing && !loading && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" /><div>Faltan tablas del ponche QR. Aplica la migración <code className="text-xs bg-amber-100 px-1 rounded">202606050003_hr_ponche_qr_geo.sql</code> en db-cls.</div>
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-primary">{cards.hoy}</div><div className="text-xs text-muted-foreground uppercase mt-1">Ponches hoy</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-emerald-600">{cards.entradas}</div><div className="text-xs text-muted-foreground uppercase mt-1">Entradas</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-blue-600">{cards.salidas}</div><div className="text-xs text-muted-foreground uppercase mt-1">Salidas</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-red-600">{cards.rechazados}</div><div className="text-xs text-muted-foreground uppercase mt-1">Rechazados</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-indigo-600">{cards.devices}</div><div className="text-xs text-muted-foreground uppercase mt-1">Dispositivos</div></CardContent></Card>
      </div>

      {/* Dispositivos + geocercas */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card><CardContent className="py-3">
          <div className="flex items-center justify-between mb-2"><h3 className="text-sm font-bold">Dispositivos autorizados</h3><Smartphone className="w-4 h-4 text-muted-foreground" /></div>
          {devices.length === 0 ? <p className="text-xs text-muted-foreground py-2">Sin dispositivos. Usa “Autorizar dispositivo” en el equipo del kiosco.</p> : (
            <div className="space-y-1">{devices.map(d => (
              <div key={d.id} className="flex items-center justify-between text-xs border rounded px-2 py-1.5">
                <div><span className="font-medium">{d.device_name}</span> · {d.sucursal || "—"}<div className="text-muted-foreground">Últ.: {d.last_seen_at ? fmtDateTime(d.last_seen_at) : "—"}</div></div>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className={d.active ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-gray-100 text-gray-500"}>{d.active ? "Activo" : "Inactivo"}</Badge>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleDevice(d)} disabled={busyId === d.id} title={d.active ? "Desactivar" : "Activar"}><Power className="h-3.5 w-3.5" /></Button>
                </div>
              </div>))}</div>
          )}
        </CardContent></Card>
        <Card><CardContent className="py-3">
          <div className="flex items-center justify-between mb-2"><h3 className="text-sm font-bold">Geocercas por sucursal</h3><MapPin className="w-4 h-4 text-muted-foreground" /></div>
          {geofences.length === 0 ? <p className="text-xs text-muted-foreground py-2">Sin geocercas. Usa “Configurar geocerca”.</p> : (
            <div className="space-y-1">{geofences.map(g => (
              <div key={g.id} className="flex items-center justify-between text-xs border rounded px-2 py-1.5">
                <div><span className="font-medium">{g.sucursal}</span><div className="text-muted-foreground">{Number(g.latitude) || Number(g.longitude) ? `${g.latitude}, ${g.longitude}` : "Sin coordenadas"} · {g.radius_meters} m</div></div>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className={g.active && (Number(g.latitude) || Number(g.longitude)) ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-amber-100 text-amber-700 border-amber-200"}>{Number(g.latitude) || Number(g.longitude) ? (g.active ? "Activa" : "Inactiva") : "Pendiente"}</Badge>
                  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setGeoEdit(g)}>Editar</Button>
                </div>
              </div>))}</div>
          )}
        </CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-3">
          <Input placeholder="Buscar por empleado o sucursal…" value={search} onChange={e => setSearch(e.target.value)} className="h-8 max-w-sm mb-2" />
          <div className="overflow-x-auto">
          {loading ? <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Cargando...</div>
          : filtered.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">Sin ponches.</div> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Empleado</TableHead><TableHead className="text-xs">Sucursal</TableHead><TableHead className="text-xs">Tipo</TableHead>
                <TableHead className="text-xs">Hora</TableHead><TableHead className="text-xs">Dispositivo</TableHead><TableHead className="text-xs">Ubicación</TableHead>
                <TableHead className="text-xs text-right">Dist.</TableHead><TableHead className="text-xs">Estado</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.slice(0, 300).map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm font-medium">{p.employee_nombre || empMap[p.employee_id]?.nombre || p.employee_id}</TableCell>
                    <TableCell className="text-xs">{p.sucursal || "—"}</TableCell>
                    <TableCell><Badge variant="outline" className={TYPE_CLASS[p.type] || ""}>{TYPE_LABEL[p.type] || p.type}</Badge></TableCell>
                    <TableCell className="text-xs">{fmtDateTime(p.punched_at)}</TableCell>
                    <TableCell className="text-xs">{deviceName(p.device_id)}{p.source === "manual" ? " (manual)" : ""}</TableCell>
                    <TableCell className="text-xs">{p.latitude != null && p.longitude != null ? `${Number(p.latitude).toFixed(5)}, ${Number(p.longitude).toFixed(5)}` : "—"}</TableCell>
                    <TableCell className="text-xs text-right">{p.distance_meters != null ? `${Math.round(Number(p.distance_meters))} m` : "—"}</TableCell>
                    <TableCell>{p.status === "rejected"
                      ? <Badge variant="outline" className="bg-red-100 text-red-700 border-red-200" title={p.rejection_reason || ""}>Rechazado</Badge>
                      : <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200">Aprobado</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          </div>
          <div className="mt-2"><Button variant="outline" size="sm" onClick={() => setCorrection({ type: "entrada", punched_at: new Date().toISOString().slice(0, 16) })}><Plus className="w-4 h-4 mr-1" />Marca manual (corrección)</Button></div>
        </CardContent>
      </Card>

      {/* Dialog corrección manual */}
      <Dialog open={!!correction} onOpenChange={o => !o && setCorrection(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Marca manual (corrección)</DialogTitle></DialogHeader>
          {correction && (
            <div className="space-y-3 py-2">
              <div className="space-y-1"><Label className="text-xs">Empleado *</Label><EmployeeSelect value={correction.employee_id} onSelect={emp => setCorrection({ ...correction, employee_id: emp?.empleado_id || "", employee_nombre: emp?.nombre || "", sucursal: emp?.sucursal || correction.sucursal })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Tipo *</Label>
                  <Select value={correction.type || "entrada"} onValueChange={v => setCorrection({ ...correction, type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>)}</SelectContent>
                  </Select></div>
                <div className="space-y-1"><Label className="text-xs">Fecha / hora</Label><Input type="datetime-local" value={correction.punched_at?.slice(0, 16) || ""} onChange={e => setCorrection({ ...correction, punched_at: e.target.value })} /></div>
              </div>
              <div className="space-y-1"><Label className="text-xs">Sucursal</Label><Input value={correction.sucursal || ""} onChange={e => setCorrection({ ...correction, sucursal: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Motivo de la corrección *</Label><Input value={correction.correction_reason || ""} onChange={e => setCorrection({ ...correction, correction_reason: e.target.value })} placeholder="Olvidó ponchar la entrada" /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrection(null)} disabled={saving}><X className="w-4 h-4 mr-1" />Cancelar</Button>
            <Button onClick={saveCorrection} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog geocerca */}
      <Dialog open={!!geoEdit} onOpenChange={o => !o && setGeoEdit(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Configurar geocerca</DialogTitle></DialogHeader>
          {geoEdit && (
            <div className="space-y-3 py-2">
              <div className="space-y-1"><Label className="text-xs">Sucursal *</Label>
                <Input list="sucursales-geo" value={geoEdit.sucursal || ""} onChange={e => setGeoEdit({ ...geoEdit, sucursal: e.target.value })} placeholder="RAFAEL VIDAL" />
                <datalist id="sucursales-geo">{sucursales.map(s => <option key={s} value={s} />)}</datalist>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Latitud</Label><Input type="number" step="0.0000001" value={geoEdit.latitude ?? 0} onChange={e => setGeoEdit({ ...geoEdit, latitude: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Longitud</Label><Input type="number" step="0.0000001" value={geoEdit.longitude ?? 0} onChange={e => setGeoEdit({ ...geoEdit, longitude: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Radio (metros)</Label><Input type="number" step="1" value={geoEdit.radius_meters ?? 80} onChange={e => setGeoEdit({ ...geoEdit, radius_meters: Number(e.target.value) })} /></div>
                <div className="space-y-1 flex items-end"><Button type="button" variant="outline" size="sm" className="w-full" onClick={useMyLocation}><LocateFixed className="w-4 h-4 mr-1" />Usar mi ubicación</Button></div>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={geoEdit.active !== false} onChange={e => setGeoEdit({ ...geoEdit, active: e.target.checked })} />Geocerca activa (valida ubicación al ponchar)</label>
              <p className="text-[11px] text-muted-foreground">Abre Google Maps en la sucursal, copia lat/long, o usa “Usar mi ubicación” estando físicamente allí.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setGeoEdit(null)} disabled={saving}><X className="w-4 h-4 mr-1" />Cancelar</Button>
            <Button onClick={saveGeofence} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog autorizar dispositivo */}
      <Dialog open={!!authDev} onOpenChange={o => !o && setAuthDev(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Autorizar este dispositivo</DialogTitle></DialogHeader>
          {authDev && (
            <div className="space-y-3 py-2">
              <p className="text-xs text-muted-foreground">Autoriza el equipo (tablet/celular) que quedará fijo en la sucursal como kiosco. El permiso se guarda en este navegador.</p>
              <div className="space-y-1"><Label className="text-xs">Nombre del dispositivo</Label><Input value={authDev.device_name} onChange={e => setAuthDev({ ...authDev, device_name: e.target.value })} placeholder="Tablet recepción" /></div>
              <div className="space-y-1"><Label className="text-xs">Sucursal</Label>
                <Input list="sucursales-dev" value={authDev.sucursal} onChange={e => setAuthDev({ ...authDev, sucursal: e.target.value })} placeholder="RAFAEL VIDAL" />
                <datalist id="sucursales-dev">{sucursales.map(s => <option key={s} value={s} />)}</datalist>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAuthDev(null)} disabled={saving}><X className="w-4 h-4 mr-1" />Cancelar</Button>
            <Button onClick={authorizeDevice} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Smartphone className="w-4 h-4 mr-1" />}Autorizar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Kiosco de ponche ──────────────────────────────────────────────────────
type DetectedBarcode = { rawValue: string }
type BarcodeDetectorLike = { detect: (src: CanvasImageSource) => Promise<DetectedBarcode[]> }

function KioskView({ onExit, apiUrl }: { onExit: () => void; apiUrl: string }) {
  const { showToast } = useAppStore()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanningRef = useRef(false)
  const [scanned, setScanned] = useState<{ token: string; nombre: string } | null>(null)
  const [manualToken, setManualToken] = useState("")
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [geoError, setGeoError] = useState("")
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; title: string; sub: string } | null>(null)
  const [camError, setCamError] = useState("")
  const [now, setNow] = useState(() => new Date())

  const call = (params: Record<string, string | number | boolean>) => apiCall(normalizeApiUrl(apiUrl), params)
  const deviceToken = typeof window !== "undefined" ? (localStorage.getItem(DEVICE_TOKEN_KEY) || "") : ""

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])

  // Geolocalización (watch).
  useEffect(() => {
    if (!navigator.geolocation) { setGeoError("Este dispositivo no soporta geolocalización"); return }
    const id = navigator.geolocation.watchPosition(
      pos => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGeoError("") },
      () => setGeoError("Activa el GPS y otorga permiso de ubicación"),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 })
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  // Cámara + escaneo QR con BarcodeDetector.
  useEffect(() => {
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector
    if (!BD) { setCamError("Este navegador no soporta escaneo de QR con cámara. Usa la entrada manual del código."); return }
    let detector: BarcodeDetectorLike
    try { detector = new BD({ formats: ["qr_code"] }) } catch { setCamError("No se pudo iniciar el lector de QR"); return }
    let cancelled = false
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play() }
        scanningRef.current = true
        const tick = async () => {
          if (cancelled) return
          if (scanningRef.current && videoRef.current) {
            try {
              const codes = await detector.detect(videoRef.current)
              if (codes && codes[0]?.rawValue) onQrFound(codes[0].rawValue)
            } catch { /* frame sin código */ }
          }
          setTimeout(tick, 400)
        }
        tick()
      } catch { setCamError("No se pudo acceder a la cámara. Otorga permiso o usa la entrada manual.") }
    })()
    return () => { cancelled = true; scanningRef.current = false; streamRef.current?.getTracks().forEach(t => t.stop()) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onQrFound = async (raw: string) => {
    if (busy || scanned) return
    scanningRef.current = false
    setBusy(true)
    try {
      const res = await call({ action: "resolveHrQr", qr_token: raw }) as { ok?: boolean; employee_nombre?: string; error?: string }
      if (!res?.ok) { setResult({ ok: false, title: "QR no válido", sub: res?.error || "Token no reconocido" }); resetSoon(); return }
      setScanned({ token: raw, nombre: res.employee_nombre || "Empleado" })
    } catch (e) { setResult({ ok: false, title: "Error", sub: e instanceof Error ? e.message : "—" }); resetSoon() }
    finally { setBusy(false) }
  }

  const punch = async (type: string) => {
    if (!scanned) return
    setBusy(true)
    try {
      const res = await call({
        action: "punchByQr", qr_token: scanned.token, device_token: deviceToken, punch_type: type,
        latitude: coords?.lat ?? "", longitude: coords?.lng ?? "",
        device_info: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : "",
      }) as { ok?: boolean; status?: string; reason?: string; employee_nombre?: string; type?: string; distance_meters?: number | null }
      if (res?.status === "approved") setResult({ ok: true, title: `${TYPE_LABEL[type]} registrada`, sub: `${res.employee_nombre || scanned.nombre}${res.distance_meters != null ? ` · ${Math.round(res.distance_meters)} m` : ""}` })
      else setResult({ ok: false, title: rejectTitle(res?.reason), sub: res?.reason || "Marca rechazada" })
    } catch (e) { setResult({ ok: false, title: "Error", sub: e instanceof Error ? e.message : "—" }) }
    finally { setBusy(false); resetSoon() }
  }
  const rejectTitle = (reason?: string) => {
    const r = (reason || "").toLowerCase()
    if (r.includes("ubicaci") || r.includes("fuera")) return "Fuera de ubicación"
    if (r.includes("dispositivo")) return "Dispositivo no autorizado"
    if (r.includes("qr")) return "QR inválido"
    return "Marca rechazada"
  }
  const resetSoon = () => setTimeout(() => { setScanned(null); setResult(null); setManualToken(""); scanningRef.current = true }, 3500)

  const fmtClock = now.toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit", second: "2-digit" })

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 text-white flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-white/10">
        <button onClick={onExit} className="flex items-center gap-1 text-sm text-white/70 hover:text-white"><ArrowLeft className="w-4 h-4" />Salir del kiosco</button>
        <div className="text-2xl font-black tabular-nums">{fmtClock}</div>
        <div className="text-xs text-white/60 flex items-center gap-2">
          <span className={deviceToken ? "text-emerald-400" : "text-red-400"}>{deviceToken ? "Dispositivo autorizado" : "Dispositivo NO autorizado"}</span>
          <span>·</span>
          <span className={coords ? "text-emerald-400" : "text-amber-400"}>{coords ? "GPS OK" : "GPS…"}</span>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        {result ? (
          <div className="text-center">
            {result.ok ? <CheckCircle2 className="w-24 h-24 mx-auto text-emerald-400" /> : <XCircle className="w-24 h-24 mx-auto text-red-400" />}
            <div className="mt-4 text-4xl font-black">{result.title}</div>
            <div className="mt-2 text-lg text-white/70">{result.sub}</div>
          </div>
        ) : scanned ? (
          <div className="text-center w-full max-w-md">
            <p className="text-white/60">Empleado</p>
            <div className="text-3xl font-black mb-6">{scanned.nombre}</div>
            <div className="grid grid-cols-2 gap-3">
              {TYPES.map(t => (
                <button key={t} disabled={busy} onClick={() => punch(t)}
                  className="rounded-2xl py-6 text-lg font-bold bg-white/10 hover:bg-white/20 disabled:opacity-50 border border-white/15">
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
            <button onClick={() => { setScanned(null); scanningRef.current = true }} className="mt-5 text-sm text-white/50 hover:text-white">Cancelar</button>
          </div>
        ) : (
          <div className="text-center w-full max-w-md">
            <div className="relative mx-auto w-72 h-72 rounded-2xl overflow-hidden border-2 border-white/20 bg-black">
              <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><ScanLine className="w-40 h-40 text-emerald-400/40" /></div>
            </div>
            <p className="mt-4 text-white/70">Muestra tu QR a la cámara para ponchar</p>
            {geoError && <p className="mt-1 text-amber-400 text-sm">{geoError}</p>}
            {camError && (
              <div className="mt-4">
                <p className="text-amber-400 text-sm mb-2">{camError}</p>
                <div className="flex gap-2 justify-center">
                  <input value={manualToken} onChange={e => setManualToken(e.target.value)} placeholder="Pegar código del QR" className="rounded-lg px-3 py-2 text-sm text-slate-900 w-56" />
                  <button onClick={() => manualToken.trim() && onQrFound(manualToken.trim())} disabled={busy} className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium disabled:opacity-50">Validar</button>
                </div>
              </div>
            )}
            {!deviceToken && <p className="mt-3 text-red-400 text-sm">Este navegador no está autorizado. Pídele al admin “Autorizar dispositivo”.</p>}
            {busy && <Loader2 className="w-6 h-6 animate-spin mx-auto mt-4" />}
          </div>
        )}
      </div>
    </div>
  )
}

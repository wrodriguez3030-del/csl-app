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
import { Fingerprint, Plus, Trash2, Save, X, Loader2, Monitor, ArrowLeft, AlertCircle, MapPin, Smartphone, ScanLine, FileSpreadsheet, CheckCircle2, XCircle, LocateFixed, Power, QrCode, Users, RefreshCw, Search, Link as LinkIcon, Copy } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { exportHrReportExcel } from "@/lib/hr-report-excel"
import { haversineMeters } from "@/lib/hr-geo"
import QRCode from "qrcode"
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser"
import { composeQrPng, downloadDataUrl } from "@/lib/qr-compose"

interface HrPunch {
  id: string; employee_id: string; employee_nombre?: string | null; type: string; punched_at: string
  sucursal: string | null; source: string; is_correction: boolean; correction_reason: string | null
  latitude?: number | null; longitude?: number | null; distance_meters?: number | null
  device_id?: string | null; status?: string; rejection_reason?: string | null
}
interface Device { id: string; sucursal: string | null; device_name: string; active: boolean; last_seen_at: string | null; device_info: string | null }
interface Geofence { id: string; sucursal: string; latitude: number; longitude: number; radius_meters: number; active: boolean; google_maps_url?: string; direccion?: string; timezone?: string; telefono?: string; email?: string; business_id?: string }
/** Extrae lat/lng de un link de Google Maps (@lat,lng / q=lat,lng / !3d!4d). */
function parseLatLng(url: string): { lat: number; lng: number } | null {
  const pats = [/@(-?\d+\.\d+),(-?\d+\.\d+)/, /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/, /[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/, /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /(-?\d{1,2}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})/]
  for (const re of pats) { const m = url.match(re); if (m) return { lat: Number(m[1]), lng: Number(m[2]) } }
  return null
}
interface Emp { id: string; nombre: string; cedula: string; sucursal: string; puesto: string }

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
    puesto: pick(r.PuestoSolicitado, r.puesto_solicitado, r.Puesto, r.puesto),
  }
}

interface BranchOption { business_id: string; business_name: string; sucursal: string }

export function RrhhPonchePage() {
  const { apiUrl, showToast } = useAppStore()
  const activeBusinessSlug = useAppStore(s => s.activeBusinessSlug)
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
  const [authDev, setAuthDev] = useState<{ device_name: string; sucursal: string; business_id: string; descripcion?: string } | null>(null)
  const [activationLink, setActivationLink] = useState<{ url: string; device_name: string; sucursal: string; regenerated?: boolean } | null>(null)
  const [branchOptions, setBranchOptions] = useState<BranchOption[]>([])
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [empSearch, setEmpSearch] = useState("")
  const [syncing, setSyncing] = useState(false)
  const [qrEmp, setQrEmp] = useState<Emp | null>(null)
  const [qrUrl, setQrUrl] = useState("")
  const [qrToken, setQrToken] = useState("")
  const [qrBusy, setQrBusy] = useState(false)
  const qrLink = (token: string) => `${typeof window !== "undefined" ? window.location.origin : ""}/qr/${encodeURIComponent(token)}`
  const shareWhatsapp = () => {
    if (!qrToken || !qrEmp) return
    const msg = `Hola ${qrEmp.nombre} 👋\n\nEste es tu QR personal para el ponche de asistencia.\n\nDebes presentarlo en el kiosco autorizado de tu sucursal para registrar entrada y salida.\n\nImportante:\nEste QR solo funciona dentro de la geocerca de la sucursal y desde un dispositivo autorizado.\n\n${qrLink(qrToken)}`
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank")
  }
  const copyLink = async () => {
    if (!qrToken) return
    try { await navigator.clipboard.writeText(qrLink(qrToken)); showToast("Link del QR copiado", "success") } catch { showToast(qrLink(qrToken), "info") }
  }

  const reload = async () => {
    setLoading(true)
    try {
      const [p, d, g, e, bo] = await Promise.all([
        call({ action: "getHrPunches" }) as Promise<{ ok?: boolean; records?: HrPunch[]; tableMissing?: boolean }>,
        call({ action: "getHrPunchDevices" }) as Promise<{ ok?: boolean; records?: Device[]; tableMissing?: boolean }>,
        call({ action: "getHrBranchGeofences" }) as Promise<{ ok?: boolean; records?: Geofence[] }>,
        call({ action: "getEmpleados" }) as Promise<{ ok?: boolean; records?: Record<string, unknown>[] }>,
        call({ action: "getBranchOptions" }) as Promise<{ ok?: boolean; options?: BranchOption[] }>,
      ])
      setTableMissing(Boolean(p?.tableMissing || d?.tableMissing))
      setPunches(p?.records ?? []); setDevices(d?.records ?? []); setGeofences(g?.records ?? [])
      setBranchOptions(bo?.options ?? [])
      const map: Record<string, Emp> = {}
      for (const r of (e?.records ?? [])) { const em = toEmp(r); if (em.id) map[em.id] = em }
      setEmpMap(map)
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setLoading(false) }
  }
  // Recargar al entrar a admin y al CAMBIAR el negocio activo (limpia el cache del modal).
  useEffect(() => { if (view === "admin") reload() }, [view, activeBusinessSlug]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sucursales REALES por negocio activo (csl_sucursales vía getBranchOptions).
  const sucursales = useMemo(() => {
    const fromBranches = branchOptions.map(o => o.sucursal).filter(Boolean)
    if (fromBranches.length) return Array.from(new Set(fromBranches)).sort()
    return Array.from(new Set([...geofences.map(g => g.sucursal), ...Object.values(empMap).map(e => e.sucursal)].filter(Boolean))).sort()
  }, [branchOptions, geofences, empMap])
  const multiBiz = useMemo(() => new Set(branchOptions.map(o => o.business_name)).size > 1, [branchOptions])
  const bizGroups = useMemo(() => {
    const m = new Map<string, BranchOption[]>()
    for (const o of branchOptions) { const k = o.business_name || "—"; if (!m.has(k)) m.set(k, []); m.get(k)!.push(o) }
    return Array.from(m.entries())
  }, [branchOptions])
  const deviceName = (id?: string | null) => id ? (devices.find(d => d.id === id)?.device_name || "Dispositivo") : "—"
  const filtered = useMemo(() => {
    if (!search) return punches
    const q = search.toLowerCase()
    return punches.filter(p => { const e = empMap[p.employee_id]; return `${p.employee_id} ${e?.nombre || ""} ${e?.cedula || ""} ${e?.puesto || ""} ${p.sucursal || e?.sucursal || ""}`.toLowerCase().includes(q) })
  }, [punches, search, empMap])

  // Directorio de empleados reales (tenant-scoped) para el módulo de ponche.
  const empList = useMemo(() => Object.values(empMap).sort((a, b) => a.nombre.localeCompare(b.nombre)), [empMap])
  const filteredEmps = useMemo(() => {
    if (!empSearch.trim()) return empList
    const q = empSearch.toLowerCase()
    return empList.filter(e => `${e.nombre} ${e.cedula} ${e.sucursal} ${e.puesto}`.toLowerCase().includes(q))
  }, [empList, empSearch])

  const openQr = async (emp: Emp, regenerate = false) => {
    setQrEmp(emp); setQrBusy(true); if (!regenerate) setQrUrl("")
    try {
      const params: Record<string, string> = { action: "getHrEmployeeQr", employee_id: emp.id }
      if (regenerate) params.regenerate = "true"
      const res = await call(params) as { ok?: boolean; token?: string | null; tableMissing?: boolean; error?: string }
      if (res?.tableMissing) { showToast("Falta aplicar la migración del ponche QR en db-cls", "error"); return }
      if (!res?.ok || !res.token) { showToast(res?.error || "No se pudo generar el QR", "error"); return }
      setQrToken(res.token)
      setQrUrl(await QRCode.toDataURL(res.token, { width: 320, margin: 1 }))
      if (regenerate) showToast("QR regenerado. El anterior quedó inválido.", "success")
    } catch (e) { showToast(e instanceof Error ? e.message : "Error generando QR", "error") } finally { setQrBusy(false) }
  }
  const downloadQr = async () => {
    if (!qrUrl || !qrEmp) return
    const sub = [qrEmp.cedula, qrEmp.puesto].filter(Boolean).join(" · ")
    try { downloadDataUrl(await composeQrPng(qrUrl, qrEmp.nombre, sub), `QR_${qrEmp.nombre}.png`) }
    catch { downloadDataUrl(qrUrl, `QR_${qrEmp.nombre}.png`) }
  }
  const syncEmpleados = async () => {
    setSyncing(true)
    try {
      const res = await call({ action: "syncApprovedEmpleados" }) as { ok?: boolean; creados?: number; actualizados?: number; aprobadas?: number; error?: string }
      if (!res?.ok) { showToast(res?.error || "No se pudo sincronizar", "error"); return }
      showToast(`Sincronizado: ${res.creados ?? 0} creados, ${res.actualizados ?? 0} actualizados (de ${res.aprobadas ?? 0} aprobadas)`, "success")
      reload()
    } catch (e) { showToast(e instanceof Error ? e.message : "Error al sincronizar", "error") } finally { setSyncing(false) }
  }

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
      const res = await call({ action: "saveHrBranchGeofence", data: JSON.stringify({ sucursal: geoEdit.sucursal, business_id: geoEdit.business_id || "", latitude: geoEdit.latitude || 0, longitude: geoEdit.longitude || 0, radius_meters: geoEdit.radius_meters || 80, active: geoEdit.active !== false, google_maps_url: geoEdit.google_maps_url || "", direccion: geoEdit.direccion || "", timezone: geoEdit.timezone || "America/Santo_Domingo", telefono: geoEdit.telefono || "", email: geoEdit.email || "" }) }) as { ok?: boolean; error?: string; tableMissing?: boolean }
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
  const aplicarMapsUrl = () => {
    const c = parseLatLng(geoEdit?.google_maps_url || "")
    if (!c) { showToast("No pude extraer lat/lng del link. Pega un enlace con coordenadas o usa 'Usar mi ubicación'.", "error"); return }
    setGeoEdit(prev => prev ? { ...prev, latitude: c.lat, longitude: c.lng } : prev)
    showToast(`Coordenadas extraídas: ${c.lat}, ${c.lng}`, "success")
  }
  const probarGeocerca = () => {
    if (!geoEdit || (!geoEdit.latitude && !geoEdit.longitude)) { showToast("Configura lat/lng primero", "error"); return }
    if (!navigator.geolocation) { showToast("Geolocalización no disponible", "error"); return }
    navigator.geolocation.getCurrentPosition(
      pos => { const d = haversineMeters(pos.coords.latitude, pos.coords.longitude, Number(geoEdit.latitude), Number(geoEdit.longitude)); const r = Number(geoEdit.radius_meters || 80); showToast(`Estás a ${Math.round(d)} m del centro → ${d <= r ? "DENTRO ✓" : "FUERA ✗"} del radio (${r} m)`, d <= r ? "success" : "error") },
      () => showToast("No se pudo obtener tu ubicación", "error"), { enableHighAccuracy: true, timeout: 10000 })
  }
  const buildActivationUrl = (token: string) => `${typeof window !== "undefined" ? window.location.origin : ""}/hr/ponche/kiosko/activar?device_token=${encodeURIComponent(token)}`

  // Crea el dispositivo en hr_punch_devices. Si alsoThisBrowser=true autoriza el
  // navegador actual (flujo rápido); si no, genera un LINK de activación para
  // abrir en la tablet del kiosco.
  const createDevice = async (alsoThisBrowser: boolean) => {
    if (!authDev) return
    if (!authDev.sucursal) { showToast("Selecciona la sucursal del kiosco", "error"); return }
    setSaving(true)
    try {
      const res = await call({ action: "authorizeHrPunchDevice", data: JSON.stringify({ device_name: authDev.device_name || "Kiosco de ponche", sucursal: authDev.sucursal || "", business_id: authDev.business_id || "", device_info: authDev.descripcion || "" }) }) as { ok?: boolean; device_token?: string; error?: string; tableMissing?: boolean }
      if (res?.tableMissing) { showToast("Falta aplicar la migración del ponche QR en db-cls", "error"); return }
      if (!res?.ok || !res.device_token) { showToast(`Error: ${res?.error || "no se pudo autorizar"}`, "error"); return }
      const dev = { device_name: authDev.device_name || "Kiosco de ponche", sucursal: authDev.sucursal }
      setAuthDev(null); reload()
      if (alsoThisBrowser) { localStorage.setItem(DEVICE_TOKEN_KEY, res.device_token); showToast("Dispositivo autorizado en este navegador", "success") }
      else setActivationLink({ url: buildActivationUrl(res.device_token), device_name: dev.device_name, sucursal: dev.sucursal })
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setSaving(false) }
  }
  const regenerateDevice = async (d: Device) => {
    setBusyId(d.id)
    try {
      const res = await call({ action: "regenerateHrPunchDeviceToken", id: d.id }) as { ok?: boolean; device_token?: string; error?: string; tableMissing?: boolean }
      if (!res?.ok || !res.device_token) { showToast(`Error: ${res?.error || "no se pudo regenerar"}`, "error"); return }
      setActivationLink({ url: buildActivationUrl(res.device_token), device_name: d.device_name, sucursal: d.sucursal || "", regenerated: true })
      reload()
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setBusyId(null) }
  }
  const copyActivation = async () => { if (activationLink) { try { await navigator.clipboard.writeText(activationLink.url); showToast("Link copiado", "success") } catch { showToast("No se pudo copiar", "error") } } }
  const waActivation = () => { if (activationLink && typeof window !== "undefined") window.open(`https://wa.me/?text=${encodeURIComponent(`Activa el kiosco de ponche "${activationLink.device_name}" (${activationLink.sucursal}). Abre este link en la tablet del kiosco: ${activationLink.url}`)}`, "_blank") }
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

  if (view === "kiosk") return <KioskView onExit={() => setView("admin")} showExit />

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
          <Button variant="outline" onClick={() => setAuthDev({ device_name: "Kiosco de ponche", sucursal: "", business_id: "" })}><Smartphone className="w-4 h-4 mr-1" />Nuevo dispositivo</Button>
          <Button variant="outline" onClick={() => setGeoEdit({ sucursal: "", latitude: 0, longitude: 0, radius_meters: 80, active: true })}><MapPin className="w-4 h-4 mr-1" />Configurar geocerca</Button>
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
          {devices.length === 0 ? <p className="text-xs text-muted-foreground py-2">Sin dispositivos. Usa “Nuevo dispositivo” para crear uno y enviar el link de activación a la tablet.</p> : (
            <div className="space-y-1">{devices.map(d => (
              <div key={d.id} className="flex items-center justify-between text-xs border rounded px-2 py-1.5">
                <div><span className="font-medium">{d.device_name}</span> · {d.sucursal || "—"}<div className="text-muted-foreground">Últ.: {d.last_seen_at ? fmtDateTime(d.last_seen_at) : "—"}</div></div>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className={d.active ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-gray-100 text-gray-500"}>{d.active ? "Activo" : "Inactivo"}</Badge>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => regenerateDevice(d)} disabled={busyId === d.id} title="Generar link de activación (regenera token)"><LinkIcon className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleDevice(d)} disabled={busyId === d.id} title={d.active ? "Desactivar" : "Activar"}><Power className="h-3.5 w-3.5" /></Button>
                </div>
              </div>))}</div>
          )}
        </CardContent></Card>
        <Card><CardContent className="py-3">
          <div className="flex items-center justify-between mb-2"><h3 className="text-sm font-bold">Geocercas por sucursal</h3><MapPin className="w-4 h-4 text-muted-foreground" /></div>
          {branchOptions.length === 0 ? <p className="text-xs text-muted-foreground py-2">Sin sucursales para este negocio. Créalas en el módulo Sucursales.</p> : (
            <div className="space-y-1">{branchOptions.map(o => {
              const g = geofences.find(x => (x.sucursal || "").toUpperCase().trim() === o.sucursal.toUpperCase().trim() && (!x.business_id || x.business_id === o.business_id))
              const hasCoords = !!g && (Number(g.latitude) !== 0 || Number(g.longitude) !== 0)
              return (
                <div key={o.business_id + o.sucursal} className="flex items-center justify-between text-xs border rounded px-2 py-1.5">
                  <div><span className="font-medium">{o.sucursal}</span>{multiBiz && <span className="text-muted-foreground"> · {o.business_name}</span>}<div className="text-muted-foreground">{hasCoords ? `${g!.latitude}, ${g!.longitude} · ${g!.radius_meters} m` : "Sin coordenadas"}</div></div>
                  <div className="flex items-center gap-1">
                    <Badge variant="outline" className={hasCoords && g!.active ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-amber-100 text-amber-700 border-amber-200"}>{hasCoords ? (g!.active ? "Activa" : "Inactiva") : "Pendiente"}</Badge>
                    <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setGeoEdit(g ? { ...g, sucursal: o.sucursal, business_id: o.business_id } : { sucursal: o.sucursal, business_id: o.business_id, latitude: 0, longitude: 0, radius_meters: 80, active: true })}>{hasCoords ? "Editar" : "Configurar"}</Button>
                  </div>
                </div>)
            })}</div>
          )}
        </CardContent></Card>
      </div>

      {/* Directorio de empleados reales (Solicitudes aprobadas / csl_empleados) */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-bold flex items-center gap-1"><Users className="w-4 h-4" />Empleados</h3>
            <Button variant="outline" size="sm" onClick={syncEmpleados} disabled={syncing}>{syncing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}Sincronizar empleados aprobados</Button>
          </div>
          <div className="relative max-w-sm mb-2">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8 h-8" placeholder="Buscar por nombre, cédula, sucursal o puesto…" value={empSearch} onChange={e => setEmpSearch(e.target.value)} />
          </div>
          {loading ? (
            <div className="py-6 text-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Cargando…</div>
          ) : empList.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No hay empleados registrados para este negocio. Sincroniza solicitudes aprobadas o agrega un empleado.
            </div>
          ) : filteredEmps.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">Sin coincidencias para “{empSearch}”.</div>
          ) : (
            <div className="max-h-72 overflow-y-auto divide-y">
              {filteredEmps.map(e => (
                <div key={e.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{e.nombre}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{[e.cedula, e.puesto, e.sucursal].filter(Boolean).join(" · ") || "—"}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openQr(e)}><QrCode className="w-3.5 h-3.5 mr-1" />Ver QR</Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setCorrection({ employee_id: e.id, employee_nombre: e.nombre, sucursal: e.sucursal, type: "entrada", punched_at: new Date().toISOString().slice(0, 16) })}>Marca manual</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3">
          <Input placeholder="Buscar en historial de ponches (nombre, cédula, sucursal, puesto)…" value={search} onChange={e => setSearch(e.target.value)} className="h-8 max-w-sm mb-2" />
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
                <select className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                  value={geoEdit.sucursal ? `${geoEdit.business_id || ""}|||${geoEdit.sucursal}` : ""}
                  onChange={e => { const [bizId, suc] = e.target.value.split("|||"); setGeoEdit({ ...geoEdit, business_id: bizId || geoEdit.business_id || "", sucursal: suc || "" }) }}>
                  <option value="">Selecciona sucursal…</option>
                  {geoEdit.sucursal && !branchOptions.some(o => o.sucursal === geoEdit.sucursal) && <option value={`${geoEdit.business_id || ""}|||${geoEdit.sucursal}`}>{geoEdit.sucursal} (actual)</option>}
                  {multiBiz
                    ? bizGroups.map(([bn, opts]) => <optgroup key={bn} label={bn}>{opts.map(o => <option key={o.business_id + o.sucursal} value={`${o.business_id}|||${o.sucursal}`}>{o.sucursal}</option>)}</optgroup>)
                    : branchOptions.map(o => <option key={o.business_id + o.sucursal} value={`${o.business_id}|||${o.sucursal}`}>{o.sucursal}</option>)}
                </select>
              </div>
              <div className="space-y-1"><Label className="text-xs">Dirección</Label><Input value={geoEdit.direccion || ""} onChange={e => setGeoEdit({ ...geoEdit, direccion: e.target.value })} placeholder="Av. Rafael Vidal, Plaza Mediterránea Módulo H-1" /></div>
              <div className="space-y-1"><Label className="text-xs">Link de Google Maps</Label>
                <div className="flex gap-1"><Input value={geoEdit.google_maps_url || ""} onChange={e => setGeoEdit({ ...geoEdit, google_maps_url: e.target.value })} placeholder="https://maps.google.com/...@19.45,-70.69..." />
                  <Button type="button" variant="outline" size="sm" onClick={aplicarMapsUrl}>Extraer</Button></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Latitud</Label><Input type="number" step="0.0000001" value={geoEdit.latitude ?? 0} onChange={e => setGeoEdit({ ...geoEdit, latitude: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Longitud</Label><Input type="number" step="0.0000001" value={geoEdit.longitude ?? 0} onChange={e => setGeoEdit({ ...geoEdit, longitude: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Radio (metros)</Label><Input type="number" step="1" value={geoEdit.radius_meters ?? 80} onChange={e => setGeoEdit({ ...geoEdit, radius_meters: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Zona horaria</Label><Input value={geoEdit.timezone || "America/Santo_Domingo"} onChange={e => setGeoEdit({ ...geoEdit, timezone: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Teléfono</Label><Input value={geoEdit.telefono || ""} onChange={e => setGeoEdit({ ...geoEdit, telefono: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Email</Label><Input value={geoEdit.email || ""} onChange={e => setGeoEdit({ ...geoEdit, email: e.target.value })} /></div>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" className="flex-1" onClick={useMyLocation}><LocateFixed className="w-4 h-4 mr-1" />Usar mi ubicación</Button>
                <Button type="button" variant="outline" size="sm" className="flex-1" onClick={probarGeocerca}><MapPin className="w-4 h-4 mr-1" />Probar geocerca</Button>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={geoEdit.active !== false} onChange={e => setGeoEdit({ ...geoEdit, active: e.target.checked })} />Geocerca activa (valida ubicación al ponchar)</label>
              <p className="text-[11px] text-muted-foreground">Pega el link de Google Maps y pulsa “Extraer”, escribe lat/long, o usa “Usar mi ubicación” estando en la sucursal. “Probar geocerca” mide tu distancia al centro.</p>
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
          <DialogHeader><DialogTitle>Nuevo dispositivo de kiosco</DialogTitle></DialogHeader>
          {authDev && (
            <div className="space-y-3 py-2">
              <p className="text-xs text-muted-foreground">Crea el dispositivo y genera un <b>link de activación</b> para abrir en la tablet/celular del kiosco. O autoriza directamente este navegador.</p>
              <div className="space-y-1"><Label className="text-xs">Nombre del dispositivo *</Label><Input value={authDev.device_name} onChange={e => setAuthDev({ ...authDev, device_name: e.target.value })} placeholder="Kiosko Rafael Vidal Cabina Principal" /></div>
              <div className="space-y-1"><Label className="text-xs">Sucursal *</Label>
                <select className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                  value={authDev.business_id && authDev.sucursal ? `${authDev.business_id}|||${authDev.sucursal}` : ""}
                  onChange={e => { const [bizId, suc] = e.target.value.split("|||"); setAuthDev({ ...authDev, business_id: bizId || "", sucursal: suc || "" }) }}>
                  <option value="">Selecciona sucursal…</option>
                  {multiBiz
                    ? bizGroups.map(([bn, opts]) => <optgroup key={bn} label={bn}>{opts.map(o => <option key={o.business_id + o.sucursal} value={`${o.business_id}|||${o.sucursal}`}>{o.sucursal}</option>)}</optgroup>)
                    : branchOptions.map(o => <option key={o.business_id + o.sucursal} value={`${o.business_id}|||${o.sucursal}`}>{o.sucursal}</option>)}
                </select>
                {branchOptions.length === 0 && <p className="text-[11px] text-amber-600">No hay sucursales disponibles para ti. Créalas en Sucursales o pide acceso a la sucursal.</p>}
              </div>
              <div className="space-y-1"><Label className="text-xs">Descripción (opcional)</Label><Input value={authDev.descripcion || ""} onChange={e => setAuthDev({ ...authDev, descripcion: e.target.value })} placeholder="Tablet en recepción" /></div>
            </div>
          )}
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="ghost" onClick={() => setAuthDev(null)} disabled={saving}><X className="w-4 h-4 mr-1" />Cancelar</Button>
            <Button variant="outline" onClick={() => createDevice(true)} disabled={saving}><Smartphone className="w-4 h-4 mr-1" />Autorizar este navegador</Button>
            <Button onClick={() => createDevice(false)} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <LinkIcon className="w-4 h-4 mr-1" />}Generar link</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog link de activación */}
      <Dialog open={!!activationLink} onOpenChange={o => !o && setActivationLink(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Link de activación</DialogTitle></DialogHeader>
          {activationLink && (
            <div className="space-y-3 py-2">
              <p className="text-sm">Dispositivo: <b>{activationLink.device_name}</b>{activationLink.sucursal ? ` · ${activationLink.sucursal}` : ""}</p>
              <p className="text-xs text-muted-foreground">Abre este link <b>en la tablet/celular del kiosco</b>. Ese navegador quedará autorizado para ponchar.{activationLink.regenerated ? " El token anterior quedó inválido." : ""}</p>
              <div className="rounded-md border bg-muted/30 px-2 py-2 text-[11px] break-all select-all">{activationLink.url}</div>
              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" size="sm" onClick={copyActivation}><Copy className="w-4 h-4 mr-1" />Copiar</Button>
                <Button variant="outline" size="sm" className="text-[#25D366]" onClick={waActivation}><Smartphone className="w-4 h-4 mr-1" />WhatsApp</Button>
                <Button variant="outline" size="sm" onClick={() => { if (typeof window !== "undefined") window.open(activationLink.url, "_blank") }}><LinkIcon className="w-4 h-4 mr-1" />Abrir</Button>
              </div>
              <p className="text-[11px] text-amber-600">Por seguridad el token solo se muestra una vez. Si lo pierdes, usa “Generar link” de nuevo (regenera el token).</p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setActivationLink(null)}>Listo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog QR del empleado */}
      <Dialog open={!!qrEmp} onOpenChange={o => { if (!o) { setQrEmp(null); setQrUrl(""); setQrToken("") } }}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>QR · {qrEmp?.nombre}</DialogTitle></DialogHeader>
          <div className="flex flex-col items-center gap-3 py-2">
            {qrBusy && !qrUrl ? <div className="py-12 text-sm text-muted-foreground">Generando QR…</div>
              : qrUrl ? <img src={qrUrl} alt="QR" className="w-56 h-56" /> : <div className="py-12 text-sm text-muted-foreground">Sin QR</div>}
            <p className="text-[11px] text-muted-foreground text-center">El empleado presenta este QR en el kiosco. Solo funciona dentro de la sucursal (geocerca) y en un dispositivo autorizado.</p>
            <div className="grid grid-cols-2 gap-2 w-full">
              <button onClick={downloadQr} disabled={!qrUrl} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">Descargar</button>
              <button onClick={shareWhatsapp} disabled={!qrToken} className="rounded-lg bg-[#25D366] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">WhatsApp</button>
              <button onClick={copyLink} disabled={!qrToken} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">Copiar link</button>
              <button onClick={() => qrEmp && openQr(qrEmp, true)} disabled={qrBusy} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">Regenerar</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Página dedicada "Kiosko Ponche": abre directo el kiosco a pantalla completa
 *  (sin panel administrativo). Permiso de menú independiente: rrhh-kiosko-ponche. */
export function KioskPonchePage() {
  const setActiveTab = useAppStore(s => s.setActiveTab)
  return <KioskView onExit={() => setActiveTab("rrhh-ponche")} />
}

// ─── Kiosco de ponche ──────────────────────────────────────────────────────
type DetectedBarcode = { rawValue: string }
type BarcodeDetectorLike = { detect: (src: CanvasImageSource) => Promise<DetectedBarcode[]> }

export function KioskView({ onExit, showExit = false }: { onExit: () => void; showExit?: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const readerRef = useRef<IScannerControls | null>(null)
  const scanningRef = useRef(false)
  const startedRef = useRef(false)
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const geoWatchRef = useRef<number | null>(null)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [scanned, setScanned] = useState<{ token: string; nombre: string } | null>(null)
  const [manualToken, setManualToken] = useState("")
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [geoError, setGeoError] = useState("")
  const [geoBusy, setGeoBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; title: string; sub: string } | null>(null)
  const [camError, setCamError] = useState("")
  const [camOn, setCamOn] = useState(false)
  const [starting, setStarting] = useState(false)
  const [now, setNow] = useState(() => new Date())

  const deviceToken = typeof window !== "undefined" ? (localStorage.getItem(DEVICE_TOKEN_KEY) || "") : ""
  // Kiosco: endpoint PÚBLICO autenticado por device_token (sin login/sesión).
  const kioskPost = async (payload: Record<string, unknown>) => {
    const r = await fetch("/api/public/punch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
    return r.json() as Promise<Record<string, unknown>>
  }

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); clockRef.current = t; return () => clearInterval(t) }, [])

  // Pide permiso de UBICACIÓN explícitamente (one-shot) + mantiene un watch.
  // Llamado en el montaje y también desde el gesto "Activar cámara" para que
  // iOS/Android muestren AMBOS permisos (cámara y ubicación), no solo cámara.
  const onGeoErr = (err: GeolocationPositionError) => {
    setGeoBusy(false)
    if (err.code === 1) setGeoError("El permiso de ubicación está BLOQUEADO. Actívalo en los Ajustes del navegador (Safari/Chrome → Ubicación), permite el acceso y recarga la página.")
    else if (err.code === 3) setGeoError("La ubicación tardó demasiado. Verifica que el GPS esté encendido e intenta de nuevo.")
    else setGeoError("No se pudo obtener la ubicación. Verifica el GPS e intenta de nuevo.")
  }
  const requestLocation = () => {
    if (!navigator.geolocation) { setGeoError("Este dispositivo no soporta geolocalización"); return }
    setGeoBusy(true); setGeoError("")
    navigator.geolocation.getCurrentPosition(
      pos => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGeoError(""); setGeoBusy(false) },
      onGeoErr,
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 })
    if (geoWatchRef.current == null) {
      geoWatchRef.current = navigator.geolocation.watchPosition(
        pos => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGeoError(""); setGeoBusy(false) },
        onGeoErr,
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 })
    }
  }

  // Geolocalización: intenta al montar (en iOS suele requerir gesto → botón).
  useEffect(() => {
    requestLocation()
    return () => { if (geoWatchRef.current != null && navigator.geolocation) { navigator.geolocation.clearWatch(geoWatchRef.current); geoWatchRef.current = null } }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-intenta abrir la cámara; si el navegador lo bloquea (iOS sin gesto),
  // el usuario la activa con el botón "Activar cámara".
  useEffect(() => { void startCamera(); return () => stopCamera() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const rejectTitle = (code?: string, reason?: string) => {
    switch (code) {
      case "no_device": case "device": return "Dispositivo no autorizado"
      case "no_qr": case "qr_invalid": return "QR inválido"
      case "qr_revoked": return "QR revocado / regenerado"
      case "geofence": return "Fuera de ubicación"
      case "no_gps": return "Sin ubicación (activa GPS)"
      case "dup_in": return "Entrada duplicada"
      case "no_in": return "Sin entrada previa"
      case "table_missing": return "Falta migración en db-cls"
      case "db_error": return "Error de base de datos"
      case "bad_request": return "Solicitud inválida"
    }
    const r = (reason || "").toLowerCase()
    if (r.includes("ubicaci") || r.includes("fuera")) return "Fuera de ubicación"
    if (r.includes("dispositivo")) return "Dispositivo no autorizado"
    if (r.includes("qr")) return "QR inválido"
    return "Marca rechazada"
  }

  const onQrFound = async (raw: string) => {
    if (busy || scanned) return
    scanningRef.current = false
    setBusy(true)
    try {
      const res = await kioskPost({ mode: "resolve", device_token: deviceToken, qr_token: raw }) as { ok?: boolean; employee_nombre?: string; code?: string; error?: string }
      if (!res?.ok) { setResult({ ok: false, title: rejectTitle(res?.code, res?.error), sub: res?.error || "QR no reconocido" }); resetSoon(); return }
      setScanned({ token: raw, nombre: res.employee_nombre || "Empleado" })
    } catch { setResult({ ok: false, title: "Error de red", sub: "No se pudo conectar. Verifica el internet del kiosco." }); resetSoon() }
    finally { setBusy(false) }
  }

  const punch = async (type: string) => {
    if (!scanned) return
    setBusy(true)
    try {
      const res = await kioskPost({ mode: "punch", device_token: deviceToken, qr_token: scanned.token, punch_type: type, latitude: coords?.lat ?? "", longitude: coords?.lng ?? "", device_info: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : "" }) as { ok?: boolean; status?: string; code?: string; reason?: string; error?: string; employee_nombre?: string; distance_meters?: number | null; late_minutes?: number | null }
      if (res?.status === "approved") setResult({ ok: true, title: `${TYPE_LABEL[type]} registrada`, sub: `${res.employee_nombre || scanned.nombre}${res.distance_meters != null ? ` · ${Math.round(res.distance_meters)} m` : ""}${res.late_minutes ? ` · tarde ${res.late_minutes}m` : ""}` })
      else setResult({ ok: false, title: rejectTitle(res?.code, res?.reason || res?.error), sub: res?.reason || res?.error || "Marca rechazada" })
    } catch { setResult({ ok: false, title: "Error de red", sub: "No se pudo conectar. Verifica el internet." }) }
    finally { setBusy(false); resetSoon() }
  }
  const resetSoon = () => { resetTimerRef.current = setTimeout(() => { setScanned(null); setResult(null); setManualToken(""); scanningRef.current = true }, 3500) }

  // Salida segura del kiosco: detiene cámara, scanner, GPS y timers, limpia el
  // estado temporal y vuelve al panel. NO toca device_token / autorización / geocerca.
  const handleExit = () => {
    stopCamera()
    if (geoWatchRef.current != null && navigator.geolocation) { try { navigator.geolocation.clearWatch(geoWatchRef.current) } catch { /* noop */ } geoWatchRef.current = null }
    if (clockRef.current) { clearInterval(clockRef.current); clockRef.current = null }
    if (resetTimerRef.current) { clearTimeout(resetTimerRef.current); resetTimerRef.current = null }
    setScanned(null); setResult(null); setManualToken(""); setCamError(""); setBusy(false)
    onExit()
  }

  const stopCamera = () => {
    startedRef.current = false; scanningRef.current = false
    try { readerRef.current?.stop() } catch { /* noop */ }
    readerRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }
  const startCamera = async () => {
    if (startedRef.current || starting || !videoRef.current) return
    requestLocation() // mismo gesto → pide cámara Y ubicación
    setStarting(true); setCamError("")
    try {
      const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector
      if (BD) {
        let detector: BarcodeDetectorLike | null = null
        try { detector = new BD({ formats: ["qr_code"] }) } catch { detector = null }
        if (detector) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
          streamRef.current = stream
          videoRef.current.setAttribute("playsinline", "true")
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          startedRef.current = true; scanningRef.current = true; setCamOn(true); setStarting(false)
          const det = detector
          const tick = async () => {
            if (!startedRef.current) return
            if (scanningRef.current && videoRef.current) {
              try { const codes = await det.detect(videoRef.current); if (codes && codes[0]?.rawValue) onQrFound(codes[0].rawValue) } catch { /* sin código */ }
            }
            setTimeout(tick, 400)
          }
          tick()
          return
        }
      }
      // Fallback universal (iOS Safari/Chrome, Android): @zxing/browser.
      const reader = new BrowserQRCodeReader()
      readerRef.current = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } } },
        videoRef.current,
        (res) => { if (res && scanningRef.current) onQrFound(res.getText()) },
      )
      startedRef.current = true; scanningRef.current = true; setCamOn(true); setStarting(false)
    } catch {
      setStarting(false); setCamOn(false)
      setCamError("Permite el acceso a la cámara para escanear el QR. Si no aparece el permiso, pulsa “Activar cámara”.")
    }
  }

  const fmtClock = now.toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit", second: "2-digit" })

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 text-white flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-white/10">
        {showExit
          ? <button type="button" onClick={handleExit} aria-label="Salir del kiosco" className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/20 active:bg-white/30 touch-manipulation select-none"><ArrowLeft className="w-4 h-4" />Salir del kiosco</button>
          : <div className="w-8" />}
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
              <video ref={videoRef} className="w-full h-full object-cover" playsInline muted autoPlay />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><ScanLine className="w-40 h-40 text-emerald-400/40" /></div>
              {!camOn && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 gap-2">
                  <button onClick={() => void startCamera()} disabled={starting} className="rounded-xl bg-emerald-500 px-5 py-3 text-base font-bold disabled:opacity-50">
                    {starting ? "Abriendo cámara…" : "Activar cámara y ubicación"}
                  </button>
                  {camError && <p className="text-amber-300 text-xs px-4 text-center">{camError}</p>}
                </div>
              )}
            </div>
            <p className="mt-4 text-white/70">{camOn ? "Muestra tu QR a la cámara para ponchar" : "Pulsa “Activar cámara y ubicación” y permite ambos accesos"}</p>
            {(geoError || geoBusy) && (
              <div className="mt-1 flex flex-col items-center gap-1">
                {geoError && <p className="text-amber-400 text-sm px-4">{geoError}</p>}
                <button onClick={requestLocation} disabled={geoBusy} className="rounded-lg bg-white/15 hover:bg-white/25 px-3 py-1.5 text-xs font-medium disabled:opacity-60">{geoBusy ? "Solicitando ubicación…" : "Activar ubicación"}</button>
              </div>
            )}
            <div className="mt-4">
              <p className="text-white/40 text-xs mb-1">¿No funciona la cámara? Pega el código del QR:</p>
              <div className="flex gap-2 justify-center">
                <input value={manualToken} onChange={e => setManualToken(e.target.value)} placeholder="Código del QR" className="rounded-lg px-3 py-2 text-sm text-slate-900 w-56" />
                <button onClick={() => manualToken.trim() && onQrFound(manualToken.trim())} disabled={busy} className="rounded-lg bg-white/15 hover:bg-white/25 px-3 py-2 text-sm font-medium disabled:opacity-50">Validar</button>
              </div>
            </div>
            {!deviceToken && <p className="mt-3 text-red-400 text-sm">Este dispositivo no está autorizado. Solicita al administrador el link de activación.</p>}
            {busy && <Loader2 className="w-6 h-6 animate-spin mx-auto mt-4" />}
          </div>
        )}
      </div>
    </div>
  )
}

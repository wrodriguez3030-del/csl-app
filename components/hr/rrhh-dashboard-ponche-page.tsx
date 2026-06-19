"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAppStore, apiCall, normalizeApiUrl } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { KpiCard } from "@/components/kpi-card"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { isEmpleadoActivo } from "@/lib/empleado-estado"
import {
  Users, Clock, UserCheck, UserX, AlertTriangle, LogOut, Timer,
  CalendarClock, MapPinOff, Fingerprint, RefreshCw, Loader2,
} from "lucide-react"
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from "recharts"

// ── Tipos mínimos de las filas que consumimos ──────────────────────────────
interface PunchRow {
  id: string
  employee_id: string
  type: string                 // entrada | salida | almuerzo_inicio | almuerzo_fin | salida_autorizada
  punched_at: string
  sucursal?: string | null
  modality?: string | null
  status?: string | null       // approved | rejected | anulado
  worked_minutes?: number | null
  late_minutes?: number | null
  early_leave_minutes?: number | null
  overtime_minutes?: number | null
}
interface EmpRow {
  empleado_id: string
  nombre: string
  sucursal: string
  estado: string
}

const TZ = "America/Santo_Domingo"
const fmtDay = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
const fmtTime = new Intl.DateTimeFormat("es-DO", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })

/** YYYY-MM-DD del instante en zona RD. */
function dayStr(iso: string | Date): string {
  try { return fmtDay.format(new Date(iso)) } catch { return "" }
}
function todayStr(): string { return fmtDay.format(new Date()) }
/** Lunes de la semana operativa que contiene `base` (YYYY-MM-DD). */
function weekStartStr(base: string): string {
  const d = new Date(`${base}T12:00:00`)
  const dow = d.getDay()              // 0=Dom … 6=Sáb
  const diff = dow === 0 ? 6 : dow - 1 // lunes
  d.setDate(d.getDate() - diff)
  return fmtDay.format(d)
}
function firstOfMonthStr(base: string): string { return `${base.slice(0, 7)}-01` }
function hours(min: number): string { return (min / 60).toLocaleString("es-DO", { maximumFractionDigits: 1 }) }

const MODALITY_LABEL: Record<string, string> = {
  pin: "PIN", qr: "QR", mobile_biometric: "Biometría móvil", face: "Facial",
  gps: "GPS", kiosk: "Kiosko", remote: "Remoto", manual: "Manual",
}
const PIE_COLORS = ["#0891b2", "#059669", "#d97706", "#dc2626", "#7c3aed", "#0ea5e9", "#65a30d", "#64748b"]

type Preset = "hoy" | "semana" | "mes" | "rango"

export function RrhhDashboardPonchePage() {
  const apiUrl = useAppStore((s) => s.apiUrl)
  const activeBusinessSlug = useAppStore((s) => s.activeBusinessSlug)
  const business = useCurrentBusiness()

  const [preset, setPreset] = useState<Preset>("semana")
  const [desde, setDesde] = useState<string>(weekStartStr(todayStr()))
  const [hasta, setHasta] = useState<string>(todayStr())
  const [sucursalFilter, setSucursalFilter] = useState<string>("__all__")
  const [loading, setLoading] = useState(false)
  const [punches, setPunches] = useState<PunchRow[]>([])
  const [empleados, setEmpleados] = useState<EmpRow[]>([])
  const [tableMissing, setTableMissing] = useState(false)

  // Resuelve el rango de fechas según el preset.
  const applyPreset = useCallback((p: Preset) => {
    setPreset(p)
    const t = todayStr()
    if (p === "hoy") { setDesde(t); setHasta(t) }
    else if (p === "semana") { setDesde(weekStartStr(t)); setHasta(t) }
    else if (p === "mes") { setDesde(firstOfMonthStr(t)); setHasta(t) }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const url = normalizeApiUrl(apiUrl)
      const [empRes, punchRes] = await Promise.all([
        apiCall(url, { action: "getEmpleados" }) as Promise<{ records?: Record<string, unknown>[] }>,
        apiCall(url, {
          action: "getHrPunches",
          desde: `${desde}T00:00:00`,
          hasta: `${hasta}T23:59:59`,
        }) as Promise<{ records?: PunchRow[]; tableMissing?: boolean }>,
      ])
      const emps: EmpRow[] = (empRes?.records ?? []).map((r) => {
        const g = (k: string) => String((r as Record<string, unknown>)[k] ?? "")
        const nombre = `${g("Nombre") || g("nombre")} ${g("Apellido") || g("apellido")}`.replace(/\s+/g, " ").trim()
        const id = g("empleado_id") || g("EmpleadoID") || g("SolicitudID") || g("id")
        return {
          empleado_id: id,
          nombre: nombre || id,
          sucursal: g("Sucursal") || g("sucursal"),
          estado: (g("Estado") || g("estado") || "Activo"),
        }
      }).filter((e) => e.empleado_id)
      setEmpleados(emps)
      setTableMissing(Boolean(punchRes?.tableMissing))
      setPunches((punchRes?.records ?? []).filter((p) => p.status !== "anulado"))
    } catch {
      setPunches([]); setEmpleados([])
    } finally { setLoading(false) }
  }, [apiUrl, desde, hasta])

  useEffect(() => { load() }, [load, activeBusinessSlug])

  // ── Cálculo de KPIs / breakdowns (cliente) ───────────────────────────────
  const data = useMemo(() => {
    const today = todayStr()
    const wkStart = weekStartStr(today)
    const inSuc = (s?: string | null) => sucursalFilter === "__all__" || (s || "") === sucursalFilter
    const px = punches.filter((p) => inSuc(p.sucursal))
    const empActivos = empleados.filter((e) => isEmpleadoActivo(e.estado) && inSuc(e.sucursal))

    const todayPunches = px.filter((p) => dayStr(p.punched_at) === today)
    const entradasHoy = todayPunches.filter((p) => p.type === "entrada")
    const salidasHoy = todayPunches.filter((p) => p.type === "salida")
    const empConEntradaHoy = new Set(entradasHoy.map((p) => p.employee_id))
    const empConSalidaHoy = new Set(salidasHoy.map((p) => p.employee_id))
    const sinSalida = [...empConEntradaHoy].filter((id) => !empConSalidaHoy.has(id))

    const sumBy = (arr: PunchRow[], k: keyof PunchRow) =>
      arr.reduce((a, p) => a + (Number(p[k]) || 0), 0)

    const weekPunches = px.filter((p) => dayStr(p.punched_at) >= wkStart && dayStr(p.punched_at) <= today)

    const kpis = {
      empleadosActivos: empActivos.length,
      ponchesHoy: todayPunches.length,
      asistenciasHoy: empConEntradaHoy.size,
      ausenciasHoy: Math.max(0, empActivos.length - empConEntradaHoy.size),
      tardanzasHoy: entradasHoy.filter((p) => (p.late_minutes || 0) > 0).length,
      salidasTempranasHoy: salidasHoy.filter((p) => (p.early_leave_minutes || 0) > 0).length,
      sinSalidaHoy: sinSalida.length,
      horasHoy: sumBy(todayPunches, "worked_minutes"),
      horasSemana: sumBy(weekPunches, "worked_minutes"),
      horasExtra: sumBy(px, "overtime_minutes"),
      geocercaInvalida: todayPunches.filter((p) => p.status === "rejected").length,
    }

    // Resumen por sucursal (rango activo)
    const sucMap = new Map<string, { sucursal: string; asistencias: Set<string>; tardanzas: number; horas: number }>()
    for (const p of px) {
      const k = p.sucursal || "Sin sucursal"
      if (!sucMap.has(k)) sucMap.set(k, { sucursal: k, asistencias: new Set(), tardanzas: 0, horas: 0 })
      const e = sucMap.get(k)!
      if (p.type === "entrada") { e.asistencias.add(`${p.employee_id}|${dayStr(p.punched_at)}`); if ((p.late_minutes || 0) > 0) e.tardanzas++ }
      e.horas += Number(p.worked_minutes) || 0
    }
    const porSucursal = [...sucMap.values()]
      .map((e) => ({ sucursal: e.sucursal, asistencias: e.asistencias.size, tardanzas: e.tardanzas, horas: e.horas }))
      .sort((a, b) => b.asistencias - a.asistencias)

    // Distribución por modalidad (rango)
    const modMap = new Map<string, number>()
    for (const p of px.filter((p) => p.type === "entrada")) {
      const k = p.modality || "sin_registrar"
      modMap.set(k, (modMap.get(k) || 0) + 1)
    }
    const porModalidad = [...modMap.entries()]
      .map(([k, v]) => ({ name: MODALITY_LABEL[k] || (k === "sin_registrar" ? "Sin registrar" : k), value: v }))
      .sort((a, b) => b.value - a.value)

    // Asistencia por día (rango)
    const dayMap = new Map<string, { fecha: string; asistencias: Set<string>; tardanzas: number }>()
    for (const p of px.filter((p) => p.type === "entrada")) {
      const k = dayStr(p.punched_at)
      if (!dayMap.has(k)) dayMap.set(k, { fecha: k, asistencias: new Set(), tardanzas: 0 })
      const e = dayMap.get(k)!
      e.asistencias.add(p.employee_id)
      if ((p.late_minutes || 0) > 0) e.tardanzas++
    }
    const porDia = [...dayMap.values()]
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
      .map((e) => ({ fecha: e.fecha.slice(5), asistencias: e.asistencias.size, tardanzas: e.tardanzas }))

    // Tabla de recientes + alertas
    const nombreDe = (id: string) => empleados.find((e) => e.empleado_id === id)?.nombre || id
    const recientes = [...px]
      .sort((a, b) => b.punched_at.localeCompare(a.punched_at))
      .slice(0, 12)
      .map((p) => ({ ...p, nombre: nombreDe(p.employee_id) }))
    const alertaSinSalida = sinSalida.map((id) => ({ id, nombre: nombreDe(id) }))
    const alertaTardanzas = entradasHoy.filter((p) => (p.late_minutes || 0) > 0)
      .map((p) => ({ id: p.id, nombre: nombreDe(p.employee_id), late: p.late_minutes || 0, sucursal: p.sucursal || "" }))

    return { kpis, porSucursal, porModalidad, porDia, recientes, alertaSinSalida, alertaTardanzas }
  }, [punches, empleados, sucursalFilter])

  const sucursales = useMemo(() => {
    const s = new Set<string>()
    empleados.forEach((e) => e.sucursal && s.add(e.sucursal))
    punches.forEach((p) => p.sucursal && s.add(p.sucursal))
    return [...s].sort()
  }, [empleados, punches])

  return (
    <div className="space-y-4">
      {/* Cabecera */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            RR.HH. · Asistencia · {business.shortName}
          </p>
          <h2 className="mt-1 text-2xl font-black tracking-tight">Dashboard Ponche</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Métricas de asistencia y ponche. Solo datos de {business.displayName}.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Actualizar
        </Button>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex gap-1">
            {(["hoy", "semana", "mes"] as Preset[]).map((p) => (
              <Button key={p} size="sm" variant={preset === p ? "default" : "outline"}
                onClick={() => applyPreset(p)} className="capitalize">{p}</Button>
            ))}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Desde</Label>
            <Input type="date" value={desde} className="h-9 w-[150px]"
              onChange={(e) => { setPreset("rango"); setDesde(e.target.value) }} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Hasta</Label>
            <Input type="date" value={hasta} className="h-9 w-[150px]"
              onChange={(e) => { setPreset("rango"); setHasta(e.target.value) }} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Sucursal</Label>
            <Select value={sucursalFilter} onValueChange={setSucursalFilter}>
              <SelectTrigger className="h-9 w-[190px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas las sucursales</SelectItem>
                {sucursales.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {tableMissing && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          La tabla de ponches aún no está migrada en este entorno. Aplica las migraciones de RR.HH.
        </div>
      )}

      {/* KPIs principales */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Empleados activos" value={data.kpis.empleadosActivos} icon={Users} variant="primary" description="Estado: Activo" />
        <KpiCard title="Asistencias hoy" value={data.kpis.asistenciasHoy} icon={UserCheck} variant="success" description={`${data.kpis.ponchesHoy} ponches hoy`} />
        <KpiCard title="Ausencias hoy" value={data.kpis.ausenciasHoy} icon={UserX} variant={data.kpis.ausenciasHoy > 0 ? "warning" : "success"} description="Activos sin entrada" />
        <KpiCard title="Tardanzas hoy" value={data.kpis.tardanzasHoy} icon={AlertTriangle} variant={data.kpis.tardanzasHoy > 0 ? "destructive" : "success"} description="Entrada con atraso" />
      </div>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Sin salida hoy" value={data.kpis.sinSalidaHoy} icon={LogOut} variant={data.kpis.sinSalidaHoy > 0 ? "warning" : "success"} description="Entró y no marcó salida" />
        <KpiCard title="Salidas tempranas" value={data.kpis.salidasTempranasHoy} icon={CalendarClock} variant={data.kpis.salidasTempranasHoy > 0 ? "warning" : "success"} description="Hoy" />
        <KpiCard title="Horas hoy" value={hours(data.kpis.horasHoy)} icon={Clock} variant="primary" description="Trabajadas hoy" />
        <KpiCard title="Horas semana" value={hours(data.kpis.horasSemana)} icon={Timer} variant="primary" description="Semana operativa" />
      </div>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Horas extra" value={hours(data.kpis.horasExtra)} icon={Timer} variant={data.kpis.horasExtra > 0 ? "warning" : "primary"} description="Rango seleccionado" />
        <KpiCard title="Geocerca inválida" value={data.kpis.geocercaInvalida} icon={MapPinOff} variant={data.kpis.geocercaInvalida > 0 ? "destructive" : "success"} description="Ponches rechazados hoy" />
        <KpiCard title="Modalidad biométrica" value={data.porModalidad.find((m) => m.name === "Biometría móvil")?.value || 0} icon={Fingerprint} variant="primary" description="Entradas en rango" />
        <KpiCard title="Ponches hoy" value={data.kpis.ponchesHoy} icon={Clock} variant="success" description="Todas las marcas" />
      </div>

      {/* Gráficas */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Asistencia por día</CardTitle></CardHeader>
          <CardContent className="h-[260px]">
            {data.porDia.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin datos en el rango.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.porDia} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="fecha" fontSize={11} />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="asistencias" name="Asistencias" fill="#0891b2" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="tardanzas" name="Tardanzas" fill="#dc2626" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Distribución por modalidad</CardTitle></CardHeader>
          <CardContent className="h-[260px]">
            {data.porModalidad.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin entradas registradas en el rango.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.porModalidad} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                    {data.porModalidad.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Resumen por sucursal */}
      <Card>
        <CardHeader><CardTitle className="text-base">Resumen por sucursal</CardTitle></CardHeader>
        <CardContent>
          {data.porSucursal.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin ponches en el rango.</p>
          ) : (
            <div className="space-y-2">
              {data.porSucursal.map((s) => (
                <div key={s.sucursal} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-sm">
                  <span className="font-medium">{s.sucursal}</span>
                  <div className="flex gap-4 text-xs">
                    <span><span className="text-muted-foreground">Asistencias:</span> <b>{s.asistencias}</b></span>
                    <span><span className="text-muted-foreground">Tardanzas:</span> <b className={s.tardanzas > 0 ? "text-rose-600" : ""}>{s.tardanzas}</b></span>
                    <span><span className="text-muted-foreground">Horas:</span> <b>{hours(s.horas)}</b></span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Alertas */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><LogOut className="h-4 w-4 text-amber-600" /> Sin marca de salida (hoy)</CardTitle></CardHeader>
          <CardContent>
            {data.alertaSinSalida.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todos los que entraron marcaron salida.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.alertaSinSalida.map((a) => <Badge key={a.id} variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">{a.nombre}</Badge>)}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-rose-600" /> Tardanzas (hoy)</CardTitle></CardHeader>
          <CardContent>
            {data.alertaTardanzas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin tardanzas hoy.</p>
            ) : (
              <div className="space-y-1">
                {data.alertaTardanzas.map((a) => (
                  <div key={a.id} className="flex items-center justify-between rounded border bg-rose-50/50 px-3 py-1.5 text-sm">
                    <span>{a.nombre} <span className="text-xs text-muted-foreground">· {a.sucursal}</span></span>
                    <Badge variant="destructive">+{a.late} min</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Últimos ponches */}
      <Card>
        <CardHeader><CardTitle className="text-base">Últimos ponches</CardTitle></CardHeader>
        <CardContent>
          {data.recientes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin ponches en el rango.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">Empleado</th>
                    <th className="py-2 pr-3">Tipo</th>
                    <th className="py-2 pr-3">Hora</th>
                    <th className="py-2 pr-3">Sucursal</th>
                    <th className="py-2 pr-3">Modalidad</th>
                    <th className="py-2 pr-3">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recientes.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium">{p.nombre}</td>
                      <td className="py-2 pr-3 capitalize">{p.type.replace(/_/g, " ")}</td>
                      <td className="py-2 pr-3 tabular-nums">{dayStr(p.punched_at).slice(5)} {fmtTime.format(new Date(p.punched_at))}</td>
                      <td className="py-2 pr-3">{p.sucursal || "—"}</td>
                      <td className="py-2 pr-3">{p.modality ? (MODALITY_LABEL[p.modality] || p.modality) : "—"}</td>
                      <td className="py-2 pr-3">
                        <Badge variant={p.status === "rejected" ? "destructive" : "secondary"} className="text-xs">
                          {p.status === "rejected" ? "Rechazado" : "OK"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

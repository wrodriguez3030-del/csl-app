"use client"

import { useEffect, useMemo, useState } from "react"
import { apiJsonp, normalizeApiUrl, useAppStore } from "@/lib/store"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { KpiCard } from "@/components/kpi-card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Boxes,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  Cog,
  Filter,
  Package,
  ShieldCheck,
  Wrench,
} from "lucide-react"
import type { Equipo, InventarioItem, PiezaIntervenida, PiezaPolizaLista, Reporte } from "@/lib/types"

// ─── Filtros del Dashboard ────────────────────────────────────────────────────

const DATE_RANGES = ["Hoy", "Esta semana", "Este mes", "Últimos 30 días", "Año actual"] as const
type DateRange = typeof DATE_RANGES[number]

const TIPOS_REPORTE = ["Todos", "Preventivo", "Correctivo", "Garantía", "Pago por servicio"] as const
type TipoReporteFilter = typeof TIPOS_REPORTE[number]

/** Devuelve el límite inferior (ISO YYYY-MM-DD) para un rango dado. */
function rangeStart(range: DateRange): string {
  const now = new Date()
  switch (range) {
    case "Hoy":
      return now.toISOString().slice(0, 10)
    case "Esta semana": {
      const d = new Date(now)
      d.setDate(now.getDate() - 7)
      return d.toISOString().slice(0, 10)
    }
    case "Últimos 30 días": {
      const d = new Date(now)
      d.setDate(now.getDate() - 30)
      return d.toISOString().slice(0, 10)
    }
    case "Año actual":
      return `${now.getFullYear()}-01-01`
    case "Este mes":
    default:
      return `${now.toISOString().slice(0, 7)}-01`
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parsePiezas(json: string | undefined): PiezaIntervenida[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function formatDate(value?: string | null): string {
  if (!value) return "—"
  const raw = String(value).slice(0, 10)
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  return raw
}

function totalStock(item: InventarioItem): number {
  return (
    Number(item.StockRafaelVidal || 0)
    + Number(item.StockLosJardines || 0)
    + Number(item.StockVillaOlga || 0)
    + Number(item.StockLaVega || 0)
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function DashboardPage() {
  const { db, dbPulsos, apiUrl } = useAppStore()
  // Branding multi-tenant — el `useCurrentBusiness` ya hidrata el negocio
  // activo a partir del perfil del usuario. Los datos en `db` ya vienen
  // filtrados por business_id desde el backend (loadBusinessContext +
  // AsyncLocalStorage) — no hace falta filtrar acá.
  const business = useCurrentBusiness()

  // Piezas póliza lista — no vive en `db` global, hay que cargarlas. Si la
  // llamada falla (módulo deshabilitado o sin datos), seguimos con [].
  const [piezasPoliza, setPiezasPoliza] = useState<PiezaPolizaLista[]>([])
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const result = await apiJsonp(normalizeApiUrl(apiUrl), { action: "listPiezasPolizaLista" })
        const records = Array.isArray(result.records) ? (result.records as PiezaPolizaLista[]) : []
        if (active) setPiezasPoliza(records)
      } catch {
        if (active) setPiezasPoliza([])
      }
    })()
    return () => { active = false }
  }, [apiUrl])

  // ─── Filtros ────────────────────────────────────────────────────────────────
  const [rangeFilter, setRangeFilter] = useState<DateRange>("Este mes")
  const [sucursalFilter, setSucursalFilter] = useState<string>("Todas")
  const [tipoFilter, setTipoFilter] = useState<TipoReporteFilter>("Todos")

  const sucursalesOptions = useMemo(() => {
    const set = new Set<string>()
    db.equipos.forEach((e) => { if (e.Sucursal) set.add(e.Sucursal) })
    db.reportes.forEach((r) => { if (r.Sucursal) set.add(r.Sucursal) })
    return ["Todas", ...Array.from(set).sort((a, b) => a.localeCompare(b, "es"))]
  }, [db.equipos, db.reportes])

  const fromDate = useMemo(() => rangeStart(rangeFilter), [rangeFilter])

  // ─── Datos filtrados ────────────────────────────────────────────────────────
  const filteredReportes = useMemo<Reporte[]>(() => {
    return db.reportes.filter((r) => {
      const date = String(r.Fecha || "").slice(0, 10)
      if (date && date < fromDate) return false
      if (sucursalFilter !== "Todas" && r.Sucursal !== sucursalFilter) return false
      if (tipoFilter !== "Todos" && r.Tipo !== tipoFilter) return false
      return true
    })
  }, [db.reportes, fromDate, sucursalFilter, tipoFilter])

  const visibleEquipos = useMemo<Equipo[]>(() => {
    return sucursalFilter === "Todas"
      ? db.equipos
      : db.equipos.filter((e) => e.Sucursal === sucursalFilter)
  }, [db.equipos, sucursalFilter])

  // ─── Métricas ───────────────────────────────────────────────────────────────
  const totalEquipos = visibleEquipos.length
  const equiposActivos = visibleEquipos.filter((e) => String(e.Estado || "Activo").toLowerCase() === "activo").length
  const equiposInactivos = totalEquipos - equiposActivos
  const alertasPulsos = visibleEquipos.filter((e) => Number(e.P_Cabeza || 0) >= Number(e.Max_Cabeza || 6_000_000) * 0.8)

  const reportesTotal = filteredReportes.length
  const reportesPreventivos = filteredReportes.filter((r) => r.Tipo === "Preventivo").length
  const reportesCorrectivos = filteredReportes.filter((r) => r.Tipo === "Correctivo").length
  const reportesGarantia = filteredReportes.filter((r) => r.Tipo === "Garantía").length
  const reportesPagoServicio = filteredReportes.filter((r) => r.Tipo === "Pago por servicio").length
  const reportesPendientes = filteredReportes.filter((r) => r.EstadoEquipo === "Fuera de servicio" || r.EstadoEquipo === "Observación").length
  const reportesCompletados = reportesTotal - reportesPendientes

  const inventario = db.inventario || []
  const inventarioFiltrado = useMemo(() => {
    if (sucursalFilter === "Todas") return inventario
    // Filtramos por stock de la sucursal seleccionada — solo aplica si el
    // nombre matchea uno de los slots conocidos.
    const slot = ({
      "Rafael Vidal": "StockRafaelVidal",
      "Los Jardines": "StockLosJardines",
      "Villa Olga": "StockVillaOlga",
      "La Vega": "StockLaVega",
    } as const)[sucursalFilter as "Rafael Vidal" | "Los Jardines" | "Villa Olga" | "La Vega"]
    if (!slot) return inventario
    return inventario.filter((i) => Number(i[slot] || 0) > 0 || Number(i.StockMinimo || 0) > 0)
  }, [inventario, sucursalFilter])

  const totalPiezas = inventarioFiltrado.length
  const piezasStockBajo = inventarioFiltrado.filter((i) => {
    const total = totalStock(i)
    return Number(i.StockMinimo || 0) > 0 && total <= Number(i.StockMinimo || 0)
  })
  const piezasSinStock = inventarioFiltrado.filter((i) => totalStock(i) === 0)

  const piezasPolizaFiltradas = useMemo(
    () => (sucursalFilter === "Todas" ? piezasPoliza : piezasPoliza.filter((p) => p.Sucursal === sucursalFilter)),
    [piezasPoliza, sucursalFilter],
  )
  const piezasPendientesRecibir = piezasPolizaFiltradas.filter((p) => p.Estado === "pendiente")
  const piezasRecibidasRecientes = piezasPolizaFiltradas
    .filter((p) => p.Estado === "recibida" && p.FechaRecibida)
    .sort((a, b) => String(b.FechaRecibida || "").localeCompare(String(a.FechaRecibida || "")))
    .slice(0, 5)

  // Rankings ────────────────────────────────────────────────────────────────
  const topEquipos = useMemo(() => {
    const count: Record<string, number> = {}
    const lastDate: Record<string, string> = {}
    const lastSucursal: Record<string, string> = {}
    filteredReportes.forEach((r) => {
      const id = r.EquipoID || "Sin equipo"
      count[id] = (count[id] || 0) + 1
      if (!lastDate[id] || String(r.Fecha) > String(lastDate[id])) {
        lastDate[id] = r.Fecha
        lastSucursal[id] = r.Sucursal || ""
      }
    })
    return Object.entries(count)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([equipoId, n]) => ({ equipoId, count: n, lastDate: lastDate[equipoId], sucursal: lastSucursal[equipoId] }))
  }, [filteredReportes])

  const topPiezasUsadas = useMemo(() => {
    const map: Record<string, { usos: number; reemplazos: number }> = {}
    filteredReportes.forEach((r) => {
      parsePiezas(r.PiezasJSON).forEach((p) => {
        const key = p.pieza || "Sin pieza"
        if (!map[key]) map[key] = { usos: 0, reemplazos: 0 }
        map[key].usos += 1
        if (String(p.reemplazo || "").toLowerCase().startsWith("s")) map[key].reemplazos += 1
      })
    })
    return Object.entries(map)
      .sort((a, b) => b[1].usos - a[1].usos)
      .slice(0, 6)
      .map(([pieza, item]) => ({ pieza, ...item }))
  }, [filteredReportes])

  // Técnico con más reportes del rango
  const topTecnico = useMemo(() => {
    const count: Record<string, number> = {}
    filteredReportes.forEach((r) => {
      const t = (r.Atendio || "").trim()
      if (t) count[t] = (count[t] || 0) + 1
    })
    const entries = Object.entries(count).sort((a, b) => b[1] - a[1])
    return entries[0] ? { nombre: entries[0][0], reportes: entries[0][1] } : null
  }, [filteredReportes])

  // Sucursal con más reportes (cuando filtro=Todas)
  const topSucursal = useMemo(() => {
    const count: Record<string, number> = {}
    filteredReportes.forEach((r) => {
      const s = (r.Sucursal || "").trim()
      if (s) count[s] = (count[s] || 0) + 1
    })
    const entries = Object.entries(count).sort((a, b) => b[1] - a[1])
    return entries[0] ? { nombre: entries[0][0], reportes: entries[0][1] } : null
  }, [filteredReportes])

  // Pulsos totales
  const pulsosTotales = visibleEquipos.reduce((sum, e) => sum + Number(e.P_Totales || 0), 0)
  const promedioPulsos = visibleEquipos.length ? Math.round(pulsosTotales / visibleEquipos.length) : 0

  // Actividad reciente — últimos 8 reportes del rango filtrado
  const actividadReciente = useMemo(() => {
    return [...filteredReportes]
      .sort((a, b) => String(b.Fecha || "").localeCompare(String(a.Fecha || "")))
      .slice(0, 8)
  }, [filteredReportes])

  const tecnicosTotal = db.tecnicos.length
  const tecnicosActivos = db.tecnicos.filter((t) => String(t.Estado || "Activo").toLowerCase() === "activo").length

  const pulseReal = dbPulsos.lecturasSemanales.reduce((sum, item) => sum + Number(item.DiferenciaReal || 0), 0)
  const pulseReportado = dbPulsos.sesionesCliente.reduce((sum, item) => sum + Number(item.DisparosReportados || 0), 0)

  // ─── Cuadres semanales (csl_auditorias_semanales) ──────────────────────────
  // El wizard "Cuadre semanal" persiste un snapshot por equipo/semana/cabina.
  // Acá leemos lo que está en el store (dbPulsos.auditoriasSemanales viene
  // de getAllPulsosData ya filtrado por tenant) y lo cruzamos con los filtros
  // del dashboard (sucursal + rango fecha).
  const auditoriasFiltradas = useMemo(() => {
    return (dbPulsos.auditoriasSemanales || []).filter((a) => {
      const date = String(a.FechaSemana || "").slice(0, 10)
      if (date && date < fromDate) return false
      if (sucursalFilter !== "Todas" && a.Sucursal !== sucursalFilter) return false
      return true
    })
  }, [dbPulsos.auditoriasSemanales, fromDate, sucursalFilter])

  const cuadresOK = auditoriasFiltradas.filter((a) => a.Alerta === "OK").length
  const cuadresAdv = auditoriasFiltradas.filter((a) => a.Alerta === "Advertencia").length
  const cuadresCrit = auditoriasFiltradas.filter((a) => a.Alerta === "Critico").length
  const cuadresDisparosLaser = auditoriasFiltradas.reduce((s, a) => s + Number(a.PulsosReales || 0), 0)
  const cuadresDisparosOperador = auditoriasFiltradas.reduce((s, a) => s + Number(a.PulsosReportados || 0), 0)
  const cuadresDifTotal = cuadresDisparosOperador - cuadresDisparosLaser

  // Ranking de equipos con mayor desviación absoluta en el rango.
  const equiposMayorDesviacion = useMemo(() => {
    return [...auditoriasFiltradas]
      .sort((a, b) => Math.abs(Number(b.Diferencia || 0)) - Math.abs(Number(a.Diferencia || 0)))
      .slice(0, 6)
  }, [auditoriasFiltradas])

  // Tendencia por semana: agrupa auditorías por FechaSemana, suma reales +
  // reportados, devuelve las últimas 8 semanas ordenadas.
  const tendenciaSemanal = useMemo(() => {
    const map = new Map<string, { semana: string; laser: number; operador: number; alertas: number }>()
    for (const a of auditoriasFiltradas) {
      const semana = String(a.FechaSemana || "").slice(0, 10)
      if (!semana) continue
      const acc = map.get(semana) || { semana, laser: 0, operador: 0, alertas: 0 }
      acc.laser += Number(a.PulsosReales || 0)
      acc.operador += Number(a.PulsosReportados || 0)
      if (a.Alerta && a.Alerta !== "OK") acc.alertas += 1
      map.set(semana, acc)
    }
    return Array.from(map.values())
      .sort((a, b) => b.semana.localeCompare(a.semana))
      .slice(0, 8)
      .reverse()
  }, [auditoriasFiltradas])

  // Pico para el mini-chart (escala el ancho de las barras).
  const tendenciaMax = Math.max(1, ...tendenciaSemanal.flatMap((t) => [t.laser, t.operador]))

  return (
    <div className="csl-page-shell">
      {/* Hero ejecutivo */}
      <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_22px_70px_rgba(15,45,68,.09)]">
        <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-cyan-100 blur-3xl" />
        <div className="relative grid gap-6 lg:grid-cols-[1.35fr_.65fr] lg:items-end">
          <div>
            <p className="csl-kicker">Dashboard ejecutivo · {business.shortName}</p>
            <h2 className="mt-2 font-heading text-3xl font-black tracking-tight text-slate-950 md:text-5xl">
              Control operativo de mantenimiento
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Resumen general de mantenimiento, equipos, inventario y reportes. Filtra por rango,
              sucursal y tipo de servicio para ajustar todas las métricas.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MiniMetric label="Disp. láser" value={pulseReal} icon={<Activity className="h-4 w-4" />} />
            <MiniMetric label="Disp. operador" value={pulseReportado} icon={<BarChart3 className="h-4 w-4" />} />
          </div>
        </div>
      </section>

      {/* Filtros */}
      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-3">
          <FilterField icon={<CalendarRange className="h-4 w-4" />} label="Rango de fecha">
            <Select value={rangeFilter} onValueChange={(value) => setRangeFilter(value as DateRange)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DATE_RANGES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField icon={<Filter className="h-4 w-4" />} label="Sucursal">
            <Select value={sucursalFilter} onValueChange={setSucursalFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {sucursalesOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField icon={<ClipboardList className="h-4 w-4" />} label="Tipo de servicio">
            <Select value={tipoFilter} onValueChange={(value) => setTipoFilter(value as TipoReporteFilter)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIPOS_REPORTE.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterField>
        </CardContent>
      </Card>

      {/* KPIs principales — 5 cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          title="Total equipos"
          value={totalEquipos}
          icon={Wrench}
          variant="primary"
          description={`${equiposActivos.toLocaleString("es-DO")} activos · ${equiposInactivos.toLocaleString("es-DO")} inactivos`}
        />
        <KpiCard
          title="Reportes del rango"
          value={reportesTotal}
          icon={ClipboardList}
          variant="success"
          description={`${reportesCompletados.toLocaleString("es-DO")} completados · ${reportesPendientes.toLocaleString("es-DO")} pendientes`}
        />
        <KpiCard
          title="Pendientes"
          value={reportesPendientes}
          icon={AlertTriangle}
          variant="warning"
          description="Reportes con equipo en observación o fuera de servicio"
        />
        <KpiCard
          title="Stock bajo"
          value={piezasStockBajo.length}
          icon={Package}
          variant="warning"
          description={`${piezasSinStock.length.toLocaleString("es-DO")} sin stock · ${totalPiezas.toLocaleString("es-DO")} piezas`}
        />
        <KpiCard
          title="Piezas pendientes"
          value={piezasPendientesRecibir.length}
          icon={ClipboardCheck}
          variant="destructive"
          description="Pendientes por recibir del suplidor"
        />
      </div>

      {/* Estado de mantenimiento */}
      <Card className="overflow-hidden py-0">
        <CardHeader className="border-b border-slate-100 bg-slate-50/70 py-5">
          <CardTitle className="flex items-center gap-2 text-xl">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Estado de mantenimiento
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 p-6 md:grid-cols-3 lg:grid-cols-6">
          <StatusTile label="Preventivos" value={reportesPreventivos} color="bg-emerald-300" />
          <StatusTile label="Correctivos" value={reportesCorrectivos} color="bg-rose-300" />
          <StatusTile label="Garantías" value={reportesGarantia} color="bg-cyan-300" />
          <StatusTile label="Pago por servicio" value={reportesPagoServicio} color="bg-violet-300" />
          <StatusTile label="Pendientes" value={reportesPendientes} color="bg-amber-300" />
          <StatusTile label="Completados" value={reportesCompletados} color="bg-slate-300" />
        </CardContent>
      </Card>

      {/* Equipos críticos + Alertas pulsos */}
      <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
        <Card className="overflow-hidden py-0">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70 py-5">
            <CardTitle className="flex items-center gap-2 text-xl">
              <BarChart3 className="h-5 w-5 text-primary" />
              Equipos con más reportes (rango filtrado)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Equipo</TableHead>
                  <TableHead>Sucursal</TableHead>
                  <TableHead className="text-right">Reportes</TableHead>
                  <TableHead className="text-right">Última intervención</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topEquipos.length ? topEquipos.map((eq) => (
                  <TableRow key={eq.equipoId}>
                    <TableCell className="font-bold">{eq.equipoId}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{eq.sucursal || "—"}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">{eq.count.toLocaleString("es-DO")}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{formatDate(eq.lastDate)}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">Sin reportes en el rango.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="overflow-hidden py-0">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70 py-5">
            <CardTitle className="flex items-center gap-2 text-xl">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Equipos cerca del límite de cabeza
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {alertasPulsos.length ? (
              <div className="divide-y divide-slate-100">
                {alertasPulsos.slice(0, 6).map((equipo) => (
                  <div key={equipo.EquipoID} className="flex items-center justify-between gap-4 px-5 py-3.5">
                    <div className="min-w-0">
                      <div className="truncate font-bold">{equipo.EquipoID} · {equipo.Modelo}</div>
                      <div className="text-xs text-muted-foreground">{equipo.Sucursal}</div>
                    </div>
                    <Badge className="border-amber-200 bg-amber-50 text-amber-700">
                      {Number(equipo.P_Cabeza || 0).toLocaleString("es-DO")}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Sin alertas de límite de cabeza.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Inventario y piezas */}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="overflow-hidden py-0">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70 py-5">
            <CardTitle className="flex items-center gap-2 text-xl">
              <Boxes className="h-5 w-5 text-primary" />
              Piezas con stock bajo
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pieza</TableHead>
                  <TableHead className="text-right">Stock total</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {piezasStockBajo.length ? piezasStockBajo.slice(0, 8).map((p) => (
                  <TableRow key={p.ItemID}>
                    <TableCell className="font-semibold">{p.Pieza}</TableCell>
                    <TableCell className="text-right">
                      <Badge className="border-rose-200 bg-rose-50 text-rose-700">
                        {totalStock(p).toLocaleString("es-DO")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{Number(p.StockMinimo || 0).toLocaleString("es-DO")}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">Inventario dentro de mínimos.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="overflow-hidden py-0">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70 py-5">
            <CardTitle className="flex items-center gap-2 text-xl">
              <ClipboardCheck className="h-5 w-5 text-primary" />
              Piezas póliza
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            <div className="grid grid-cols-2 gap-3">
              <SummaryTile label="Pendientes por recibir" value={piezasPendientesRecibir.length} accent="border-amber-200 bg-amber-50 text-amber-700" />
              <SummaryTile label="Recibidas recientes" value={piezasRecibidasRecientes.length} accent="border-emerald-200 bg-emerald-50 text-emerald-700" />
            </div>
            <div className="rounded-xl border bg-slate-50/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pieza</TableHead>
                    <TableHead>Suplidor</TableHead>
                    <TableHead className="text-right">Solicitada</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {piezasPendientesRecibir.length ? piezasPendientesRecibir.slice(0, 6).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-semibold">{p.PiezaNombre}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.Suplidor || "—"}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{formatDate(p.FechaSolicitada)}</TableCell>
                    </TableRow>
                  )) : (
                    <TableRow>
                      <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">Sin piezas pendientes.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top piezas usadas + Técnico/sucursal destacado */}
      <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
        <Card className="overflow-hidden py-0">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70 py-5">
            <CardTitle className="flex items-center gap-2 text-xl">
              <Cog className="h-5 w-5 text-primary" />
              Piezas más utilizadas
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pieza</TableHead>
                  <TableHead className="text-right">Usos</TableHead>
                  <TableHead className="text-right">Reemplazos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topPiezasUsadas.length ? topPiezasUsadas.map((p) => (
                  <TableRow key={p.pieza}>
                    <TableCell className="font-semibold">{p.pieza}</TableCell>
                    <TableCell className="text-right">{p.usos.toLocaleString("es-DO")}</TableCell>
                    <TableCell className="text-right">
                      {p.reemplazos > 0
                        ? <Badge className="border-primary/25 bg-primary/10 text-primary">{p.reemplazos.toLocaleString("es-DO")}</Badge>
                        : "—"}
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">Sin piezas registradas en el rango.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Técnicos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pb-5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total</span>
                <span className="font-bold">{tecnicosTotal.toLocaleString("es-DO")}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Activos</span>
                <span className="font-bold text-emerald-600">{tecnicosActivos.toLocaleString("es-DO")}</span>
              </div>
              {topTecnico ? (
                <div className="mt-3 rounded-xl border bg-slate-50/60 p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Más activo del rango</div>
                  <div className="mt-1 truncate text-sm font-bold">{topTecnico.nombre}</div>
                  <div className="text-xs text-muted-foreground">{topTecnico.reportes.toLocaleString("es-DO")} reportes</div>
                </div>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Sucursales</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pb-5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total equipos</span>
                <span className="font-bold">{totalEquipos.toLocaleString("es-DO")}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Pulsos totales</span>
                <span className="font-bold">{pulsosTotales.toLocaleString("es-DO")}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Promedio / equipo</span>
                <span className="font-bold">{promedioPulsos.toLocaleString("es-DO")}</span>
              </div>
              {topSucursal ? (
                <div className="mt-3 rounded-xl border bg-slate-50/60 p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Con más reportes</div>
                  <div className="mt-1 truncate text-sm font-bold">{topSucursal.nombre}</div>
                  <div className="text-xs text-muted-foreground">{topSucursal.reportes.toLocaleString("es-DO")} reportes</div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Actividad reciente */}
      <Card className="overflow-hidden py-0">
        <CardHeader className="border-b border-slate-100 bg-slate-50/70 py-5">
          <CardTitle className="flex items-center gap-2 text-xl">
            <ClipboardList className="h-5 w-5 text-primary" />
            Actividad reciente
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Equipo</TableHead>
                <TableHead>Sucursal</TableHead>
                <TableHead>Técnico</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {actividadReciente.length ? actividadReciente.map((r) => (
                <TableRow key={r.ID}>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(r.Fecha)}</TableCell>
                  <TableCell className="font-bold">{r.EquipoID}</TableCell>
                  <TableCell className="text-xs">{r.Sucursal || "—"}</TableCell>
                  <TableCell className="text-xs">{r.Atendio || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{r.Tipo}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className={
                      r.EstadoEquipo === "Operativo"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : r.EstadoEquipo === "Observación"
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : "border-rose-200 bg-rose-50 text-rose-700"
                    }>{r.EstadoEquipo}</Badge>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Sin actividad en el rango.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Cuadres semanales PulseControl — snapshot persistido por el wizard
          en csl_auditorias_semanales. Si no hay auditorías guardadas en el
          rango, muestra estado vacío. */}
      <Card className="overflow-hidden py-0">
        <CardHeader className="border-b border-slate-100 bg-slate-50/70 py-5">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Activity className="h-5 w-5 text-primary" />
            Cuadres semanales PulseControl
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard title="Cuadres en rango" value={auditoriasFiltradas.length} icon={ClipboardCheck} variant="primary"
              description={`${cuadresOK} OK · ${cuadresAdv} adv · ${cuadresCrit} crit`} />
            <KpiCard title="Disp. láser" value={cuadresDisparosLaser} icon={Activity} variant="success" description="Reales (lectura del equipo)" />
            <KpiCard title="Disp. operador" value={cuadresDisparosOperador} icon={BarChart3} variant="success" description="Reportados por operadora" />
            <KpiCard title="Diferencia total" value={cuadresDifTotal} icon={AlertTriangle}
              variant={cuadresDifTotal === 0 ? "primary" : cuadresCrit > 0 ? "destructive" : "warning"}
              description={cuadresDifTotal > 0 ? "Operador reportó de más" : cuadresDifTotal < 0 ? "Operador reportó de menos" : "Cuadrado"} />
            <KpiCard title="Críticos" value={cuadresCrit} icon={AlertTriangle}
              variant={cuadresCrit > 0 ? "destructive" : "success"}
              description="Equipos con >15% de desviación" />
          </div>

          {auditoriasFiltradas.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-slate-50/60 p-6 text-center text-sm text-muted-foreground">
              Sin cuadres semanales guardados para este rango y sucursal. Usa el wizard <b>PulseControl → Cuadre semanal</b> para registrar uno.
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
              {/* Tendencia por semana (mini-chart de barras horizontales) */}
              <div className="rounded-xl border bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-sm font-bold">Tendencia disp. láser vs reportado</h4>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{tendenciaSemanal.length} semanas</span>
                </div>
                {tendenciaSemanal.length ? (
                  <div className="space-y-2">
                    {tendenciaSemanal.map((t) => (
                      <div key={t.semana} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono text-muted-foreground">{formatDate(t.semana)}</span>
                          <span>
                            <span className="text-cyan-700 font-bold">{t.laser.toLocaleString("es-DO")}</span>
                            <span className="text-muted-foreground"> vs </span>
                            <span className="text-violet-700 font-bold">{t.operador.toLocaleString("es-DO")}</span>
                            {t.alertas > 0 ? <span className="ml-2 inline-flex rounded-full bg-rose-50 px-1.5 py-0.5 text-[9px] font-bold text-rose-700">{t.alertas} alertas</span> : null}
                          </span>
                        </div>
                        <div className="flex gap-1">
                          <div className="h-2 rounded-full bg-cyan-200" style={{ width: `${(t.laser / tendenciaMax) * 100}%` }} title={`Láser: ${t.laser.toLocaleString("es-DO")}`} />
                          <div className="h-2 rounded-full bg-violet-300" style={{ width: `${(t.operador / tendenciaMax) * 100}%` }} title={`Operador: ${t.operador.toLocaleString("es-DO")}`} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-6 text-center text-xs text-muted-foreground">Sin datos para graficar.</p>
                )}
              </div>

              {/* Equipos con mayor desviación */}
              <div className="rounded-xl border bg-white p-0 overflow-hidden">
                <div className="border-b bg-slate-50/60 px-4 py-2.5">
                  <h4 className="text-sm font-bold">Equipos con mayor desviación</h4>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Equipo</TableHead>
                      <TableHead>Semana</TableHead>
                      <TableHead className="text-right">Diferencia</TableHead>
                      <TableHead className="text-right">%</TableHead>
                      <TableHead>Alerta</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {equiposMayorDesviacion.map((a) => (
                      <TableRow key={a.AuditoriaID}>
                        <TableCell>
                          <div className="font-bold text-xs">{a.EquipoID}</div>
                          <div className="text-[10px] text-muted-foreground">{a.Sucursal}{a.Cabina ? ` · ${a.Cabina}` : ""}</div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDate(a.FechaSemana)}</TableCell>
                        <TableCell className={`text-right font-mono text-xs ${Number(a.Diferencia) > 0 ? "text-rose-600" : Number(a.Diferencia) < 0 ? "text-sky-600" : ""}`}>
                          {Number(a.Diferencia) > 0 ? "+" : ""}{Number(a.Diferencia || 0).toLocaleString("es-DO")}
                        </TableCell>
                        <TableCell className="text-right text-xs">{Number(a.PorcentajeDesviacion || 0).toFixed(1)}%</TableCell>
                        <TableCell>
                          <Badge className={
                            a.Alerta === "OK"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : a.Alerta === "Advertencia"
                                ? "border-amber-200 bg-amber-50 text-amber-700"
                                : "border-rose-200 bg-rose-50 text-rose-700"
                          }>{a.Alerta}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

function MiniMetric({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-primary/12 text-primary">{icon}</div>
      <div className="font-heading text-2xl font-black tracking-tight">{value.toLocaleString("es-DO")}</div>
      <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{label}</div>
    </div>
  )
}

function FilterField({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </Label>
      {children}
    </div>
  )
}

function StatusTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between text-sm">
        <span className="font-bold text-slate-700">{label}</span>
        <span className="font-heading text-lg font-black tracking-tight">{value.toLocaleString("es-DO")}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: value > 0 ? "100%" : "4%" }} />
      </div>
    </div>
  )
}

function SummaryTile({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className={`rounded-2xl border p-3 text-center ${accent}`}>
      <div className="font-heading text-2xl font-black tracking-tight">{value.toLocaleString("es-DO")}</div>
      <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.16em]">{label}</div>
    </div>
  )
}

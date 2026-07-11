"use client"

/**
 * Dashboard de Requisición de Materiales — estilo EJECUTIVO (kit compartido):
 * KPIs con chip de ícono, paneles redondeados con acción, charts con paleta
 * validada (ejes recesivos, barras con radio, tooltips redondeados). Los
 * ESTADOS usan colores semánticos de estado (nunca la paleta categórica ciclada).
 */
import { useEffect, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { KpiCard } from "@/components/kpi-card"
import {
  DashHeader, DashPanel, DashSkeletonRow, EmptyChart,
  CHART_TEAL, CHART_COLORS, STATUS_COLORS, AXIS_TICK, AXIS_TICK_MUTED, GRID_STROKE, TOOLTIP_STYLE,
} from "@/components/dashboard-kit"
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LabelList,
  PieChart, Pie, Cell, AreaChart, Area,
} from "recharts"
import { ClipboardList, Clock, CheckCircle2, ShoppingCart, PackageCheck, PackageX, XCircle, RefreshCcw, Building2, Package, Truck } from "lucide-react"

interface Dash {
  kpis: {
    totalRequisiciones: number; pendientesAprobacion: number; aprobadas: number; compradas: number
    recibidasCompletas: number; recibidasParciales: number; rechazadas: number
    totalMateriales: number; totalComprado: number
    sucursalTop: string; materialTop: string; proveedorTop: string
  }
  charts: {
    porSucursal: { name: string; value: number }[]
    materialesTop: { name: string; value: number }[]
    gastoPorProveedor: { name: string; value: number }[]
    estados: { name: string; value: number }[]
    tendencia: { name: string; value: number }[]
  }
}

/** Color SEMÁNTICO por estado de requisición (paleta de estado, no categórica). */
function estadoColor(name: string): string {
  const n = name.toLowerCase()
  if (n.includes("rechaz") || n.includes("cancel")) return STATUS_COLORS.critical
  if (n.includes("parcial")) return STATUS_COLORS.serious
  if (n.includes("pendiente")) return STATUS_COLORS.warning
  if (n.includes("aprobad") || n.includes("completa")) return STATUS_COLORS.good
  if (n.includes("comprad")) return CHART_TEAL
  return STATUS_COLORS.neutral
}
const estadoLabel = (name: string) => name.replace(/_/g, " ")

export function ReqMatDashboardPage() {
  const { apiUrl, showToast } = useAppStore()
  const [data, setData] = useState<Dash | null>(null)
  const [loading, setLoading] = useState(true)
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")

  const load = async () => {
    setLoading(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getMaterialDashboard", desde, hasta })
      if (res?.ok) setData(res as unknown as Dash)
      else showToast((res as { error?: string })?.error || "Error", "error")
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al cargar", "error")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [apiUrl])

  const k = data?.kpis
  const c = data?.charts
  const estadosTotal = (c?.estados || []).reduce((s, e) => s + e.value, 0)

  return (
    <div className="space-y-4">
      <DashHeader title="Requisición de materiales" subtitle="Panel de solicitudes, compras y consumo por sucursal" />

      <Card className="rounded-2xl border-[color:var(--brand-border)] shadow-sm">
        <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-end sm:justify-between sm:p-4">
          <div className="grid flex-1 grid-cols-2 gap-2 sm:max-w-md">
            <div><Label className="text-[11px] text-muted-foreground">Desde</Label><Input type="date" className="mt-0.5 h-9" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
            <div><Label className="text-[11px] text-muted-foreground">Hasta</Label><Input type="date" className="mt-0.5 h-9" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
          </div>
          <Button className="h-9 bg-[color:var(--brand-primary)] text-white hover:bg-[color:var(--brand-primary)]/90" onClick={load}><RefreshCcw className="mr-1.5 h-4 w-4" />Actualizar datos</Button>
        </CardContent>
      </Card>

      {loading || !k || !c ? (
        <>
          <DashSkeletonRow n={8} />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-72 animate-pulse rounded-2xl bg-slate-100" />)}
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard title="Requisiciones" value={k.totalRequisiciones} icon={ClipboardList} variant="primary" description="En el período" />
            <KpiCard title="Pendientes aprobación" value={k.pendientesAprobacion} icon={Clock} variant="warning" description="Esperando revisión" />
            <KpiCard title="Aprobadas" value={k.aprobadas} icon={CheckCircle2} variant="success" description="Listas para compra" />
            <KpiCard title="Compradas" value={k.compradas} icon={ShoppingCart} variant="primary" description="En proceso de entrega" />
            <KpiCard title="Recibidas completas" value={k.recibidasCompletas} icon={PackageCheck} variant="success" description="Entregas cerradas" />
            <KpiCard title="Recibidas parciales" value={k.recibidasParciales} icon={PackageCheck} variant="warning" description="Entrega incompleta" />
            <KpiCard title="Rechazadas" value={k.rechazadas} icon={XCircle} variant="destructive" description="No aprobadas" />
            <KpiCard title="Materiales solicitados" value={k.totalMateriales} icon={PackageX} variant="primary" description="Unidades totales" />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <KpiCard title="Sucursal que más solicita" value={k.sucursalTop} icon={Building2} variant="primary" />
            <KpiCard title="Material más solicitado" value={k.materialTop} icon={Package} variant="primary" />
            <KpiCard title="Proveedor más usado" value={k.proveedorTop} icon={Truck} variant="primary" />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <DashPanel title="Solicitudes por sucursal">
              {c.porSucursal.length === 0 ? <EmptyChart /> : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={c.porSucursal} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                    <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={0} />
                    <YAxis hide />
                    <Tooltip formatter={(v: number) => [v, "Requisiciones"]} contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(13,148,136,0.06)" }} />
                    <Bar dataKey="value" name="Requisiciones" fill={CHART_TEAL} radius={[4, 4, 0, 0]} maxBarSize={44}>
                      <LabelList dataKey="value" position="top" style={{ fontSize: 10, fill: "#334155", fontWeight: 600 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </DashPanel>

            <DashPanel title="Estado de requisiciones">
              {estadosTotal === 0 ? <EmptyChart /> : (
                <>
                  <div className="relative h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={c.estados} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="88%" paddingAngle={2} stroke="none">
                          {c.estados.map((e) => <Cell key={e.name} fill={estadoColor(e.name)} />)}
                        </Pie>
                        <Tooltip formatter={(v: number, n: string) => [v, estadoLabel(n)]} contentStyle={TOOLTIP_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Total</span>
                      <span className="text-base font-black tabular-nums text-[color:var(--brand-primary-dark)]">{estadosTotal}</span>
                    </div>
                  </div>
                  <ul className="mt-3 space-y-1.5">
                    {c.estados.map((e) => (
                      <li key={e.name} className="flex items-center gap-2 text-xs">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: estadoColor(e.name) }} />
                        <span className="min-w-0 flex-1 truncate capitalize text-slate-600">{estadoLabel(e.name)}</span>
                        <span className="font-semibold tabular-nums text-slate-500">{estadosTotal ? ((e.value / estadosTotal) * 100).toFixed(1) : "0.0"}%</span>
                        <span className="w-10 text-right font-semibold tabular-nums">{e.value}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </DashPanel>

            <DashPanel title="Materiales más solicitados">
              {c.materialesTop.length === 0 ? <EmptyChart /> : (
                <ResponsiveContainer width="100%" height={Math.max(240, c.materialesTop.length * 28)}>
                  <BarChart data={c.materialesTop} layout="vertical" margin={{ left: 8, right: 28 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={AXIS_TICK_MUTED} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="name" width={120} tick={AXIS_TICK} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(v: number) => [v, "Cantidad"]} contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(13,148,136,0.06)" }} />
                    <Bar dataKey="value" name="Cantidad" fill={CHART_TEAL} radius={[0, 4, 4, 0]} maxBarSize={18}>
                      <LabelList dataKey="value" position="right" style={{ fontSize: 10, fill: "#334155", fontWeight: 600 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </DashPanel>

            <DashPanel title="Tendencia mensual (requisiciones)">
              {c.tendencia.length === 0 ? <EmptyChart /> : (
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={c.tendencia} margin={{ top: 16, right: 12, left: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="reqTrendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART_TEAL} stopOpacity={0.18} />
                        <stop offset="100%" stopColor={CHART_TEAL} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                    <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tick={AXIS_TICK_MUTED} tickLine={false} axisLine={false} width={34} />
                    <Tooltip formatter={(v: number) => [v, "Requisiciones"]} contentStyle={TOOLTIP_STYLE} />
                    <Area type="monotone" dataKey="value" name="Requisiciones" stroke={CHART_TEAL} strokeWidth={2} fill="url(#reqTrendFill)" dot={{ r: 3, fill: CHART_TEAL, strokeWidth: 0 }} activeDot={{ r: 5 }} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </DashPanel>

            <DashPanel title="Gasto por proveedor (RD$)" className="lg:col-span-2">
              {c.gastoPorProveedor.length === 0 ? <EmptyChart /> : (
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={c.gastoPorProveedor} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                    <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={0} />
                    <YAxis tick={AXIS_TICK_MUTED} tickLine={false} axisLine={false} width={54} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}K` : String(v))} />
                    <Tooltip formatter={(v: number) => ["RD$" + (Number(v) || 0).toLocaleString("en-US", { minimumFractionDigits: 2 }), "Gasto"]} contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(217,119,6,0.06)" }} />
                    <Bar dataKey="value" name="Gasto" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} maxBarSize={44} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </DashPanel>
          </div>
        </>
      )}
    </div>
  )
}

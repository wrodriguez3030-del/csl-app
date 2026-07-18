"use client"

/**
 * BI FINANCIERO IA — Pantallas de datos (fuente única: getBiFinanceData /
 * getBiFinanceForecast). Estilo ejecutivo compartido (dashboard-kit / kpi-card).
 * Cada pantalla incluye "Preguntar a la IA" sobre datos REALES del período.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { apiJsonp } from "@/lib/store"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { getBusinessBranding } from "@/lib/business"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DashPanel, EmptyChart, InsightItem } from "@/components/dashboard-kit"
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LabelList,
  PieChart, Pie, Cell, AreaChart, Area, LineChart, Line, Legend,
} from "recharts"
import {
  CircleDollarSign, Wallet, TrendingUp, Percent, Users, Receipt, ShoppingBag, Zap,
  Building2, PiggyBank, Bell, FileSpreadsheet, Printer, Sparkles, Plus, Trash2, Loader2,
  ArrowUpRight, ArrowDownRight, LineChart as LineChartIcon, Package, RefreshCcw, Pencil, CheckCircle2,
  Info, AlertTriangle,
} from "lucide-react"
import {
  useBiData, useBiStore, BiPeriodBar, BiKpiGrid, BiHeader, BiLoading, BiError,
  AskAiPanel, branchesFromSummary, fmtRD, fmtRD0, fmtInt, fmtPct, fmtCompact, CHART_COLORS,
  type BiSummary,
} from "./bi-shared"
import { exportBiFinanceExcel, printBiFinancePdf } from "@/lib/bi-finance/bi-export"

const tooltipFmt = (v: number | string) => fmtRD(Number(v))

function useExportHandlers(summary: BiSummary | null) {
  const business = useCurrentBusiness()
  const branding = getBusinessBranding(business.slug)
  const onExcel = useCallback(() => { if (summary) void exportBiFinanceExcel(summary, branding) }, [summary, branding])
  const onPdf = useCallback(() => { if (summary) printBiFinancePdf(summary, branding, window.location.origin) }, [summary, branding])
  return { onExcel, onPdf }
}

function ExportButtons({ summary }: { summary: BiSummary | null }) {
  const { onExcel, onPdf } = useExportHandlers(summary)
  return (
    <>
      <Button variant="outline" size="sm" className="h-9" onClick={onExcel} disabled={!summary}><FileSpreadsheet className="h-4 w-4" /><span className="ml-1 hidden sm:inline">Excel</span></Button>
      <Button variant="outline" size="sm" className="h-9" onClick={onPdf} disabled={!summary}><Printer className="h-4 w-4" /><span className="ml-1 hidden sm:inline">PDF</span></Button>
    </>
  )
}

// ══════════════════════════════════ DASHBOARD ══════════════════════════════
const MESES_CORTO = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
export function BiDashboardPage() {
  const { summary, loading, error, refresh, data, latestPeriod } = useBiData()
  const { setPeriod } = useBiStore()
  const branches = branchesFromSummary(summary)

  if (loading && !summary) return <div className="space-y-4"><BiHeader title="Dashboard financiero" /><BiLoading /></div>
  if (error) return <div className="space-y-4"><BiHeader title="Dashboard financiero" /><BiError message={error} onRetry={refresh} /></div>
  if (!summary) return null
  const sinDatos = summary.resumen.ingresos === 0 && latestPeriod && (latestPeriod.month !== summary.period.month || latestPeriod.year !== summary.period.year)
  const r = summary.resumen
  const gastos = summary.gastos
  const gastoComposicion = [
    { name: "Facturas", value: gastos.facturas },
    { name: "Gastos generales", value: gastos.gastosGenerales },
    { name: "Gastos menores", value: gastos.gastosMenores },
    { name: "Recurrentes", value: gastos.recurrentes },
    { name: "Nómina", value: gastos.nomina },
  ].filter((x) => x.value > 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BiHeader title="Dashboard financiero" subtitle={`${summary.business.name} · ${summary.period.label}`} />
      </div>
      <BiPeriodBar branches={branches} onRefresh={refresh} loading={loading} right={<ExportButtons summary={summary} />} />

      {sinDatos && latestPeriod ? (
        <Card className="rounded-2xl border-amber-200 bg-amber-50 shadow-sm">
          <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm text-amber-800">
            <span className="flex items-center gap-2"><Info className="h-4 w-4" /> No hay ventas registradas en <b>{summary.period.label}</b>. El último mes con datos es {MESES_CORTO[latestPeriod.month]} {latestPeriod.year}.</span>
            <Button size="sm" variant="outline" onClick={() => setPeriod(latestPeriod.month, latestPeriod.year)}>Ver {MESES_CORTO[latestPeriod.month]} {latestPeriod.year}</Button>
          </CardContent>
        </Card>
      ) : null}

      <BiKpiGrid items={[
        { title: "Ingresos", value: fmtRD0(r.ingresos), icon: CircleDollarSign, variant: "primary", description: r.ingresosDeltaPct != null ? `${r.ingresosDeltaPct >= 0 ? "▲" : "▼"} ${fmtPct(Math.abs(r.ingresosDeltaPct))} vs mes anterior` : undefined },
        { title: "Gastos", value: fmtRD0(r.gastos), icon: Wallet, variant: "warning" },
        { title: "Utilidad neta", value: fmtRD0(r.utilidadNeta), icon: TrendingUp, variant: r.utilidadNeta >= 0 ? "success" : "destructive" },
        { title: "Margen neto", value: fmtPct(r.margenNeto), icon: Percent, variant: r.margenNeto >= 15 ? "success" : r.margenNeto >= 0 ? "warning" : "destructive" },
      ]} />
      <BiKpiGrid items={[
        { title: "Ticket promedio", value: fmtRD0(r.ticketPromedio), icon: Receipt, variant: "primary" },
        { title: "Transacciones", value: fmtInt(r.transacciones), icon: ShoppingBag, variant: "primary" },
        { title: "Pacientes", value: fmtInt(r.pacientes), icon: Users, variant: "primary" },
        { title: "Alertas abiertas", value: fmtInt(data?.openAlerts || 0), icon: Bell, variant: (data?.openAlerts || 0) > 0 ? "destructive" : "success" },
      ]} />

      <div className="grid gap-3 lg:grid-cols-2">
        <DashPanel title="Ingresos vs gastos por sucursal">
          {summary.rentabilidad.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={summary.rentabilidad} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="branch" tick={{ fontSize: 10, fill: "#64748B" }} />
                <YAxis tickFormatter={(v) => fmtCompact(Number(v))} tick={{ fontSize: 10, fill: "#94A3B8" }} width={64} />
                <Tooltip formatter={tooltipFmt} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="ingresos" name="Ingresos" fill="#0D9488" radius={[4, 4, 0, 0]} />
                <Bar dataKey="gastos" name="Gastos" fill="#D97706" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </DashPanel>

        <DashPanel title="Composición de gastos">
          {gastoComposicion.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={gastoComposicion} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={2}>
                  {gastoComposicion.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={tooltipFmt} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyChart text="Sin gastos registrados en el período." />}
        </DashPanel>
      </div>

      <DashPanel title="Tendencia 6 meses (ingresos · gastos · utilidad)">
        {summary.trend.some((t) => t.ingresos || t.gastos) ? (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={summary.trend} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <defs>
                <linearGradient id="gIng" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#0D9488" stopOpacity={0.3} /><stop offset="95%" stopColor="#0D9488" stopOpacity={0} /></linearGradient>
                <linearGradient id="gUtil" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#7C3AED" stopOpacity={0.3} /><stop offset="95%" stopColor="#7C3AED" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748B" }} />
              <YAxis tickFormatter={(v) => fmtCompact(Number(v))} tick={{ fontSize: 10, fill: "#94A3B8" }} width={64} />
              <Tooltip formatter={tooltipFmt} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="ingresos" name="Ingresos" stroke="#0D9488" fill="url(#gIng)" strokeWidth={2} />
              <Area type="monotone" dataKey="gastos" name="Gastos" stroke="#D97706" fill="none" strokeWidth={2} />
              <Area type="monotone" dataKey="utilidad" name="Utilidad" stroke="#7C3AED" fill="url(#gUtil)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        ) : <EmptyChart />}
      </DashPanel>

      <DashPanel title="Insights automáticos">
        <ul className="space-y-2.5">
          {computeInsights(summary).map((it, i) => (
            <InsightItem key={i} tone={it.tone} title={it.title} detail={it.detail}
              icon={it.tone === "success" ? <CheckCircle2 className="h-3.5 w-3.5" /> : it.tone === "warning" ? <AlertTriangle className="h-3.5 w-3.5" /> : <Info className="h-3.5 w-3.5" />} />
          ))}
        </ul>
      </DashPanel>

      <AskAiPanel scope="dashboard" suggestions={[
        "¿Cuál es la salud financiera del negocio este mes?",
        "¿Qué sucursal es más rentable y por qué?",
        "¿Dónde puedo reducir gastos sin afectar ventas?",
        "Dame 3 recomendaciones para mejorar el margen.",
      ]} />
    </div>
  )
}

// ══════════════════════════════════ VENTAS ═════════════════════════════════
export function BiVentasPage() {
  const { summary, loading, error, refresh } = useBiData()
  const branches = branchesFromSummary(summary)
  if (loading && !summary) return <div className="space-y-4"><BiHeader title="Ventas e ingresos" /><BiLoading /></div>
  if (error) return <div className="space-y-4"><BiHeader title="Ventas e ingresos" /><BiError message={error} onRetry={refresh} /></div>
  if (!summary) return null
  const cat = summary.ingresos.porCategoria
  const catData = [
    { name: "Servicios", value: cat.servicio },
    { name: "Productos", value: cat.producto },
    { name: "Depilación láser", value: cat.laser },
  ].filter((x) => x.value > 0)

  return (
    <div className="space-y-4">
      <BiHeader title="Ventas e ingresos" subtitle={`${summary.business.name} · ${summary.period.label}`} />
      <BiPeriodBar branches={branches} onRefresh={refresh} loading={loading} right={<ExportButtons summary={summary} />} />
      <BiKpiGrid items={[
        { title: "Ingresos totales", value: fmtRD0(summary.ingresos.total), icon: CircleDollarSign, variant: "primary" },
        { title: "Servicios", value: fmtRD0(cat.servicio), icon: Sparkles, variant: "primary" },
        { title: "Productos", value: fmtRD0(cat.producto), icon: ShoppingBag, variant: "primary" },
        { title: "Depilación láser", value: fmtRD0(cat.laser), icon: Zap, variant: "primary" },
      ]} />
      <div className="grid gap-3 lg:grid-cols-2">
        <DashPanel title="Ingresos por sucursal">
          {summary.rentabilidad.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={summary.rentabilidad} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="branch" tick={{ fontSize: 10, fill: "#64748B" }} />
                <YAxis tickFormatter={(v) => fmtCompact(Number(v))} tick={{ fontSize: 10, fill: "#94A3B8" }} width={64} />
                <Tooltip formatter={tooltipFmt} />
                <Bar dataKey="ingresos" name="Ingresos" fill="#0D9488" radius={[4, 4, 0, 0]}><LabelList dataKey="ingresos" position="top" formatter={(v: number) => fmtCompact(Number(v))} style={{ fontSize: 10, fill: "#475569" }} /></Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </DashPanel>
        <DashPanel title="Composición por categoría">
          {catData.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={catData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={2}>
                  {catData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={tooltipFmt} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </DashPanel>
      </div>
      <DashPanel title="Detalle de ingresos por sucursal">
        <SimpleTable
          head={["Sucursal", "Servicios", "Productos", "Láser", "Total"]}
          rows={summary.rentabilidad.map((r) => [r.branch, fmtRD0(r.categorias.servicio), fmtRD0(r.categorias.producto), fmtRD0(r.categorias.laser), fmtRD0(r.ingresos)])}
          alignRight={[1, 2, 3, 4]}
        />
      </DashPanel>
      <AskAiPanel scope="ventas" suggestions={["¿Qué categoría genera más ingresos?", "¿Qué sucursal vende más productos vs servicios?", "¿Cómo aumentar el ticket promedio?"]} />
    </div>
  )
}

// ══════════════════════════════════ GASTOS ═════════════════════════════════
export function BiGastosPage() {
  const { summary, loading, error, refresh } = useBiData()
  const branches = branchesFromSummary(summary)
  if (loading && !summary) return <div className="space-y-4"><BiHeader title="Gastos y egresos" /><BiLoading /></div>
  if (error) return <div className="space-y-4"><BiHeader title="Gastos y egresos" /><BiError message={error} onRetry={refresh} /></div>
  if (!summary) return null
  const g = summary.gastos
  const comp = [
    { name: "Facturas proveedores", value: g.facturas },
    { name: "Gastos generales", value: g.gastosGenerales },
    { name: "Gastos menores", value: g.gastosMenores },
    { name: "Pagos recurrentes", value: g.recurrentes },
    { name: "Nómina", value: g.nomina },
  ].filter((x) => x.value > 0)

  return (
    <div className="space-y-4">
      <BiHeader title="Gastos y egresos" subtitle={`${summary.business.name} · ${summary.period.label}`} />
      <BiPeriodBar branches={branches} onRefresh={refresh} loading={loading} right={<ExportButtons summary={summary} />} />
      <BiKpiGrid items={[
        { title: "Gastos totales", value: fmtRD0(g.total), icon: Wallet, variant: "warning" },
        { title: "Facturas proveedores", value: fmtRD0(g.facturas), icon: Receipt, variant: "primary" },
        { title: "Gastos generales", value: fmtRD0(g.gastosGenerales), icon: CircleDollarSign, variant: "primary" },
        { title: "Nómina", value: fmtRD0(g.nomina), icon: Users, variant: "primary" },
      ]} />
      <BiKpiGrid items={[
        { title: "Gastos menores", value: fmtRD0(g.gastosMenores), icon: Wallet, variant: "primary" },
        { title: "Pagos recurrentes", value: fmtRD0(g.recurrentes), icon: RefreshCcw, variant: "primary" },
        { title: "Materiales (compras)", value: fmtRD0(g.materiales), icon: Package, variant: "primary", description: "Informativo · ya incluido en facturas" },
        { title: "% sobre ingresos", value: summary.ingresos.total ? fmtPct((g.total / summary.ingresos.total) * 100) : "—", icon: Percent, variant: "warning" },
      ]} />
      <div className="grid gap-3 lg:grid-cols-2">
        <DashPanel title="Composición de gastos">
          {comp.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={comp} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={2}>
                  {comp.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={tooltipFmt} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyChart text="Sin gastos registrados en el período." />}
        </DashPanel>
        <DashPanel title="Gastos por sucursal">
          {summary.rentabilidad.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={summary.rentabilidad} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="branch" tick={{ fontSize: 10, fill: "#64748B" }} />
                <YAxis tickFormatter={(v) => fmtCompact(Number(v))} tick={{ fontSize: 10, fill: "#94A3B8" }} width={64} />
                <Tooltip formatter={tooltipFmt} />
                <Bar dataKey="gastos" name="Gastos" fill="#D97706" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </DashPanel>
      </div>
      <AskAiPanel scope="gastos" suggestions={["¿Cuál es mi mayor rubro de gasto?", "¿Qué gastos puedo optimizar?", "¿La nómina está proporcional a las ventas?"]} />
    </div>
  )
}

// ═══════════════════════════════ RENTABILIDAD ══════════════════════════════
export function BiRentabilidadPage() {
  const { summary, loading, error, refresh } = useBiData()
  const branches = branchesFromSummary(summary)
  if (loading && !summary) return <div className="space-y-4"><BiHeader title="Rentabilidad por sucursal" /><BiLoading /></div>
  if (error) return <div className="space-y-4"><BiHeader title="Rentabilidad por sucursal" /><BiError message={error} onRetry={refresh} /></div>
  if (!summary) return null

  return (
    <div className="space-y-4">
      <BiHeader title="Rentabilidad por sucursal" subtitle={`Utilidad neta = ingresos − gastos · ${summary.period.label}`} />
      <BiPeriodBar branches={branches} onRefresh={refresh} loading={loading} right={<ExportButtons summary={summary} />} />
      <div className="grid gap-3 lg:grid-cols-2">
        <DashPanel title="Utilidad neta por sucursal">
          {summary.rentabilidad.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={summary.rentabilidad} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="branch" tick={{ fontSize: 10, fill: "#64748B" }} />
                <YAxis tickFormatter={(v) => fmtCompact(Number(v))} tick={{ fontSize: 10, fill: "#94A3B8" }} width={64} />
                <Tooltip formatter={tooltipFmt} />
                <Bar dataKey="utilidadNeta" name="Utilidad neta" radius={[4, 4, 0, 0]}>
                  {summary.rentabilidad.map((r, i) => <Cell key={i} fill={r.utilidadNeta >= 0 ? "#059669" : "#E11D48"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </DashPanel>
        <DashPanel title="Margen neto por sucursal">
          {summary.rentabilidad.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={summary.rentabilidad} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10, fill: "#94A3B8" }} />
                <YAxis type="category" dataKey="branch" tick={{ fontSize: 10, fill: "#64748B" }} width={90} />
                <Tooltip formatter={(v: number) => `${Number(v).toFixed(1)}%`} />
                <Bar dataKey="margenNeto" name="Margen neto" radius={[0, 4, 4, 0]}>
                  {summary.rentabilidad.map((r, i) => <Cell key={i} fill={r.margenNeto >= 15 ? "#059669" : r.margenNeto >= 0 ? "#D97706" : "#E11D48"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </DashPanel>
      </div>
      <DashPanel title="Estado de resultados por sucursal">
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span className={`rounded-full px-2 py-0.5 font-semibold ${summary.allocateOverhead ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
            {summary.allocateOverhead ? "Overhead prorrateado por ingresos" : "Overhead sin prorratear (fila aparte)"}
          </span>
          <span>Gastos generales + nómina ({fmtRD0(summary.gastos.overhead.total)}) — configurable en Configuración IA.</span>
        </div>
        <SimpleTable
          head={["Sucursal", "Ingresos", "Facturas", "Generales", "Menores", "Recurrentes", "Overhead", "Gastos", "Utilidad", "Margen"]}
          rows={summary.rentabilidad.map((r) => [
            r.branch, fmtRD0(r.ingresos), fmtRD0(r.desglose.facturas), fmtRD0(r.desglose.gastosGenerales),
            fmtRD0(r.desglose.gastosMenores), fmtRD0(r.desglose.recurrentes), fmtRD0(r.desglose.overheadAsignado),
            fmtRD0(r.gastos), fmtRD0(r.utilidadNeta), fmtPct(r.margenNeto),
          ])}
          alignRight={[1, 2, 3, 4, 5, 6, 7, 8, 9]}
          footer={["TOTAL", fmtRD0(summary.ingresos.total), "", "", "", "", fmtRD0(summary.gastos.overhead.total), fmtRD0(summary.gastos.total), fmtRD0(summary.resumen.utilidadNeta), fmtPct(summary.resumen.margenNeto)]}
        />
      </DashPanel>
      <AskAiPanel scope="rentabilidad" suggestions={["¿Cuál sucursal es más y menos rentable?", "¿Por qué una sucursal tiene menor margen?", "¿Qué haría para que todas superen 15% de margen?"]} />
    </div>
  )
}

// ═══════════════════════════════ PROYECCIONES ══════════════════════════════
export function BiProyeccionesPage() {
  const { month, year } = useBiStore()
  const [metric, setMetric] = useState<"ingresos" | "gastos" | "utilidad">("ingresos")
  const [horizon, setHorizon] = useState(3)
  const [data, setData] = useState<{ historico: { label: string; value: number }[]; proyeccion: Array<Record<string, number | string>>; promedioMovil: number; slope: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await apiJsonp("", { action: "getBiFinanceForecast", metric, horizon, month, year }) as unknown as typeof data
      setData(res)
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo calcular la proyección.") } finally { setLoading(false) }
  }, [metric, horizon, month, year])
  useEffect(() => { void load() }, [load])

  const chartData = useMemo(() => {
    if (!data) return []
    const hist = data.historico.map((h) => ({ label: h.label, real: h.value }))
    const proj = data.proyeccion.map((p) => ({ label: String(p.label), base: p.base, optimista: p.optimista, conservador: p.conservador }))
    return [...hist, ...proj]
  }, [data])

  return (
    <div className="space-y-4">
      <BiHeader title="Proyecciones" subtitle="Promedio móvil + tendencia lineal + escenarios (datos reales de 6 meses)" />
      <Card className="rounded-2xl border-[color:var(--brand-border)] shadow-sm">
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <BiPeriodBarInline />
          <span className="text-xs font-semibold text-muted-foreground">Métrica</span>
          <Select value={metric} onValueChange={(v) => setMetric(v as typeof metric)}>
            <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ingresos">Ingresos</SelectItem>
              <SelectItem value="gastos">Gastos</SelectItem>
              <SelectItem value="utilidad">Utilidad</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs font-semibold text-muted-foreground">Horizonte</span>
          <Select value={String(horizon)} onValueChange={(v) => setHorizon(Number(v))}>
            <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
            <SelectContent>{[3, 6, 12].map((h) => <SelectItem key={h} value={String(h)}>{h} meses</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-9" onClick={load} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}<span className="ml-1">Calcular</span></Button>
        </CardContent>
      </Card>

      {error ? <BiError message={error} onRetry={load} /> : null}
      <DashPanel title={`Proyección de ${metric} · ${horizon} meses`}>
        {chartData.length ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748B" }} />
              <YAxis tickFormatter={(v) => fmtCompact(Number(v))} tick={{ fontSize: 10, fill: "#94A3B8" }} width={64} />
              <Tooltip formatter={tooltipFmt} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="real" name="Histórico" stroke="#0D9488" strokeWidth={2.5} dot />
              <Line type="monotone" dataKey="base" name="Base" stroke="#7C3AED" strokeWidth={2} strokeDasharray="5 4" dot />
              <Line type="monotone" dataKey="optimista" name="Optimista" stroke="#059669" strokeWidth={1.5} strokeDasharray="2 3" dot={false} />
              <Line type="monotone" dataKey="conservador" name="Conservador" stroke="#D97706" strokeWidth={1.5} strokeDasharray="2 3" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : loading ? <EmptyChart text="Calculando…" /> : <EmptyChart />}
      </DashPanel>
      {data ? (
        <DashPanel title="Meses proyectados">
          <SimpleTable
            head={["Mes", "Conservador", "Base", "Optimista"]}
            rows={data.proyeccion.map((p) => [String(p.label), fmtRD0(Number(p.conservador)), fmtRD0(Number(p.base)), fmtRD0(Number(p.optimista))])}
            alignRight={[1, 2, 3]}
          />
        </DashPanel>
      ) : null}
      <AskAiPanel scope="proyecciones" suggestions={["¿Cómo se ven mis próximos 3 meses?", "¿Qué riesgos hay en la tendencia?", "¿Qué debo hacer para alcanzar el escenario optimista?"]} />
    </div>
  )
}

function BiPeriodBarInline() {
  const { month, year, setPeriod } = useBiStore()
  const MESES = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
  const options: { value: string; label: string }[] = []
  const d = new Date(); let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1
  for (let i = 0; i < 18; i++) { options.push({ value: `${y}-${m}`, label: `${MESES[m]} ${y}` }); m--; if (m < 1) { m = 12; y-- } }
  return (
    <>
      <span className="text-xs font-semibold text-muted-foreground">Ancla</span>
      <Select value={`${year}-${month}`} onValueChange={(v) => { const [yy, mm] = v.split("-").map(Number); setPeriod(mm, yy) }}>
        <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
    </>
  )
}

// ═══════════════════════════════ INVERSIONES / ROI ═════════════════════════
interface Investment {
  id?: string; nombre: string; categoria?: string | null; branch?: string | null
  monto_inversion: number; beneficio_estimado: number; beneficio_real?: number | null
  fecha_inicio?: string | null; fecha_fin?: string | null; estado: string
  roi_estimado?: number | null; roi_real?: number | null; payback_meses?: number | null; notas?: string | null
}
const emptyInvestment = (): Investment => ({ nombre: "", categoria: "equipo", monto_inversion: 0, beneficio_estimado: 0, estado: "planificada" })

export function BiInversionesPage() {
  const [rows, setRows] = useState<Investment[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Investment | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { const res = await apiJsonp("", { action: "getBiFinanceInvestments" }) as unknown as { rows: Investment[] }; setRows(res.rows || []) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const save = useCallback(async () => {
    if (!editing || !editing.nombre.trim()) return
    setSaving(true)
    try { await apiJsonp("", { action: "saveBiFinanceInvestment", data: JSON.stringify(editing) }); setEditing(null); await load() } finally { setSaving(false) }
  }, [editing, load])
  const remove = useCallback(async (id?: string) => {
    if (!id || !window.confirm("¿Eliminar esta inversión?")) return
    await apiJsonp("", { action: "deleteBiFinanceInvestment", id }); await load()
  }, [load])

  const totalInv = rows.reduce((s, r) => s + (Number(r.monto_inversion) || 0), 0)
  const roiVals = rows.map((r) => r.roi_real ?? r.roi_estimado).filter((x): x is number => x != null)
  const roiAvg = roiVals.length ? roiVals.reduce((a, b) => a + b, 0) / roiVals.length : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BiHeader title="Inversiones y ROI" subtitle="ROI = (beneficio − inversión) / inversión · payback en meses" />
        <Button size="sm" onClick={() => setEditing(emptyInvestment())}><Plus className="h-4 w-4" /><span className="ml-1">Nueva inversión</span></Button>
      </div>
      <BiKpiGrid items={[
        { title: "Total invertido", value: fmtRD0(totalInv), icon: PiggyBank, variant: "primary" },
        { title: "Inversiones", value: fmtInt(rows.length), icon: LineChartIcon, variant: "primary" },
        { title: "ROI promedio", value: roiAvg == null ? "—" : fmtPct(roiAvg * 100), icon: Percent, variant: roiAvg != null && roiAvg >= 0 ? "success" : "warning" },
        { title: "En curso", value: fmtInt(rows.filter((r) => r.estado === "en_curso").length), icon: RefreshCcw, variant: "primary" },
      ]} />

      {editing ? (
        <Card className="rounded-2xl border-[color:var(--brand-primary-soft)] shadow-sm">
          <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Nombre"><Input value={editing.nombre} onChange={(e) => setEditing({ ...editing, nombre: e.target.value })} /></Field>
            <Field label="Categoría">
              <Select value={editing.categoria || "equipo"} onValueChange={(v) => setEditing({ ...editing, categoria: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["equipo", "marketing", "remodelacion", "personal", "otro"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Estado">
              <Select value={editing.estado} onValueChange={(v) => setEditing({ ...editing, estado: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["planificada", "en_curso", "completada", "cancelada"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Monto inversión (RD$)"><Input type="number" value={editing.monto_inversion} onChange={(e) => setEditing({ ...editing, monto_inversion: Number(e.target.value) })} /></Field>
            <Field label="Beneficio estimado (RD$)"><Input type="number" value={editing.beneficio_estimado} onChange={(e) => setEditing({ ...editing, beneficio_estimado: Number(e.target.value) })} /></Field>
            <Field label="Beneficio real (RD$)"><Input type="number" value={editing.beneficio_real ?? ""} onChange={(e) => setEditing({ ...editing, beneficio_real: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
            <Field label="Fecha inicio"><Input type="date" value={editing.fecha_inicio ?? ""} onChange={(e) => setEditing({ ...editing, fecha_inicio: e.target.value })} /></Field>
            <Field label="Fecha fin"><Input type="date" value={editing.fecha_fin ?? ""} onChange={(e) => setEditing({ ...editing, fecha_fin: e.target.value })} /></Field>
            <Field label="Notas"><Input value={editing.notas ?? ""} onChange={(e) => setEditing({ ...editing, notas: e.target.value })} /></Field>
            <div className="col-span-full flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(null)}>Cancelar</Button>
              <Button size="sm" onClick={save} disabled={saving || !editing.nombre.trim()}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}<span className="ml-1">Guardar</span></Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <DashPanel title="Cartera de inversiones">
        {loading ? <EmptyChart text="Cargando…" /> : rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground">
                {["Nombre", "Categoría", "Estado", "Inversión", "Beneficio", "ROI", "Payback", ""].map((h, i) => <th key={i} className={`p-2 ${i >= 3 && i <= 6 ? "text-right" : ""}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const roi = r.roi_real ?? r.roi_estimado
                  const benef = r.beneficio_real ?? r.beneficio_estimado
                  return (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="p-2 font-medium">{r.nombre}</td>
                      <td className="p-2 text-muted-foreground">{r.categoria}</td>
                      <td className="p-2"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px]">{r.estado}</span></td>
                      <td className="p-2 text-right tabular-nums">{fmtRD0(r.monto_inversion)}</td>
                      <td className="p-2 text-right tabular-nums">{fmtRD0(benef)}</td>
                      <td className={`p-2 text-right font-semibold tabular-nums ${roi != null && roi >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{roi == null ? "—" : fmtPct(roi * 100)}</td>
                      <td className="p-2 text-right tabular-nums">{r.payback_meses != null ? `${r.payback_meses} m` : "—"}</td>
                      <td className="p-2 text-right">
                        <button onClick={() => setEditing(r)} className="mr-2 text-slate-400 hover:text-[color:var(--brand-primary)]"><Pencil className="h-4 w-4" /></button>
                        <button onClick={() => remove(r.id)} className="text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyChart text="Aún no hay inversiones registradas." />}
      </DashPanel>
      <AskAiPanel scope="inversiones" suggestions={["¿Qué inversión tiene mejor ROI?", "¿Cuáles inversiones debería priorizar?", "¿El payback de mis inversiones es razonable?"]} />
    </div>
  )
}

// ═══════════════════════════════ ALERTAS ═══════════════════════════════════
interface Alert {
  id: string; tipo: string; severidad: string; titulo: string; detalle?: string; branch?: string | null
  status: string; source: string; created_at: string; period_month?: number; period_year?: number
}
export function BiAlertasPage() {
  const { month, year } = useBiStore()
  const [rows, setRows] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { const res = await apiJsonp("", { action: "getBiFinanceAlerts" }) as unknown as { rows: Alert[] }; setRows(res.rows || []) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const regenerate = useCallback(async () => {
    setBusy(true)
    try { await apiJsonp("", { action: "generateBiFinanceAlerts", month, year }); await load() } finally { setBusy(false) }
  }, [month, year, load])
  const setStatus = useCallback(async (id: string, status: string) => {
    await apiJsonp("", { action: "updateBiFinanceAlert", id, status }); await load()
  }, [load])

  const sevChip = (s: string) => s === "critica" ? "bg-rose-100 text-rose-700" : s === "alta" ? "bg-amber-100 text-amber-700" : s === "media" ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-600"

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BiHeader title="Alertas financieras" subtitle="Reglas automáticas sobre datos reales (margen bajo, pérdidas, caídas de ventas)" />
        <div className="flex items-center gap-2">
          <BiPeriodBarInline />
          <Button size="sm" onClick={regenerate} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}<span className="ml-1">Recalcular</span></Button>
        </div>
      </div>
      <DashPanel title="Alertas">
        {loading ? <EmptyChart text="Cargando…" /> : rows.length ? (
          <ul className="space-y-2">
            {rows.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-[color:var(--brand-border)] p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${sevChip(a.severidad)}`}>{a.severidad}</span>
                    <span className="text-sm font-semibold">{a.titulo}</span>
                    {a.branch ? <span className="text-xs text-muted-foreground">· {a.branch}</span> : null}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${a.status === "abierta" ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"}`}>{a.status}</span>
                  </div>
                  {a.detalle ? <div className="mt-0.5 text-xs text-muted-foreground">{a.detalle}</div> : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  {a.status === "abierta" ? <Button variant="outline" size="sm" onClick={() => setStatus(a.id, "revisada")}>Revisar</Button> : null}
                  {a.status !== "resuelta" ? <Button variant="outline" size="sm" onClick={() => setStatus(a.id, "resuelta")}>Resolver</Button> : null}
                  {a.status !== "descartada" ? <Button variant="ghost" size="sm" onClick={() => setStatus(a.id, "descartada")}>Descartar</Button> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : <EmptyChart text="Sin alertas. Pulsa Recalcular para evaluar el período." />}
      </DashPanel>
      <AskAiPanel scope="alertas" suggestions={["¿Qué alertas debo atender primero?", "¿Cómo resuelvo el margen bajo?", "¿Qué señales de riesgo ves en mis finanzas?"]} />
    </div>
  )
}

// ═══════════════════════════════ REPORTES EJECUTIVOS ═══════════════════════
export function BiReportesPage() {
  const { summary, loading, error, refresh } = useBiData()
  const { onExcel, onPdf } = useExportHandlers(summary)
  const branches = branchesFromSummary(summary)
  if (loading && !summary) return <div className="space-y-4"><BiHeader title="Reportes ejecutivos" /><BiLoading /></div>
  if (error) return <div className="space-y-4"><BiHeader title="Reportes ejecutivos" /><BiError message={error} onRetry={refresh} /></div>
  if (!summary) return null
  const r = summary.resumen

  return (
    <div className="space-y-4">
      <BiHeader title="Reportes ejecutivos" subtitle={`${summary.business.name} · ${summary.period.label}`} />
      <BiPeriodBar branches={branches} onRefresh={refresh} loading={loading} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ReportCard icon={FileSpreadsheet} title="Reporte financiero Excel" desc="Resumen, ingresos, gastos y rentabilidad por sucursal en hojas separadas." action="Descargar Excel" onClick={onExcel} />
        <ReportCard icon={Printer} title="Reporte ejecutivo PDF" desc="Documento imprimible con KPIs, P&L por sucursal y tendencia." action="Generar PDF" onClick={onPdf} />
        <ReportCard icon={Sparkles} title="Resumen IA del período" desc="Pídele a la IA un resumen ejecutivo con hallazgos y recomendaciones." action="" />
      </div>
      <DashPanel title="Vista previa del período">
        <SimpleTable
          head={["Indicador", "Valor"]}
          rows={[
            ["Ingresos", fmtRD(r.ingresos)],
            ["Gastos", fmtRD(r.gastos)],
            ["Utilidad neta", fmtRD(r.utilidadNeta)],
            ["Margen neto", fmtPct(r.margenNeto)],
            ["Ticket promedio", fmtRD(r.ticketPromedio)],
            ["Transacciones", fmtInt(r.transacciones)],
            ["Pacientes", fmtInt(r.pacientes)],
          ]}
          alignRight={[1]}
        />
      </DashPanel>
      <AskAiPanel scope="reportes" suggestions={["Redáctame un resumen ejecutivo del mes.", "¿Qué destacarías para la junta directiva?", "Dame las 5 conclusiones clave del período."]} />
    </div>
  )
}

function ReportCard({ icon: Icon, title, desc, action, onClick }: { icon: typeof FileSpreadsheet; title: string; desc: string; action: string; onClick?: () => void }) {
  return (
    <Card className="rounded-2xl border-[color:var(--brand-border)] shadow-sm">
      <CardContent className="flex h-full flex-col gap-2 p-4">
        <span className="w-fit rounded-lg bg-[color:var(--brand-primary-soft)] p-2 text-[color:var(--brand-primary)]"><Icon className="h-5 w-5" /></span>
        <h3 className="text-sm font-bold text-[color:var(--brand-primary-dark)]">{title}</h3>
        <p className="flex-1 text-xs text-muted-foreground">{desc}</p>
        {action ? <Button size="sm" variant="outline" onClick={onClick} className="w-full">{action}</Button> : <span className="text-[11px] text-muted-foreground">Usa el panel de abajo ↓</span>}
      </CardContent>
    </Card>
  )
}

// ── Tabla simple reutilizable ────────────────────────────────────────────────
function SimpleTable({ head, rows, alignRight = [], footer }: { head: string[]; rows: (string | number)[][]; alignRight?: number[]; footer?: (string | number)[] }) {
  const isR = (i: number) => alignRight.includes(i)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground">{head.map((h, i) => <th key={i} className={`p-2 ${isR(i) ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b last:border-0">
              {row.map((c, ci) => <td key={ci} className={`p-2 ${isR(ci) ? "text-right tabular-nums" : ""} ${ci === 0 ? "font-medium" : ""}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
        {footer ? <tfoot><tr className="border-t-2 font-bold">{footer.map((c, i) => <td key={i} className={`p-2 ${isR(i) ? "text-right tabular-nums" : ""}`}>{c}</td>)}</tr></tfoot> : null}
      </table>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>
}

/** Insights automáticos por reglas sobre el resumen real (sin IA). */
function computeInsights(summary: BiSummary): { tone: "success" | "info" | "warning"; title: string; detail: string }[] {
  const out: { tone: "success" | "info" | "warning"; title: string; detail: string }[] = []
  const r = summary.resumen
  // Margen consolidado
  if (r.ingresos <= 0) {
    out.push({ tone: "info", title: "Sin ventas registradas en el período", detail: "Importa el archivo de ventas del mes para ver el análisis." })
  } else if (r.utilidadNeta < 0) {
    out.push({ tone: "warning", title: "El negocio operó en pérdida", detail: `Utilidad ${fmtRD0(r.utilidadNeta)} · margen ${fmtPct(r.margenNeto)}.` })
  } else if (r.margenNeto >= 25) {
    out.push({ tone: "success", title: `Margen saludable (${fmtPct(r.margenNeto)})`, detail: `Utilidad neta de ${fmtRD0(r.utilidadNeta)} en el período.` })
  } else {
    out.push({ tone: "warning", title: `Margen a vigilar (${fmtPct(r.margenNeto)})`, detail: `Los gastos representan ${fmtPct((r.gastos / r.ingresos) * 100)} de los ingresos.` })
  }
  // Ventas vs mes anterior
  if (r.ingresosDeltaPct != null) {
    const up = r.ingresosDeltaPct >= 0
    out.push({ tone: up ? "success" : "warning", title: `Ventas ${up ? "▲" : "▼"} ${fmtPct(Math.abs(r.ingresosDeltaPct))} vs mes anterior`, detail: `Ingresos del período: ${fmtRD0(r.ingresos)}.` })
  }
  // Mejor / peor sucursal por margen
  const conIngresos = summary.rentabilidad.filter((b) => b.ingresos > 0 && b.branch !== "(sin sucursal)")
  if (conIngresos.length >= 2) {
    const best = [...conIngresos].sort((a, b) => b.margenNeto - a.margenNeto)[0]
    const worst = [...conIngresos].sort((a, b) => a.margenNeto - b.margenNeto)[0]
    out.push({ tone: "success", title: `${best.branch} es la más rentable`, detail: `Margen ${fmtPct(best.margenNeto)} · utilidad ${fmtRD0(best.utilidadNeta)}.` })
    if (worst.branch !== best.branch && worst.margenNeto < 15) {
      out.push({ tone: "warning", title: `${worst.branch} necesita atención`, detail: `Margen ${fmtPct(worst.margenNeto)} — el más bajo del período.` })
    }
  }
  // Compras vacío (contexto real del negocio)
  if (r.ingresos > 0 && summary.gastos.facturas === 0 && summary.gastos.gastosGenerales === 0 && summary.gastos.gastosMenores === 0) {
    out.push({ tone: "info", title: "Gastos operativos sin registrar en Compras", detail: "Solo se contabiliza la nómina. Registra facturas y gastos en el módulo Compras para un P&L completo." })
  }
  return out
}

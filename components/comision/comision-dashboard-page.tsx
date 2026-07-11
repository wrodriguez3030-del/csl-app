"use client"

/**
 * COMISIÓN DE VENTAS · Dashboard EJECUTIVO.
 * Panel de resultados, incentivos y liquidación mensual: 2 filas de KPIs con
 * comparativas vs mes anterior, 3 gráficos (sucursales / composición donut /
 * tendencia 6 meses), top prestadores, resumen de liquidación e insights.
 * Todos los datos salen de `getCommissionExecutiveDashboard` (una sola llamada);
 * sin datos el layout se mantiene con 0s (nunca se rompe).
 * Paleta validada (dataviz): teal #0D9488 · ámbar #D97706 · violeta #7C3AED · rosa #DB2777.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl, invalidateReadCache } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LabelList,
  PieChart, Pie, Cell, AreaChart, Area,
} from "recharts"
import {
  CircleDollarSign, Percent, Package, Zap, Gift, Wallet,
  Users, Upload, HeartHandshake, ShoppingBag, CreditCard, ReceiptText,
  TrendingUp, TrendingDown, Minus, SlidersHorizontal, Download, RefreshCcw,
  CheckCircle2, AlertTriangle, Info, Loader2,
} from "lucide-react"
import { monthBounds, quickRange, todayInTz } from "@/lib/commission/period"
import { FILTER_MONTHS, defaultCommissionFilters, useCommissionFilters, type CommissionFilters } from "./comision-filter-bar"

const BRANCHES = ["RAFAEL VIDAL", "LOS JARDINES", "VILLA OLGA"]
const TEAL = "#0D9488"
const DONUT_COLORS = ["#0D9488", "#D97706", "#7C3AED", "#DB2777"]

const fmtRD = (n: number) => "RD$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtInt = (n: number) => (Number(n) || 0).toLocaleString("en-US")
const fmtCompact = (n: number) => {
  const v = Number(n) || 0
  if (Math.abs(v) >= 1e6) return `RD$${(v / 1e6).toFixed(2)}M`
  if (Math.abs(v) >= 1e3) return `RD$${Math.round(v / 1e3)}K`
  return `RD$${Math.round(v)}`
}

interface ExecData {
  period: { month: number; year: number; label: string; isFullMonth: boolean; hasPeriod: boolean }
  prevLabel: string
  kpis: {
    salesTotal: number; serviceCommission: number; productIncentive: number; laserIncentive: number
    bonusExtra: number; netTotal: number; employees: number; importsMonth: number
    patients: number; productUnits: number; cardSharePct: number; ticketAvg: number
  }
  deltas: {
    salesTotal: number | null; serviceCommission: number | null; productIncentive: number | null
    laserIncentive: number | null; bonusExtra: number | null; netTotal: number | null
    patients: number | null; productUnits: number | null; cardSharePp: number | null; ticketAvg: number | null
  } | null
  byBranch: { branch: string; gross: number }[]
  composition: { name: string; value: number }[]
  trend: { year: number; month: number; label: string; sales: number }[]
  topProviders: { provider: string; sales: number; commission: number; incentives: number; net: number }[]
  settlement: { gross: number; cleaning: number; discounts: number; net: number }
  insights: { tone: "success" | "info" | "warning"; title: string; detail: string }[]
  providers: string[]
}

// ── Barra de filtros del dashboard (mismo store global del módulo) ──────────
export function DashboardFilterBar({ providers, onRefresh, loading }: {
  providers: string[]; onRefresh: () => void; loading: boolean
}) {
  const { commissionFilters, setCommissionFilters, setActiveTab } = useAppStore()
  const applied = (commissionFilters as CommissionFilters | null) || defaultCommissionFilters()
  const [moreOpen, setMoreOpen] = useState(applied.quick === "personalizado")
  const [range, setRange] = useState({ from: applied.from, to: applied.to })

  const monthOptions = useMemo(() => {
    const [y0, m0] = todayInTz().split("-").map(Number)
    const out: { value: string; label: string }[] = []
    let y = y0, m = m0
    for (let i = 0; i < 18; i++) {
      out.push({ value: `${y}-${m}`, label: `${FILTER_MONTHS[m]} ${y}` })
      m--; if (m < 1) { m = 12; y-- }
    }
    return out
  }, [])

  const monthValue = applied.quick === "todo" ? "todo"
    : applied.quick === "personalizado" ? "personalizado"
    : `${applied.year}-${applied.month}`

  const setMonth = (v: string) => {
    if (v === "todo") {
      const r = quickRange("todo")
      setCommissionFilters({ ...applied, quick: "todo", year: r.year, month: r.month, from: "", to: "" })
      return
    }
    if (v === "personalizado") { setMoreOpen(true); return }
    const [y, m] = v.split("-").map(Number)
    const r = monthBounds(y, m)
    setCommissionFilters({ ...applied, quick: "mes", year: y, month: m, from: r.from, to: r.to })
  }
  const applyRange = (patch: Partial<{ from: string; to: string }>) => {
    const next = { ...range, ...patch }
    setRange(next)
    if (next.from && next.to && next.from <= next.to) {
      const [y, m] = next.from.split("-").map(Number)
      setCommissionFilters({ ...applied, quick: "personalizado", year: y, month: m, from: next.from, to: next.to })
    }
  }

  return (
    <Card className="rounded-2xl border-[color:var(--brand-border)] shadow-sm">
      <CardContent className="space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-44">
            <Label className="text-[11px] text-muted-foreground">Período</Label>
            <Select value={monthValue} onValueChange={setMonth}>
              <SelectTrigger className="mt-0.5 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {monthValue === "personalizado" ? <SelectItem value="personalizado">{applied.from} → {applied.to}</SelectItem> : null}
                {monthOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                <SelectItem value="todo">Todo el historial</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-full sm:w-48">
            <Label className="text-[11px] text-muted-foreground">Sucursal</Label>
            <Select value={applied.branch || "todas"} onValueChange={(v) => setCommissionFilters({ ...applied, branch: v === "todas" ? "" : v })}>
              <SelectTrigger className="mt-0.5 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las sucursales</SelectItem>
                {BRANCHES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full sm:w-48">
            <Label className="text-[11px] text-muted-foreground">Prestador</Label>
            <Select value={applied.provider || "todos"} onValueChange={(v) => setCommissionFilters({ ...applied, provider: v === "todos" ? "" : v })}>
              <SelectTrigger className="mt-0.5 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los prestadores</SelectItem>
                {providers.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="h-9" onClick={() => setMoreOpen((o) => !o)}>
              <SlidersHorizontal className="mr-1.5 h-4 w-4" />Más filtros
            </Button>
            <Button variant="outline" size="sm" className="h-9" onClick={() => setActiveTab("comision-reportes")}>
              <Download className="mr-1.5 h-4 w-4" />Exportar
            </Button>
            <Button size="sm" className="h-9 bg-[color:var(--brand-primary)] text-white hover:bg-[color:var(--brand-primary)]/90" onClick={onRefresh} disabled={loading}>
              {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-1.5 h-4 w-4" />}Actualizar datos
            </Button>
          </div>
        </div>
        {moreOpen ? (
          <div className="flex flex-wrap items-end gap-3 border-t pt-3">
            <div className="w-full sm:w-44">
              <Label className="text-[11px] text-muted-foreground">Desde</Label>
              <Input type="date" className="mt-0.5 h-9" value={range.from} onChange={(e) => applyRange({ from: e.target.value })} />
            </div>
            <div className="w-full sm:w-44">
              <Label className="text-[11px] text-muted-foreground">Hasta</Label>
              <Input type="date" className="mt-0.5 h-9" value={range.to} onChange={(e) => applyRange({ to: e.target.value })} />
            </div>
            <p className="pb-2 text-[11px] text-muted-foreground">Rango personalizado (las comparativas vs mes anterior requieren un mes completo).</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ── KPI cards ────────────────────────────────────────────────────────────────
function DeltaLine({ pct, prevLabel, suffix = "%" }: { pct: number | null | undefined; prevLabel: string | null; suffix?: string }) {
  if (pct == null || !prevLabel) {
    return <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground"><Minus className="h-3 w-3" />sin comparativa</div>
  }
  const Icon = pct > 0 ? TrendingUp : pct < 0 ? TrendingDown : Minus
  const cls = pct > 0 ? "text-emerald-600" : pct < 0 ? "text-red-600" : "text-slate-400"
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
      <span className={`flex items-center gap-0.5 font-semibold ${cls}`}><Icon className="h-3 w-3" />{pct === 0 ? "0.0" : Math.abs(pct).toFixed(1)}{suffix}</span>
      <span className="text-muted-foreground">vs. {prevLabel}</span>
    </div>
  )
}

export function ExecutiveKpiCard({ icon, title, value, pct, prevLabel, suffix, sub }: {
  icon: ReactNode; title: string; value: string
  pct?: number | null; prevLabel?: string | null; suffix?: string; sub?: string
}) {
  return (
    <Card className="rounded-2xl border-[color:var(--brand-border)] shadow-sm">
      <CardContent className="flex items-start gap-3 p-4">
        <div className="shrink-0 rounded-xl bg-[color:var(--brand-primary-soft)] p-2.5 text-[color:var(--brand-primary)]">{icon}</div>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
          <div className="truncate text-lg font-black tabular-nums text-[color:var(--brand-primary-dark)]">{value}</div>
          {sub ? <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
            : <DeltaLine pct={pct} prevLabel={prevLabel ?? null} suffix={suffix} />}
        </div>
      </CardContent>
    </Card>
  )
}

/** KPI operativo: misma anatomía que el ejecutivo (icono + valor + tendencia/nota). */
export function OperationalKpiCard(props: Parameters<typeof ExecutiveKpiCard>[0]) {
  return <ExecutiveKpiCard {...props} />
}

// ── Paneles ──────────────────────────────────────────────────────────────────
function PanelCard({ title, action, onAction, children, className = "" }: {
  title: string; action?: string; onAction?: () => void; children: ReactNode; className?: string
}) {
  return (
    <Card className={`rounded-2xl border-[color:var(--brand-border)] shadow-sm ${className}`}>
      <CardContent className="flex h-full flex-col p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[color:var(--brand-primary-dark)]">{title}</h3>
          {action && onAction ? (
            <button onClick={onAction} className="whitespace-nowrap text-xs font-semibold text-[color:var(--brand-primary)] underline-offset-2 hover:underline">{action} →</button>
          ) : null}
        </div>
        <div className="flex-1">{children}</div>
      </CardContent>
    </Card>
  )
}

const EmptyChart = ({ text = "Sin datos en el período seleccionado." }: { text?: string }) => (
  <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">{text}</div>
)

export function SalesByBranchChart({ data, onDetail }: { data: { branch: string; gross: number }[]; onDetail: () => void }) {
  return (
    <PanelCard title="Ventas por sucursal" action="Ver detalle" onAction={onDetail}>
      {data.length === 0 ? <EmptyChart /> : (
        <ResponsiveContainer width="100%" height={230}>
          <BarChart data={data} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
            <XAxis dataKey="branch" tick={{ fontSize: 10, fill: "#64748B" }} tickLine={false} axisLine={false} interval={0} />
            <YAxis hide />
            <Tooltip formatter={(v: number) => [fmtRD(v), "Ventas"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} cursor={{ fill: "rgba(13,148,136,0.06)" }} />
            <Bar dataKey="gross" name="Ventas" fill={TEAL} radius={[4, 4, 0, 0]} maxBarSize={44}>
              <LabelList dataKey="gross" position="top" formatter={(v: number) => fmtCompact(v)} style={{ fontSize: 10, fill: "#334155", fontWeight: 600 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </PanelCard>
  )
}

export function IncentiveCompositionChart({ data, onDetail }: { data: { name: string; value: number }[]; onDetail: () => void }) {
  const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0)
  const slices = total > 0 ? data.filter((d) => d.value > 0) : [{ name: "Sin datos", value: 1 }]
  const colorOf = (name: string) => {
    const i = data.findIndex((d) => d.name === name)
    return i >= 0 ? DONUT_COLORS[i] : "#E2E8F0"
  }
  return (
    <PanelCard title="Composición de incentivos" action="Ver detalle" onAction={onDetail}>
      <div className="relative h-44">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="88%" paddingAngle={total > 0 ? 2 : 0} stroke="none">
              {slices.map((s) => <Cell key={s.name} fill={total > 0 ? colorOf(s.name) : "#E2E8F0"} />)}
            </Pie>
            {total > 0 ? <Tooltip formatter={(v: number, n: string) => [fmtRD(v), n]} contentStyle={{ fontSize: 12, borderRadius: 8 }} /> : null}
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Total</span>
          <span className="text-base font-black tabular-nums text-[color:var(--brand-primary-dark)]">{fmtRD(total)}</span>
        </div>
      </div>
      <ul className="mt-3 space-y-1.5">
        {data.map((d, i) => {
          const pct = total > 0 ? (d.value / total) * 100 : 0
          return (
            <li key={d.name} className="flex items-center gap-2 text-xs">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: DONUT_COLORS[i] }} />
              <span className="min-w-0 flex-1 truncate text-slate-600">{d.name}</span>
              <span className="font-semibold tabular-nums text-slate-500">{pct.toFixed(1)}%</span>
              <span className="w-24 text-right font-semibold tabular-nums">{fmtRD(d.value)}</span>
            </li>
          )
        })}
      </ul>
    </PanelCard>
  )
}

export function MonthlyTrendChart({ data, onReport }: { data: { label: string; sales: number }[]; onReport: () => void }) {
  const hasData = data.some((d) => d.sales > 0)
  return (
    <PanelCard title="Tendencia mensual (Ventas)" action="Ver reporte" onAction={onReport}>
      {!hasData ? <EmptyChart /> : (
        <ResponsiveContainer width="100%" height={230}>
          <AreaChart data={data} margin={{ top: 16, right: 12, left: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="scTrendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={TEAL} stopOpacity={0.18} />
                <stop offset="100%" stopColor={TEAL} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748B" }} tickLine={false} axisLine={false} interval={0} />
            <YAxis tickFormatter={(v: number) => fmtCompact(v)} tick={{ fontSize: 10, fill: "#94A3B8" }} tickLine={false} axisLine={false} width={54} />
            <Tooltip formatter={(v: number) => [fmtRD(v), "Ventas"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Area type="monotone" dataKey="sales" name="Ventas" stroke={TEAL} strokeWidth={2} fill="url(#scTrendFill)" dot={{ r: 3, fill: TEAL, strokeWidth: 0 }} activeDot={{ r: 5 }} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </PanelCard>
  )
}

export function TopProvidersTable({ rows, onFull }: { rows: ExecData["topProviders"]; onFull: () => void }) {
  return (
    <PanelCard title="Top prestadores" action="Ver ranking completo" onAction={onFull}>
      {rows.length === 0 ? <EmptyChart text="Sin liquidaciones en el período." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                <th className="px-2 py-2 text-center">#</th><th className="px-2 py-2">Prestador</th>
                <th className="px-2 py-2 text-right">Ventas</th><th className="px-2 py-2 text-right">Comisión</th>
                <th className="px-2 py-2 text-right">Incentivos</th><th className="px-2 py-2 text-right">Total neto</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.provider} className="border-b last:border-0">
                  <td className="px-2 py-2 text-center tabular-nums text-muted-foreground">{i + 1}</td>
                  <td className="px-2 py-2 font-medium">{r.provider}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtRD(r.sales)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtRD(r.commission)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtRD(r.incentives)}</td>
                  <td className="px-2 py-2 text-right font-bold tabular-nums text-[color:var(--brand-primary-dark)]">{fmtRD(r.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelCard>
  )
}

export function SettlementSummaryCard({ settlement }: { settlement: ExecData["settlement"] }) {
  return (
    <PanelCard title="Resumen de liquidación">
      <div className="space-y-2.5 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-slate-600">Total bruto</span>
          <span className="font-semibold tabular-nums">{fmtRD(settlement.gross)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-600">Aporte limpieza</span>
          <span className="font-semibold tabular-nums text-red-600">−{fmtRD(settlement.cleaning)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-600">Descuentos aplicados</span>
          <span className="font-semibold tabular-nums text-red-600">−{fmtRD(settlement.discounts)}</span>
        </div>
      </div>
      <div className="mt-4 rounded-xl bg-[color:var(--brand-primary-soft)] p-4 text-center">
        <div className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--brand-primary-dark)]">Neto a pagar</div>
        <div className="mt-1 text-2xl font-black tabular-nums text-[color:var(--brand-primary)]">{fmtRD(settlement.net)}</div>
      </div>
    </PanelCard>
  )
}

const INSIGHT_STYLE = {
  success: { icon: CheckCircle2, cls: "bg-emerald-50 text-emerald-600" },
  info: { icon: Info, cls: "bg-sky-50 text-sky-600" },
  warning: { icon: AlertTriangle, cls: "bg-amber-50 text-amber-600" },
} as const

export function PeriodInsightsCard({ insights, onAll }: { insights: ExecData["insights"]; onAll: () => void }) {
  return (
    <PanelCard title="Insights del período">
      <ul className="space-y-3">
        {insights.map((it, i) => {
          const s = INSIGHT_STYLE[it.tone] || INSIGHT_STYLE.info
          const Icon = s.icon
          return (
            <li key={i} className="flex items-start gap-2.5">
              <span className={`mt-0.5 shrink-0 rounded-full p-1.5 ${s.cls}`}><Icon className="h-3.5 w-3.5" /></span>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold leading-snug">{it.title}</div>
                <div className="text-xs text-muted-foreground">{it.detail}</div>
              </div>
            </li>
          )
        })}
      </ul>
      <button onClick={onAll} className="mt-3 text-xs font-semibold text-[color:var(--brand-primary)] underline-offset-2 hover:underline">Ver todos los insights →</button>
    </PanelCard>
  )
}

// ── Página ───────────────────────────────────────────────────────────────────
const SkeletonRow = ({ n, h = "h-[92px]" }: { n: number; h?: string }) => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
    {Array.from({ length: n }).map((_, i) => <div key={i} className={`${h} animate-pulse rounded-2xl bg-slate-100`} />)}
  </div>
)

export function ComisionDashboardPage() {
  const { apiUrl, showToast, setActiveTab } = useAppStore()
  const { params } = useCommissionFilters()
  const [data, setData] = useState<ExecData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionExecutiveDashboard", ...params })
      if (res?.ok) setData(res as never)
      else showToast((res as { error?: string })?.error || "Error", "error")
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setLoading(false) }
  }, [apiUrl, showToast, params])
  useEffect(() => { void load() }, [load])

  const refresh = () => { invalidateReadCache("getCommissionExecutiveDashboard"); void load() }

  const k = data?.kpis
  const d = data?.deltas
  const prevL = data?.period.isFullMonth ? data.prevLabel : null

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-black text-[color:var(--brand-primary-dark)]">Comisión de Ventas</h1>
        <p className="text-sm text-muted-foreground">Panel ejecutivo de resultados, incentivos y liquidación mensual</p>
      </div>

      <DashboardFilterBar providers={data?.providers || []} onRefresh={refresh} loading={loading} />

      {loading && !data ? (
        <>
          <SkeletonRow n={6} />
          <SkeletonRow n={6} />
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-72 animate-pulse rounded-2xl bg-slate-100" />)}
          </div>
        </>
      ) : (
        <>
          {/* Fila 1 · KPIs principales */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <ExecutiveKpiCard icon={<CircleDollarSign className="h-5 w-5" />} title="Ventas totales" value={fmtRD(k?.salesTotal || 0)} pct={d?.salesTotal} prevLabel={prevL} />
            <ExecutiveKpiCard icon={<Percent className="h-5 w-5" />} title="Total comisiones" value={fmtRD(k?.serviceCommission || 0)} pct={d?.serviceCommission} prevLabel={prevL} />
            <ExecutiveKpiCard icon={<Package className="h-5 w-5" />} title="Incentivos productos" value={fmtRD(k?.productIncentive || 0)} pct={d?.productIncentive} prevLabel={prevL} />
            <ExecutiveKpiCard icon={<Zap className="h-5 w-5" />} title="Incentivo láser" value={fmtRD(k?.laserIncentive || 0)} pct={d?.laserIncentive} prevLabel={prevL} />
            <ExecutiveKpiCard icon={<Gift className="h-5 w-5" />} title="Bono extra" value={fmtRD(k?.bonusExtra || 0)} pct={d?.bonusExtra} prevLabel={prevL} />
            <ExecutiveKpiCard icon={<Wallet className="h-5 w-5" />} title="Total neto" value={fmtRD(k?.netTotal || 0)} pct={d?.netTotal} prevLabel={prevL} />
          </div>

          {/* Fila 2 · KPIs operativos */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <OperationalKpiCard icon={<Users className="h-5 w-5" />} title="Empleados calculados" value={fmtInt(k?.employees || 0)} sub="Activos este mes" />
            <OperationalKpiCard icon={<Upload className="h-5 w-5" />} title="Importaciones del mes" value={fmtInt(k?.importsMonth || 0)} sub="Total importaciones" />
            <OperationalKpiCard icon={<HeartHandshake className="h-5 w-5" />} title="Clientes atendidos" value={fmtInt(k?.patients || 0)} pct={d?.patients} prevLabel={prevL} />
            <OperationalKpiCard icon={<ShoppingBag className="h-5 w-5" />} title="Productos vendidos" value={fmtInt(k?.productUnits || 0)} pct={d?.productUnits} prevLabel={prevL} />
            <OperationalKpiCard icon={<CreditCard className="h-5 w-5" />} title="% ventas con tarjeta" value={`${(k?.cardSharePct || 0).toFixed(1)}%`} pct={d?.cardSharePp} prevLabel={prevL} suffix=" pp" />
            <OperationalKpiCard icon={<ReceiptText className="h-5 w-5" />} title="Ticket promedio" value={fmtRD(k?.ticketAvg || 0)} pct={d?.ticketAvg} prevLabel={prevL} />
          </div>

          {/* Fila 3 · Gráficos */}
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <SalesByBranchChart data={data?.byBranch || []} onDetail={() => setActiveTab("comision-sucursales")} />
            <IncentiveCompositionChart data={data?.composition || []} onDetail={() => setActiveTab("comision-liquidacion")} />
            <MonthlyTrendChart data={data?.trend || []} onReport={() => setActiveTab("comision-reportes")} />
          </div>

          {/* Fila 4 · Tabla + liquidación + insights */}
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.5fr_1fr_1fr]">
            <TopProvidersTable rows={data?.topProviders || []} onFull={() => setActiveTab("comision-prestadores")} />
            <SettlementSummaryCard settlement={data?.settlement || { gross: 0, cleaning: 0, discounts: 0, net: 0 }} />
            <PeriodInsightsCard insights={data?.insights || []} onAll={() => setActiveTab("comision-reportes")} />
          </div>
        </>
      )}
    </div>
  )
}

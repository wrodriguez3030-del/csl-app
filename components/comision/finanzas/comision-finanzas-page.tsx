"use client"

/**
 * Incentivos de Ventas › Dashboard financiero.
 * Réplica de la hoja DASHBOARD del libro de incentivos: ventas, gastos, margen
 * y rentabilidad del período; ventas por sucursal y por servicio; histórico
 * anual con crecimiento; ventas vs gastos mes a mes; y el desglose sucursal × mes.
 */
import { useMemo } from "react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { CircleDollarSign, Wallet, TrendingUp, Percent } from "lucide-react"
import { DashPanel, EmptyChart } from "@/components/dashboard-kit"
import {
  useBiData, BiKpiGrid, ExportButtons, SimpleTable, fmtRD, fmtPct, fmtCompact, CHART_COLORS, type FlujoMes,
} from "@/components/bi-finance/bi-shared"
import { serviceRows, shareRows, fmtGrowth } from "@/lib/bi-finance/finanzas-format"
import { FinanzasPageShell, ServiceTable, ShareTable } from "./finanzas-shared"

const tip = (v: number | string) => fmtRD(Number(v))

function VentasPorSucursal({ byBranch }: { byBranch: Record<string, number> }) {
  const rows = shareRows(byBranch)
  return (
    <DashPanel title="Ventas por sucursal">
      {!rows.length ? <EmptyChart text="Sin ventas en el período" /> : (
        <>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={rows} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="branch" tick={{ fontSize: 10, fill: "#64748B" }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 10, fill: "#94A3B8" }} tickLine={false} axisLine={false} width={62} />
              <Tooltip formatter={tip} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="monto" name="Ventas" fill={CHART_COLORS[0]} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-2"><ShareTable rows={rows} first="Sucursal" /></div>
        </>
      )}
    </DashPanel>
  )
}

function VentasPorServicio({ porServicio }: { porServicio?: Record<string, number> }) {
  const rows = serviceRows(porServicio)
  const conVentas = rows.some((r) => r.monto > 0)
  return (
    <DashPanel title="Ventas por servicio">
      {!conVentas ? <EmptyChart text="Sin ventas en el período" /> : (
        <>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
              <XAxis type="number" tickFormatter={fmtCompact} tick={{ fontSize: 10, fill: "#94A3B8" }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="label" width={118} tick={{ fontSize: 10, fill: "#64748B" }} tickLine={false} axisLine={false} />
              <Tooltip formatter={tip} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="monto" name="Ventas" fill={CHART_COLORS[2]} radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-2"><ServiceTable rows={rows} /></div>
        </>
      )}
    </DashPanel>
  )
}

function HistoricoAnual({ rows }: { rows?: { year: number; ventas: number; crecimientoPct: number | null; parcial: boolean }[] }) {
  const data = rows || []
  return (
    <DashPanel title="Histórico anual de ventas">
      {!data.length ? <EmptyChart text="Sin histórico" /> : (
        <>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={data} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 10, fill: "#64748B" }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 10, fill: "#94A3B8" }} tickLine={false} axisLine={false} width={62} />
              <Tooltip formatter={tip} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="ventas" name="Ventas" fill={CHART_COLORS[0]} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-2">
            <SimpleTable head={["Año", "Ventas", "Crecimiento"]} alignRight={[1, 2]}
              rows={data.map((r) => [`${r.year}${r.parcial ? " (parcial)" : ""}`, fmtRD(r.ventas), fmtGrowth(r.crecimientoPct)])} />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Los años anteriores a la primera venta registrada en el sistema provienen del histórico del Excel; desde ahí manda la venta real.</p>
        </>
      )}
    </DashPanel>
  )
}

function VentasMensuales({ rows }: { rows: readonly FlujoMes[] }) {
  return (
    <DashPanel title="Ventas y gastos mes a mes (12 meses)">
      {!rows.length ? <EmptyChart text="Sin datos" /> : (
        <ResponsiveContainer width="100%" height={230}>
          <BarChart data={[...rows]} margin={{ top: 12, right: 12, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
            <XAxis dataKey="short" tick={{ fontSize: 10, fill: "#64748B" }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={4} />
            <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 10, fill: "#94A3B8" }} tickLine={false} axisLine={false} width={62} />
            <Tooltip formatter={tip} labelFormatter={(_l, p) => String(p?.[0]?.payload?.label ?? _l)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="ventas" name="Ventas" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
            <Bar dataKey="gastosOperativos" name="Gastos" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </DashPanel>
  )
}

function DesgloseSucursalMes({ rows }: { rows: readonly FlujoMes[] }) {
  const branches = useMemo(() => [...new Set(rows.flatMap((r) => Object.keys(r.ventasByBranch || {})))].sort(), [rows])
  if (!branches.length) return <DashPanel title="Ventas por sucursal y mes"><EmptyChart text="Sin desglose por sucursal" /></DashPanel>
  const body = rows.map((r) => [r.label, ...branches.map((b) => fmtRD(r.ventasByBranch?.[b] || 0)), fmtRD(r.ventas)])
  const totals = ["TOTAL", ...branches.map((b) => fmtRD(rows.reduce((s, r) => s + (r.ventasByBranch?.[b] || 0), 0))), fmtRD(rows.reduce((s, r) => s + r.ventas, 0))]
  const head = ["Mes", ...branches, "Total"]
  return (
    <DashPanel title="Ventas por sucursal y mes">
      <SimpleTable head={head} rows={body} alignRight={head.map((_, i) => i).filter((i) => i > 0)} footer={totals} />
    </DashPanel>
  )
}

export function ComisionFinanzasPage() {
  const { summary, loading, error, refresh } = useBiData()
  const flujoMensual = summary?.flujoMensual || []
  return (
    <FinanzasPageShell
      title="Dashboard financiero"
      subtitle="Ventas, gastos, margen y rentabilidad del período — con las mismas ventas de Incentivos"
      loading={loading} error={error} summary={summary} onRefresh={refresh}
      right={<ExportButtons summary={summary} />}
    >
      {summary ? (
        <>
          <BiKpiGrid items={[
            { title: "Ventas brutas", value: fmtRD(summary.resumen.ingresos), icon: CircleDollarSign },
            { title: "Gastos totales", value: fmtRD(summary.resumen.gastos), icon: Wallet, variant: "warning" },
            { title: "Margen", value: fmtRD(summary.resumen.utilidadNeta), icon: TrendingUp, variant: summary.resumen.utilidadNeta >= 0 ? "success" : "destructive" },
            { title: "Rentabilidad", value: fmtPct(summary.resumen.margenNeto), icon: Percent, variant: summary.resumen.margenNeto >= 25 ? "success" : summary.resumen.margenNeto >= 0 ? "warning" : "destructive" },
          ]} />
          <div className="grid gap-3 xl:grid-cols-2">
            <VentasPorSucursal byBranch={summary.ingresos.byBranch} />
            <VentasPorServicio porServicio={summary.ingresos.porServicio} />
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            <HistoricoAnual rows={summary.historicoAnual} />
            <VentasMensuales rows={flujoMensual} />
          </div>
          <DesgloseSucursalMes rows={flujoMensual} />
        </>
      ) : null}
    </FinanzasPageShell>
  )
}

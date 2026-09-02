"use client"

/**
 * Incentivos de Ventas › Rentabilidad y flujo.
 * Réplica de la hoja DASH RENTABILIDAD: rentabilidad por sucursal, flujo de
 * efectivo del período (gastos operativos, inversiones, retiros de socios) y su
 * desglose mes a mes.
 */
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from "recharts"
import { TrendingUp, TrendingDown, Wallet, PiggyBank } from "lucide-react"
import { DashPanel, EmptyChart } from "@/components/dashboard-kit"
import { useSessionUser } from "@/hooks/use-session-user"
import { canPerm } from "@/lib/permissions"
import {
  useBiData, BiKpiGrid, ExportButtons, SimpleTable, fmtRD, fmtPct, fmtCompact, CHART_COLORS, type BiSummary, type FlujoMes,
} from "@/components/bi-finance/bi-shared"
import { rentPct } from "@/lib/bi-finance/finanzas-format"
import { FinanzasPageShell, BranchCard, FlujoMensualTable } from "./finanzas-shared"
import { RetirosEditor } from "./retiros-editor"

const NO_BRANCH = "(sin sucursal)"
const tip = (v: number | string) => fmtRD(Number(v))

function TarjetasSucursal({ summary }: { summary: BiSummary }) {
  const total = summary.ingresos.total
  const rows = summary.rentabilidad.filter((b) => b.branch !== NO_BRANCH || b.gastos > 0)
  if (!rows.length) return <EmptyChart text="Sin datos por sucursal" />
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((b) => (
        <BranchCard key={b.branch} branch={b.branch} ventas={b.ingresos} gastos={b.gastos} margen={b.utilidadNeta}
          rent={b.ingresos > 0 ? b.margenNeto : null} sharePct={total > 0 ? (b.ingresos / total) * 100 : 0} />
      ))}
    </div>
  )
}

function FlujoDelPeriodo({ summary }: { summary: BiSummary }) {
  const f = summary.flujo
  const inv = summary.inversiones
  const ret = summary.retiros
  if (!f) return <DashPanel title="Flujo de efectivo"><EmptyChart text="Sin datos de flujo" /></DashPanel>
  const desglose: { label: string; monto: number }[] = [
    { label: "Gastos operativos", monto: f.egresosOperativos },
    { label: "Inversión general", monto: inv?.general || 0 },
    ...Object.entries(inv?.byBranch || {}).map(([b, v]) => ({ label: `Inversión ${b}`, monto: v })),
    { label: "Retiro de dividendos", monto: ret?.dividendos || 0 },
    { label: "Retiro de cuentas", monto: ret?.cuentas || 0 },
  ].filter((d) => d.monto > 0)
  return (
    <DashPanel title="Flujo de efectivo del período">
      <BiKpiGrid items={[
        { title: "Ingresos", value: fmtRD(f.ingresos), icon: TrendingUp, variant: "success" },
        { title: "Egresos", value: fmtRD(f.egresos), icon: Wallet, variant: "warning" },
        { title: "Flujo neto", value: fmtRD(f.neto), icon: f.neto >= 0 ? TrendingUp : TrendingDown, variant: f.neto >= 0 ? "success" : "destructive" },
        { title: "Retiros de socios", value: fmtRD(ret?.total || 0), icon: PiggyBank },
      ]} />
      <div className="mt-3 grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <SimpleTable head={["Concepto", "Monto", "% de egresos"]} alignRight={[1, 2]}
          rows={desglose.map((d) => [d.label, fmtRD(d.monto), fmtPct(f.egresos > 0 ? (d.monto / f.egresos) * 100 : 0)])}
          footer={["TOTAL EGRESOS", fmtRD(f.egresos), "100.0%"]} />
        {desglose.length ? (
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={desglose} dataKey="monto" nameKey="label" innerRadius={45} outerRadius={78} paddingAngle={2}>
                {desglose.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={tip} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </PieChart>
          </ResponsiveContainer>
        ) : null}
      </div>
    </DashPanel>
  )
}

function RentabilidadMensual({ rows }: { rows: readonly FlujoMes[] }) {
  const branches = [...new Set(rows.flatMap((r) => Object.keys(r.ventasByBranch || {})))].sort()
  if (!branches.length) return <DashPanel title="Rentabilidad mensual por sucursal"><EmptyChart text="Sin desglose por sucursal" /></DashPanel>
  const margenDe = (r: FlujoMes, b: string) => (r.ventasByBranch?.[b] || 0) - (r.gastosByBranch?.[b] || 0)
  const chart = rows.map((r) => ({ short: r.short, label: r.label, ...Object.fromEntries(branches.map((b) => [b, Math.round(margenDe(r, b) * 100) / 100])) }))
  const head = ["Mes", ...branches.flatMap((b) => [`${b} margen`, `${b} rent.`])]
  const body = rows.map((r) => [r.label, ...branches.flatMap((b) => {
    const m = margenDe(r, b)
    return [fmtRD(m), fmtPct(rentPct(m, r.ventasByBranch?.[b] || 0))]
  })])
  return (
    <DashPanel title="Rentabilidad mensual por sucursal">
      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={chart} margin={{ top: 12, right: 12, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
          <XAxis dataKey="short" tick={{ fontSize: 10, fill: "#64748B" }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={4} />
          <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 10, fill: "#94A3B8" }} tickLine={false} axisLine={false} width={62} />
          <Tooltip formatter={tip} labelFormatter={(_l, p) => String(p?.[0]?.payload?.label ?? _l)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {branches.map((b, i) => <Bar key={b} dataKey={b} name={b} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[4, 4, 0, 0]} />)}
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-2"><SimpleTable head={head} rows={body} alignRight={head.map((_, i) => i).filter((i) => i > 0)} /></div>
    </DashPanel>
  )
}

export function ComisionRentabilidadPage() {
  const { summary, loading, error, refresh } = useBiData()
  const user = useSessionUser()
  const canManage = canPerm(user, "sales_commission.finance.manage")
  const flujoMensual = summary?.flujoMensual || []
  return (
    <FinanzasPageShell
      title="Rentabilidad y flujo"
      subtitle="Margen por sucursal y flujo de efectivo: gastos operativos, inversiones y retiros de socios"
      loading={loading} error={error} summary={summary} onRefresh={refresh}
      right={<ExportButtons summary={summary} />}
    >
      {summary ? (
        <>
          <TarjetasSucursal summary={summary} />
          <FlujoDelPeriodo summary={summary} />
          <RentabilidadMensual rows={flujoMensual} />
          <DashPanel title="Flujo de efectivo mensual (12 meses)">
            {flujoMensual.length ? <FlujoMensualTable rows={flujoMensual} /> : <EmptyChart text="Sin datos" />}
          </DashPanel>
          <RetirosEditor from={summary.period.from} to={summary.period.to} canManage={canManage} onChanged={refresh} />
        </>
      ) : null}
    </FinanzasPageShell>
  )
}

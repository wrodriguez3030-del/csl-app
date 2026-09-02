"use client"

/** Piezas compartidas por las tres pantallas financieras de Incentivos de Ventas. */
import type { ReactNode } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { DashPanel } from "@/components/dashboard-kit"
import { kpiValueClasses } from "@/lib/ui/kpi-value"
import { BiHeader, BiLoading, BiError, BiFilterBar, SimpleTable, fmtRD, fmtPct, type BiSummary, type FlujoMes } from "@/components/bi-finance/bi-shared"
import { flujoTotals, inversionBranches, type ServiceRow, type ShareRow } from "@/lib/bi-finance/finanzas-format"

const money = (n: number) => fmtRD(n)
const neg = (n: number) => (n < 0 ? "text-rose-600" : "")

/** Envoltorio común: cabecera, estados de carga/error y barra de período. */
export function FinanzasPageShell({ title, subtitle, loading, error, summary, onRefresh, right, children }: {
  title: string; subtitle: string; loading: boolean; error: string | null
  summary: BiSummary | null; onRefresh: () => void; right?: ReactNode; children: ReactNode
}) {
  return (
    <div className="space-y-4">
      <BiHeader title={title} subtitle={subtitle} />
      <BiFilterBar onRefresh={onRefresh} loading={loading} right={right} />
      {error ? <BiError message={error} onRetry={onRefresh} /> : null}
      {loading && !summary ? <BiLoading /> : null}
      {summary ? children : null}
    </div>
  )
}

/** Tarjeta de una sucursal: ventas, gastos, margen, rentabilidad y peso en el total. */
export function BranchCard({ branch, ventas, gastos, margen, rent, sharePct }: {
  branch: string; ventas: number; gastos: number; margen: number; rent: number | null; sharePct: number
}) {
  const tone = rent == null ? "bg-slate-50 text-slate-600 border-slate-200"
    : rent >= 25 ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : rent >= 0 ? "bg-amber-50 text-amber-700 border-amber-200"
    : "bg-rose-50 text-rose-600 border-rose-200"
  const filas: [string, string, string][] = [
    ["Ventas", money(ventas), ""],
    ["Gastos", money(gastos), ""],
    ["Margen", money(margen), neg(margen)],
  ]
  return (
    <Card className="rounded-2xl border-[color:var(--brand-border)] shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-600">{branch}</div>
          <Badge variant="outline" className={tone}>{fmtPct(rent)}</Badge>
        </div>
        <div className={`mt-1 ${kpiValueClasses(money(margen))} ${neg(margen)}`}>{money(margen)}</div>
        <div className="mt-2 space-y-0.5 text-xs">
          {filas.map(([k, v, cls]) => (
            <div key={k} className="flex justify-between gap-2"><span className="text-muted-foreground">{k}</span><span className={`tabular-nums font-medium ${cls}`}>{v}</span></div>
          ))}
          <div className="flex justify-between gap-2"><span className="text-muted-foreground">% del total</span><span className="tabular-nums font-medium">{fmtPct(sharePct)}</span></div>
        </div>
      </CardContent>
    </Card>
  )
}

/** Tabla mes × (ventas, gastos, inversiones, retiros, flujo) con fila TOTAL. */
export function FlujoMensualTable({ rows }: { rows: readonly FlujoMes[] }) {
  const branches = inversionBranches(rows)
  const total = flujoTotals(rows)
  const head = ["Mes", "Ventas", "Gastos oper.", "Inv. general", ...branches.map((b) => `Inv. ${b}`), "Retiros socios", "Flujo neto"]
  const line = (r: FlujoMes, label: string) => [
    label, money(r.ventas), money(r.gastosOperativos), money(r.inversionGeneral),
    ...branches.map((b) => money(r.inversionByBranch?.[b] || 0)), money(r.retiros), money(r.neto),
  ]
  return <SimpleTable head={head} rows={rows.map((r) => line(r, r.label))} alignRight={head.map((_, i) => i).filter((i) => i > 0)} footer={line(total, "TOTAL")} />
}

/** Ventas por servicio: monto y participación. */
export function ServiceTable({ rows }: { rows: readonly ServiceRow[] }) {
  return <SimpleTable head={["Servicio", "Ventas", "% del total"]} alignRight={[1, 2]} rows={rows.map((r) => [r.label, money(r.monto), fmtPct(r.pct)])} />
}

/** Participación por sucursal. */
export function ShareTable({ rows, first }: { rows: readonly ShareRow[]; first: string }) {
  return <SimpleTable head={[first, "Ventas", "% part."]} alignRight={[1, 2]} rows={rows.map((r) => [r.branch, money(r.monto), fmtPct(r.pct)])} />
}

/** Panel con nota al pie (origen del dato). */
export function PanelConNota({ title, nota, children }: { title: string; nota?: string; children: ReactNode }) {
  return (
    <DashPanel title={title}>
      {children}
      {nota ? <p className="mt-2 text-[11px] text-muted-foreground">{nota}</p> : null}
    </DashPanel>
  )
}

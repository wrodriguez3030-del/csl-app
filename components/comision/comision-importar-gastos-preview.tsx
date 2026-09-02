"use client"

/** Vista previa y conciliación del libro de gastos antes de confirmar. */
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { AlertTriangle, XCircle } from "lucide-react"
import { semaforo, SEM_CLASS } from "./comision-importar-ventas"
import { type GastosParseResult, periodLabel } from "@/lib/finanzas/gastos-parser"
import type { ConsolidadoResult } from "@/lib/finanzas/consolidado-parser"
import type { HistoricoResult } from "@/lib/finanzas/historico-parser"
import { monthLabel, yearMonthKey } from "@/lib/finanzas/meses"

const fmtRD = (n: number) => "RD$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const round2 = (n: number) => Math.round(n * 100) / 100

export interface CheckResult {
  ok: boolean; exists: boolean
  aggregates: { id: string; branch: string; month: string; amount: number }[]
  detail: { month: string; branch: string; n: number; total: number }[]
  investments: { branch: string | null; month: string; amount: number }[]
  withdrawals: { month: string; kind: string; amount: number }[]
}

interface Props {
  parsed: GastosParseResult; cons: ConsolidadoResult; hist: HistoricoResult; check: CheckResult | null
  includeHistory: boolean; onToggleHistory: (v: boolean) => void
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4">
    <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">{title}</div>
    {children}
  </CardContent></Card>
)
const TH = ({ children, right }: { children: React.ReactNode; right?: boolean }) => <th className={`py-1 pr-2 ${right ? "text-right" : ""}`}>{children}</th>
const TD = ({ children, right, className = "" }: { children: React.ReactNode; right?: boolean; className?: string }) => <td className={`py-1.5 pr-2 ${right ? "text-right tabular-nums" : ""} ${className}`}>{children}</td>

function Kpis({ parsed }: { parsed: GastosParseResult }) {
  const total = round2(parsed.rows.reduce((s, r) => s + r.amount, 0))
  const items = [
    ["Hojas con datos", String(parsed.sheets.filter((s) => !s.empty).length)],
    ["Gastos", parsed.rows.length.toLocaleString("en-US")],
    ["Total", fmtRD(total)],
    ["Año", parsed.year ? `${parsed.year} (${parsed.yearSource === "ledger" ? "por fechas" : "por nombre"})` : "—"],
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([k, v]) => <Card key={k} className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">{k}</div><div className="text-lg font-black tabular-nums">{v}</div></CardContent></Card>)}
    </div>
  )
}

function Conciliacion({ parsed }: { parsed: GastosParseResult }) {
  const rows = parsed.sheets.flatMap((s) => s.controls)
  if (!rows.length) return null
  return (
    <Section title="Conciliación contra el RESUMEN de cada hoja (suma numérica; los montos en texto no entran en el SUM del Excel)">
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b text-left text-[11px] uppercase text-muted-foreground"><TH>Hoja</TH><TH>Sucursal</TH><TH right>Filas</TH><TH right>Importado</TH><TH right>En texto</TH><TH right>Control</TH><TH right>Diferencia</TH><TH>Estado</TH></tr></thead>
        <tbody>{rows.map((c) => {
          const diff = c.control == null ? null : round2(c.numericTotal - c.control)
          const sem = diff == null ? null : semaforo(diff, c.control || 0)
          return (
            <tr key={`${c.sheet}-${c.branch}`} className="border-b last:border-0">
              <TD>{c.sheet}</TD><TD className="font-medium">{c.branch}</TD><TD right>{c.rows}</TD><TD right>{fmtRD(c.numericTotal)}</TD>
              <TD right className="text-muted-foreground">{c.textTotal ? fmtRD(c.textTotal) : "—"}</TD>
              <TD right>{c.control == null ? "—" : `${fmtRD(c.control)}`}{c.controlSource ? <span className="ml-1 text-[10px] text-muted-foreground">({c.controlSource})</span> : null}</TD>
              <TD right>{diff == null ? "—" : fmtRD(diff)}</TD>
              <TD>{sem ? <Badge variant="outline" className={SEM_CLASS[sem]}>{sem}</Badge> : <Badge variant="outline">sin control</Badge>}</TD>
            </tr>
          )
        })}</tbody>
      </table></div>
    </Section>
  )
}

function Consolidado({ cons, check }: { cons: ConsolidadoResult; check: CheckResult | null }) {
  if (!cons.found || (!cons.investments.length && !cons.withdrawals.length)) return null
  const invState = (branch: string | null, month: number, year: number, amount: number) => {
    const ex = check?.investments.find((i) => (i.branch || "") === (branch || "") && i.month === yearMonthKey(year, month))
    if (!ex) return ["nuevo", "bg-emerald-50 text-emerald-700 border-emerald-200"]
    return Math.abs(ex.amount - amount) > 0.01 ? [`ya cargada con ${fmtRD(ex.amount)} — no se toca`, "bg-amber-50 text-amber-700 border-amber-200"] : ["ya cargada", "bg-slate-50 text-slate-600 border-slate-200"]
  }
  const retState = (month: number, year: number) => check?.withdrawals.some((w) => w.month === yearMonthKey(year, month)) ? ["ya cargado", "bg-slate-50 text-slate-600 border-slate-200"] : ["nuevo", "bg-emerald-50 text-emerald-700 border-emerald-200"]
  return (
    <Section title="Inversiones y retiros de socios (hoja consolidado)">
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b text-left text-[11px] uppercase text-muted-foreground"><TH>Mes</TH><TH>Concepto</TH><TH right>Monto</TH><TH>Estado</TH></tr></thead>
        <tbody>
          {cons.investments.map((i) => { const [label, cls] = invState(i.branch, i.month, i.year, i.amount); return (
            <tr key={i.rowHash} className="border-b last:border-0"><TD>{monthLabel(i.month, i.year)}</TD><TD>{i.nombre}</TD><TD right>{fmtRD(i.amount)}</TD><TD><Badge variant="outline" className={cls}>{label}</Badge></TD></tr>
          ) })}
          {cons.withdrawals.map((w) => { const [label, cls] = retState(w.month, w.year); return (
            <tr key={w.rowHash} className="border-b last:border-0"><TD>{monthLabel(w.month, w.year)}</TD><TD>Retiro de socios (dividendo)</TD><TD right>{fmtRD(w.amount)}</TD><TD><Badge variant="outline" className={cls}>{label}</Badge></TD></tr>
          ) })}
        </tbody>
      </table></div>
      <p className="mt-2 text-[11px] text-muted-foreground">«RETIRO CTAS» del consolidado es el total de egresos del mes (suma de las columnas anteriores), no un retiro: se usa solo como control.</p>
    </Section>
  )
}

function Reemplazos({ check }: { check: CheckResult | null }) {
  if (!check || (!check.aggregates.length && !check.detail.length)) return null
  return (
    <Section title="Lo que ya existe en esos meses">
      {check.aggregates.length ? (
        <>
          <p className="mb-1 text-xs text-amber-700">Estos <b>totales mensuales</b> cargados a mano se retirarán al importar el detalle (reversible al anular la importación):</p>
          <div className="flex flex-wrap gap-1.5">{check.aggregates.map((a) => <Badge key={a.id} variant="outline" className="bg-amber-50 text-amber-800 border-amber-200">{periodLabel(a.month)} · {a.branch} · {fmtRD(a.amount)}</Badge>)}</div>
        </>
      ) : null}
      {check.detail.length ? (
        <>
          <p className="mb-1 mt-3 text-xs text-slate-600">Detalle ya importado antes (las filas idénticas se omiten; las editadas en el Excel NO se actualizan, se listan):</p>
          <div className="flex flex-wrap gap-1.5">{check.detail.map((d) => <Badge key={`${d.month}-${d.branch}`} variant="outline">{periodLabel(d.month)} · {d.branch} · {d.n} filas · {fmtRD(d.total)}</Badge>)}</div>
        </>
      ) : null}
    </Section>
  )
}

function Historico({ hist, includeHistory, onToggle }: { hist: HistoricoResult; includeHistory: boolean; onToggle: (v: boolean) => void }) {
  if (!hist.found) return null
  return (
    <Section title="Histórico de ventas anterior a mayo 2020 (hoja Historico ventas)">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={includeHistory} disabled={!hist.rows.length} onCheckedChange={(v) => onToggle(Boolean(v))} />
        Sembrar {hist.rows.length} meses ({hist.rows[0] ? monthLabel(hist.rows[0].month, hist.rows[0].year) : "—"} → {hist.rows.at(-1) ? monthLabel(hist.rows.at(-1)!.month, hist.rows.at(-1)!.year) : "—"}) como referencia del histórico anual
      </label>
      <div className="mt-2 flex flex-wrap gap-1.5">{hist.yearControls.map((c) => <Badge key={c.year} variant="outline" className={c.ok ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-600 border-red-200"}>{c.year}: {fmtRD(c.sumMonths)}{c.ok ? "" : ` ≠ ${fmtRD(c.excelTotal)}`}</Badge>)}</div>
      <p className="mt-2 text-[11px] text-muted-foreground">Desde la primera venta real del sistema manda la venta real; estos meses solo completan el gráfico 2017 → hoy.</p>
    </Section>
  )
}

export function ImportarGastosPreview({ parsed, cons, hist, check, includeHistory, onToggleHistory }: Props) {
  const warnings = [...parsed.warnings, ...cons.warnings, ...hist.warnings]
  return (
    <>
      <Kpis parsed={parsed} />
      {parsed.errors.length ? (
        <Card className="border-red-200 bg-red-50/40"><CardContent className="flex items-start gap-2 p-4 text-sm text-red-800">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" /><div><div className="font-semibold">No se puede importar</div><ul className="mt-1 list-disc pl-4">{parsed.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>
        </CardContent></Card>
      ) : null}
      <Section title={`Períodos detectados (${parsed.periods.length})`}>
        <div className="flex flex-wrap gap-1.5">{parsed.periods.map((p) => <Badge key={p} variant="outline" className="bg-cyan-50 text-cyan-800 border-cyan-200">{periodLabel(p)}</Badge>)}</div>
      </Section>
      <Conciliacion parsed={parsed} />
      <Consolidado cons={cons} check={check} />
      <Reemplazos check={check} />
      <Historico hist={hist} includeHistory={includeHistory} onToggle={onToggleHistory} />
      {warnings.length ? (
        <Card className="border-amber-200 bg-amber-50/40"><CardContent className="flex items-start gap-2 p-4 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div><div className="font-semibold">Diagnóstico ({warnings.length})</div><ul className="mt-1 max-h-64 list-disc overflow-auto pl-4 text-amber-700">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>
        </CardContent></Card>
      ) : null}
    </>
  )
}

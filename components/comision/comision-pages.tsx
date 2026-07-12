"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl, invalidateReadCache } from "@/lib/store"
import { useSessionUser } from "@/hooks/use-session-user"
import { canPerm } from "@/lib/permissions"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  Building2, Package, Zap, Users, CalendarClock,
  Loader2, CheckCircle2, AlertTriangle, Wand2, Download, Printer, RefreshCw, ChevronDown, Save, RotateCcw,
} from "lucide-react"
import { CommissionFilterBar, useCommissionFilters } from "./comision-filter-bar"
import { exportLaserExcel, printLaserPdf, laserModeLabel, type LaserDetail } from "@/lib/commission/laser-export"
import { LaserPersonnelEditor } from "./laser-personnel-editor"

export { ComisionDashboardPage } from "./comision-dashboard-page"

const fmtRD = (n: number) => "RD$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const BRANCHES = ["RAFAEL VIDAL", "LOS JARDINES", "VILLA OLGA"]
const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

function Shell({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="space-y-5">
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="flex items-center gap-2 p-3 text-sm font-semibold sm:p-4">
          <span className="text-[color:var(--brand-primary)]">{icon}</span> {title}
        </CardContent>
      </Card>
      {children}
    </div>
  )
}

// ── Historial mensual (importaciones; filtro por fecha de carga/estado/tipo) ─
export function ComisionHistorialPage() {
  const { apiUrl, showToast } = useAppStore()
  const { params } = useCommissionFilters()
  const [status, setStatus] = useState("")
  const [tipo, setTipo] = useState("")
  const [items, setItems] = useState<{ id: string; periodMonth: number; periodYear: number; filename: string; rowsCount: number; grossTotal: number; status: string; importType?: string }[]>([])
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), {
        action: "getCommissionImports", ...params, dateField: "created",
        ...(status ? { status } : {}), ...(tipo ? { importType: tipo } : {}),
      })
      if (res?.ok) setItems((res.records as never) || [])
      else showToast((res as { error?: string })?.error || "Error", "error")
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setLoading(false) }
  }, [apiUrl, showToast, params, status, tipo])
  useEffect(() => { void load() }, [load])

  return (
    <Shell icon={<CalendarClock className="h-4 w-4" />} title="Incentivos de Ventas · Historial mensual">
      <CommissionFilterBar>
        <div>
          <label className="text-[11px] font-medium">Tipo</label>
          <select className="mt-0.5 h-9 w-full rounded-md border border-input bg-white px-2 text-sm" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option><option value="SALES">Ventas</option><option value="RESERVATIONS">Reservas</option>
          </select>
        </div>
        <div>
          <label className="text-[11px] font-medium">Estado</label>
          <select className="mt-0.5 h-9 w-full rounded-md border border-input bg-white px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos</option>
            {["borrador", "importado", "calculado", "en_revision", "aprobado", "pagado", "cerrado", "anulado"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </CommissionFilterBar>
      <p className="-mt-3 text-[11px] text-muted-foreground">El período filtra por FECHA DE CARGA de la importación.</p>
      <Card className="border-[color:var(--brand-border)]"><CardContent className="p-0">
        {loading ? <div className="py-10 text-center text-sm text-muted-foreground">Cargando...</div>
          : items.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">No hay importaciones registradas todavía.</div>
          : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                <th className="px-4 py-2">Período</th><th className="px-2 py-2">Archivo</th><th className="px-2 py-2 text-right">Filas</th><th className="px-2 py-2 text-right">Bruto</th><th className="px-2 py-2">Estado</th>
              </tr></thead>
              <tbody>{items.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-4 py-2 font-medium">{String(r.periodMonth).padStart(2, "0")}/{r.periodYear}</td>
                  <td className="px-2 py-2 text-xs">{r.filename}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.rowsCount}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtRD(r.grossTotal)}</td>
                  <td className="px-2 py-2"><Badge variant="outline">{r.status}</Badge></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
      </CardContent></Card>
    </Shell>
  )
}

// ── Scaffolds dedicados (próxima fase) ──────────────────────────────────────
// Ventas por sucursal (agrega ventas persistidas; filtros backend)
export function ComisionSucursalesPage() {
  const { apiUrl, showToast } = useAppStore()
  const { params } = useCommissionFilters()
  const [payment, setPayment] = useState("")
  const [data, setData] = useState<{ cardPct: number; branches: { branch: string; gross: number; tarjeta: number; efectivo: number; transferencia: number; otros: number; cardResult: number; producto: number; servicio: number; laser: number }[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    try { const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionByBranch", ...params, ...(payment ? { payment } : {}) }); if (res?.ok) setData(res as never); else showToast((res as { error?: string })?.error || "Error", "error") }
    catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setLoading(false) }
  }, [apiUrl, showToast, params, payment])
  useEffect(() => { void load() }, [load])
  const br = data?.branches || []
  const T = (f: (b: (typeof br)[number]) => number) => br.reduce((s, b) => s + f(b), 0)
  return (
    <Shell icon={<Building2 className="h-4 w-4" />} title="Incentivos de Ventas · Ventas por sucursal">
      <CommissionFilterBar branches={BRANCHES}>
        <div>
          <label className="text-[11px] font-medium">Forma de pago</label>
          <select className="mt-0.5 h-9 w-full rounded-md border border-input bg-white px-2 text-sm" value={payment} onChange={(e) => setPayment(e.target.value)}>
            <option value="">Todas</option>
            {["EFECTIVO", "TARJETA", "TRANSFERENCIA", "CHEQUE", "ONLINE", "OTROS"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </CommissionFilterBar>
      <Card className="border-[color:var(--brand-border)]"><CardContent className="p-0">
        {loading ? <div className="py-10 text-center text-sm text-muted-foreground">Cargando...</div>
          : br.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">Sin datos. Importa un archivo de ventas primero.</div>
          : (<div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
              <th className="px-3 py-2">Sucursal</th><th className="px-2 py-2 text-right">Bruto</th><th className="px-2 py-2 text-right">Tarjeta</th><th className="px-2 py-2 text-right">Efectivo</th><th className="px-2 py-2 text-right">Transfer.</th><th className="px-2 py-2 text-right">Otros</th><th className="px-2 py-2 text-right">% Tarj.</th><th className="px-2 py-2 text-right">Result. tarjeta</th><th className="px-2 py-2 text-right">Productos</th><th className="px-2 py-2 text-right">Servicios</th><th className="px-3 py-2 text-right">Láser</th>
            </tr></thead>
            <tbody>{br.map((b) => (
              <tr key={b.branch} className="border-b last:border-0">
                <td className="px-3 py-2 font-medium">{b.branch}</td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums">{fmtRD(b.gross)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtRD(b.tarjeta)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtRD(b.efectivo)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtRD(b.transferencia)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtRD(b.otros)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{((data?.cardPct || 0) * 100).toFixed(0)}%</td>
                <td className="px-2 py-2 text-right tabular-nums text-[color:var(--brand-primary)]">{fmtRD(b.cardResult)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtRD(b.producto)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtRD(b.servicio)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtRD(b.laser)}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr className="bg-slate-50 font-bold"><td className="px-3 py-2">Totales</td><td className="px-2 py-2 text-right tabular-nums">{fmtRD(T((b) => b.gross))}</td><td className="px-2 py-2 text-right tabular-nums">{fmtRD(T((b) => b.tarjeta))}</td><td className="px-2 py-2 text-right tabular-nums">{fmtRD(T((b) => b.efectivo))}</td><td className="px-2 py-2 text-right tabular-nums">{fmtRD(T((b) => b.transferencia))}</td><td className="px-2 py-2 text-right tabular-nums">{fmtRD(T((b) => b.otros))}</td><td className="px-2 py-2"></td><td className="px-2 py-2 text-right tabular-nums">{fmtRD(T((b) => b.cardResult))}</td><td className="px-2 py-2 text-right tabular-nums">{fmtRD(T((b) => b.producto))}</td><td className="px-2 py-2 text-right tabular-nums">{fmtRD(T((b) => b.servicio))}</td><td className="px-3 py-2 text-right tabular-nums">{fmtRD(T((b) => b.laser))}</td></tr></tfoot>
          </table></div>)}
      </CardContent></Card>
    </Shell>
  )
}

// Incentivos de productos (lee cálculos vivos; período compartido)
export function ComisionProductosPage() {
  const { apiUrl, showToast } = useAppStore()
  const { params } = useCommissionFilters()
  const [items, setItems] = useState<{ id: string; provider: string; branch: string; productsCount: number; productIncentive: number }[]>([])
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionCalculations", ...params })
      if (res?.ok) setItems(((res.records as never[]) || []).filter((c: { productsCount: number }) => c.productsCount > 0))
      else showToast((res as { error?: string })?.error || "Error", "error")
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setLoading(false) }
  }, [apiUrl, showToast, params])
  useEffect(() => { void load() }, [load])
  const totalU = items.reduce((s, c) => s + c.productsCount, 0)
  const totalI = items.reduce((s, c) => s + c.productIncentive, 0)
  const providers = [...new Set(items.map((c) => c.provider).filter(Boolean))].sort()
  return (
    <Shell icon={<Package className="h-4 w-4" />} title="Incentivos de Ventas · Incentivos de productos">
      <CommissionFilterBar branches={BRANCHES} providers={providers} />
      <Card className="border-[color:var(--brand-border)]"><CardContent className="p-0">
        {loading ? <div className="py-10 text-center text-sm text-muted-foreground">Cargando...</div>
          : items.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">Sin datos. Importa un archivo de ventas primero.</div>
          : (<div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b text-left text-[11px] uppercase text-muted-foreground"><th className="px-4 py-2">Empleado</th><th className="px-2 py-2">Sucursal</th><th className="px-2 py-2 text-right">Unidades</th><th className="px-4 py-2 text-right">Incentivo</th></tr></thead>
            <tbody>{[...items].sort((a, b) => b.productsCount - a.productsCount).map((c) => (
              <tr key={c.id} className="border-b last:border-0"><td className="px-4 py-2 font-medium">{c.provider}</td><td className="px-2 py-2 text-xs text-muted-foreground">{c.branch}</td><td className="px-2 py-2 text-right tabular-nums">{c.productsCount}</td><td className="px-4 py-2 text-right tabular-nums">{fmtRD(c.productIncentive)}</td></tr>
            ))}</tbody>
            <tfoot><tr className="bg-slate-50 font-bold"><td className="px-4 py-2" colSpan={2}>Totales</td><td className="px-2 py-2 text-right tabular-nums">{totalU}</td><td className="px-4 py-2 text-right tabular-nums">{fmtRD(totalI)}</td></tr></tfoot>
          </table></div>)}
      </CardContent></Card>
    </Shell>
  )
}

// Comisión depilación láser: fondo POR SUCURSAL (tarjeta neteada → escala) +
// reparto personas/pacientes con cuadre exacto. Personal elegible desde el roster.
interface LaserApplyResult {
  results: {
    month: number; year: number; fund: number; updated: number; appliedTotal: number
    byBranch: { branch: string; base: number; pct: number; fund: number }[]
    unmatched: { provider: string; amount: number }[]
    locked: { provider: string; status: string }[]
  }[]
  totalApplied: number
}

// Resumen ANUAL del láser ("Todos los meses"): fondo por sucursal × mes.
interface LaserAnnual {
  year: number; cardPct: number
  months: { month: number; fundTotal: number; branches: { branch: string; base: number; pct: number; fund: number }[] }[]
  totals: { byBranch: { branch: string; base: number; fund: number }[]; fundYear: number }
}

/** Mes/año efectivos desde los filtros globales del módulo: "año"/"todo" = 0
 *  (todos los meses); "personalizado" usa el mes/año del inicio del rango. */
function effectivePeriod(filters: { quick: string; month: number; year: number; from: string }) {
  if (filters.quick === "año" || filters.quick === "todo") return { month: 0, year: filters.year || new Date().getFullYear() }
  if (filters.quick === "personalizado" && filters.from) {
    return { month: Number(String(filters.from).slice(5, 7)) || 0, year: Number(String(filters.from).slice(0, 4)) || filters.year }
  }
  return { month: filters.month || new Date().getMonth() + 1, year: filters.year || new Date().getFullYear() }
}

export function ComisionLaserPage() {
  const { apiUrl, showToast } = useAppStore()
  const user = useSessionUser()
  const canApply = canPerm(user, "sales_commission.calculate")
  const { filters } = useCommissionFilters()
  const { month, year } = effectivePeriod(filters)
  const branch = filters.branch
  const annualMode = month === 0
  const [detail, setDetail] = useState<LaserDetail | null>(null)
  const [annual, setAnnual] = useState<LaserAnnual | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<LaserApplyResult | null>(null)
  const [showRoster, setShowRoster] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (month === 0) {
        const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionLaserAnnual", year })
        if (res?.ok) { setAnnual(res as unknown as LaserAnnual); setDetail(null) }
        else { setAnnual(null); showToast((res as { error?: string })?.error || "Error", "error") }
      } else {
        const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionLaserDetail", month, year, ...(branch ? { branch } : {}) })
        if (res?.ok) { setDetail(res as unknown as LaserDetail); setAnnual(null) }
        else { setDetail(null); showToast((res as { error?: string })?.error || "Error", "error") }
      }
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setLoading(false) }
  }, [apiUrl, showToast, month, year, branch])
  useEffect(() => { void load() }, [load])

  const applyToSettlement = async () => {
    setApplying(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "applyCommissionLaser", month, year })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "No se pudo aplicar")
      const r = res as unknown as LaserApplyResult
      setApplied(r)
      invalidateReadCache("getCommissionCalculations")
      invalidateReadCache("getCommissionDashboard")
      invalidateReadCache("getCommissionExecutiveDashboard")
      showToast(`Fondo láser aplicado: ${fmtRD(r.totalApplied || 0)} a la liquidación`, "success")
      setConfirmOpen(false)
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setApplying(false) }
  }

  const totalFondo = (detail?.branches || []).reduce((s, b) => s + b.fondo, 0)
  // Los pesos solo aplican (y se validan) en modo "pesos"; en equitativo son dinámicos.
  const weightsOk = !detail || detail.mode !== "pesos" || Math.abs(detail.weights.personas + detail.weights.pacientes - 100) < 0.01

  return (
    <Shell icon={<Zap className="h-4 w-4" />} title="Incentivos de Ventas · Comisión depilación láser">
      {/* Filtros estándar del módulo + acciones */}
      <CommissionFilterBar branches={BRANCHES} />
      <Card className="border-[color:var(--brand-border)]"><CardContent className="flex flex-wrap items-center gap-2 p-3">
        <Button size="sm" variant="outline" className="h-9" disabled={loading} onClick={() => void load()}>{loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}Recalcular</Button>
        <Button size="sm" variant="outline" className="h-9" disabled={!detail || annualMode} title={annualMode ? "Elige un mes específico para exportar el detalle" : undefined} onClick={() => detail && void exportLaserExcel(detail)}><Download className="mr-1.5 h-3.5 w-3.5" />Excel</Button>
        <Button size="sm" variant="outline" className="h-9" disabled={!detail || annualMode} title={annualMode ? "Elige un mes específico para exportar el detalle" : undefined} onClick={() => detail && printLaserPdf(detail)}><Printer className="mr-1.5 h-3.5 w-3.5" />PDF</Button>
        <div className="ml-auto flex items-center gap-2">
          {canApply && !annualMode ? (
            <Button size="sm" className="h-9" disabled={loading || applying || !detail || totalFondo <= 0} onClick={() => setConfirmOpen(true)}>
              <Wand2 className="mr-1.5 h-3.5 w-3.5" />Aplicar a liquidación
            </Button>
          ) : null}
        </div>
      </CardContent></Card>

      {detail ? (
        <div className="flex items-center gap-1.5 rounded-md border border-[color:var(--brand-border)] bg-[color:var(--brand-primary)]/5 px-3 py-2 text-xs text-slate-700">
          <CheckCircle2 className="h-3.5 w-3.5 text-[color:var(--brand-primary)]" />{laserModeLabel(detail)} · configurable en <b>Reglas de comisión</b>
        </div>
      ) : null}

      {!weightsOk ? (
        <div className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"><AlertTriangle className="h-3.5 w-3.5" />Los pesos de reparto no suman 100% (personas {detail?.weights.personas}% + pacientes {detail?.weights.pacientes}%). Corrige en Reglas de comisión.</div>
      ) : null}
      {(detail?.globalAlerts || []).map((a, i) => (
        <div key={i} className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"><AlertTriangle className="h-3.5 w-3.5" />{a}</div>
      ))}

      {loading ? (
        <Card className="border-[color:var(--brand-border)]"><CardContent className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />Calculando…</CardContent></Card>
      ) : annualMode ? (
        !annual ? (
          <Card className="border-[color:var(--brand-border)]"><CardContent className="py-10 text-center text-sm text-muted-foreground">Sin datos del año seleccionado.</CardContent></Card>
        ) : (
          <>
            {/* Resumen anual: fondo por sucursal × mes */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Card className="border-emerald-200"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Fondo total {annual.year}</div><div className="text-lg font-black tabular-nums text-emerald-700">{fmtRD(annual.totals.fundYear)}</div></CardContent></Card>
              {annual.totals.byBranch.map((b) => (
                <Card key={b.branch} className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">{b.branch}</div><div className="text-lg font-black tabular-nums">{fmtRD(b.fund)}</div><div className="text-[10px] text-muted-foreground">base neta {fmtRD(b.base)}</div></CardContent></Card>
              ))}
            </div>
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-0">
              <div className="border-b px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">Fondo láser por mes · {annual.year} · tarjeta −{(annual.cardPct * 100).toFixed(0)}% antes de la escala</div>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                  <th className="px-3 py-2">Mes</th>
                  {annual.totals.byBranch.map((b) => <th key={b.branch} className="px-2 py-2 text-right">{b.branch}</th>)}
                  <th className="px-3 py-2 text-right">Fondo total</th>
                </tr></thead>
                <tbody>{annual.months.map((mo) => (
                  <tr key={mo.month} className={`border-b last:border-0 ${mo.fundTotal === 0 ? "text-muted-foreground" : ""}`}>
                    <td className="px-3 py-2 font-medium">{MONTHS[mo.month - 1]}</td>
                    {mo.branches.map((b) => (
                      <td key={b.branch} className="px-2 py-2 text-right tabular-nums">
                        {b.fund > 0 ? <>{fmtRD(b.fund)} <span className="text-[10px] text-muted-foreground">({(b.pct * 100).toFixed(0)}%)</span></> : "—"}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-bold tabular-nums">{mo.fundTotal > 0 ? fmtRD(mo.fundTotal) : "—"}</td>
                  </tr>
                ))}</tbody>
                <tfoot><tr className="bg-slate-50 font-bold">
                  <td className="px-3 py-2">Total {annual.year}</td>
                  {annual.totals.byBranch.map((b) => <td key={b.branch} className="px-2 py-2 text-right tabular-nums">{fmtRD(b.fund)}</td>)}
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{fmtRD(annual.totals.fundYear)}</td>
                </tr></tfoot>
              </table></div>
              <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">Vista anual (todos los meses): muestra la base neta → tramo → fondo de cada sucursal. Para el reparto por persona, Excel/PDF o aplicar a liquidación, elige un mes específico.</p>
            </CardContent></Card>
          </>
        )
      ) : !detail ? (
        <Card className="border-[color:var(--brand-border)]"><CardContent className="py-10 text-center text-sm text-muted-foreground">Sin datos. Importa ventas del período primero.</CardContent></Card>
      ) : detail.branches.map((b) => (
        <Card key={b.branch} className="border-[color:var(--brand-border)]"><CardContent className="p-0">
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
            <Building2 className="h-4 w-4 text-[color:var(--brand-primary)]" />
            <span className="text-sm font-semibold">{b.branch}</span>
            <span className="text-[11px] text-muted-foreground">{MONTHS[month - 1]} {year}</span>
            {Math.abs(b.cuadre) < 0.005
              ? <Badge variant="outline" className="ml-auto border-emerald-200 bg-emerald-50 text-emerald-700">Cuadre exacto ✓</Badge>
              : <Badge variant="outline" className="ml-auto border-amber-200 bg-amber-50 text-amber-700">Diferencia {fmtRD(b.cuadre)}</Badge>}
          </div>
          {/* Resumen del mes */}
          <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4 lg:grid-cols-8">
            {[
              ["Venta bruta", fmtRD(b.ventaLaserBruta)],
              ["Venta tarjeta", fmtRD(b.ventaLaserTarjeta)],
              [`Desc. tarjeta ${(b.cardPct * 100).toFixed(0)}%`, "−" + fmtRD(b.descuentoTarjeta)],
              ["Base neta", fmtRD(b.baseLaserNeta)],
              ["Tramo", `${(b.pct * 100).toFixed(0)}%`],
              ["Fondo", fmtRD(b.fondo)],
              [`Cuota (fondo÷${b.eligibleCount || "N"})`, fmtRD(b.perCapita || 0)],
              ["Pacientes", `${b.totalPacientes}`],
            ].map(([k, v], i) => (
              <div key={i} className="bg-white p-3"><div className="text-[10px] uppercase text-muted-foreground">{k}</div><div className="text-sm font-black tabular-nums">{v}</div></div>
            ))}
          </div>
          {b.alerts.length ? (
            <div className="space-y-0.5 border-t bg-amber-50/50 px-4 py-2">
              {b.alerts.map((a, i) => <div key={i} className="text-[11px] text-amber-800">⚠ {a}</div>)}
            </div>
          ) : null}
          {/* Tabla del personal */}
          <div className="overflow-x-auto border-t"><table className="w-full text-sm">
            <thead><tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
              <th className="px-3 py-2">Empleado</th><th className="px-2 py-2 text-center">Aplica</th>
              <th className="px-2 py-2 text-right">Pacientes</th><th className="px-2 py-2 text-right">% Pac.</th>
              <th className="px-2 py-2 text-right">Inc. personas</th><th className="px-2 py-2 text-right">Inc. pacientes</th>
              <th className="px-3 py-2 text-right">Total láser</th>
            </tr></thead>
            <tbody>{b.personnel.map((p) => (
              <tr key={p.name} className="border-b last:border-0">
                <td className="px-3 py-2 font-medium">{p.name}{!p.applies ? <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700">no aplica</span> : null}</td>
                <td className="px-2 py-2 text-center">{p.applies ? "Sí" : "No"}</td>
                <td className="px-2 py-2 text-right tabular-nums">{p.patients}</td>
                <td className="px-2 py-2 text-right tabular-nums">{(p.patientsPct * 100).toFixed(2)}%</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtRD(p.laserLinear)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtRD(p.laserPatients)}</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums text-[color:var(--brand-primary)]">{fmtRD(p.laserTotal)}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr className="bg-slate-50 font-bold">
              <td className="px-3 py-2">Total ({b.personasAplican} aplican)</td><td className="px-2 py-2"></td>
              <td className="px-2 py-2 text-right tabular-nums">{b.totalPacientes}</td><td className="px-2 py-2"></td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtRD(b.fondoPersonas)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtRD(b.fondoPacientes)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtRD(b.totalDistribuido)}</td>
            </tr></tfoot>
          </table></div>
        </CardContent></Card>
      ))}

      {applied ? (
        <Card className="border-emerald-200 bg-emerald-50/40"><CardContent className="space-y-2 p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" />Fondo aplicado a la liquidación · {fmtRD(applied.totalApplied)}</div>
          {applied.results.map((r) => (
            <div key={`${r.year}-${r.month}`} className="text-xs text-slate-600">
              <b>{String(r.month).padStart(2, "0")}/{r.year}</b>: fondo {fmtRD(r.fund)} · {r.updated} liquidación{r.updated === 1 ? "" : "es"} actualizada{r.updated === 1 ? "" : "s"} · asignado {fmtRD(r.appliedTotal)}
              {r.unmatched.length ? <span className="ml-1 inline-flex items-center gap-1 text-amber-700"><AlertTriangle className="h-3 w-3" />{r.unmatched.length} sin cálculo: {r.unmatched.map((u) => u.provider).join(", ")}</span> : null}
              {r.locked.length ? <span className="ml-1 text-amber-700">· {r.locked.length} fila(s) pagada/cerrada sin tocar</span> : null}
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">El incentivo láser ya está sumado al neto de cada empleado en <b>Liquidación de incentivos</b>.</p>
        </CardContent></Card>
      ) : null}

      {/* Personal que aplica (roster editable) */}
      <button type="button" onClick={() => setShowRoster((v) => !v)} className="flex items-center gap-1 text-xs font-medium text-[color:var(--brand-primary)]">
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showRoster ? "rotate-180" : ""}`} />{showRoster ? "Ocultar" : "Ver / editar"} personal que aplica
      </button>
      {showRoster ? <LaserPersonnelEditor /> : null}

      <Dialog open={confirmOpen} onOpenChange={(o) => !o && setConfirmOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Aplicar fondo láser a la liquidación</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm text-slate-600">
            <p>Se escribirá el <b>incentivo láser</b> de <b>{MONTHS[month - 1]} {year}</b> en la liquidación de cada empleado (reparto por sucursal: personas + pacientes) y se recalculará el bruto y el neto.</p>
            <ul className="list-disc space-y-1 pl-5 text-xs">
              <li>Se procesa <b>por sucursal</b> con tarjeta neteada antes de la escala.</li>
              <li>Re-aplicar es seguro: sincroniza con el reparto vigente.</li>
              <li>Las liquidaciones <b>pagadas o cerradas</b> no se modifican.</li>
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={applying}>Cancelar</Button>
            <Button onClick={applyToSettlement} disabled={applying}>{applying ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Wand2 className="mr-1.5 h-4 w-4" />}Aplicar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Shell>
  )
}


// Clientes atendidos por prestador (fecha = Fecha de realización de la reserva)
// Clientes atendidos + CAPTURA MANUAL de pacientes (manual sobre-escribe reservas
// por colaborador; alimenta el reparto láser y el cálculo mensual).
interface CapRow {
  provider: string; branch: string; inRoster: boolean
  reservas: number | null; manual: number | null; manualId: string | null
  effective: number; source: string; service: string | null; observation: string | null
}
export function ComisionClientesPage() {
  const { apiUrl, showToast } = useAppStore()
  const user = useSessionUser()
  const canEdit = canPerm(user, "sales_commission.calculate")
  const { filters } = useCommissionFilters()
  const eff = effectivePeriod(filters)
  // La captura es POR MES y POR SUCURSAL: si el período global es "Todos los
  // meses" usa el mes actual; si la sucursal es "Todas" usa la primera.
  const month = eff.month === 0 ? new Date().getMonth() + 1 : eff.month
  const year = eff.year
  const branch = filters.branch || BRANCHES[0]
  const coerced = eff.month === 0 || !filters.branch
  const [rows, setRows] = useState<CapRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<Record<string, { patients: string; service: string; observation: string }>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionPatientCapture", branch, month, year })
      if (res?.ok) {
        const list = ((res as { rows: CapRow[] }).rows) || []
        setRows(list); setTotal((res as { total: number }).total || 0)
        const e: typeof edit = {}
        list.forEach((r) => { e[r.provider] = { patients: String(r.effective), service: r.service || "", observation: r.observation || "" } })
        setEdit(e)
      } else { setRows([]); showToast((res as { error?: string })?.error || "Error", "error") }
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setLoading(false) }
  }, [apiUrl, showToast, branch, month, year])
  useEffect(() => { void load() }, [load])

  const save = async (r: CapRow) => {
    if (!canEdit) return
    setBusyId(r.provider)
    try {
      const e = edit[r.provider] || { patients: "0", service: "", observation: "" }
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "saveCommissionPatientCount", branch, month, year, provider: r.provider, patients: e.patients || "0", service: e.service, observation: e.observation })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "No se pudo guardar")
      invalidateReadCache("getCommissionLaserDetail"); invalidateReadCache("getCommissionRunPreview")
      showToast(`Pacientes de ${r.provider} guardados (manual)`, "success")
      await load()
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setBusyId(null) }
  }

  const revert = async (r: CapRow) => {
    if (!canEdit) return
    setBusyId(r.provider)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "deleteCommissionPatientCount", branch, month, year, provider: r.provider })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "No se pudo revertir")
      invalidateReadCache("getCommissionLaserDetail"); invalidateReadCache("getCommissionRunPreview")
      showToast(`${r.provider} revertido a reservas`, "success")
      await load()
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setBusyId(null) }
  }

  const setE = (p: string, patch: Partial<{ patients: string; service: string; observation: string }>) =>
    setEdit((prev) => ({ ...prev, [p]: { ...(prev[p] || { patients: "", service: "", observation: "" }), ...patch } }))

  return (
    <Shell icon={<Users className="h-4 w-4" />} title="Incentivos de Ventas · Clientes atendidos (captura de pacientes)">
      <CommissionFilterBar branches={BRANCHES} />
      <Card className="border-[color:var(--brand-border)]"><CardContent className="flex flex-wrap items-center gap-2 p-3">
        <Badge variant="outline" className="border-cyan-200 bg-cyan-50 text-cyan-800">{MONTHS[month - 1]} {year} · {branch}</Badge>
        {coerced ? <span className="text-[11px] text-amber-700">Esta pantalla trabaja por mes y sucursal: elige un mes y una sucursal específicos en Filtros.</span> : null}
        <Button size="sm" variant="outline" className="ml-auto h-9" disabled={loading} onClick={() => void load()}>{loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}Recargar</Button>
        <div className="w-full text-xs text-muted-foreground">Base: <b>Reservas</b> (atenciones ASISTE). Editar guarda un valor <b>manual</b> que sobre-escribe solo a ese colaborador.</div>
      </CardContent></Card>

      <Card className="border-[color:var(--brand-border)]"><CardContent className="p-0">
        {loading ? <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
          : rows.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">Sin colaboradores ni reservas para {branch} en el período.</div>
          : (<div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
              <th className="px-3 py-2">Prestador</th><th className="px-2 py-2 text-right">Reservas</th>
              <th className="px-2 py-2 text-right">Pacientes</th><th className="px-2 py-2 text-center">Fuente</th>
              <th className="px-2 py-2 text-right">% Particip.</th><th className="px-2 py-2">Observación</th>
              <th className="px-3 py-2 text-right">Acciones</th>
            </tr></thead>
            <tbody>{rows.map((r) => {
              const e = edit[r.provider] || { patients: String(r.effective), service: "", observation: "" }
              const part = total > 0 ? (r.effective / total) * 100 : 0
              return (
                <tr key={r.provider} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{r.provider}{!r.inRoster ? <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700">fuera de roster</span> : null}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{r.reservas ?? "—"}</td>
                  <td className="px-2 py-2 text-right">
                    <input type="number" min={0} className="ml-auto h-8 w-20 rounded-md border border-input bg-white px-2 text-right text-sm" value={e.patients} disabled={!canEdit}
                      onChange={(ev) => setE(r.provider, { patients: ev.target.value })} />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] ${r.source === "manual" ? "border-[color:var(--brand-primary)] bg-[color:var(--brand-primary)]/10 text-[color:var(--brand-primary)]" : "border-slate-200 bg-slate-50 text-slate-500"}`}>{r.source}</span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{part.toFixed(2)}%</td>
                  <td className="px-2 py-2"><input className="h-8 w-40 rounded-md border border-input bg-white px-2 text-sm" placeholder="—" value={e.observation} disabled={!canEdit} onChange={(ev) => setE(r.provider, { observation: ev.target.value })} /></td>
                  <td className="px-3 py-2 text-right">
                    {canEdit ? (
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" className="h-7" disabled={busyId === r.provider} onClick={() => save(r)}>{busyId === r.provider ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}</Button>
                        {r.source === "manual" ? <Button size="sm" variant="ghost" className="h-7 text-amber-700 hover:bg-amber-50" disabled={busyId === r.provider} title="Revertir a reservas" onClick={() => revert(r)}><RotateCcw className="h-3.5 w-3.5" /></Button> : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              )
            })}</tbody>
            <tfoot><tr className="bg-slate-50 font-bold"><td className="px-3 py-2">Total ({rows.length})</td><td className="px-2 py-2"></td><td className="px-2 py-2 text-right tabular-nums">{total}</td><td className="px-2 py-2"></td><td className="px-2 py-2 text-right tabular-nums">100%</td><td className="px-2 py-2" colSpan={2}></td></tr></tfoot>
          </table></div>)}
      </CardContent></Card>
    </Shell>
  )
}

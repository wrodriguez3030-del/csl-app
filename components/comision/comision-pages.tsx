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
  Loader2, CheckCircle2, AlertTriangle, Wand2,
} from "lucide-react"
import { CommissionFilterBar, useCommissionFilters } from "./comision-filter-bar"

export { ComisionDashboardPage } from "./comision-dashboard-page"

const fmtRD = (n: number) => "RD$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const BRANCHES = ["RAFAEL VIDAL", "LOS JARDINES", "VILLA OLGA"]

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
    <Shell icon={<CalendarClock className="h-4 w-4" />} title="Comisión de Ventas · Historial mensual">
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
    <Shell icon={<Building2 className="h-4 w-4" />} title="Comisión de Ventas · Ventas por sucursal">
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
    <Shell icon={<Package className="h-4 w-4" />} title="Comisión de Ventas · Incentivos de productos">
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

// Comisión depilación láser: fondo por escala + reparto por pacientes
interface LaserApplyResult {
  results: {
    month: number; year: number; fund: number; tramoPct: number; updated: number; appliedTotal: number
    unmatched: { provider: string; amount: number }[]
    locked: { provider: string; status: string }[]
  }[]
  totalApplied: number
}

export function ComisionLaserPage() {
  const { apiUrl, showToast } = useAppStore()
  const user = useSessionUser()
  const canApply = canPerm(user, "sales_commission.calculate")
  const { params, filters, label } = useCommissionFilters()
  const [d, setD] = useState<{ laserTotal: number; tramoPct: number; threshold: number; fund: number; patientsTotal: number; distribution: { provider: string; patients: number; participation: number; amount: number }[]; byBranch: Record<string, number> } | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<LaserApplyResult | null>(null)
  const load = useCallback(async () => {
    setLoading(true)
    try { const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionLaser", ...params }); if (res?.ok) setD(res as never); else showToast((res as { error?: string })?.error || "Error", "error") }
    catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setLoading(false) }
  }, [apiUrl, showToast, params])
  useEffect(() => { void load() }, [load])
  const providers = (d?.distribution || []).map((r) => r.provider).sort()
  const hasPeriod = filters.quick !== "todo"

  const applyToSettlement = async () => {
    setApplying(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "applyCommissionLaser", ...params })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "No se pudo aplicar")
      const r = res as unknown as LaserApplyResult
      setApplied(r)
      invalidateReadCache("getCommissionCalculations")
      invalidateReadCache("getCommissionDashboard")
      invalidateReadCache("getCommissionExecutiveDashboard")
      showToast(`Fondo láser aplicado: RD$${(r.totalApplied || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} a la liquidación`, "success")
      setConfirmOpen(false)
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setApplying(false) }
  }

  return (
    <Shell icon={<Zap className="h-4 w-4" />} title="Comisión de Ventas · Comisión depilación láser">
      <CommissionFilterBar branches={BRANCHES} providers={providers} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Venta láser</div><div className="text-xl font-black tabular-nums">{fmtRD(d?.laserTotal || 0)}</div></CardContent></Card>
        <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Tramo alcanzado</div><div className="text-xl font-black tabular-nums">{((d?.tramoPct || 0) * 100).toFixed(0)}%</div><div className="text-[10px] text-muted-foreground">umbral {fmtRD(d?.threshold || 0)}</div></CardContent></Card>
        <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Fondo generado</div><div className="text-xl font-black tabular-nums text-[color:var(--brand-primary)]">{fmtRD(d?.fund || 0)}</div></CardContent></Card>
        <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Pacientes</div><div className="text-xl font-black tabular-nums">{d?.patientsTotal || 0}</div></CardContent></Card>
      </div>
      <Card className="border-[color:var(--brand-border)]"><CardContent className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Reparto del fondo por participación de pacientes</span>
          {canApply ? (
            <Button size="sm" variant="outline" className="ml-auto h-8"
              disabled={loading || applying || !hasPeriod || !d || d.fund <= 0}
              title={!hasPeriod ? "Selecciona un período (mes o rango) para aplicar" : undefined}
              onClick={() => setConfirmOpen(true)}>
              <Wand2 className="mr-1.5 h-3.5 w-3.5" />Aplicar a liquidación
            </Button>
          ) : null}
        </div>
        {loading ? <div className="py-8 text-center text-sm text-muted-foreground">Cargando...</div>
          : !d || d.distribution.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">Sin datos. Importa un archivo de ventas primero.</div>
          : (<div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b text-left text-[11px] uppercase text-muted-foreground"><th className="px-4 py-2">Prestador</th><th className="px-2 py-2 text-right">Pacientes</th><th className="px-2 py-2 text-right">Participación</th><th className="px-4 py-2 text-right">Incentivo láser</th></tr></thead>
            <tbody>{d.distribution.map((r) => (<tr key={r.provider} className="border-b last:border-0"><td className="px-4 py-2 font-medium">{r.provider}</td><td className="px-2 py-2 text-right tabular-nums">{r.patients}</td><td className="px-2 py-2 text-right tabular-nums">{r.participation.toFixed(2)}%</td><td className="px-4 py-2 text-right tabular-nums">{fmtRD(r.amount)}</td></tr>))}</tbody>
            <tfoot><tr className="bg-slate-50 font-bold"><td className="px-4 py-2">Total</td><td className="px-2 py-2 text-right tabular-nums">{d.patientsTotal}</td><td className="px-2 py-2 text-right tabular-nums">100%</td><td className="px-4 py-2 text-right tabular-nums">{fmtRD(d.fund)}</td></tr></tfoot>
          </table></div>)}
      </CardContent></Card>

      {applied ? (
        <Card className="border-emerald-200 bg-emerald-50/40"><CardContent className="space-y-2 p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" />Fondo aplicado a la liquidación · {fmtRD(applied.totalApplied)}</div>
          {applied.results.map((r) => (
            <div key={`${r.year}-${r.month}`} className="text-xs text-slate-600">
              <b>{String(r.month).padStart(2, "0")}/{r.year}</b>: fondo {fmtRD(r.fund)} ({(r.tramoPct * 100).toFixed(0)}%) · {r.updated} liquidación{r.updated === 1 ? "" : "es"} actualizada{r.updated === 1 ? "" : "s"} · asignado {fmtRD(r.appliedTotal)}
              {r.unmatched.length ? <span className="ml-1 inline-flex items-center gap-1 text-amber-700"><AlertTriangle className="h-3 w-3" />{r.unmatched.length} prestador{r.unmatched.length === 1 ? "" : "es"} sin cálculo: {r.unmatched.map((u) => u.provider).join(", ")}</span> : null}
              {r.locked.length ? <span className="ml-1 text-amber-700">· {r.locked.length} fila{r.locked.length === 1 ? "" : "s"} pagada/cerrada sin tocar</span> : null}
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">El incentivo láser ya está sumado al neto de cada empleado en <b>Liquidación de incentivos</b>.</p>
        </CardContent></Card>
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={(o) => !o && setConfirmOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Aplicar fondo láser a la liquidación</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm text-slate-600">
            <p>Se escribirá el <b>incentivo láser</b> de <b>{label}</b> en la liquidación de cada empleado según su participación de pacientes, y se recalculará el bruto y el neto.</p>
            <ul className="list-disc space-y-1 pl-5 text-xs">
              <li>Se procesa <b>mes por mes</b> con el fondo de TODO el negocio (ignora los filtros de sucursal/prestador).</li>
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
export function ComisionClientesPage() {
  const { apiUrl, showToast } = useAppStore()
  const { params } = useCommissionFilters()
  const [d, setD] = useState<{ total: number; roundingDiff: number; sourceUsed?: string; rows: { provider: string; branch: string; patients: number; uniquePatients?: number; participation: number }[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    try { const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionPatients", ...params }); if (res?.ok) setD(res as never); else showToast((res as { error?: string })?.error || "Error", "error") }
    catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setLoading(false) }
  }, [apiUrl, showToast, params])
  useEffect(() => { void load() }, [load])
  const providers = (d?.rows || []).map((r) => r.provider).sort()
  return (
    <Shell icon={<Users className="h-4 w-4" />} title="Comisión de Ventas · Clientes atendidos">
      <CommissionFilterBar branches={BRANCHES} providers={providers} />
      {d?.sourceUsed ? <p className="-mt-3 text-[11px] text-muted-foreground">Fuente: {d.sourceUsed === "reservas" ? "Reservas (atenciones por Fecha de realización)" : "Ventas (clientes distintos — importa Reservas para atenciones reales)"}</p> : null}
      <Card className="border-[color:var(--brand-border)]"><CardContent className="p-0">
        {loading ? <div className="py-10 text-center text-sm text-muted-foreground">Cargando...</div>
          : !d || d.rows.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">Sin datos. Importa un archivo de ventas primero.</div>
          : (<div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b text-left text-[11px] uppercase text-muted-foreground"><th className="px-4 py-2">Prestador</th><th className="px-2 py-2">Sucursal</th><th className="px-2 py-2 text-right">Pacientes</th><th className="px-4 py-2 text-right">Participación</th></tr></thead>
            <tbody>{d.rows.map((r) => (<tr key={r.provider} className="border-b last:border-0"><td className="px-4 py-2 font-medium">{r.provider}</td><td className="px-2 py-2 text-xs text-muted-foreground">{r.branch}</td><td className="px-2 py-2 text-right tabular-nums">{r.patients}</td><td className="px-4 py-2 text-right tabular-nums">{r.participation.toFixed(2)}%</td></tr>))}</tbody>
            <tfoot><tr className="bg-slate-50 font-bold"><td className="px-4 py-2" colSpan={2}>Total ({d.rows.length})</td><td className="px-2 py-2 text-right tabular-nums">{d.total}</td><td className="px-4 py-2 text-right tabular-nums">100%{d.roundingDiff ? ` (±${d.roundingDiff})` : ""}</td></tr></tfoot>
          </table></div>)}
      </CardContent></Card>
    </Shell>
  )
}

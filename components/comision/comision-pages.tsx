"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  LayoutDashboard, Building2, Package, Zap, Users,
  CalendarClock, FileBarChart2, RefreshCcw, Hammer,
} from "lucide-react"

const fmtRD = (n: number) => "RD$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

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

function EnConstruccion({ icon, title, desc }: { icon: ReactNode; title: string; desc: string }) {
  return (
    <Shell icon={icon} title={title}>
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600"><Hammer className="h-6 w-6" /></div>
          <div className="text-sm font-semibold">Pantalla en construcción</div>
          <p className="max-w-md text-sm text-muted-foreground">{desc}</p>
          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Motor de cálculo e importador ya verificados</Badge>
        </CardContent>
      </Card>
    </Shell>
  )
}

// ── Dashboard (lee datos vivos) ──────────────────────────────────────────────
export function ComisionDashboardPage() {
  const { apiUrl, showToast } = useAppStore()
  const [data, setData] = useState<{ activeRules: number; imports: number; employees: number; kpis: Record<string, number> } | null>(null)
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionDashboard" })
      if (res?.ok) setData(res as never)
      else showToast((res as { error?: string })?.error || "Error", "error")
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setLoading(false) }
  }, [apiUrl, showToast])
  useEffect(() => { void load() }, [load])

  const k = data?.kpis || {}
  const tiles: [string, number][] = [
    ["Incentivo productos", k.productIncentive || 0],
    ["Comisiones servicios", k.serviceCommission || 0],
    ["Incentivo láser", k.laserIncentive || 0],
    ["Bono extra", k.bonusExtra || 0],
    ["Total bruto", k.grossTotal || 0],
    ["Aporte limpieza", k.cleaningContribution || 0],
    ["Total neto", k.netTotal || 0],
  ]

  return (
    <Shell icon={<LayoutDashboard className="h-4 w-4" />} title="Comisión de Ventas · Dashboard">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Reglas activas</div><div className="text-2xl font-black">{data?.activeRules ?? "—"}</div></CardContent></Card>
        <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Importaciones</div><div className="text-2xl font-black">{data?.imports ?? "—"}</div></CardContent></Card>
        <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Empleados calculados</div><div className="text-2xl font-black">{data?.employees ?? "—"}</div></CardContent></Card>
      </div>
      {loading ? null : (data?.employees ?? 0) === 0 ? (
        <Card className="border-[color:var(--brand-border)]"><CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
          Aún no hay cálculos para mostrar. Importa un archivo de ventas y ejecuta el cálculo del período.
          <Button variant="outline" size="sm" className="mt-1 h-9" onClick={load}><RefreshCcw className="mr-1.5 h-4 w-4" />Actualizar</Button>
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map(([label, val]) => (
            <Card key={label} className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">{label}</div><div className="text-lg font-bold tabular-nums">{fmtRD(val)}</div></CardContent></Card>
          ))}
        </div>
      )}
    </Shell>
  )
}

// ── Historial mensual (lee importaciones vivas) ─────────────────────────────
export function ComisionHistorialPage() {
  const { apiUrl, showToast } = useAppStore()
  const [items, setItems] = useState<{ id: string; periodMonth: number; periodYear: number; filename: string; rowsCount: number; grossTotal: number; status: string }[]>([])
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionImports" })
      if (res?.ok) setItems((res.records as never) || [])
      else showToast((res as { error?: string })?.error || "Error", "error")
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setLoading(false) }
  }, [apiUrl, showToast])
  useEffect(() => { void load() }, [load])

  return (
    <Shell icon={<CalendarClock className="h-4 w-4" />} title="Comisión de Ventas · Historial mensual">
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
// Ventas por sucursal (agrega ventas persistidas)
export function ComisionSucursalesPage() {
  const { apiUrl, showToast } = useAppStore()
  const [data, setData] = useState<{ cardPct: number; branches: { branch: string; gross: number; tarjeta: number; efectivo: number; transferencia: number; otros: number; cardResult: number; producto: number; servicio: number; laser: number }[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    try { const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionByBranch" }); if (res?.ok) setData(res as never); else showToast((res as { error?: string })?.error || "Error", "error") }
    catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setLoading(false) }
  }, [apiUrl, showToast])
  useEffect(() => { void load() }, [load])
  const br = data?.branches || []
  const T = (f: (b: (typeof br)[number]) => number) => br.reduce((s, b) => s + f(b), 0)
  return (
    <Shell icon={<Building2 className="h-4 w-4" />} title="Comisión de Ventas · Ventas por sucursal">
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

// Incentivos de productos (lee cálculos vivos)
export function ComisionProductosPage() {
  const { apiUrl, showToast } = useAppStore()
  const [items, setItems] = useState<{ id: string; provider: string; branch: string; productsCount: number; productIncentive: number }[]>([])
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionCalculations" })
      if (res?.ok) setItems(((res.records as never[]) || []).filter((c: { productsCount: number }) => c.productsCount > 0))
      else showToast((res as { error?: string })?.error || "Error", "error")
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setLoading(false) }
  }, [apiUrl, showToast])
  useEffect(() => { void load() }, [load])
  const totalU = items.reduce((s, c) => s + c.productsCount, 0)
  const totalI = items.reduce((s, c) => s + c.productIncentive, 0)
  return (
    <Shell icon={<Package className="h-4 w-4" />} title="Comisión de Ventas · Incentivos de productos">
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
export function ComisionLaserPage() {
  const { apiUrl, showToast } = useAppStore()
  const [d, setD] = useState<{ laserTotal: number; tramoPct: number; threshold: number; fund: number; patientsTotal: number; distribution: { provider: string; patients: number; participation: number; amount: number }[]; byBranch: Record<string, number> } | null>(null)
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    try { const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionLaser" }); if (res?.ok) setD(res as never); else showToast((res as { error?: string })?.error || "Error", "error") }
    catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setLoading(false) }
  }, [apiUrl, showToast])
  useEffect(() => { void load() }, [load])
  return (
    <Shell icon={<Zap className="h-4 w-4" />} title="Comisión de Ventas · Comisión depilación láser">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Venta láser</div><div className="text-xl font-black tabular-nums">{fmtRD(d?.laserTotal || 0)}</div></CardContent></Card>
        <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Tramo alcanzado</div><div className="text-xl font-black tabular-nums">{((d?.tramoPct || 0) * 100).toFixed(0)}%</div><div className="text-[10px] text-muted-foreground">umbral {fmtRD(d?.threshold || 0)}</div></CardContent></Card>
        <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Fondo generado</div><div className="text-xl font-black tabular-nums text-[color:var(--brand-primary)]">{fmtRD(d?.fund || 0)}</div></CardContent></Card>
        <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Pacientes</div><div className="text-xl font-black tabular-nums">{d?.patientsTotal || 0}</div></CardContent></Card>
      </div>
      <Card className="border-[color:var(--brand-border)]"><CardContent className="p-0">
        <div className="border-b px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">Reparto del fondo por participación de pacientes</div>
        {loading ? <div className="py-8 text-center text-sm text-muted-foreground">Cargando...</div>
          : !d || d.distribution.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">Sin datos. Importa un archivo de ventas primero.</div>
          : (<div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b text-left text-[11px] uppercase text-muted-foreground"><th className="px-4 py-2">Prestador</th><th className="px-2 py-2 text-right">Pacientes</th><th className="px-2 py-2 text-right">Participación</th><th className="px-4 py-2 text-right">Incentivo láser</th></tr></thead>
            <tbody>{d.distribution.map((r) => (<tr key={r.provider} className="border-b last:border-0"><td className="px-4 py-2 font-medium">{r.provider}</td><td className="px-2 py-2 text-right tabular-nums">{r.patients}</td><td className="px-2 py-2 text-right tabular-nums">{r.participation.toFixed(2)}%</td><td className="px-4 py-2 text-right tabular-nums">{fmtRD(r.amount)}</td></tr>))}</tbody>
            <tfoot><tr className="bg-slate-50 font-bold"><td className="px-4 py-2">Total</td><td className="px-2 py-2 text-right tabular-nums">{d.patientsTotal}</td><td className="px-2 py-2 text-right tabular-nums">100%</td><td className="px-4 py-2 text-right tabular-nums">{fmtRD(d.fund)}</td></tr></tfoot>
          </table></div>)}
      </CardContent></Card>
    </Shell>
  )
}

// Clientes atendidos por prestador
export function ComisionClientesPage() {
  const { apiUrl, showToast } = useAppStore()
  const [d, setD] = useState<{ total: number; roundingDiff: number; rows: { provider: string; branch: string; patients: number; participation: number }[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    try { const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionPatients" }); if (res?.ok) setD(res as never); else showToast((res as { error?: string })?.error || "Error", "error") }
    catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setLoading(false) }
  }, [apiUrl, showToast])
  useEffect(() => { void load() }, [load])
  return (
    <Shell icon={<Users className="h-4 w-4" />} title="Comisión de Ventas · Clientes atendidos">
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
export const ComisionReportesPage = () => <EnConstruccion icon={<FileBarChart2 className="h-4 w-4" />} title="Comisión de Ventas · Reportes" desc="Exportación mensual profesional: Excel multi-hoja (Resumen, Sucursal, Prestador, Productos, Servicios, Láser, Clientes, Liquidación, Reglas, Conciliación) y PDF A4 con logo, totales y numeración." />

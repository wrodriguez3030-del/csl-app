"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  LayoutDashboard, Building2, UserCog, Package, Zap, Users, ReceiptText,
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
export const ComisionSucursalesPage = () => <EnConstruccion icon={<Building2 className="h-4 w-4" />} title="Comisión de Ventas · Ventas por sucursal" desc="Ventas brutas, tarjeta/efectivo/transferencia, % tarjeta configurable (27%), venta de productos/servicios/láser y comisiones por sucursal (Los Jardines / Rafael Vidal / Villa Olga), con orden, filtros y exportación." />
export const ComisionPrestadoresPage = () => <EnConstruccion icon={<UserCog className="h-4 w-4" />} title="Comisión de Ventas · Comisiones por prestador" desc="Tabla por prestador: productos, comisión por categoría (Faciales/Hollywood/Tatuajes/HIFU/Masajes), pacientes láser, participación, incentivos fijos, ajustes, bono y neto — con vinculación de alias." />
export const ComisionProductosPage = () => <EnConstruccion icon={<Package className="h-4 w-4" />} title="Comisión de Ventas · Incentivos de productos" desc="Unidades vendidas por empleado × monto configurable (RD$100/unidad) con validación de cuadre (detecta discrepancias como 67 vs 86 sin ocultarlas)." />
export const ComisionLaserPage = () => <EnConstruccion icon={<Zap className="h-4 w-4" />} title="Comisión de Ventas · Comisión depilación láser" desc="Venta láser del período, tramo de la escala alcanzado, fondo generado y su distribución por participación de pacientes. Escala editable por tramos." />
export const ComisionClientesPage = () => <EnConstruccion icon={<Users className="h-4 w-4" />} title="Comisión de Ventas · Clientes atendidos" desc="Pacientes atendidos por prestador (desde el archivo, integración o carga manual autorizada) y su participación proporcional con manejo de redondeo." />
export const ComisionLiquidacionPage = () => <EnConstruccion icon={<ReceiptText className="h-4 w-4" />} title="Comisión de Ventas · Liquidación de incentivos" desc="Liquidación por empleado: incentivo de productos + servicios + bono − aporte de limpieza = neto, con detalle de origen, aprobación, marcado de pago, impresión, Excel y PDF." />
export const ComisionReportesPage = () => <EnConstruccion icon={<FileBarChart2 className="h-4 w-4" />} title="Comisión de Ventas · Reportes" desc="Exportación mensual profesional: Excel multi-hoja (Resumen, Sucursal, Prestador, Productos, Servicios, Láser, Clientes, Liquidación, Reglas, Conciliación) y PDF A4 con logo, totales y numeración." />

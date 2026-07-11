"use client"

import { useCallback, useEffect, useState } from "react"
import { useAppStore, apiCallCached, normalizeApiUrl } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ShoppingCart, Wallet, Scale, AlertTriangle, Coins, CalendarClock, RefreshCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { KpiCard } from "@/components/kpi-card"
import { DashHeader, DashSkeletonRow } from "@/components/dashboard-kit"
import { fmtMoney, currentMonth, monthLabel } from "@/lib/purchases-client"
import type { PurchaseDashboardKpis } from "@/lib/purchases-client"

export function ComprasDashboardPage() {
  const { apiUrl, showToast } = useAppStore()
  const [kpis, setKpis] = useState<PurchaseDashboardKpis | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [month, setMonth] = useState(currentMonth())
  const [branch, setBranch] = useState("todas")
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const endpoint = normalizeApiUrl(apiUrl)
      const [res, br] = await Promise.all([
        apiCallCached(endpoint, { action: "getPurchaseDashboard", month, branch: branch === "todas" ? "" : branch }),
        branches.length ? Promise.resolve(null) : apiCallCached(endpoint, { action: "getPurchaseBranches" }),
      ])
      if (res?.ok) setKpis(res.kpis as PurchaseDashboardKpis)
      if (br?.ok) setBranches((br.records as string[]) || [])
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al cargar", "error")
    } finally {
      setLoading(false)
    }
  }, [apiUrl, month, branch, branches.length, showToast])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-4">
      <DashHeader title="Compras" subtitle="Panel de facturas de proveedores, pagos y gastos del mes" />

      <Card className="rounded-2xl border-[color:var(--brand-border)] shadow-sm">
        <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-end sm:justify-between sm:p-4">
          <div className="grid flex-1 grid-cols-2 gap-2 sm:max-w-md">
            <div>
              <Label className="text-[11px] text-muted-foreground">Mes</Label>
              <Input type="month" className="mt-0.5 h-9" value={month} onChange={(e) => setMonth(e.target.value || currentMonth())} />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Sucursal</Label>
              <Select value={branch} onValueChange={setBranch}>
                <SelectTrigger className="mt-0.5 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs capitalize text-muted-foreground">{monthLabel(month)}</span>
            <Button variant="outline" className="h-9" onClick={load}><RefreshCcw className="h-4 w-4" /></Button>
          </div>
        </CardContent>
      </Card>

      {loading && !kpis ? <DashSkeletonRow n={8} /> : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard title="Total compras del mes" value={fmtMoney(kpis?.totalComprasMes)} icon={ShoppingCart} variant="primary" description="Facturas del período" />
          <KpiCard title="Total pagado" value={fmtMoney(kpis?.totalPagadoMes)} icon={Wallet} variant="success" description="Pagos aplicados" />
          <KpiCard title="Balance pendiente" value={fmtMoney(kpis?.balancePendiente)} icon={Scale} variant="warning" description="Por pagar a proveedores" />
          <KpiCard title="Facturas vencidas" value={kpis?.facturasVencidas ?? 0} icon={AlertTriangle} variant="destructive" description="Requieren atención" />
          <KpiCard title="Gastos generales del mes" value={fmtMoney(kpis?.gastosGeneralesMes)} icon={Coins} variant="primary" description="Operativos y servicios" />
          <KpiCard title="Gastos menores del mes" value={fmtMoney(kpis?.gastosMenoresMes)} icon={Coins} variant="primary" description="Caja chica" />
          <KpiCard title="Recurrentes próximos" value={kpis?.recurrentesProximos ?? 0} icon={CalendarClock} variant="warning" description="Vencen en 7 días" />
          <KpiCard title="Recurrentes vencidos" value={kpis?.recurrentesVencidos ?? 0} icon={AlertTriangle} variant="destructive" description="Compromisos sin pagar" />
        </div>
      )}

      {kpis && kpis.pettyPendientes > 0 ? (
        <Card className="rounded-2xl border-amber-200 bg-amber-50/60 shadow-sm">
          <CardContent className="flex items-center gap-2.5 p-4 text-sm text-amber-800">
            <span className="shrink-0 rounded-full bg-amber-100 p-1.5 text-amber-600"><AlertTriangle className="h-3.5 w-3.5" /></span>
            <span>Hay <b>{kpis.pettyPendientes}</b> gasto(s) menor(es) pendiente(s) de aprobación.</span>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

"use client"

import { useCallback, useEffect, useState } from "react"
import { useAppStore, apiCallCached, normalizeApiUrl } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ShoppingCart, Wallet, Scale, AlertTriangle, Coins, CalendarClock, RefreshCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
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

  const cards = [
    { label: "Total compras del mes", value: fmtMoney(kpis?.totalComprasMes), icon: <ShoppingCart className="h-5 w-5" />, tone: "text-cyan-600" },
    { label: "Total pagado", value: fmtMoney(kpis?.totalPagadoMes), icon: <Wallet className="h-5 w-5" />, tone: "text-emerald-600" },
    { label: "Balance pendiente", value: fmtMoney(kpis?.balancePendiente), icon: <Scale className="h-5 w-5" />, tone: "text-amber-600" },
    { label: "Facturas vencidas", value: String(kpis?.facturasVencidas ?? 0), icon: <AlertTriangle className="h-5 w-5" />, tone: "text-red-600" },
    { label: "Gastos generales del mes", value: fmtMoney(kpis?.gastosGeneralesMes), icon: <Coins className="h-5 w-5" />, tone: "text-slate-600" },
    { label: "Gastos menores del mes", value: fmtMoney(kpis?.gastosMenoresMes), icon: <Coins className="h-5 w-5" />, tone: "text-slate-600" },
    { label: "Recurrentes próximos (7 días)", value: String(kpis?.recurrentesProximos ?? 0), icon: <CalendarClock className="h-5 w-5" />, tone: "text-blue-600" },
    { label: "Recurrentes vencidos", value: String(kpis?.recurrentesVencidos ?? 0), icon: <AlertTriangle className="h-5 w-5" />, tone: "text-red-600" },
  ]

  return (
    <div className="space-y-5">
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-end sm:justify-between sm:p-4">
          <div className="grid flex-1 grid-cols-2 gap-2 sm:max-w-md">
            <div>
              <Label className="text-xs">Mes</Label>
              <Input type="month" className="mt-1 h-9" value={month} onChange={(e) => setMonth(e.target.value || currentMonth())} />
            </div>
            <div>
              <Label className="text-xs">Sucursal</Label>
              <Select value={branch} onValueChange={setBranch}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground capitalize">{monthLabel(month)}</span>
            <Button variant="outline" className="h-9" onClick={load}><RefreshCcw className="h-4 w-4" /></Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label} className="border-[color:var(--brand-border)]">
            <CardContent className="p-3">
              <div className={`flex items-center gap-2 ${c.tone}`}>
                {c.icon}
                <span className="text-xl font-bold">{loading ? "…" : c.value}</span>
              </div>
              <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">{c.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {kpis && kpis.pettyPendientes > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Hay <b>{kpis.pettyPendientes}</b> gasto(s) menor(es) pendiente(s) de aprobación.
        </div>
      ) : null}
    </div>
  )
}

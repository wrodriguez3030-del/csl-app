"use client"

import { useCallback, useEffect, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl, invalidateReadCache } from "@/lib/store"
import { useSessionUser } from "@/hooks/use-session-user"
import { canPerm } from "@/lib/permissions"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ReceiptText, RefreshCcw, MoreHorizontal, Pencil, Check, DollarSign, Loader2 } from "lucide-react"

interface Calc {
  id: string; provider: string; branch: string; productsCount: number; productIncentive: number
  serviceCommission: number; laserIncentive: number; fixedIncentive: number; manualAdjustment: number
  bonusExtra: number; grossTotal: number; cleaningContribution: number; netTotal: number; status: string
}
const fmtRD = (n: number) => "RD$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const STATUS_BADGE: Record<string, string> = {
  calculado: "bg-slate-50 text-slate-600 border-slate-200", en_revision: "bg-sky-50 text-sky-700 border-sky-200",
  aprobado: "bg-emerald-50 text-emerald-700 border-emerald-200", pagado: "bg-violet-50 text-violet-700 border-violet-200",
  cerrado: "bg-amber-50 text-amber-700 border-amber-200", anulado: "bg-red-50 text-red-600 border-red-200",
}
const STATUS_LABEL: Record<string, string> = { calculado: "Calculado", en_revision: "En revisión", aprobado: "Aprobado", pagado: "Pagado", cerrado: "Cerrado", anulado: "Anulado" }
const svcTotal = (c: Calc) => c.serviceCommission + c.laserIncentive + c.fixedIncentive + c.manualAdjustment

export function ComisionLiquidacionPage() {
  const { apiUrl, showToast } = useAppStore()
  const user = useSessionUser()
  const canApprove = canPerm(user, "sales_commission.approve")
  const canPay = canPerm(user, "sales_commission.pay")
  const canEditAny = canPerm(user, "sales_commission.adjust") || canPerm(user, "sales_commission.bonus.manage") || canPerm(user, "sales_commission.cleaning.manage")

  const [items, setItems] = useState<Calc[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [editT, setEditT] = useState<Calc | null>(null)
  const [form, setForm] = useState({ bonusExtra: "", cleaningContribution: "", manualAdjustment: "" })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionCalculations" })
      if (res?.ok) setItems((res.records as Calc[]) || [])
      else showToast((res as { error?: string })?.error || "Error", "error")
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setLoading(false) }
  }, [apiUrl, showToast])
  useEffect(() => { void load() }, [load])

  const openEdit = (c: Calc) => { setEditT(c); setForm({ bonusExtra: String(c.bonusExtra || 0), cleaningContribution: String(c.cleaningContribution || 0), manualAdjustment: String(c.manualAdjustment || 0) }) }

  const saveEdit = async () => {
    if (!editT) return
    setBusy(true)
    try {
      const payload: Record<string, string> = { action: "updateCommissionCalculation", id: editT.id }
      if (Number(form.bonusExtra) !== editT.bonusExtra) payload.bonusExtra = form.bonusExtra
      if (Number(form.cleaningContribution) !== editT.cleaningContribution) payload.cleaningContribution = form.cleaningContribution
      if (Number(form.manualAdjustment) !== editT.manualAdjustment) payload.manualAdjustment = form.manualAdjustment
      if (Object.keys(payload).length === 2) { setEditT(null); return }
      const res = await apiJsonp(normalizeApiUrl(apiUrl), payload)
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "No se pudo guardar")
      invalidateReadCache("getCommissionCalculations"); invalidateReadCache("getCommissionDashboard")
      showToast("Liquidación actualizada", "success"); setEditT(null); await load()
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setBusy(false) }
  }

  const setStatus = async (c: Calc, status: string) => {
    setBusy(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "setCommissionCalcStatus", id: c.id, status })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "No se pudo actualizar")
      invalidateReadCache("getCommissionCalculations")
      showToast(status === "aprobado" ? "Aprobado" : status === "pagado" ? "Marcado como pagado" : "Estado actualizado", "success")
      await load()
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setBusy(false) }
  }

  const tot = (f: (c: Calc) => number) => items.reduce((s, c) => s + f(c), 0)

  return (
    <div className="space-y-5">
      <Card className="border-[color:var(--brand-border)]"><CardContent className="flex flex-wrap items-center gap-2 p-3 text-sm font-semibold sm:p-4">
        <ReceiptText className="h-4 w-4 text-[color:var(--brand-primary)]" /> Liquidación de incentivos
        <Badge variant="secondary">{items.length}</Badge>
        <span className="ml-2 text-xs font-normal text-muted-foreground">Bruto <b className="text-foreground">{fmtRD(tot((c) => c.grossTotal))}</b> · Limpieza <b className="text-foreground">−{fmtRD(tot((c) => c.cleaningContribution))}</b> · Neto <b className="text-foreground">{fmtRD(tot((c) => c.netTotal))}</b></span>
        <Button variant="outline" size="sm" className="ml-auto h-9" onClick={load}><RefreshCcw className="h-4 w-4" /></Button>
      </CardContent></Card>

      <Card className="border-[color:var(--brand-border)]"><CardContent className="p-0">
        {loading ? <div className="py-10 text-center text-sm text-muted-foreground">Cargando...</div>
          : items.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">No hay liquidaciones. Importa un archivo de ventas primero.</div>
          : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                <th className="px-3 py-2 text-center">#</th><th className="px-2 py-2">Empleado</th><th className="px-2 py-2">Sucursal</th>
                <th className="px-2 py-2 text-right">Inc. productos</th><th className="px-2 py-2 text-right">Inc. servicios</th>
                <th className="px-2 py-2 text-right">Bono</th><th className="px-2 py-2 text-right">Bruto</th>
                <th className="px-2 py-2 text-right">Limpieza</th><th className="px-2 py-2 text-right">Neto</th>
                <th className="px-2 py-2">Estado</th><th className="px-3 py-2 text-right">Acciones</th>
              </tr></thead>
              <tbody>{items.map((c, i) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">{i + 1}</td>
                  <td className="px-2 py-2 font-medium">{c.provider}</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">{c.branch}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtRD(c.productIncentive)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtRD(svcTotal(c))}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtRD(c.bonusExtra)}</td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums">{fmtRD(c.grossTotal)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-red-600">−{fmtRD(c.cleaningContribution)}</td>
                  <td className="px-2 py-2 text-right font-bold tabular-nums">{fmtRD(c.netTotal)}</td>
                  <td className="px-2 py-2"><Badge variant="outline" className={STATUS_BADGE[c.status] || ""}>{STATUS_LABEL[c.status] || c.status}</Badge></td>
                  <td className="px-3 py-2 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={busy}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        {canEditAny && c.status !== "cerrado" ? <DropdownMenuItem onClick={() => openEdit(c)}><Pencil className="mr-2 h-4 w-4" />Editar bono / limpieza / ajuste</DropdownMenuItem> : null}
                        {canApprove && (c.status === "calculado" || c.status === "en_revision") ? <DropdownMenuItem onClick={() => setStatus(c, "aprobado")}><Check className="mr-2 h-4 w-4" />Aprobar</DropdownMenuItem> : null}
                        {canPay && c.status === "aprobado" ? <DropdownMenuItem onClick={() => setStatus(c, "pagado")}><DollarSign className="mr-2 h-4 w-4" />Marcar pagado</DropdownMenuItem> : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
      </CardContent></Card>

      <Dialog open={!!editT} onOpenChange={(o) => !o && setEditT(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Ajustar liquidación · {editT?.provider}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Bono extra (RD$)</Label><Input className="mt-1 h-9" type="number" step="0.01" value={form.bonusExtra} onChange={(e) => setForm((f) => ({ ...f, bonusExtra: e.target.value }))} /></div>
            <div><Label className="text-xs">Aporte de limpieza (RD$)</Label><Input className="mt-1 h-9" type="number" step="0.01" value={form.cleaningContribution} onChange={(e) => setForm((f) => ({ ...f, cleaningContribution: e.target.value }))} /></div>
            <div><Label className="text-xs">Ajuste manual (RD$)</Label><Input className="mt-1 h-9" type="number" step="0.01" value={form.manualAdjustment} onChange={(e) => setForm((f) => ({ ...f, manualAdjustment: e.target.value }))} /></div>
            <p className="text-[11px] text-muted-foreground">El neto se recalcula automáticamente. Cada campo requiere su permiso (bono, limpieza, ajuste).</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditT(null)} disabled={busy}>Cancelar</Button>
            <Button onClick={saveEdit} disabled={busy}>{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

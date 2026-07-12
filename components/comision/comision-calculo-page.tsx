"use client"

/**
 * CÁLCULO MENSUAL DE INCENTIVOS por sucursal (runs).
 * Elige sucursal + mes + año → corre el motor puro `computeRun` en el servidor
 * (preview, no persiste) → muestra bases, fondo láser, desglose por colaborador
 * y alertas → permite GUARDAR borrador, FINALIZAR (inmutable) o ANULAR.
 * El detalle y los totales se recalculan siempre en el servidor: el cliente solo
 * envía sucursal/período.
 */
import { useCallback, useEffect, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl, invalidateReadCache } from "@/lib/store"
import { useSessionUser } from "@/hooks/use-session-user"
import { canPerm } from "@/lib/permissions"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Calculator, Loader2, CheckCircle2, AlertTriangle, Save, Lock, Ban, RefreshCw } from "lucide-react"
import { CATEGORY_LABELS } from "@/lib/commission/classification"
import type { RunResult } from "@/lib/commission/run-engine"
import { PeriodoSucursalPicker, usePeriodoCompartido } from "./periodo-picker"

const fmtRD = (n: number) => "RD$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const BRANCHES = ["RAFAEL VIDAL", "LOS JARDINES", "VILLA OLGA"]
const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

interface SavedRun {
  id: string; branch: string; periodMonth: number; periodYear: number
  status: string; cardPct: number; notes: string | null
  finalizedAt: string | null; voidedAt: string | null; voidReason: string | null
  updatedAt: string | null
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  borrador: { label: "Borrador", cls: "bg-amber-100 text-amber-700 border-amber-200" },
  finalizado: { label: "Finalizado", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  anulado: { label: "Anulado", cls: "bg-slate-200 text-slate-600 border-slate-300" },
}

export function ComisionCalculoPage() {
  const { apiUrl, showToast } = useAppStore()
  const user = useSessionUser()
  const canCalc = canPerm(user, "sales_commission.calculate")

  const { month: sharedMonth, year, branch, setMonth, setYear, setBranch } = usePeriodoCompartido()
  // Los runs son POR MES: si el período global es "Todos los meses", usar el mes actual.
  const month = sharedMonth === 0 ? new Date().getMonth() + 1 : sharedMonth

  const [result, setResult] = useState<RunResult | null>(null)
  const [savedRun, setSavedRun] = useState<SavedRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [voidReason, setVoidReason] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionRunPreview", branch, month, year })
      if (res?.ok) {
        setResult((res as { result: RunResult }).result)
        setSavedRun((res as { savedRun: SavedRun | null }).savedRun)
      } else {
        setResult(null); setSavedRun(null)
        showToast((res as { error?: string })?.error || "Error", "error")
      }
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setLoading(false) }
  }, [apiUrl, showToast, branch, month, year])
  useEffect(() => { void load() }, [load])

  const isFinalized = savedRun?.status === "finalizado"

  const saveDraft = async () => {
    setBusy(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "saveCommissionRun", branch, month, year })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "No se pudo guardar")
      invalidateReadCache("getCommissionRunPreview")
      invalidateReadCache("getCommissionRuns")
      showToast("Borrador guardado", "success")
      await load()
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setBusy(false) }
  }

  const finalize = async () => {
    if (!savedRun) return
    setBusy(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "finalizeCommissionRun", id: savedRun.id })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "No se pudo finalizar")
      invalidateReadCache("getCommissionRunPreview")
      invalidateReadCache("getCommissionRuns")
      showToast("Cálculo finalizado", "success")
      await load()
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setBusy(false) }
  }

  const doVoid = async () => {
    if (!savedRun) return
    setBusy(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "voidCommissionRun", id: savedRun.id, reason: voidReason })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "No se pudo anular")
      invalidateReadCache("getCommissionRunPreview")
      invalidateReadCache("getCommissionRuns")
      showToast("Cálculo anulado", "success")
      setVoidOpen(false); setVoidReason("")
      await load()
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setBusy(false) }
  }

  const laser = result?.laser
  const totals = result?.totals
  const badge = savedRun ? STATUS_BADGE[savedRun.status] : null

  return (
    <div className="space-y-5">
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="flex items-center gap-2 p-3 text-sm font-semibold sm:p-4">
          <span className="text-[color:var(--brand-primary)]"><Calculator className="h-4 w-4" /></span>
          Incentivos de Ventas · Cálculo mensual de incentivos
        </CardContent>
      </Card>

      {/* Selectores de período/sucursal + estado */}
      <Card className="border-[color:var(--brand-border)]"><CardContent className="flex flex-wrap items-end gap-3 p-4">
        <PeriodoSucursalPicker showBranch allowAllMonths={false} month={month} year={year} branch={branch} onMonth={setMonth} onYear={setYear} onBranch={setBranch} />
        <Button size="sm" variant="outline" className="h-9" disabled={loading} onClick={() => void load()}>
          {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}Recalcular
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {badge ? <Badge variant="outline" className={badge.cls}>{badge.label}</Badge> : <span className="text-xs text-muted-foreground">Sin guardar</span>}
          {canCalc ? (
            <>
              <Button size="sm" className="h-9" disabled={busy || loading || isFinalized || !result} onClick={() => void saveDraft()} title={isFinalized ? "Anula el cálculo finalizado para recalcular" : undefined}>
                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}Guardar borrador
              </Button>
              <Button size="sm" variant="outline" className="h-9 border-emerald-300 text-emerald-700 hover:bg-emerald-50" disabled={busy || loading || !savedRun || savedRun.status !== "borrador"} onClick={() => void finalize()}>
                <Lock className="mr-1.5 h-3.5 w-3.5" />Finalizar
              </Button>
              {savedRun && savedRun.status !== "anulado" ? (
                <Button size="sm" variant="outline" className="h-9 border-red-300 text-red-700 hover:bg-red-50" disabled={busy || loading} onClick={() => setVoidOpen(true)}>
                  <Ban className="mr-1.5 h-3.5 w-3.5" />Anular
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </CardContent></Card>

      {loading ? (
        <Card className="border-[color:var(--brand-border)]"><CardContent className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />Calculando…</CardContent></Card>
      ) : !result ? (
        <Card className="border-[color:var(--brand-border)]"><CardContent className="py-10 text-center text-sm text-muted-foreground">Sin datos para el período seleccionado.</CardContent></Card>
      ) : (
        <>
          {/* KPIs del fondo láser + neto */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Base láser (neta)</div><div className="text-lg font-black tabular-nums">{fmtRD(laser?.base || 0)}</div></CardContent></Card>
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Tramo</div><div className="text-lg font-black tabular-nums">{((laser?.pct || 0) * 100).toFixed(0)}%</div><div className="text-[10px] text-muted-foreground">umbral {fmtRD(laser?.threshold || 0)}</div></CardContent></Card>
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Fondo láser</div><div className="text-lg font-black tabular-nums text-[color:var(--brand-primary)]">{fmtRD(laser?.fund || 0)}</div></CardContent></Card>
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Por pacientes / lineal</div><div className="text-sm font-bold tabular-nums">{fmtRD(laser?.fundPatients || 0)} <span className="text-muted-foreground">/</span> {fmtRD(laser?.fundLinear || 0)}</div><div className="text-[10px] text-muted-foreground">{laser?.patientsTotal || 0} pac · fuente {laser?.patientsSource}</div></CardContent></Card>
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Incentivo servicios</div><div className="text-lg font-black tabular-nums">{fmtRD(totals?.serviceIncentiveAdjusted || 0)}</div></CardContent></Card>
            <Card className="border-emerald-200"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Neto a pagar</div><div className="text-lg font-black tabular-nums text-emerald-700">{fmtRD(totals?.netTotal || 0)}</div></CardContent></Card>
          </div>

          {/* Alertas */}
          {result.alerts.length ? (
            <Card className="border-amber-200 bg-amber-50/50"><CardContent className="space-y-1 p-4">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />Alertas ({result.alerts.length})</div>
              {result.alerts.map((a, i) => <div key={i} className="text-xs text-amber-800">• {a}</div>)}
            </CardContent></Card>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" />Sin alertas: el cálculo cuadra con la configuración vigente.</div>
          )}

          {/* Desglose por colaborador */}
          <Card className="border-[color:var(--brand-border)]"><CardContent className="p-0">
            <div className="border-b px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">Detalle por colaborador · {branch} · {MONTHS[month - 1]} {year} · tarjeta −{((result.cardPct || 0) * 100).toFixed(0)}%</div>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                <th className="px-3 py-2">Colaborador</th>
                <th className="px-2 py-2 text-right">Servicios</th>
                <th className="px-2 py-2 text-right">Eval.</th>
                <th className="px-2 py-2 text-right">Serv. ajust.</th>
                <th className="px-2 py-2 text-right">Prod.</th>
                <th className="px-2 py-2 text-right">Láser pac.</th>
                <th className="px-2 py-2 text-right">Láser lin.</th>
                <th className="px-2 py-2 text-right">Bono</th>
                <th className="px-2 py-2 text-right">Bruto</th>
                <th className="px-2 py-2 text-right">Limpieza</th>
                <th className="px-3 py-2 text-right">Neto</th>
              </tr></thead>
              <tbody>{result.items.map((it) => (
                <tr key={it.name} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{it.name}{!it.inRoster ? <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700">fuera de roster</span> : null}{it.patients > 0 ? <span className="ml-1 text-[10px] text-muted-foreground">{it.patients} pac</span> : null}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtRD(it.serviceIncentive)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-xs">{it.evaluationPct}%</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtRD(it.serviceIncentiveAdjusted)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtRD(it.productIncentive)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtRD(it.laserPatients)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtRD(it.laserLinear)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtRD(it.bonusExtra)}</td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums">{fmtRD(it.grossTotal)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">−{fmtRD(it.cleaningContribution)}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-emerald-700">{fmtRD(it.netTotal)}</td>
                </tr>
              ))}</tbody>
              {totals ? (
                <tfoot><tr className="bg-slate-50 font-bold">
                  <td className="px-3 py-2">Totales ({result.items.length})</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtRD(totals.serviceIncentive)}</td>
                  <td className="px-2 py-2"></td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtRD(totals.serviceIncentiveAdjusted)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtRD(totals.productIncentive)}</td>
                  <td className="px-2 py-2 text-right tabular-nums" colSpan={2}>{fmtRD(totals.laserTotal)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtRD(totals.bonusExtra)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtRD(totals.grossTotal)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">−{fmtRD(totals.cleaningContribution)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{fmtRD(totals.netTotal)}</td>
                </tr></tfoot>
              ) : null}
            </table></div>
          </CardContent></Card>

          {/* Bases por categoría (método de pago) */}
          <Card className="border-[color:var(--brand-border)]"><CardContent className="p-0">
            <div className="border-b px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">Bases por categoría (tarjeta neteada)</div>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                <th className="px-3 py-2">Categoría</th>
                <th className="px-2 py-2 text-right">Efectivo</th>
                <th className="px-2 py-2 text-right">Transferencia</th>
                <th className="px-2 py-2 text-right">Tarjeta bruta</th>
                <th className="px-2 py-2 text-right">Desc. tarjeta</th>
                <th className="px-2 py-2 text-right">Tarjeta neta</th>
                <th className="px-3 py-2 text-right">Base neta</th>
              </tr></thead>
              <tbody>{Object.entries(result.baseByCategory).sort((a, b) => b[1].totalNeto - a[1].totalNeto).map(([cat, b]) => (
                <tr key={cat} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{CATEGORY_LABELS[cat] || cat}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtRD(b.efectivo)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtRD(b.transferencia)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtRD(b.tarjetaBruta)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">−{fmtRD(b.tarjetaDescuento)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtRD(b.tarjetaNeta)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtRD(b.totalNeto)}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr className="bg-slate-50 font-bold">
                <td className="px-3 py-2">Total</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtRD(result.baseTotal.efectivo)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtRD(result.baseTotal.transferencia)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtRD(result.baseTotal.tarjetaBruta)}</td>
                <td className="px-2 py-2 text-right tabular-nums">−{fmtRD(result.baseTotal.tarjetaDescuento)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtRD(result.baseTotal.tarjetaNeta)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtRD(result.baseTotal.totalNeto)}</td>
              </tr></tfoot>
            </table></div>
          </CardContent></Card>

          {savedRun?.status === "anulado" && savedRun.voidReason ? (
            <div className="text-xs text-muted-foreground">Último cálculo anulado — motivo: {savedRun.voidReason}</div>
          ) : null}
        </>
      )}

      {/* Diálogo de anulación */}
      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Anular cálculo</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Se anulará el cálculo de <b>{branch}</b> · {MONTHS[month - 1]} {year}. El período queda libre para recalcular. Indica el motivo:</p>
          <textarea className="min-h-20 w-full rounded-md border border-input bg-white p-2 text-sm" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Motivo de la anulación…" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidOpen(false)} disabled={busy}>Cancelar</Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={() => void doVoid()} disabled={busy || !voidReason.trim()}>
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Ban className="mr-1.5 h-3.5 w-3.5" />}Anular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl } from "@/lib/store"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { useSessionUser } from "@/hooks/use-session-user"
import { canPerm } from "@/lib/permissions"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FileBarChart2, FileSpreadsheet, FileText, Printer, Loader2, RefreshCcw } from "lucide-react"
import { exportCommissionExcel, printCommissionPdf, type CommissionReportData } from "@/lib/commission/commission-export"
import { CATEGORY_LABELS } from "@/lib/commission/classification"
import { CommissionFilterBar, useCommissionFilters } from "./comision-filter-bar"

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
const fmtRD = (n: number) => "RD$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function ComisionReportesPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const user = useSessionUser()
  const canExport = canPerm(user, "sales_commission.export")
  // Período GLOBAL del módulo — el reporte, el Excel y el PDF usan exactamente
  // los mismos filtros activos de pantalla.
  const { filters, params, label: periodDisplay } = useCommissionFilters()
  const month = filters.month
  const year = filters.year
  const [data, setData] = useState<CommissionReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const q = params
      const [dash, branch, pat, laser, rules, svcDetail, unassigned] = await Promise.all([
        apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionDashboard", ...q }),
        apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionByBranch", ...q }),
        apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionPatients", ...q }),
        apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionLaser", ...q }),
        apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionRules" }),
        apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionServiceDetail", ...q }),
        apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionUnassignedServices", ...q }),
      ])
      const k = (dash?.kpis as Record<string, number>) || {}
      setData({
        period: { month, year },
        totals: { productIncentive: k.productIncentive || 0, serviceCommission: k.serviceCommission || 0, laserIncentive: (laser?.fund as number) || 0, bonusExtra: k.bonusExtra || 0, grossTotal: k.grossTotal || 0, cleaningContribution: k.cleaningContribution || 0, netTotal: k.netTotal || 0 },
        branches: (branch?.branches as never) || [],
        calculations: (dash?.calculations as never) || [],
        patients: { total: (pat?.total as number) || 0, roundingDiff: (pat?.roundingDiff as number) || 0, rows: (pat?.rows as never) || [] },
        laser: { laserTotal: (laser?.laserTotal as number) || 0, tramoPct: (laser?.tramoPct as number) || 0, threshold: (laser?.threshold as number) || 0, fund: (laser?.fund as number) || 0, patientsTotal: (laser?.patientsTotal as number) || 0, byBranch: (laser?.byBranch as never) || [], distribution: (laser?.distribution as never) || [] },
        rules: (rules?.records as never) || [],
        serviceDetail: (svcDetail?.rows as never) || [],
        unassignedServices: (unassigned?.rows as never) || [],
        generadoPor: user?.nombre || user?.username || undefined,
      })
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al cargar", "error")
    } finally { setLoading(false) }
  }, [apiUrl, params, month, year, user, showToast])
  // BLINDAJE anti-bucle: disparar la carga solo cuando cambian los inputs REALES
  // (por VALOR, no por identidad de objeto). Aunque algún dep sea un objeto nuevo
  // en cada render, este efecto NO se re-dispara → imposible entrar en bucle.
  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load }, [load])
  const inputsKey = `${normalizeApiUrl(apiUrl)}|${year}|${month}|${JSON.stringify(params)}`
  useEffect(() => { void loadRef.current() }, [inputsKey])

  const doExcel = async () => {
    if (!data) return
    setExporting(true)
    try { await exportCommissionExcel(data, business) } catch (e) { showToast(e instanceof Error ? e.message : "Error Excel", "error") } finally { setExporting(false) }
  }
  const doPdf = () => { if (data) printCommissionPdf(data, business, window.location.origin) }

  const empty = !data || data.calculations.length === 0
  const t = data?.totals

  return (
    <div className="space-y-5">
      <CommissionFilterBar branches={["RAFAEL VIDAL", "LOS JARDINES", "VILLA OLGA"]} />
      <Card className="border-[color:var(--brand-border)]"><CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <FileBarChart2 className="h-4 w-4 text-[color:var(--brand-primary)]" /> Reportes de comisión
          <span className="text-xs font-normal text-muted-foreground">Período: <b className="text-foreground">{periodDisplay}</b> (los exportes usan exactamente estos filtros)</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="h-9" onClick={load} disabled={loading}><RefreshCcw className="mr-1.5 h-4 w-4" />Actualizar</Button>
          <Button size="sm" className="h-9" onClick={doExcel} disabled={!canExport || empty || exporting}>{exporting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-1.5 h-4 w-4" />}Exportar Excel (12 hojas)</Button>
          <Button size="sm" variant="outline" className="h-9" onClick={doPdf} disabled={!canExport || empty}><FileText className="mr-1.5 h-4 w-4" />Generar PDF</Button>
          <Button size="sm" variant="outline" className="h-9" onClick={doPdf} disabled={empty}><Printer className="mr-1.5 h-4 w-4" />Imprimir</Button>
        </div>
        {!canExport ? <div className="text-xs text-amber-600">Necesitas el permiso <code>sales_commission.export</code> para exportar.</div> : null}
      </CardContent></Card>

      {loading ? (
        <Card className="border-[color:var(--brand-border)]"><CardContent className="py-10 text-center text-sm text-muted-foreground">Cargando datos del período…</CardContent></Card>
      ) : empty ? (
        <Card className="border-[color:var(--brand-border)]"><CardContent className="py-10 text-center text-sm text-muted-foreground">No hay datos para {periodDisplay}. Importa un archivo de ventas de ese período primero.</CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([["Inc. productos", t!.productIncentive], ["Com. servicios", t!.serviceCommission], ["Fondo láser", t!.laserIncentive], ["Bono", t!.bonusExtra], ["Bruto", t!.grossTotal], ["Limpieza", t!.cleaningContribution], ["Total neto", t!.netTotal]] as [string, number][]).map(([l, v]) => (
              <Card key={l} className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">{l}</div><div className="text-lg font-bold tabular-nums">{fmtRD(v)}</div></CardContent></Card>
            ))}
          </div>
          {(data!.laser.byBranch || []).length > 0 && (
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-3 sm:p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold">
                <FileBarChart2 className="h-4 w-4 text-[color:var(--brand-primary)]" /> Incentivo láser · tramo por sucursal
                <span className="text-xs font-normal text-muted-foreground">cada sucursal cae en su tramo según SU venta láser individual (no sobre el total combinado)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 text-left">Sucursal</th>
                      <th className="py-2 text-right">Venta láser</th>
                      <th className="py-2 text-right">Tramo %</th>
                      <th className="py-2 text-right">Fondo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.laser.byBranch!.map((b) => (
                      <tr key={b.branch} className="border-b last:border-0">
                        <td className="py-1.5 font-medium">{b.branch}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtRD(b.base)}</td>
                        <td className="py-1.5 text-right tabular-nums">{(b.pct * 100).toFixed(2)}%</td>
                        <td className="py-1.5 text-right font-semibold tabular-nums text-emerald-700">{fmtRD(b.fund)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 bg-slate-50 font-bold">
                      <td className="py-2 text-xs uppercase">Total</td>
                      <td className="py-2 text-right tabular-nums">{fmtRD(data!.laser.byBranch!.reduce((s, b) => s + b.base, 0))}</td>
                      <td />
                      <td className="py-2 text-right tabular-nums text-emerald-700">{fmtRD(data!.laser.byBranch!.reduce((s, b) => s + b.fund, 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent></Card>
          )}
          {(data!.calculations || []).length > 0 && (
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-3 sm:p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold">
                <FileBarChart2 className="h-4 w-4 text-[color:var(--brand-primary)]" /> Comisión por prestador
                <Badge variant="secondary">{data!.calculations.length} prestadores</Badge>
                <span className="text-xs font-normal text-muted-foreground">incluye TODAS las prestadoras con comisión de productos, servicios y láser</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 text-left">Prestador</th>
                      <th className="py-2 text-left">Sucursal</th>
                      <th className="py-2 text-right">Inc. productos</th>
                      <th className="py-2 text-right">Com. servicios</th>
                      <th className="py-2 text-right">Inc. láser</th>
                      <th className="py-2 text-right">Bono</th>
                      <th className="py-2 text-right">Bruto</th>
                      <th className="py-2 text-right">Neto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.calculations.map((c, i) => (
                      <tr key={`${c.provider}-${c.branch}-${i}`} className="border-b last:border-0">
                        <td className="py-1.5 font-medium">{c.provider}</td>
                        <td className="py-1.5">{c.branch}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtRD(c.productIncentive)}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtRD(c.serviceCommission)}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtRD(c.laserIncentive)}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtRD(c.bonusExtra)}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtRD(c.grossTotal)}</td>
                        <td className="py-1.5 text-right font-semibold tabular-nums text-emerald-700">{fmtRD(c.netTotal)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 bg-slate-50 font-bold">
                      <td colSpan={2} className="py-2 text-xs uppercase">Totales</td>
                      <td className="py-2 text-right tabular-nums">{fmtRD(data!.calculations.reduce((s, c) => s + c.productIncentive, 0))}</td>
                      <td className="py-2 text-right tabular-nums">{fmtRD(data!.calculations.reduce((s, c) => s + c.serviceCommission, 0))}</td>
                      <td className="py-2 text-right tabular-nums">{fmtRD(data!.calculations.reduce((s, c) => s + c.laserIncentive, 0))}</td>
                      <td className="py-2 text-right tabular-nums">{fmtRD(data!.calculations.reduce((s, c) => s + c.bonusExtra, 0))}</td>
                      <td className="py-2 text-right tabular-nums">{fmtRD(data!.calculations.reduce((s, c) => s + c.grossTotal, 0))}</td>
                      <td className="py-2 text-right tabular-nums text-emerald-700">{fmtRD(data!.calculations.reduce((s, c) => s + c.netTotal, 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent></Card>
          )}
          {(data!.serviceDetail || []).length > 0 && (
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-3 sm:p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold">
                <FileBarChart2 className="h-4 w-4 text-[color:var(--brand-primary)]" /> Detalle de comisión por categoría
                <Badge variant="secondary">{data!.serviceDetail!.length} líneas</Badge>
                <span className="text-xs font-normal text-muted-foreground">venta base × % de la regla = comisión (hoja "Servicios Detalle" del Excel)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 text-left">Prestador</th>
                      <th className="py-2 text-left">Sucursal</th>
                      <th className="py-2 text-left">Categoría</th>
                      <th className="py-2 text-right">Venta base</th>
                      <th className="py-2 text-right">% aplicado</th>
                      <th className="py-2 text-right">Comisión</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.serviceDetail!.map((d, i) => (
                      <tr key={`${d.provider}-${d.category}-${i}`} className="border-b last:border-0">
                        <td className="py-1.5 font-medium">{d.provider}</td>
                        <td className="py-1.5">{d.branch}</td>
                        <td className="py-1.5">{CATEGORY_LABELS[d.category] || d.category}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtRD(d.base)}</td>
                        <td className="py-1.5 text-right tabular-nums">{(d.pct * 100).toFixed(2)}%</td>
                        <td className="py-1.5 text-right font-semibold tabular-nums text-emerald-700">{fmtRD(d.amount)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 bg-slate-50 font-bold">
                      <td colSpan={3} className="py-2 text-xs uppercase">Totales</td>
                      <td className="py-2 text-right tabular-nums">{fmtRD(data!.serviceDetail!.reduce((s, d) => s + d.base, 0))}</td>
                      <td />
                      <td className="py-2 text-right tabular-nums text-emerald-700">{fmtRD(data!.serviceDetail!.reduce((s, d) => s + d.amount, 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent></Card>
          )}
        </>
      )}
    </div>
  )
}

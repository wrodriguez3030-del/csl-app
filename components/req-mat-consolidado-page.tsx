"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl } from "@/lib/store"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BarChart3, FileSpreadsheet, Printer, RefreshCcw, CheckCheck } from "lucide-react"
import { buildConsolidated, buildConsolidatedTotals, fmtNum, REQ_STATUS_LABEL } from "@/lib/materials-client"
import type { ReqItem, ReqStatus } from "@/lib/materials-client"
import { exportConsolidadoExcel, printConsolidadoPdf } from "@/lib/materials-export"

export function ReqMatConsolidadoPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const [records, setRecords] = useState<ReqItem[]>([])
  const [branches, setBranches] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState(false)

  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")
  const [status, setStatus] = useState("todas")
  const [branch, setBranch] = useState("")
  const [supplier, setSupplier] = useState("todos")

  const load = async () => {
    setLoading(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), {
        action: "getMaterialConsolidado",
        desde, hasta, status, branch, supplier,
      })
      if (res?.ok) {
        setRecords((res.records as ReqItem[]) || [])
        setBranches((res.branches as string[]) || [])
      } else showToast((res as { error?: string })?.error || "Error", "error")
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al cargar", "error")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [apiUrl])

  const suppliers = useMemo(
    () => Array.from(new Set(records.map((r) => r.supplierGroup).filter(Boolean))) as string[],
    [records],
  )
  const consolidated = useMemo(() => buildConsolidated(records, branches), [records, branches])
  const totals = useMemo(() => buildConsolidatedTotals(consolidated, branches), [consolidated, branches])
  const grouped = useMemo(() => {
    const g: Record<string, typeof consolidated> = {}
    consolidated.forEach((r) => { (g[r.supplierGroup] = g[r.supplierGroup] || []).push(r) })
    return Object.entries(g)
  }, [consolidated])

  const filtrosLabel = `${desde || "inicio"} a ${hasta || "hoy"} · ${status === "todas" ? "todos los estados" : REQ_STATUS_LABEL[status as ReqStatus] || status}`

  const approveAllVisible = async () => {
    const reqIds = Array.from(new Set(records.map((r) => r.requisitionId)))
    if (!reqIds.length) return
    setApproving(true)
    try {
      for (const id of reqIds) await apiJsonp(normalizeApiUrl(apiUrl), { action: "approveAllRequisition", id })
      showToast(`${reqIds.length} requisición(es) aprobada(s)`, "success")
      await load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al aprobar", "error")
    } finally {
      setApproving(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="p-3 sm:p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <div><Label className="text-xs">Desde</Label><Input type="date" className="mt-1 h-9" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
            <div><Label className="text-xs">Hasta</Label><Input type="date" className="mt-1 h-9" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
            <div>
              <Label className="text-xs">Estado</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todos</SelectItem>
                  {(Object.keys(REQ_STATUS_LABEL) as ReqStatus[]).map((s) => <SelectItem key={s} value={s}>{REQ_STATUS_LABEL[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Sucursal</Label>
              <Select value={branch || "todas"} onValueChange={(v) => setBranch(v === "todas" ? "" : v)}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Proveedor</Label>
              <Select value={supplier} onValueChange={setSupplier}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {suppliers.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end"><Button className="h-9 w-full" onClick={load}><RefreshCcw className="mr-1.5 h-4 w-4" />Aplicar</Button></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" className="h-9" onClick={() => exportConsolidadoExcel({ rows: consolidated, branches, businessName: business.name, filtros: filtrosLabel })}>
              <FileSpreadsheet className="mr-1.5 h-4 w-4" />Exportar Excel
            </Button>
            <Button variant="outline" className="h-9" onClick={() => printConsolidadoPdf({ rows: consolidated, branches, businessName: business.name, filtros: filtrosLabel })}>
              <Printer className="mr-1.5 h-4 w-4" />Exportar / Imprimir PDF
            </Button>
            <Button className="h-9" onClick={approveAllVisible} disabled={approving || !records.length}>
              <CheckCheck className="mr-1.5 h-4 w-4" />{approving ? "Aprobando..." : "Aprobar todo (visible)"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="p-3 sm:p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold">
            <BarChart3 className="h-4 w-4 text-[color:var(--brand-primary)]" /> Consolidado de compras
            <Badge variant="secondary">{consolidated.length} materiales</Badge>
            {consolidated.length > 0 && (
              <Badge className="border-emerald-200 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                Aprobado total: {fmtNum(totals.approved)}
              </Badge>
            )}
          </div>
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Cargando...</div>
          ) : consolidated.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Sin requisiciones para los filtros aplicados.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th rowSpan={2} className="py-2 text-left align-bottom">Material</th>
                    {branches.map((b) => (
                      <th key={b} colSpan={2} className="border-l py-2 text-center">{b}</th>
                    ))}
                    <th rowSpan={2} className="border-l py-2 text-right align-bottom">Total</th>
                    <th rowSpan={2} className="py-2 text-right align-bottom">Aprobado</th>
                  </tr>
                  <tr className="border-b-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {branches.map((b) => (
                      <Fragment key={b}>
                        <th className="border-l py-1 text-right">Sol.</th>
                        <th className="py-1 text-right text-emerald-700">Apr.</th>
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grouped.map(([supplierName, rows]) => (
                    <Fragment key={supplierName}>
                      <tr className="bg-slate-100">
                        <td colSpan={branches.length * 2 + 3} className="py-1.5 pl-2 text-xs font-bold uppercase">{supplierName}</td>
                      </tr>
                      {rows.map((r) => (
                        <tr key={supplierName + r.materialName} className="border-b last:border-0">
                          <td className="py-1.5 font-medium">{r.materialName}</td>
                          {branches.map((b) => (
                            <Fragment key={b}>
                              <td className="border-l py-1.5 text-right">{r.byBranch[b] ? fmtNum(r.byBranch[b]) : <span className="text-slate-300">0</span>}</td>
                              <td className="py-1.5 text-right text-emerald-700">{r.approvedByBranch[b] ? fmtNum(r.approvedByBranch[b]) : <span className="text-slate-300">0</span>}</td>
                            </Fragment>
                          ))}
                          <td className="border-l py-1.5 text-right font-bold">{fmtNum(r.total)}</td>
                          <td className="py-1.5 text-right text-emerald-700">{fmtNum(r.approved)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                  <tr className="border-t-2 bg-slate-50 font-bold">
                    <td className="py-2 text-xs uppercase">Total general</td>
                    {branches.map((b) => (
                      <Fragment key={b}>
                        <td className="border-l py-2 text-right">{fmtNum(totals.byBranch[b])}</td>
                        <td className="py-2 text-right text-emerald-700">{fmtNum(totals.approvedByBranch[b])}</td>
                      </Fragment>
                    ))}
                    <td className="border-l py-2 text-right">{fmtNum(totals.total)}</td>
                    <td className="py-2 text-right text-emerald-700">{fmtNum(totals.approved)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

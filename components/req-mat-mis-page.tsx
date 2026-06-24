"use client"

import { useEffect, useState } from "react"
import { useAppStore, apiCallCached, apiJsonp, normalizeApiUrl } from "@/lib/store"
import { usePagination } from "@/lib/use-pagination"
import { DataPagination } from "@/components/ui/data-pagination"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ClipboardList, Eye, RefreshCcw } from "lucide-react"
import { REQ_STATUS_BADGE, REQ_STATUS_LABEL, ITEM_STATUS_BADGE, ITEM_STATUS_LABEL, fmtNum } from "@/lib/materials-client"
import type { Requisition, ReqStatus } from "@/lib/materials-client"

export function ReqMatMisPage() {
  const { apiUrl, showToast } = useAppStore()
  const [items, setItems] = useState<Requisition[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState("todas")
  const [detail, setDetail] = useState<Requisition | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await apiCallCached(normalizeApiUrl(apiUrl), { action: "getMyRequisitions", status })
      if (res?.ok) setItems((res.records as Requisition[]) || [])
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al cargar", "error")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [apiUrl, status])

  const pag = usePagination(items, { initialPageSize: 50, resetKey: status })

  const openDetail = async (r: Requisition) => {
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getRequisition", id: r.id })
      if (res?.ok) setDetail(res.record as Requisition)
      else showToast((res as { error?: string })?.error || "No se pudo abrir", "error")
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error", "error")
    }
  }

  return (
    <div className="space-y-5">
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ClipboardList className="h-4 w-4 text-[color:var(--brand-primary)]" /> Mis requisiciones
            <Badge variant="secondary">{items.length}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 w-48"><SelectValue placeholder="Estado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todos los estados</SelectItem>
                {(Object.keys(REQ_STATUS_LABEL) as ReqStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>{REQ_STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" className="h-9" onClick={load}><RefreshCcw className="h-4 w-4" /></Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="p-0">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Cargando...</div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No hay requisiciones todavía.</div>
          ) : (
            <div className="divide-y">
              {pag.pageItems.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{r.branch}</span>
                      <Badge variant="outline" className={REQ_STATUS_BADGE[r.status]}>{REQ_STATUS_LABEL[r.status]}</Badge>
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {r.itemsCount ?? 0} materiales · total {fmtNum(r.totalQty)} · {r.requestedAt ? r.requestedAt.slice(0, 10) : (r.createdAt || "").slice(0, 10)}
                      {r.notes ? ` · ${r.notes}` : ""}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => openDetail(r)}><Eye className="mr-1.5 h-4 w-4" />Ver</Button>
                </div>
              ))}
            </div>
          )}
          <DataPagination page={pag.page} totalPages={pag.totalPages} total={pag.total} from={pag.from} to={pag.to} pageSize={pag.pageSize} onPage={pag.setPage} onPageSize={pag.setPageSize} label="requisiciones" />
        </CardContent>
      </Card>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {detail?.branch}
              {detail ? <Badge variant="outline" className={REQ_STATUS_BADGE[detail.status]}>{REQ_STATUS_LABEL[detail.status]}</Badge> : null}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                  <th className="py-1.5">Material</th>
                  <th className="py-1.5">Proveedor</th>
                  <th className="py-1.5 text-right">Solicitado</th>
                  <th className="py-1.5 text-right">Aprobado</th>
                  <th className="py-1.5 text-right">Recibido</th>
                  <th className="py-1.5">Estado</th>
                </tr>
              </thead>
              <tbody>
                {(detail?.items || []).map((it) => (
                  <tr key={it.id} className="border-b last:border-0">
                    <td className="py-1.5 font-medium">{it.materialName}</td>
                    <td className="py-1.5 text-xs text-muted-foreground">{it.supplierGroup}</td>
                    <td className="py-1.5 text-right">{fmtNum(it.requestedQty)}</td>
                    <td className="py-1.5 text-right">{it.approvedQty == null ? "—" : fmtNum(it.approvedQty)}</td>
                    <td className="py-1.5 text-right">{it.receivedQty == null ? "—" : fmtNum(it.receivedQty)}</td>
                    <td className="py-1.5"><Badge variant="outline" className={ITEM_STATUS_BADGE[it.status]}>{ITEM_STATUS_LABEL[it.status]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

"use client"

import { useEffect, useState } from "react"
import { useAppStore, apiCallCached, apiJsonp, normalizeApiUrl, invalidateReadCache } from "@/lib/store"
import { usePagination } from "@/lib/use-pagination"
import { DataPagination } from "@/components/ui/data-pagination"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ShieldCheck, Check, X, ShoppingCart, PackageCheck, CheckCheck, RefreshCcw, Settings2 } from "lucide-react"
import { REQ_STATUS_BADGE, REQ_STATUS_LABEL, ITEM_STATUS_BADGE, ITEM_STATUS_LABEL, fmtNum } from "@/lib/materials-client"
import type { Requisition, ReqItem, ReqStatus } from "@/lib/materials-client"

export function ReqMatAprobacionesPage() {
  const { apiUrl, showToast } = useAppStore()
  const [items, setItems] = useState<Requisition[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState("todas")
  const [detail, setDetail] = useState<Requisition | null>(null)
  const [edit, setEdit] = useState<Record<string, { qty: string; note: string; supplier: string; cost: string }>>({})
  const [busy, setBusy] = useState(false)

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

  const openDetail = async (r: Requisition) => {
    const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getRequisition", id: r.id })
    if (res?.ok) {
      const req = res.record as Requisition
      setDetail(req)
      const e: typeof edit = {}
      ;(req.items || []).forEach((it) => {
        e[it.id] = {
          qty: String(it.approvedQty ?? it.requestedQty ?? ""),
          note: it.approvalNote || "",
          supplier: it.purchasedSupplier || "",
          cost: it.purchasedCost != null ? String(it.purchasedCost) : "",
        }
      })
      setEdit(e)
    } else showToast((res as { error?: string })?.error || "No se pudo abrir", "error")
  }

  const refreshDetail = async () => {
    if (detail) await openDetail(detail)
    await load()
  }

  const act = async (action: string, extra: Record<string, string>) => {
    setBusy(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action, ...extra })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "Error")
      invalidateReadCache("getMyRequisitions")
      invalidateReadCache("getMaterialConsolidado")
      await refreshDetail()
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error", "error")
    } finally {
      setBusy(false)
    }
  }

  const approveItem = (it: ReqItem) => act("approveMaterialItem", { id: it.id, approvedQty: edit[it.id]?.qty || "0", approvalNote: edit[it.id]?.note || "" })
  const rejectItem = (it: ReqItem) => {
    const reason = edit[it.id]?.note?.trim()
    if (!reason) return showToast("Escribe el motivo en la columna observación antes de rechazar", "error")
    return act("rejectMaterialItem", { id: it.id, reason })
  }
  const purchaseItem = (it: ReqItem) => act("purchaseMaterialItem", { id: it.id, purchasedQty: edit[it.id]?.qty || "0", purchasedSupplier: edit[it.id]?.supplier || "", purchasedCost: edit[it.id]?.cost || "" })
  const receiveItem = (it: ReqItem) => act("receiveMaterialItem", { id: it.id, receivedQty: edit[it.id]?.qty || "0", receptionNote: edit[it.id]?.note || "" })
  const approveAll = async () => {
    if (!detail) return
    await act("approveAllRequisition", { id: detail.id })
    showToast("Requisición aprobada", "success")
  }

  const setE = (id: string, patch: Partial<{ qty: string; note: string; supplier: string; cost: string }>) =>
    setEdit((p) => ({ ...p, [id]: { ...(p[id] || { qty: "", note: "", supplier: "", cost: "" }), ...patch } }))

  const pag = usePagination(items, { initialPageSize: 50, resetKey: status })

  return (
    <div className="space-y-5">
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-[color:var(--brand-primary)]" /> Aprobaciones y seguimiento
            <Badge variant="secondary">{items.length}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todos los estados</SelectItem>
                {(Object.keys(REQ_STATUS_LABEL) as ReqStatus[]).map((s) => <SelectItem key={s} value={s}>{REQ_STATUS_LABEL[s]}</SelectItem>)}
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
            <div className="py-10 text-center text-sm text-muted-foreground">No hay requisiciones.</div>
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
                      {r.itemsCount ?? 0} materiales · {(r.requestedAt || r.createdAt || "").slice(0, 10)}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => openDetail(r)}><Settings2 className="mr-1.5 h-4 w-4" />Gestionar</Button>
                </div>
              ))}
            </div>
          )}
          <DataPagination page={pag.page} totalPages={pag.totalPages} total={pag.total} from={pag.from} to={pag.to} pageSize={pag.pageSize} onPage={pag.setPage} onPageSize={pag.setPageSize} label="requisiciones" />
        </CardContent>
      </Card>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {detail?.branch}
              {detail ? <Badge variant="outline" className={REQ_STATUS_BADGE[detail.status]}>{REQ_STATUS_LABEL[detail.status]}</Badge> : null}
              <Button size="sm" className="ml-auto" onClick={approveAll} disabled={busy}><CheckCheck className="mr-1.5 h-4 w-4" />Aprobar todo</Button>
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                  <th className="py-1.5">Material</th>
                  <th className="py-1.5 text-right">Sol.</th>
                  <th className="py-1.5">Cantidad / Costo</th>
                  <th className="py-1.5">Observación / Suplidor</th>
                  <th className="py-1.5">Estado</th>
                  <th className="py-1.5 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {(detail?.items || []).map((it) => {
                  const e = edit[it.id] || { qty: "", note: "", supplier: "", cost: "" }
                  const canApprove = it.status === "enviada"
                  const canPurchase = it.status === "aprobada"
                  const canReceive = it.status === "comprada" || it.status === "recibida_parcial"
                  return (
                    <tr key={it.id} className="border-b align-top last:border-0">
                      <td className="py-2 font-medium">{it.materialName}<div className="text-[11px] text-muted-foreground">{it.supplierGroup}</div></td>
                      <td className="py-2 text-right">{fmtNum(it.requestedQty)}</td>
                      <td className="py-2">
                        <Input className="h-8 w-24" type="number" min={0} value={e.qty} onChange={(ev) => setE(it.id, { qty: ev.target.value })} placeholder="Cant." />
                        {canPurchase ? <Input className="mt-1 h-8 w-24" value={e.cost} onChange={(ev) => setE(it.id, { cost: ev.target.value })} placeholder="Costo" /> : null}
                      </td>
                      <td className="py-2">
                        <Input className="h-8" value={e.note} onChange={(ev) => setE(it.id, { note: ev.target.value })} placeholder="Observación / motivo" />
                        {canPurchase ? <Input className="mt-1 h-8" value={e.supplier} onChange={(ev) => setE(it.id, { supplier: ev.target.value })} placeholder="Suplidor final" /> : null}
                      </td>
                      <td className="py-2"><Badge variant="outline" className={ITEM_STATUS_BADGE[it.status]}>{ITEM_STATUS_LABEL[it.status]}</Badge></td>
                      <td className="py-2">
                        <div className="flex flex-col items-end gap-1">
                          {canApprove ? (
                            <>
                              <Button size="sm" className="h-7 w-full" disabled={busy} onClick={() => approveItem(it)}><Check className="mr-1 h-3.5 w-3.5" />Aprobar</Button>
                              <Button size="sm" variant="outline" className="h-7 w-full text-red-600" disabled={busy} onClick={() => rejectItem(it)}><X className="mr-1 h-3.5 w-3.5" />Rechazar</Button>
                            </>
                          ) : canPurchase ? (
                            <Button size="sm" className="h-7 w-full" disabled={busy} onClick={() => purchaseItem(it)}><ShoppingCart className="mr-1 h-3.5 w-3.5" />Comprar</Button>
                          ) : canReceive ? (
                            <Button size="sm" className="h-7 w-full" disabled={busy} onClick={() => receiveItem(it)}><PackageCheck className="mr-1 h-3.5 w-3.5" />Recibir</Button>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

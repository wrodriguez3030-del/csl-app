"use client"

import { useEffect, useState, type ReactNode } from "react"
import { useAppStore, apiCallCached, apiJsonp, normalizeApiUrl, invalidateReadCache } from "@/lib/store"
import { useSessionUser } from "@/hooks/use-session-user"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { usePagination } from "@/lib/use-pagination"
import { DataPagination } from "@/components/ui/data-pagination"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ShieldCheck, Check, X, ShoppingCart, PackageCheck, CheckCheck, RefreshCcw, Settings2,
  MoreVertical, Eye, CornerUpLeft, Send, Printer, SlidersHorizontal, Trash2, RotateCcw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { REQ_STATUS_BADGE, REQ_STATUS_LABEL, ITEM_STATUS_BADGE, ITEM_STATUS_LABEL, fmtNum } from "@/lib/materials-client"
import { printRequisitionPdf } from "@/lib/materials-export"
import type { Requisition, ReqItem, ReqStatus } from "@/lib/materials-client"

// Estados en los que el creador (no admin) ya no puede eliminar por su cuenta.
const LOCKED_FOR_CREATOR: ReqStatus[] = ["aprobada", "comprada", "recibida_parcial", "recibida_completa"]
const PENDING: ReqStatus[] = ["enviada", "en_revision"]
const RESUBMITTABLE: ReqStatus[] = ["rechazada", "devuelta"]

type ReasonKind = "rechazar" | "devolver"

export function ReqMatAprobacionesPage() {
  const { apiUrl, showToast } = useAppStore()
  const user = useSessionUser()
  const business = useCurrentBusiness()
  const isManager = Boolean(user?.isAdmin || user?.isSuperadmin)

  const [items, setItems] = useState<Requisition[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState("todas")
  const [detail, setDetail] = useState<Requisition | null>(null)
  const [edit, setEdit] = useState<Record<string, { qty: string; note: string; supplier: string; cost: string }>>({})
  const [busy, setBusy] = useState(false)

  // Modales del menú de acciones
  const [delTarget, setDelTarget] = useState<Requisition | null>(null)
  const [delReason, setDelReason] = useState("")
  const [reason, setReason] = useState<{ kind: ReasonKind; req: Requisition } | null>(null)
  const [reasonText, setReasonText] = useState("")
  const [statusTarget, setStatusTarget] = useState<Requisition | null>(null)
  const [statusValue, setStatusValue] = useState<ReqStatus>("enviada")

  const viewingDeleted = status === "eliminadas"

  const load = async () => {
    setLoading(true)
    try {
      const req: Record<string, string> = viewingDeleted
        ? { action: "getMyRequisitions", deleted: "1" }
        : { action: "getMyRequisitions", status }
      const res = await apiCallCached(normalizeApiUrl(apiUrl), req)
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

  // ── Acciones a nivel de requisición (menú "Acciones") ──────────────────────
  const invalidateLists = () => {
    invalidateReadCache("getMyRequisitions")
    invalidateReadCache("getMaterialConsolidado")
    invalidateReadCache("getMaterialDashboard")
  }
  const runReqAction = async (action: string, extra: Record<string, string>, successMsg: string): Promise<boolean> => {
    setBusy(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action, ...extra })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "Error")
      invalidateLists()
      showToast(successMsg, "success")
      await load()
      return true
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error", "error")
      return false
    } finally {
      setBusy(false)
    }
  }

  // Permiso granular espejo del backend (materials.ts PERM_REQ_DELETE):
  // habilita Eliminar a un usuario normal (p.ej. Carlos Arias, compras) sin
  // elevarlo a admin. La validación real la hace SIEMPRE el backend.
  const hasDeletePerm = Boolean(user?.permissions?.includes("material_requisitions.delete"))
  const canDelete = (r: Requisition): boolean => {
    if (isManager || hasDeletePerm) return true
    const isCreator = Boolean(user?.id && r.requestedBy && String(user.id) === String(r.requestedBy))
    return isCreator && !LOCKED_FOR_CREATOR.includes(r.status)
  }

  const doApprove = (r: Requisition) => runReqAction("approveAllRequisition", { id: r.id }, "Requisición aprobada")
  const doResubmit = (r: Requisition) => runReqAction("submitRequisition", { id: r.id }, "Requisición reenviada")
  const doRestore = (r: Requisition) => runReqAction("restoreRequisition", { id: r.id }, "Requisición restaurada")

  const openPrint = async (r: Requisition) => {
    const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getRequisition", id: r.id })
    if (res?.ok) printRequisitionPdf(res.record as Requisition, business.name)
    else showToast((res as { error?: string })?.error || "No se pudo abrir", "error")
  }

  const confirmDelete = async () => {
    if (!delTarget) return
    const ok = await runReqAction("deleteRequisition", { id: delTarget.id, reason: delReason.trim() }, "Requisición eliminada correctamente.")
    if (ok) { setDelTarget(null); setDelReason("") }
  }
  const confirmReason = async () => {
    if (!reason) return
    const txt = reasonText.trim()
    if (!txt) return showToast(reason.kind === "rechazar" ? "Indica el motivo del rechazo" : "Indica el motivo de la devolución", "error")
    const action = reason.kind === "rechazar" ? "rejectRequisition" : "returnRequisition"
    const msg = reason.kind === "rechazar" ? "Requisición rechazada" : "Requisición devuelta para corrección"
    const ok = await runReqAction(action, { id: reason.req.id, reason: txt }, msg)
    if (ok) { setReason(null); setReasonText("") }
  }
  const confirmStatus = async () => {
    if (!statusTarget) return
    const ok = await runReqAction("setRequisitionStatus", { id: statusTarget.id, status: statusValue }, "Estado actualizado")
    if (ok) setStatusTarget(null)
  }

  // ── Acciones del diálogo Gestionar (por ítem) ──────────────────────────────
  const approveItem = (it: ReqItem) => act("approveMaterialItem", { id: it.id, approvedQty: edit[it.id]?.qty || "0", approvalNote: edit[it.id]?.note || "" })
  const rejectItem = (it: ReqItem) => {
    const r = edit[it.id]?.note?.trim()
    if (!r) return showToast("Escribe el motivo en la columna observación antes de rechazar", "error")
    return act("rejectMaterialItem", { id: it.id, reason: r })
  }
  const purchaseItem = (it: ReqItem) => act("purchaseMaterialItem", { id: it.id, purchasedQty: edit[it.id]?.qty || "0", purchasedSupplier: edit[it.id]?.supplier || "", purchasedCost: edit[it.id]?.cost || "" })
  const receiveItem = (it: ReqItem) => act("receiveMaterialItem", { id: it.id, receivedQty: edit[it.id]?.qty || "0", receptionNote: edit[it.id]?.note || "" })
  const approveAll = async () => {
    if (!detail) return
    await act("approveAllRequisition", { id: detail.id })
    showToast("Requisición aprobada", "success")
  }
  // "Rechazar todo" desde el detalle: cierra el modal y abre el de motivo
  // reutilizando el flujo de rechazo a nivel de requisición completa.
  const rejectAllFromDetail = () => {
    if (!detail) return
    const req = detail
    setDetail(null)
    setReason({ kind: "rechazar", req })
    setReasonText("")
  }

  const setE = (id: string, patch: Partial<{ qty: string; note: string; supplier: string; cost: string }>) =>
    setEdit((p) => ({ ...p, [id]: { ...(p[id] || { qty: "", note: "", supplier: "", cost: "" }), ...patch } }))

  // Acciones por ítem en horizontal, reutilizadas en tabla (desktop) y tarjetas (móvil).
  const renderItemActions = (it: ReqItem, align: string): ReactNode => {
    if (detail?.deletedAt) return <span className="text-[11px] text-muted-foreground">—</span>
    const canApprove = it.status === "enviada"
    const canPurchase = it.status === "aprobada"
    const canReceive = it.status === "comprada" || it.status === "recibida_parcial"
    const wrap = (children: ReactNode) => <div className={cn("flex flex-wrap items-center gap-2", align)}>{children}</div>
    if (canApprove)
      return wrap(
        <>
          <Button size="sm" className="h-8" disabled={busy} onClick={() => approveItem(it)}><Check className="mr-1 h-3.5 w-3.5" />Aprobar</Button>
          <Button size="sm" variant="outline" className="h-8 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700" disabled={busy} onClick={() => rejectItem(it)}><X className="mr-1 h-3.5 w-3.5" />Rechazar</Button>
        </>,
      )
    if (canPurchase) return wrap(<Button size="sm" className="h-8" disabled={busy} onClick={() => purchaseItem(it)}><ShoppingCart className="mr-1 h-3.5 w-3.5" />Comprar</Button>)
    if (canReceive) return wrap(<Button size="sm" className="h-8" disabled={busy} onClick={() => receiveItem(it)}><PackageCheck className="mr-1 h-3.5 w-3.5" />Recibir</Button>)
    return <span className="text-[11px] text-muted-foreground">—</span>
  }

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
                {isManager ? <SelectItem value="eliminadas">Eliminadas</SelectItem> : null}
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
            <div className="py-10 text-center text-sm text-muted-foreground">{viewingDeleted ? "No hay requisiciones eliminadas." : "No hay requisiciones."}</div>
          ) : (
            <div className="divide-y">
              {pag.pageItems.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{r.branch}</span>
                      <Badge variant="outline" className={REQ_STATUS_BADGE[r.status]}>{REQ_STATUS_LABEL[r.status]}</Badge>
                      {r.deletedAt ? <Badge variant="outline" className="bg-red-50 text-red-600 border-red-200">Eliminada</Badge> : null}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {r.itemsCount ?? 0} materiales · {(r.requestedAt || r.createdAt || "").slice(0, 10)}
                      {r.deletedReason ? ` · Motivo: ${r.deletedReason}` : ""}
                    </div>
                  </div>

                  {viewingDeleted ? (
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={() => openDetail(r)}><Eye className="mr-1.5 h-4 w-4" />Ver detalle</Button>
                      {isManager ? <Button variant="outline" size="sm" disabled={busy} onClick={() => doRestore(r)}><RotateCcw className="mr-1.5 h-4 w-4" />Restaurar</Button> : null}
                    </div>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-9"><MoreVertical className="mr-1.5 h-4 w-4" />Acciones</Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel>{r.branch}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => openDetail(r)}><Eye className="mr-2 h-4 w-4" />Ver detalle</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openDetail(r)}><Settings2 className="mr-2 h-4 w-4" />Gestionar</DropdownMenuItem>
                        {PENDING.includes(r.status) ? (
                          <>
                            <DropdownMenuItem onClick={() => doApprove(r)}><Check className="mr-2 h-4 w-4" />Aprobar todo</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setReason({ kind: "rechazar", req: r }); setReasonText("") }}><X className="mr-2 h-4 w-4" />Rechazar</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setReason({ kind: "devolver", req: r }); setReasonText("") }}><CornerUpLeft className="mr-2 h-4 w-4" />Devolver / corrección</DropdownMenuItem>
                          </>
                        ) : null}
                        {RESUBMITTABLE.includes(r.status) ? (
                          <DropdownMenuItem onClick={() => doResubmit(r)}><Send className="mr-2 h-4 w-4" />Reenviar</DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem onClick={() => openPrint(r)}><Printer className="mr-2 h-4 w-4" />Imprimir / PDF</DropdownMenuItem>
                        {isManager ? (
                          <DropdownMenuItem onClick={() => { setStatusTarget(r); setStatusValue(r.status) }}><SlidersHorizontal className="mr-2 h-4 w-4" />Cambiar estado</DropdownMenuItem>
                        ) : null}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          disabled={!canDelete(r)}
                          title={canDelete(r) ? undefined : "No tienes permiso para eliminar esta requisición."}
                          className={canDelete(r) ? "text-red-600 focus:text-red-600" : undefined}
                          onClick={() => { if (canDelete(r)) { setDelTarget(r); setDelReason("") } }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />Eliminar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              ))}
            </div>
          )}
          <DataPagination page={pag.page} totalPages={pag.totalPages} total={pag.total} from={pag.from} to={pag.to} pageSize={pag.pageSize} onPage={pag.setPage} onPageSize={pag.setPageSize} label="requisiciones" />
        </CardContent>
      </Card>

      {/* Diálogo Gestionar (por ítem) — ancho amplio, cabecera fija, scroll interno */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="flex max-h-[90vh] w-[calc(100vw-48px)] max-w-[1400px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1400px]">
          {/* Cabecera fija */}
          <DialogHeader className="shrink-0 border-b border-[color:var(--brand-border)] px-6 py-4 pr-14 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle className="text-lg">{detail?.branch}</DialogTitle>
              {detail ? <Badge variant="outline" className={REQ_STATUS_BADGE[detail.status]}>{REQ_STATUS_LABEL[detail.status]}</Badge> : null}
              <span className="text-xs text-muted-foreground">{detail?.items?.length ?? detail?.itemsCount ?? 0} materiales</span>
              {detail && !detail.deletedAt ? (
                <div className="ml-auto flex items-center gap-2">
                  {PENDING.includes(detail.status) ? (
                    <Button size="sm" variant="outline" className="h-8 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700" onClick={rejectAllFromDetail} disabled={busy}>
                      <X className="mr-1.5 h-4 w-4" />Rechazar todo
                    </Button>
                  ) : null}
                  <Button size="sm" className="h-8" onClick={approveAll} disabled={busy}>
                    <CheckCheck className="mr-1.5 h-4 w-4" />Aprobar todo
                  </Button>
                </div>
              ) : null}
            </div>
          </DialogHeader>

          {/* Cuerpo con scroll vertical interno */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {/* Desktop / tablet: tabla de ancho completo con columnas proporcionales */}
            <table className="hidden w-full table-fixed text-sm md:table">
              <colgroup>
                <col style={{ width: "22%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "24%" }} />
              </colgroup>
              <thead>
                <tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                  <th className="py-1.5 pr-2">Material</th>
                  <th className="py-1.5 pr-2 text-center">Solicitado</th>
                  <th className="py-1.5 pr-2">Cant. aprobada</th>
                  <th className="py-1.5 pr-2">Observación / suplidor</th>
                  <th className="py-1.5 pr-2">Estado</th>
                  <th className="py-1.5 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {(detail?.items || []).map((it) => {
                  const e = edit[it.id] || { qty: "", note: "", supplier: "", cost: "" }
                  const canPurchase = it.status === "aprobada"
                  return (
                    <tr key={it.id} className="border-b align-top last:border-0">
                      <td className="py-2 pr-2">
                        <div className="font-medium break-words">{it.materialName}</div>
                        <div className="text-[11px] text-muted-foreground break-words">{it.supplierGroup}</div>
                      </td>
                      <td className="py-2 pr-2 text-center tabular-nums">{fmtNum(it.requestedQty)}</td>
                      <td className="py-2 pr-2">
                        <Input className="h-8 w-20 text-center" type="number" min={0} value={e.qty} onChange={(ev) => setE(it.id, { qty: ev.target.value })} placeholder="Cant." />
                        {canPurchase ? <Input className="mt-1 h-8 w-24 text-center" value={e.cost} onChange={(ev) => setE(it.id, { cost: ev.target.value })} placeholder="Costo" /> : null}
                      </td>
                      <td className="py-2 pr-2">
                        <Input className="h-8 w-full" value={e.note} onChange={(ev) => setE(it.id, { note: ev.target.value })} placeholder="Observación / motivo" />
                        {canPurchase ? <Input className="mt-1 h-8 w-full" value={e.supplier} onChange={(ev) => setE(it.id, { supplier: ev.target.value })} placeholder="Suplidor final" /> : null}
                      </td>
                      <td className="py-2 pr-2"><Badge variant="outline" className={ITEM_STATUS_BADGE[it.status]}>{ITEM_STATUS_LABEL[it.status]}</Badge></td>
                      <td className="py-2">{renderItemActions(it, "justify-end")}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Móvil: tarjetas apiladas (sin scroll horizontal) */}
            <div className="space-y-3 md:hidden">
              {(detail?.items || []).map((it) => {
                const e = edit[it.id] || { qty: "", note: "", supplier: "", cost: "" }
                const canPurchase = it.status === "aprobada"
                return (
                  <div key={it.id} className="rounded-lg border border-[color:var(--brand-border)] p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium break-words">{it.materialName}</div>
                        <div className="text-[11px] text-muted-foreground break-words">{it.supplierGroup}</div>
                      </div>
                      <Badge variant="outline" className={ITEM_STATUS_BADGE[it.status]}>{ITEM_STATUS_LABEL[it.status]}</Badge>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      Solicitado: <b className="text-foreground tabular-nums">{fmtNum(it.requestedQty)}</b>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Input className="h-8 w-24 text-center" type="number" min={0} value={e.qty} onChange={(ev) => setE(it.id, { qty: ev.target.value })} placeholder="Cant. aprob." />
                      {canPurchase ? <Input className="h-8 w-24 text-center" value={e.cost} onChange={(ev) => setE(it.id, { cost: ev.target.value })} placeholder="Costo" /> : null}
                    </div>
                    <Input className="mt-2 h-8 w-full" value={e.note} onChange={(ev) => setE(it.id, { note: ev.target.value })} placeholder="Observación / motivo" />
                    {canPurchase ? <Input className="mt-2 h-8 w-full" value={e.supplier} onChange={(ev) => setE(it.id, { supplier: ev.target.value })} placeholder="Suplidor final" /> : null}
                    <div className="mt-3">{renderItemActions(it, "justify-start")}</div>
                  </div>
                )
              })}
              {(detail?.items || []).length === 0 ? <div className="py-6 text-center text-sm text-muted-foreground">Sin materiales.</div> : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Eliminar requisición */}
      <Dialog open={!!delTarget} onOpenChange={(o) => { if (!o) { setDelTarget(null); setDelReason("") } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-red-600">Eliminar requisición</DialogTitle></DialogHeader>
          {delTarget ? (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Esta requisición será quitada de las listas activas. El historial se conservará para auditoría.
              </p>
              {LOCKED_FOR_CREATOR.includes(delTarget.status) ? (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
                  ⚠ Esta requisición ya está <b>{REQ_STATUS_LABEL[delTarget.status]}</b>. Eliminarla la sacará de los totales activos.
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-2 rounded-md border p-2 text-[12px]">
                <div><span className="text-muted-foreground">Sucursal:</span> <b>{delTarget.branch}</b></div>
                <div><span className="text-muted-foreground">Estado:</span> <b>{REQ_STATUS_LABEL[delTarget.status]}</b></div>
                <div><span className="text-muted-foreground">Fecha:</span> {(delTarget.requestedAt || delTarget.createdAt || "").slice(0, 10)}</div>
                <div><span className="text-muted-foreground">Materiales:</span> {delTarget.itemsCount ?? 0}</div>
              </div>
              <div>
                <Label className="text-xs">Motivo de eliminación (opcional)</Label>
                <Input className="mt-1 h-9" value={delReason} onChange={(e) => setDelReason(e.target.value)} placeholder="Ej. duplicada, error de captura..." />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDelTarget(null); setDelReason("") }} disabled={busy}>Cancelar</Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={confirmDelete} disabled={busy}><Trash2 className="mr-1.5 h-4 w-4" />Eliminar requisición</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Rechazar / Devolver (motivo) */}
      <Dialog open={!!reason} onOpenChange={(o) => { if (!o) { setReason(null); setReasonText("") } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{reason?.kind === "rechazar" ? "Rechazar requisición" : "Devolver para corrección"}</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              {reason?.kind === "rechazar"
                ? "Se rechazará la requisición completa. Indica el motivo."
                : "Se devolverá a la encargada para que la corrija y la reenvíe. Indica el motivo."}
            </p>
            <Label className="text-xs">Motivo *</Label>
            <Input className="h-9" value={reasonText} onChange={(e) => setReasonText(e.target.value)} placeholder="Motivo..." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReason(null); setReasonText("") }} disabled={busy}>Cancelar</Button>
            <Button onClick={confirmReason} disabled={busy}>{reason?.kind === "rechazar" ? "Rechazar" : "Devolver"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Cambiar estado (admin/superadmin) */}
      <Dialog open={!!statusTarget} onOpenChange={(o) => { if (!o) setStatusTarget(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Cambiar estado</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">{statusTarget?.branch} · actual: <b>{statusTarget ? REQ_STATUS_LABEL[statusTarget.status] : ""}</b></p>
            <Label className="text-xs">Nuevo estado</Label>
            <Select value={statusValue} onValueChange={(v) => setStatusValue(v as ReqStatus)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(REQ_STATUS_LABEL) as ReqStatus[]).map((s) => <SelectItem key={s} value={s}>{REQ_STATUS_LABEL[s]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusTarget(null)} disabled={busy}>Cancelar</Button>
            <Button onClick={confirmStatus} disabled={busy}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
